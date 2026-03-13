use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tracing::{info, instrument};

use crate::dto::DtoObject;
use crate::error::{GraphError, Result, SmartCrabError};
use crate::node::{AnyNode, HiddenNode, InputNode, OutputNode};
use crate::storage::Storage;

type ConditionFn = Box<dyn Fn(&dyn DtoObject) -> Option<String> + Send + Sync>;

/// Specifies when and how a `DirectedGraph` is triggered.
#[derive(Debug, Clone)]
pub enum TriggerKind {
    /// Triggered once at application startup.
    Startup,
    /// Triggered by a chat event (e.g. Discord mention or DM).
    ///
    /// `platform` routes the graph to the correct `ChatGateway`.
    /// If `None`, defaults to the first registered gateway.
    ///
    /// `token` is the platform bot token. If `None`, falls back to the
    /// Runtime-level token or the `DISCORD_TOKEN` environment variable.
    Chat {
        /// Platform identifier for routing to the correct `ChatGateway`.
        /// `None` defaults to the first registered gateway.
        platform: Option<String>,
        triggers: Vec<String>,
        token: Option<String>,
    },
    /// Triggered on a cron schedule.
    Cron { schedule: String },
}

impl TriggerKind {
    /// Create a Chat trigger. Routes to the first registered gateway by default.
    #[must_use]
    pub fn chat(triggers: Vec<String>, token: Option<String>) -> Self {
        TriggerKind::Chat {
            platform: None,
            triggers,
            token,
        }
    }

    /// Create a Discord-specific Chat trigger.
    #[must_use]
    pub fn discord(triggers: Vec<String>, token: Option<String>) -> Self {
        TriggerKind::Chat {
            platform: Some("discord".into()),
            triggers,
            token,
        }
    }
}

enum Edge {
    Unconditional {
        from: String,
        to: String,
    },
    Conditional {
        from: String,
        condition: ConditionFn,
        branches: HashMap<String, String>,
    },
    Exit {
        from: String,
        condition: ConditionFn,
    },
}

pub struct DirectedGraph {
    name: String,
    description: Option<String>,
    nodes: HashMap<String, AnyNode>,
    edges: Vec<Edge>,
    execution_order: Vec<String>,
    trigger_kind: Option<TriggerKind>,
    storage: Option<Arc<dyn Storage>>,
}

pub struct EdgeInfo {
    pub from: String,
    pub to: String,
    pub label: Option<String>,
}

impl DirectedGraph {
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    #[must_use]
    pub fn nodes(&self) -> &HashMap<String, AnyNode> {
        &self.nodes
    }

    #[must_use]
    pub fn execution_order(&self) -> &[String] {
        &self.execution_order
    }

    #[must_use]
    pub fn trigger_kind(&self) -> Option<&TriggerKind> {
        self.trigger_kind.as_ref()
    }

    #[must_use]
    pub fn storage(&self) -> Option<&Arc<dyn Storage>> {
        self.storage.as_ref()
    }

    #[must_use]
    pub fn edge_infos(&self) -> Vec<EdgeInfo> {
        let mut infos = Vec::new();
        for edge in &self.edges {
            match edge {
                Edge::Unconditional { from, to } => {
                    infos.push(EdgeInfo {
                        from: from.clone(),
                        to: to.clone(),
                        label: None,
                    });
                }
                Edge::Conditional { from, branches, .. } => {
                    for (label, to) in branches {
                        infos.push(EdgeInfo {
                            from: from.clone(),
                            to: to.clone(),
                            label: Some(label.clone()),
                        });
                    }
                }
                Edge::Exit { from: _, .. } => {}
            }
        }
        infos
    }

    /// Run the graph with a unit trigger (backward-compatible shortcut).
    ///
    /// # Errors
    ///
    /// Returns an error if any node in the graph fails during execution.
    #[instrument(skip(self), fields(graph = %self.name))]
    pub async fn run(&self) -> Result<()> {
        self.run_with_trigger(Box::new(())).await
    }

