use std::collections::{HashMap, HashSet};

use tracing::{info, instrument};

use crate::dto::DtoObject;
use crate::error::{GraphError, Result, SmartCrabError};
use crate::layer::{AnyLayer, HiddenLayer, InputLayer, OutputLayer};

type ConditionFn = Box<dyn Fn(&dyn DtoObject) -> Option<String> + Send + Sync>;

enum Edge {
    Unconditional { from: String, to: String },
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
    nodes: HashMap<String, AnyLayer>,
    edges: Vec<Edge>,
    execution_order: Vec<String>,
}

pub struct EdgeInfo {
    pub from: String,
    pub to: String,
    pub label: Option<String>,
}

impl DirectedGraph {
    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    pub fn nodes(&self) -> &HashMap<String, AnyLayer> {
        &self.nodes
    }

    pub fn execution_order(&self) -> &[String] {
        &self.execution_order
    }

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

    #[instrument(skip(self), fields(graph = %self.name))]
    pub async fn run(&self) -> Result<()> {
        let mut outputs: HashMap<String, Box<dyn DtoObject>> = HashMap::new();
        let mut completed: HashSet<String> = HashSet::new();

        loop {
            let executables = self.find_executable_nodes(&outputs, &completed);
            
            if executables.is_empty() {
                info!(graph = %self.name, "all nodes completed");
                break;
            }

            for node_name in &executables {
                let node = self.nodes.get(node_name).expect("node must exist");

                info!(node = %node_name, "executing layer");

                match node {
                    AnyLayer::Input(layer) => {
                        let output = layer.run_dyn().await.map_err(|e| {
                            SmartCrabError::Graph(GraphError::LayerFailed {
                                name: node_name.clone(),
                                source: Box::new(e),
                            })
                        })?;
                        outputs.insert(node_name.clone(), output);
                        completed.insert(node_name.clone());
                    }
                    AnyLayer::Hidden(layer) => {
                        let input = self.resolve_input(node_name, &outputs)?;
                        let output = layer.run_dyn(input.as_ref()).await.map_err(|e| {
                            SmartCrabError::Graph(GraphError::LayerFailed {
                                name: node_name.clone(),
                                source: Box::new(e),
                            })
                        })?;
                        outputs.insert(node_name.clone(), output);
                        completed.insert(node_name.clone());
                    }
                    AnyLayer::Output(layer) => {
                        let input = self.resolve_input(node_name, &outputs)?;
                        layer.run_dyn(input.as_ref()).await.map_err(|e| {
                            SmartCrabError::Graph(GraphError::LayerFailed {
                                name: node_name.clone(),
                                source: Box::new(e),
                            })
                        })?;
                        completed.insert(node_name.clone());
                    }
                }

                if let Some(exit_branch) = self.check_exit_conditions(node_name, &outputs) {
                    if exit_branch.is_none() {
                        info!(graph = %self.name, "exit condition triggered, terminating");
                        return Ok(());
                    }
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

        for (node_name, _node) in self.nodes.iter() {
            if completed.contains(node_name) {
                continue;
            }

            if self.can_execute(node_name, outputs) {
                executables.push(node_name.clone());
            }
        }

        executables
    }

    fn can_execute(
        &self,
        node_name: &str,
        outputs: &HashMap<String, Box<dyn DtoObject>>,
    ) -> bool {
        for edge in &self.edges {
            match edge {
                Edge::Unconditional { from, to } if to == node_name => {
                    // Self-loops must not block the first execution
                    if from != node_name && !outputs.contains_key(from) {
                        return false;
                    }
                }
                Edge::Conditional { from, condition, branches } => {
                    if !branches.values().any(|t| t == node_name) {
                        continue;
                    }
                    if let Some(output) = outputs.get(from) {
                        if let Some(branch_key) = condition(output.as_ref()) {
                            if branches.get(&branch_key) == Some(&node_name.to_string()) {
                                return true;
                            }
                        }
                    }
                    if !outputs.contains_key(from) {
                        return false;
                    }
                }
                Edge::Exit { from, .. } if outputs.contains_key(from) => {
                    continue;
                }
                _ => {}
            }
        }

        let has_dependency = self.edges.iter().any(|edge| match edge {
            Edge::Unconditional { to, .. } => to == node_name,
            Edge::Conditional { branches, .. } => branches.values().any(|t| t == node_name),
            Edge::Exit { .. } => false,
        });

        if !has_dependency {
            return matches!(self.nodes.get(node_name), Some(AnyLayer::Input(_)));
        }

        true
    }

    fn check_exit_conditions(
        &self,
        node_name: &str,
        outputs: &HashMap<String, Box<dyn DtoObject>>,
    ) -> Option<Option<String>> {
        for edge in &self.edges {
            if let Edge::Exit { from, condition } = edge {
                if from == node_name {
                    if let Some(output) = outputs.get(from) {
                        return Some(condition(output.as_ref()));
                    }
                }
            }
        }
        None
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
                    if let Some(output) = outputs.get(from) {
                        if let Some(branch_key) = condition(output.as_ref()) {
                            if let Some(target) = branches.get(&branch_key)
                                && target == node_name
                            {
                                return Ok(output.clone_box());
                            }
                        }
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
    nodes: HashMap<String, AnyLayer>,
    edges: Vec<Edge>,
    insertion_order: Vec<String>,
}

impl DirectedGraphBuilder {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: None,
            nodes: HashMap::new(),
            edges: Vec::new(),
            insertion_order: Vec::new(),
        }
    }

    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    pub fn add_input<L: InputLayer>(mut self, layer: L) -> Self {
        let name = layer.name().to_owned();
        self.insertion_order.push(name.clone());
        self.nodes.insert(name, AnyLayer::Input(Box::new(layer)));
        self
    }

    pub fn add_hidden<L: HiddenLayer>(mut self, layer: L) -> Self {
        let name = layer.name().to_owned();
        self.insertion_order.push(name.clone());
        self.nodes.insert(name, AnyLayer::Hidden(Box::new(layer)));
        self
    }

    pub fn add_output<L: OutputLayer>(mut self, layer: L) -> Self {
        let name = layer.name().to_owned();
        self.insertion_order.push(name.clone());
        self.nodes.insert(name, AnyLayer::Output(Box::new(layer)));
        self
    }

    pub fn add_edge(mut self, from: &str, to: &str) -> Self {
        self.edges.push(Edge::Unconditional {
            from: from.to_owned(),
            to: to.to_owned(),
        });
        self
    }

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

    pub fn build(self) -> std::result::Result<DirectedGraph, GraphError> {
        self.validate()?;

        Ok(DirectedGraph {
            name: self.name,
            description: self.description,
            nodes: self.nodes,
            edges: self.edges,
            execution_order: self.insertion_order,
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

        let has_input = self.nodes.values().any(|n| matches!(n, AnyLayer::Input(_)));
        if !has_input {
            return Err(GraphError::NoInputNode);
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
    use crate::layer::{HiddenLayer, InputLayer, Layer, OutputLayer};

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct MsgA {
        text: String,
    }
    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct MsgB {
        text: String,
    }

    struct SourceLayer;
    impl Layer for SourceLayer {
        fn name(&self) -> &str {
            "Source"
        }
    }
    #[async_trait]
    impl InputLayer for SourceLayer {
        type Output = MsgA;
        async fn run(&self) -> Result<MsgA> {
            Ok(MsgA {
                text: "hello".into(),
            })
        }
    }

    struct TransformLayer;
    impl Layer for TransformLayer {
        fn name(&self) -> &str {
            "Transform"
        }
    }
    #[async_trait]
    impl HiddenLayer for TransformLayer {
        type Input = MsgA;
        type Output = MsgA;
        async fn run(&self, input: MsgA) -> Result<MsgA> {
            Ok(MsgA {
                text: format!("transformed: {}", input.text),
            })
        }
    }

    struct SinkLayer;
    impl Layer for SinkLayer {
        fn name(&self) -> &str {
            "Sink"
        }
    }
    #[async_trait]
    impl OutputLayer for SinkLayer {
        type Input = MsgA;
        async fn run(&self, _input: MsgA) -> Result<()> {
            Ok(())
        }
    }

    struct BadSinkLayer;
    impl Layer for BadSinkLayer {
        fn name(&self) -> &str {
            "BadSink"
        }
    }
    #[async_trait]
    impl OutputLayer for BadSinkLayer {
        type Input = MsgB;
        async fn run(&self, _input: MsgB) -> Result<()> {
            Ok(())
        }
    }

    #[test]
    fn test_valid_graph_builds() {
        let graph = DirectedGraphBuilder::new("test")
            .add_input(SourceLayer)
            .add_hidden(TransformLayer)
            .add_output(SinkLayer)
            .add_edge("Source", "Transform")
            .add_edge("Transform", "Sink")
            .build();
        assert!(graph.is_ok());
        assert_eq!(graph.unwrap().name(), "test");
    }

    #[test]
    fn test_no_input_node() {
        let result = DirectedGraphBuilder::new("test")
            .add_hidden(TransformLayer)
            .add_output(SinkLayer)
            .add_edge("Transform", "Sink")
            .build();
        assert!(matches!(result, Err(GraphError::NoInputNode)));
    }

    #[test]
    fn test_type_mismatch() {
        let result = DirectedGraphBuilder::new("test")
            .add_input(SourceLayer)
            .add_output(BadSinkLayer)
            .add_edge("Source", "BadSink")
            .build();
        assert!(matches!(result, Err(GraphError::TypeMismatch { .. })));
    }

    #[test]
    fn test_missing_branch_target() {
        let result = DirectedGraphBuilder::new("test")
            .add_input(SourceLayer)
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
            .add_input(SourceLayer)
            .add_input(SourceLayer)
            .add_edge("Source", "Source")
            .build();
        assert!(matches!(result, Err(GraphError::DuplicateNodeName { .. })));
    }

    #[tokio::test]
    async fn test_graph_execution() {
        let graph = DirectedGraphBuilder::new("exec_test")
            .add_input(SourceLayer)
            .add_hidden(TransformLayer)
            .add_output(SinkLayer)
            .add_edge("Source", "Transform")
            .add_edge("Transform", "Sink")
            .build()
            .unwrap();
        let result = graph.run().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_cycle_graph_execution() {
        struct CycleSource;
        impl Layer for CycleSource {
            fn name(&self) -> &str {
                "Source"
            }
        }
        #[async_trait]
        impl InputLayer for CycleSource {
            type Output = MsgA;
            async fn run(&self) -> Result<MsgA> {
                Ok(MsgA {
                    text: "start".into(),
                })
            }
        }

        struct LoopLayer {
            executed: std::sync::Arc<std::sync::atomic::AtomicBool>,
        }
        impl Layer for LoopLayer {
            fn name(&self) -> &str {
                "Loop"
            }
        }
        #[async_trait]
        impl HiddenLayer for LoopLayer {
            type Input = MsgA;
            type Output = MsgA;
            async fn run(&self, input: MsgA) -> Result<MsgA> {
                self.executed.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(MsgA {
                    text: format!("looped: {}", input.text),
                })
            }
        }

        struct ExitLayer;
        impl Layer for ExitLayer {
            fn name(&self) -> &str {
                "Exit"
            }
        }
        #[async_trait]
        impl OutputLayer for ExitLayer {
            type Input = MsgA;
            async fn run(&self, input: MsgA) -> Result<()> {
                assert!(input.text.starts_with("looped:"));
                Ok(())
            }
        }

        let loop_executed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        let graph = DirectedGraphBuilder::new("cycle_test")
            .add_input(CycleSource)
            .add_hidden(LoopLayer { executed: loop_executed.clone() })
            .add_output(ExitLayer)
            .add_edge("Source", "Loop")
            .add_edge("Loop", "Loop")
            .add_edge("Loop", "Exit")
            .add_exit_condition("Loop", |_| None)
            .build()
            .unwrap();
        let result = graph.run().await;
        assert!(result.is_ok());
        assert!(loop_executed.load(std::sync::atomic::Ordering::SeqCst), "Loop layer must execute");
    }

    #[tokio::test]
    async fn test_exit_condition_terminates() {
        struct CountSource;
        impl Layer for CountSource {
            fn name(&self) -> &str {
                "Source"
            }
        }
        #[async_trait]
        impl InputLayer for CountSource {
            type Output = MsgA;
            async fn run(&self) -> Result<MsgA> {
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
            .unwrap();
        
        let result = graph.run().await;
        assert!(result.is_ok());
        assert!(exit_triggered.load(std::sync::atomic::Ordering::SeqCst));
    }
}