    /// Run the graph, passing `trigger_data` to the `InputNode`.
    ///
    /// # Errors
    ///
    /// Returns an error if any node in the graph fails during execution or if
    /// a node is unreachable.
    ///
    /// # Panics
    ///
    /// Panics if a node name present in the execution order is not found in the
    /// nodes map (which should never happen for a correctly built graph).
    #[instrument(skip(self, trigger_data), fields(graph = %self.name))]
    pub async fn run_with_trigger(&self, trigger_data: Box<dyn DtoObject>) -> Result<()> {
        let mut outputs: HashMap<String, Box<dyn DtoObject>> = HashMap::new();
        let mut completed: HashSet<String> = HashSet::new();

        loop {
            let executables = self.find_executable_nodes(&outputs, &completed);

            if executables.is_empty() {
                info!(graph = %self.name, "all nodes completed");
                break;
            }

            for node_name in &executables {
                let Some(node) = self.nodes.get(node_name) else {
                    return Err(SmartCrabError::Graph(GraphError::UnreachableNode {
                        name: node_name.clone(),
                    }));
                };

                info!(node = %node_name, "executing node");

                match node {
                    AnyNode::Input(node) => {
                        let output = node.run_dyn(trigger_data.as_ref()).await.map_err(|e| {
                            SmartCrabError::Graph(GraphError::NodeFailed {
                                name: node_name.clone(),
                                source: Box::new(e),
                            })
                        })?;
                        outputs.insert(node_name.clone(), output);
                        completed.insert(node_name.clone());
                    }
                    AnyNode::Hidden(node) => {
                        let input = self.resolve_input(node_name, &outputs)?;
                        let output = node.run_dyn(input.as_ref()).await.map_err(|e| {
                            SmartCrabError::Graph(GraphError::NodeFailed {
                                name: node_name.clone(),
                                source: Box::new(e),
                            })
                        })?;
                        outputs.insert(node_name.clone(), output);
                        completed.insert(node_name.clone());
                    }
                    AnyNode::Output(node) => {
                        let input = self.resolve_input(node_name, &outputs)?;
                        node.run_dyn(input.as_ref()).await.map_err(|e| {
                            SmartCrabError::Graph(GraphError::NodeFailed {
                                name: node_name.clone(),
                                source: Box::new(e),
                            })
                        })?;
                        completed.insert(node_name.clone());
                    }
                }

                if self.check_exit_conditions(node_name, &outputs) {
                    info!(graph = %self.name, "exit condition triggered, terminating");
                    return Ok(());
                }
            }
        }

        info!(graph = %self.name, "completed");
        Ok(())
    }

    fn find_executable_nodes(
        &self,
        outputs: &HashMap<String, Box<dyn DtoObject>>,
        completed: &HashSet<String>,
    ) -> Vec<String> {
        let mut executables = Vec::new();

        for node_name in self.nodes.keys() {
            if completed.contains(node_name) {
                continue;
            }

            if self.can_execute(node_name, outputs) {
                executables.push(node_name.clone());
            }
        }

        executables
    }

    fn can_execute(&self, node_name: &str, outputs: &HashMap<String, Box<dyn DtoObject>>) -> bool {
        for edge in &self.edges {
            match edge {
                Edge::Unconditional { from, to } if to == node_name => {
                    // Self-loops must not block the first execution
                    if from != node_name && !outputs.contains_key(from) {
                        return false;
                    }
                }
                Edge::Conditional {
                    from,
                    condition,
                    branches,
                } => {
                    if !branches.values().any(|t| t == node_name) {
                        continue;
                    }
                    if let Some(output) = outputs.get(from)
                        && let Some(branch_key) = condition(output.as_ref())
                        && branches.get(&branch_key).is_some_and(|s| s == node_name)
                    {
                        return true;
                    }
                    if !outputs.contains_key(from) {
                        return false;
                    }
                }
                Edge::Exit { from, .. } if outputs.contains_key(from) => {}
                _ => {}
            }
        }

        let has_unconditional_dep = self
            .edges
            .iter()
            .any(|edge| matches!(edge, Edge::Unconditional { to, .. } if to == node_name));
        let has_conditional_dep = self.edges.iter().any(|edge| match edge {
            Edge::Conditional { branches, .. } => branches.values().any(|t| t == node_name),
            _ => false,
        });

        if !has_unconditional_dep && !has_conditional_dep {
            return matches!(self.nodes.get(node_name), Some(AnyNode::Input(_)));
        }

        // If this node is only reachable via conditional edges and none of them selected
        // it (we would have returned `true` above), all sources have resolved to other
        // branches — this node will never be activated.
        if has_conditional_dep && !has_unconditional_dep {
            return false;
        }

        true
    }

    fn check_exit_conditions(
        &self,
        node_name: &str,
        outputs: &HashMap<String, Box<dyn DtoObject>>,
    ) -> bool {
        for edge in &self.edges {
            if let Edge::Exit { from, condition } = edge
                && from == node_name
                && let Some(output) = outputs.get(from)
            {
                return condition(output.as_ref()).is_none();
            }
        }
        false
    }

    fn resolve_input(
        &self,
        node_name: &str,
        outputs: &HashMap<String, Box<dyn DtoObject>>,
    ) -> Result<Box<dyn DtoObject>> {
        for edge in &self.edges {
            match edge {
                Edge::Unconditional { from, to } if to == node_name => {
                    if let Some(output) = outputs.get(from) {
                        return Ok(output.clone_box());
                    }
                }
                Edge::Conditional {
                    from,
                    condition,
                    branches,
                } => {
                    if let Some(output) = outputs.get(from)
                        && let Some(branch_key) = condition(output.as_ref())
                        && let Some(target) = branches.get(&branch_key)
                        && target == node_name
                    {
                        return Ok(output.clone_box());
                    }
                }
                _ => {}
            }
        }

        Err(SmartCrabError::Graph(GraphError::UnreachableNode {
            name: node_name.to_owned(),
        }))
    }
}

pub struct DirectedGraphBuilder {
    name: String,
    description: Option<String>,
    nodes: HashMap<String, AnyNode>,
    edges: Vec<Edge>,
    insertion_order: Vec<String>,
    trigger_kind: Option<TriggerKind>,
    storage: Option<Arc<dyn Storage>>,
}

impl DirectedGraphBuilder {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: None,
            nodes: HashMap::new(),
            edges: Vec::new(),
            insertion_order: Vec::new(),
            trigger_kind: None,
            storage: None,
        }
    }

    #[must_use]
    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    #[must_use]
    pub fn trigger(mut self, kind: TriggerKind) -> Self {
        self.trigger_kind = Some(kind);
        self
    }

    #[must_use]
    pub fn storage(mut self, storage: Arc<dyn Storage>) -> Self {
        self.storage = Some(storage);
        self
    }

    #[must_use]
    pub fn add_input<L: InputNode>(mut self, node: L) -> Self {
        let name = node.name().to_owned();
        self.insertion_order.push(name.clone());
        self.nodes.insert(name, AnyNode::Input(Box::new(node)));
        self
    }

    #[must_use]
    pub fn add_hidden<L: HiddenNode>(mut self, node: L) -> Self {
        let name = node.name().to_owned();
        self.insertion_order.push(name.clone());
        self.nodes.insert(name, AnyNode::Hidden(Box::new(node)));
        self
    }

    #[must_use]
    pub fn add_output<L: OutputNode>(mut self, node: L) -> Self {
        let name = node.name().to_owned();
        self.insertion_order.push(name.clone());
        self.nodes.insert(name, AnyNode::Output(Box::new(node)));
        self
    }

    #[must_use]
    pub fn add_edge(mut self, from: &str, to: &str) -> Self {
        self.edges.push(Edge::Unconditional {
            from: from.to_owned(),
            to: to.to_owned(),
        });
        self
    }

    #[must_use]
    pub fn add_conditional_edge<F, I>(mut self, from: &str, condition: F, branches: I) -> Self
    where
        F: Fn(&dyn DtoObject) -> Option<String> + Send + Sync + 'static,
        I: IntoIterator<Item = (String, String)>,
    {
        self.edges.push(Edge::Conditional {
            from: from.to_owned(),
            condition: Box::new(condition),
            branches: branches.into_iter().collect(),
        });
        self
    }

    #[must_use]
    pub fn add_exit_condition<F>(mut self, from: &str, condition: F) -> Self
    where
        F: Fn(&dyn DtoObject) -> Option<String> + Send + Sync + 'static,
    {
        self.edges.push(Edge::Exit {
            from: from.to_owned(),
            condition: Box::new(condition),
        });
        self
    }

    /// Build the `DirectedGraph`.
    ///
    /// # Errors
    ///
    /// Returns a [`GraphError`] if the graph configuration is invalid (e.g.,
    /// duplicate node names, missing input node, type mismatches on edges).
    pub fn build(self) -> std::result::Result<DirectedGraph, GraphError> {
        self.validate()?;

        Ok(DirectedGraph {
            name: self.name,
            description: self.description,
            nodes: self.nodes,
            edges: self.edges,
            execution_order: self.insertion_order,
            trigger_kind: self.trigger_kind,
            storage: self.storage,
        })
    }

    fn validate(&self) -> std::result::Result<(), GraphError> {
        {
            let mut seen = HashSet::new();
            for name in &self.insertion_order {
                if !seen.insert(name.as_str()) {
                    return Err(GraphError::DuplicateNodeName { name: name.clone() });
                }
            }
        }

        let has_input = self.nodes.values().any(|n| matches!(n, AnyNode::Input(_)));
        if !has_input {
            return Err(GraphError::NoInputNode);
        }

        if let Some(kind) = &self.trigger_kind {
            match kind {
                TriggerKind::Chat { triggers, .. } if triggers.is_empty() => {
                    return Err(GraphError::InvalidTriggerConfig {
                        message: "Chat trigger requires at least one trigger pattern".to_owned(),
                    });
                }
                TriggerKind::Cron { schedule } if schedule.is_empty() => {
                    return Err(GraphError::InvalidTriggerConfig {
                        message: "Cron trigger requires a non-empty schedule".to_owned(),
                    });
                }
                _ => {}
            }
        }

        for edge in &self.edges {
            match edge {
                Edge::Unconditional { from, to } => {
                    if !self.nodes.contains_key(from) {
                        return Err(GraphError::MissingBranch {
                            from: from.clone(),
                            target: from.clone(),
                        });
                    }
                    if !self.nodes.contains_key(to) {
                        return Err(GraphError::MissingBranch {
                            from: from.clone(),
                            target: to.clone(),
                        });
                    }
                }
                Edge::Conditional { from, branches, .. } => {
                    if !self.nodes.contains_key(from) {
                        return Err(GraphError::MissingBranch {
                            from: from.clone(),
                            target: from.clone(),
                        });
                    }
                    for target in branches.values() {
                        if !self.nodes.contains_key(target) {
                            return Err(GraphError::MissingBranch {
                                from: from.clone(),
                                target: target.clone(),
                            });
                        }
                    }
                }
                Edge::Exit { from, .. } => {
                    if !self.nodes.contains_key(from) {
                        return Err(GraphError::MissingBranch {
                            from: from.clone(),
                            target: from.clone(),
                        });
                    }
                }
            }
        }

        for edge in &self.edges {
            let pairs: Vec<(&str, &str)> = match edge {
                Edge::Unconditional { from, to } => vec![(from.as_str(), to.as_str())],
                Edge::Conditional { from, branches, .. } => branches
                    .values()
                    .map(|to| (from.as_str(), to.as_str()))
                    .collect(),
                Edge::Exit { .. } => vec![],
            };
            for (from, to) in pairs {
                if let (Some(from_node), Some(to_node)) = (self.nodes.get(from), self.nodes.get(to))
                    && let (Some(out_id), Some(in_id)) =
                        (from_node.output_type_id(), to_node.input_type_id())
                    && out_id != in_id
                {
                    return Err(GraphError::TypeMismatch {
                        from: from.to_owned(),
                        to: to.to_owned(),
                        output_type: from_node.output_type_name().unwrap_or("unknown").to_owned(),
                        input_type: to_node.input_type_name().unwrap_or("unknown").to_owned(),
                    });
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use serde::{Deserialize, Serialize};

    use super::*;
    use crate::node::{HiddenNode, InputNode, Node, OutputNode};
    use crate::storage::{InMemoryStorage, StorageExt};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct MsgA {
        text: String,
    }
    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct MsgB {
        text: String,
    }

    struct SourceNode;
    impl Node for SourceNode {
        fn name(&self) -> &'static str {
            "Source"
        }
    }
    #[async_trait]
    impl InputNode for SourceNode {
        type TriggerData = ();
        type Output = MsgA;
        async fn run(&self, _: ()) -> Result<MsgA> {
            Ok(MsgA {
                text: "hello".into(),
            })
        }
    }

    struct TransformNode;
    impl Node for TransformNode {
        fn name(&self) -> &'static str {
            "Transform"
        }
    }
    #[async_trait]
    impl HiddenNode for TransformNode {
        type Input = MsgA;
        type Output = MsgA;
        async fn run(&self, input: MsgA) -> Result<MsgA> {
            Ok(MsgA {
                text: format!("transformed: {}", input.text),
            })
        }
    }

    struct SinkNode;
    impl Node for SinkNode {
        fn name(&self) -> &'static str {
            "Sink"
        }
    }
    #[async_trait]
    impl OutputNode for SinkNode {
        type Input = MsgA;
        async fn run(&self, _input: MsgA) -> Result<()> {
            Ok(())
        }
    }

    struct BadSinkNode;
    impl Node for BadSinkNode {
        fn name(&self) -> &'static str {
            "BadSink"
        }
    }
    #[async_trait]
    impl OutputNode for BadSinkNode {
        type Input = MsgB;
        async fn run(&self, _input: MsgB) -> Result<()> {
            Ok(())
        }
    }

    #[test]
    fn test_valid_graph_builds() -> std::result::Result<(), GraphError> {
        let graph = DirectedGraphBuilder::new("test")
            .add_input(SourceNode)
            .add_hidden(TransformNode)
            .add_output(SinkNode)
            .add_edge("Source", "Transform")
            .add_edge("Transform", "Sink")
            .build()?;
        assert_eq!(graph.name(), "test");
        Ok(())
    }

    #[test]
    fn test_no_input_node() {
        let result = DirectedGraphBuilder::new("test")
            .add_hidden(TransformNode)
            .add_output(SinkNode)
            .add_edge("Transform", "Sink")
            .build();
        assert!(matches!(result, Err(GraphError::NoInputNode)));
    }

    #[test]
    fn test_type_mismatch() {
        let result = DirectedGraphBuilder::new("test")
            .add_input(SourceNode)
            .add_output(BadSinkNode)
            .add_edge("Source", "BadSink")
            .build();
        assert!(matches!(result, Err(GraphError::TypeMismatch { .. })));
    }

    #[test]
    fn test_missing_branch_target() {
        let result = DirectedGraphBuilder::new("test")
            .add_input(SourceNode)
            .add_conditional_edge(
                "Source",
                |_| Some("branch_a".to_owned()),
                vec![("branch_a".to_owned(), "NonExistent".to_owned())],
            )
            .build();
        assert!(matches!(result, Err(GraphError::MissingBranch { .. })));
    }

    #[test]
    fn test_duplicate_node_name() {
        let result = DirectedGraphBuilder::new("test")
            .add_input(SourceNode)
            .add_input(SourceNode)
            .add_edge("Source", "Source")
            .build();
        assert!(matches!(result, Err(GraphError::DuplicateNodeName { .. })));
    }

    #[test]
    fn test_trigger_kind_startup() -> std::result::Result<(), GraphError> {
        let graph = DirectedGraphBuilder::new("test")
            .add_input(SourceNode)
            .trigger(TriggerKind::Startup)
            .build()?;
        assert!(matches!(graph.trigger_kind(), Some(TriggerKind::Startup)));
        Ok(())
    }

    #[test]
    fn test_trigger_kind_default_none() -> std::result::Result<(), GraphError> {
        let graph = DirectedGraphBuilder::new("test")
            .add_input(SourceNode)
            .build()?;
        assert!(graph.trigger_kind().is_none());
        Ok(())
    }

    #[test]
    fn test_trigger_kind_empty_schedule_error() {
        let result = DirectedGraphBuilder::new("test")
            .add_input(SourceNode)
            .trigger(TriggerKind::Cron {
                schedule: String::new(),
            })
            .build();
        assert!(matches!(
            result,
            Err(GraphError::InvalidTriggerConfig { .. })
        ));
    }

    #[test]
    fn test_trigger_kind_empty_triggers_error() {
        let result = DirectedGraphBuilder::new("test")
            .add_input(SourceNode)
            .trigger(TriggerKind::Chat {
                platform: None,
                triggers: Vec::new(),
                token: None,
            })
            .build();
        assert!(matches!(
            result,
            Err(GraphError::InvalidTriggerConfig { .. })
        ));
    }

    #[tokio::test]
    async fn test_graph_execution() -> Result<()> {
        let graph = DirectedGraphBuilder::new("exec_test")
            .add_input(SourceNode)
            .add_hidden(TransformNode)
            .add_output(SinkNode)
            .add_edge("Source", "Transform")
            .add_edge("Transform", "Sink")
            .build()
            .map_err(SmartCrabError::Graph)?;
        graph.run().await
    }

    #[tokio::test]
    async fn test_run_with_trigger() -> Result<()> {
        let graph = DirectedGraphBuilder::new("trigger_test")
            .add_input(SourceNode)
            .add_output(SinkNode)
            .add_edge("Source", "Sink")
            .build()
            .map_err(SmartCrabError::Graph)?;
        graph.run_with_trigger(Box::new(())).await
    }

    #[tokio::test]
    async fn test_cycle_graph_execution() -> Result<()> {
        struct CycleSource;
        impl Node for CycleSource {
            fn name(&self) -> &'static str {
                "Source"
            }
        }
        #[async_trait]
        impl InputNode for CycleSource {
            type TriggerData = ();
            type Output = MsgA;
            async fn run(&self, _: ()) -> Result<MsgA> {
                Ok(MsgA {
                    text: "start".into(),
                })
            }
        }

        struct LoopNode {
            executed: std::sync::Arc<std::sync::atomic::AtomicBool>,
        }
        impl Node for LoopNode {
            fn name(&self) -> &'static str {
                "Loop"
            }
        }
        #[async_trait]
        impl HiddenNode for LoopNode {
            type Input = MsgA;
            type Output = MsgA;
            async fn run(&self, input: MsgA) -> Result<MsgA> {
                self.executed
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(MsgA {
                    text: format!("looped: {}", input.text),
                })
            }
        }

        struct ExitNode;
        impl Node for ExitNode {
            fn name(&self) -> &'static str {
                "Exit"
            }
        }
        #[async_trait]
        impl OutputNode for ExitNode {
            type Input = MsgA;
            async fn run(&self, input: MsgA) -> Result<()> {
                assert!(input.text.starts_with("looped:"));
                Ok(())
            }
        }

        let loop_executed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        let graph = DirectedGraphBuilder::new("cycle_test")
            .add_input(CycleSource)
            .add_hidden(LoopNode {
                executed: loop_executed.clone(),
            })
            .add_output(ExitNode)
            .add_edge("Source", "Loop")
            .add_edge("Loop", "Loop")
            .add_edge("Loop", "Exit")
            .add_exit_condition("Loop", |_| None)
            .build()
            .map_err(SmartCrabError::Graph)?;
        graph.run().await?;
        assert!(
            loop_executed.load(std::sync::atomic::Ordering::SeqCst),
            "Loop node must execute"
        );
        Ok(())
    }

    #[tokio::test]
    async fn test_exit_condition_terminates() -> Result<()> {
        struct CountSource;
        impl Node for CountSource {
            fn name(&self) -> &'static str {
                "Source"
            }
        }
        #[async_trait]
        impl InputNode for CountSource {
            type TriggerData = ();
            type Output = MsgA;
            async fn run(&self, _: ()) -> Result<MsgA> {
                Ok(MsgA {
                    text: "start".into(),
                })
            }
        }

        let exit_triggered = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let exit_triggered_clone = exit_triggered.clone();

        let graph = DirectedGraphBuilder::new("exit_test")
            .add_input(CountSource)
            .add_exit_condition("Source", move |_| {
                exit_triggered_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                None
            })
            .build()
            .map_err(SmartCrabError::Graph)?;

        graph.run().await?;
        assert!(exit_triggered.load(std::sync::atomic::Ordering::SeqCst));
        Ok(())
    }

    #[tokio::test]
    async fn test_graph_storage_attach_and_access() -> Result<()> {
        struct WriteNode {
            storage: Arc<dyn Storage>,
        }
        impl Node for WriteNode {
            fn name(&self) -> &'static str {
                "Write"
            }
        }
        #[async_trait]
        impl InputNode for WriteNode {
            type TriggerData = ();
            type Output = MsgA;
            async fn run(&self, _: ()) -> Result<MsgA> {
                self.storage
                    .set("result", "stored_value".to_owned())
                    .await?;
                Ok(MsgA {
                    text: "written".into(),
                })
            }
        }

        let storage: Arc<dyn Storage> = Arc::new(InMemoryStorage::new());

        let graph = DirectedGraphBuilder::new("storage_test")
            .storage(storage.clone())
            .add_input(WriteNode {
                storage: storage.clone(),
            })
            .build()
            .map_err(SmartCrabError::Graph)?;

        graph.run().await?;

        assert!(graph.storage().is_some());
        assert_eq!(
            storage.get("result").await?,
            Some("stored_value".to_owned())
        );

        // Typed access via Arc<dyn Storage>
        storage.set_typed("typed_key", &42u32).await?;
        let v: Option<u32> = storage.get_typed("typed_key").await?;
        assert_eq!(v, Some(42u32));
        Ok(())
    }

    #[test]
    fn test_graph_no_storage_by_default() -> std::result::Result<(), GraphError> {
        let graph = DirectedGraphBuilder::new("test")
            .add_input(SourceNode)
            .build()?;
        assert!(graph.storage().is_none());
        Ok(())
    }

    /// Conditional branch: the bypassed branch must never execute, and the graph
    /// must complete without an "Unreachable node" error.
    #[tokio::test]
    async fn test_conditional_branch_skips_inactive_node() -> Result<()> {
        #[derive(Debug, Clone, Serialize, Deserialize)]
        struct Flag {
            value: bool,
        }

        struct FlagSource;
        impl Node for FlagSource {
            fn name(&self) -> &'static str {
                "FlagSource"
            }
        }
        #[async_trait]
        impl InputNode for FlagSource {
            type TriggerData = ();
            type Output = Flag;
            async fn run(&self, _: ()) -> Result<Flag> {
                Ok(Flag { value: false })
            }
        }

        struct TrueSink(std::sync::Arc<std::sync::atomic::AtomicBool>);
        impl Node for TrueSink {
            fn name(&self) -> &'static str {
                "TrueSink"
            }
        }
        #[async_trait]
        impl OutputNode for TrueSink {
            type Input = Flag;
            async fn run(&self, _: Flag) -> Result<()> {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            }
        }

        struct FalseSink(std::sync::Arc<std::sync::atomic::AtomicBool>);
        impl Node for FalseSink {
            fn name(&self) -> &'static str {
                "FalseSink"
            }
        }
        #[async_trait]
        impl OutputNode for FalseSink {
            type Input = Flag;
            async fn run(&self, _: Flag) -> Result<()> {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            }
        }

        let true_executed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let false_executed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        let graph = DirectedGraphBuilder::new("cond_test")
            .add_input(FlagSource)
            .add_output(TrueSink(true_executed.clone()))
            .add_output(FalseSink(false_executed.clone()))
            .add_conditional_edge(
                "FlagSource",
                |dto| {
                    let f: &Flag = dto.as_any().downcast_ref()?;
                    Some(if f.value { "true" } else { "false" }.to_owned())
                },
                vec![
                    ("true".to_owned(), "TrueSink".to_owned()),
                    ("false".to_owned(), "FalseSink".to_owned()),
                ],
            )
            .build()
            .map_err(SmartCrabError::Graph)?;

        graph.run().await?;
        assert!(
            !true_executed.load(std::sync::atomic::Ordering::SeqCst),
            "TrueSink must NOT execute when condition is false"
        );
        assert!(
            false_executed.load(std::sync::atomic::Ordering::SeqCst),
            "FalseSink must execute when condition is false"
        );
        Ok(())
    }
}
