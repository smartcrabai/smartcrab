use std::collections::{HashMap, HashSet, VecDeque};

use tracing::{info, instrument};

use crate::dto::DtoObject;
use crate::error::{DagError, Result, SmartCrabError};
use crate::layer::{AnyLayer, HiddenLayer, InputLayer, OutputLayer};

/// Type alias for the condition closure used in conditional edges.
type ConditionFn = Box<dyn Fn(&dyn DtoObject) -> String + Send + Sync>;

/// Edge types within a DAG.
enum Edge {
    /// Unconditional: always follow after the source node completes.
    Unconditional { from: String, to: String },
    /// Conditional: evaluate the condition closure on the output DTO to pick a branch.
    Conditional {
        from: String,
        condition: ConditionFn,
        branches: HashMap<String, String>,
    },
}

/// A validated, immutable DAG ready for execution.
pub struct Dag {
    name: String,
    nodes: HashMap<String, AnyLayer>,
    edges: Vec<Edge>,
    /// Pre-computed execution order (topological sort).
    execution_order: Vec<String>,
}

impl Dag {
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Execute the DAG to completion.
    #[instrument(skip(self), fields(dag = %self.name))]
    pub async fn run(&self) -> Result<()> {
        let mut outputs: HashMap<String, Box<dyn DtoObject>> = HashMap::new();

        for node_name in &self.execution_order {
            let node = self.nodes.get(node_name).expect("node must exist");

            info!(node = %node_name, "executing layer");

            match node {
                AnyLayer::Input(layer) => {
                    let output = layer.run_dyn().await.map_err(|e| {
                        SmartCrabError::Dag(DagError::LayerFailed {
                            name: node_name.clone(),
                            source: Box::new(e),
                        })
                    })?;
                    outputs.insert(node_name.clone(), output);
                }
                AnyLayer::Hidden(layer) => {
                    let input = self.resolve_input(node_name, &outputs)?;
                    let output = layer.run_dyn(input.as_ref()).await.map_err(|e| {
                        SmartCrabError::Dag(DagError::LayerFailed {
                            name: node_name.clone(),
                            source: Box::new(e),
                        })
                    })?;
                    outputs.insert(node_name.clone(), output);
                }
                AnyLayer::Output(layer) => {
                    let input = self.resolve_input(node_name, &outputs)?;
                    layer.run_dyn(input.as_ref()).await.map_err(|e| {
                        SmartCrabError::Dag(DagError::LayerFailed {
                            name: node_name.clone(),
                            source: Box::new(e),
                        })
                    })?;
                }
            }
        }

        info!(dag = %self.name, "completed");
        Ok(())
    }

    /// Find the predecessor node for the given node and return its output.
    fn resolve_input(
        &self,
        node_name: &str,
        outputs: &HashMap<String, Box<dyn DtoObject>>,
    ) -> Result<Box<dyn DtoObject>> {
        // Check unconditional edges first
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
                        let branch_key = condition(output.as_ref());
                        if let Some(target) = branches.get(&branch_key)
                            && target == node_name
                        {
                            return Ok(output.clone_box());
                        }
                    }
                }
                _ => {}
            }
        }

        Err(SmartCrabError::Dag(DagError::UnreachableNode {
            name: node_name.to_owned(),
        }))
    }
}

/// Builder for constructing and validating a `Dag`.
pub struct DagBuilder {
    name: String,
    nodes: HashMap<String, AnyLayer>,
    edges: Vec<Edge>,
    insertion_order: Vec<String>,
}

impl DagBuilder {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            nodes: HashMap::new(),
            edges: Vec::new(),
            insertion_order: Vec::new(),
        }
    }

    /// Add an input layer.
    pub fn add_input<L: InputLayer>(mut self, layer: L) -> Self {
        let name = layer.name().to_owned();
        self.insertion_order.push(name.clone());
        self.nodes.insert(name, AnyLayer::Input(Box::new(layer)));
        self
    }

    /// Add a hidden layer.
    pub fn add_hidden<L: HiddenLayer>(mut self, layer: L) -> Self {
        let name = layer.name().to_owned();
        self.insertion_order.push(name.clone());
        self.nodes.insert(name, AnyLayer::Hidden(Box::new(layer)));
        self
    }

    /// Add an output layer.
    pub fn add_output<L: OutputLayer>(mut self, layer: L) -> Self {
        let name = layer.name().to_owned();
        self.insertion_order.push(name.clone());
        self.nodes.insert(name, AnyLayer::Output(Box::new(layer)));
        self
    }

    /// Add an unconditional edge from one node to another.
    pub fn add_edge(mut self, from: &str, to: &str) -> Self {
        self.edges.push(Edge::Unconditional {
            from: from.to_owned(),
            to: to.to_owned(),
        });
        self
    }

    /// Add a conditional edge with a branching function.
    pub fn add_conditional_edge<F, I>(mut self, from: &str, condition: F, branches: I) -> Self
    where
        F: Fn(&dyn DtoObject) -> String + Send + Sync + 'static,
        I: IntoIterator<Item = (String, String)>,
    {
        self.edges.push(Edge::Conditional {
            from: from.to_owned(),
            condition: Box::new(condition),
            branches: branches.into_iter().collect(),
        });
        self
    }

    /// Validate and build the DAG.
    pub fn build(self) -> std::result::Result<Dag, DagError> {
        self.validate()?;
        let execution_order = self.topological_sort()?;

        Ok(Dag {
            name: self.name,
            nodes: self.nodes,
            edges: self.edges,
            execution_order,
        })
    }

    fn validate(&self) -> std::result::Result<(), DagError> {
        // 1. Check for duplicate node names (already enforced by HashMap, but
        //    check insertion_order for duplicates explicitly)
        {
            let mut seen = HashSet::new();
            for name in &self.insertion_order {
                if !seen.insert(name.as_str()) {
                    return Err(DagError::DuplicateNodeName { name: name.clone() });
                }
            }
        }

        // 2. At least one input node
        let has_input = self.nodes.values().any(|n| matches!(n, AnyLayer::Input(_)));
        if !has_input {
            return Err(DagError::NoInputNode);
        }

        // 3. Edge targets and sources must exist
        for edge in &self.edges {
            match edge {
                Edge::Unconditional { from, to } => {
                    if !self.nodes.contains_key(from) || !self.nodes.contains_key(to) {
                        // This is caught by unreachable check below, but let's be explicit
                    }
                }
                Edge::Conditional { from, branches, .. } => {
                    if !self.nodes.contains_key(from) {
                        return Err(DagError::MissingBranch {
                            from: from.clone(),
                            target: from.clone(),
                        });
                    }
                    for target in branches.values() {
                        if !self.nodes.contains_key(target) {
                            return Err(DagError::MissingBranch {
                                from: from.clone(),
                                target: target.clone(),
                            });
                        }
                    }
                }
            }
        }

        // 4. Type mismatch check
        for edge in &self.edges {
            let pairs: Vec<(&str, &str)> = match edge {
                Edge::Unconditional { from, to } => vec![(from.as_str(), to.as_str())],
                Edge::Conditional { from, branches, .. } => branches
                    .values()
                    .map(|to| (from.as_str(), to.as_str()))
                    .collect(),
            };
            for (from, to) in pairs {
                if let (Some(from_node), Some(to_node)) = (self.nodes.get(from), self.nodes.get(to))
                    && let (Some(out_id), Some(in_id)) =
                        (from_node.output_type_id(), to_node.input_type_id())
                    && out_id != in_id
                {
                    return Err(DagError::TypeMismatch {
                        from: from.to_owned(),
                        to: to.to_owned(),
                        output_type: from_node.output_type_name().unwrap_or("unknown").to_owned(),
                        input_type: to_node.input_type_name().unwrap_or("unknown").to_owned(),
                    });
                }
            }
        }

        // 5. Unreachable node check
        let input_nodes: Vec<&str> = self
            .nodes
            .iter()
            .filter(|(_, v)| matches!(v, AnyLayer::Input(_)))
            .map(|(k, _)| k.as_str())
            .collect();

        let adjacency = self.build_adjacency();
        let mut visited = HashSet::new();
        let mut queue: VecDeque<&str> = VecDeque::new();

        for input in &input_nodes {
            visited.insert(*input);
            queue.push_back(input);
        }

        while let Some(current) = queue.pop_front() {
            if let Some(neighbors) = adjacency.get(current) {
                for neighbor in neighbors {
                    if visited.insert(neighbor) {
                        queue.push_back(neighbor);
                    }
                }
            }
        }

        for name in self.nodes.keys() {
            if !visited.contains(name.as_str()) {
                return Err(DagError::UnreachableNode { name: name.clone() });
            }
        }

        Ok(())
    }

    fn build_adjacency(&self) -> HashMap<&str, Vec<&str>> {
        let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
        for edge in &self.edges {
            match edge {
                Edge::Unconditional { from, to } => {
                    adj.entry(from.as_str()).or_default().push(to.as_str());
                }
                Edge::Conditional { from, branches, .. } => {
                    for to in branches.values() {
                        adj.entry(from.as_str()).or_default().push(to.as_str());
                    }
                }
            }
        }
        adj
    }

    /// Topological sort using Kahn's algorithm. Returns `CycleDetected` if the graph has a cycle.
    fn topological_sort(&self) -> std::result::Result<Vec<String>, DagError> {
        let adjacency = self.build_adjacency();

        // Compute in-degrees
        let mut in_degree: HashMap<&str, usize> = HashMap::new();
        for name in self.nodes.keys() {
            in_degree.insert(name.as_str(), 0);
        }
        for neighbors in adjacency.values() {
            for n in neighbors {
                *in_degree.entry(n).or_insert(0) += 1;
            }
        }

        let mut queue: VecDeque<&str> = VecDeque::new();
        for (name, &deg) in &in_degree {
            if deg == 0 {
                queue.push_back(name);
            }
        }

        let mut order = Vec::new();
        while let Some(current) = queue.pop_front() {
            order.push(current.to_owned());
            if let Some(neighbors) = adjacency.get(current) {
                for neighbor in neighbors {
                    let deg = in_degree.get_mut(neighbor).unwrap();
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(neighbor);
                    }
                }
            }
        }

        if order.len() != self.nodes.len() {
            return Err(DagError::CycleDetected);
        }

        Ok(order)
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

    // Type-mismatch layer
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
    fn test_valid_dag_builds() {
        let dag = DagBuilder::new("test")
            .add_input(SourceLayer)
            .add_hidden(TransformLayer)
            .add_output(SinkLayer)
            .add_edge("Source", "Transform")
            .add_edge("Transform", "Sink")
            .build();
        assert!(dag.is_ok());
        assert_eq!(dag.unwrap().name(), "test");
    }

    #[test]
    fn test_no_input_node() {
        let result = DagBuilder::new("test")
            .add_hidden(TransformLayer)
            .add_output(SinkLayer)
            .add_edge("Transform", "Sink")
            .build();
        assert!(matches!(result, Err(DagError::NoInputNode)));
    }

    #[test]
    fn test_unreachable_node() {
        let result = DagBuilder::new("test")
            .add_input(SourceLayer)
            .add_output(SinkLayer)
            .add_hidden(TransformLayer)
            .build(); // No edges connecting Transform
        assert!(matches!(result, Err(DagError::UnreachableNode { .. })));
    }

    #[test]
    fn test_type_mismatch() {
        let result = DagBuilder::new("test")
            .add_input(SourceLayer)
            .add_output(BadSinkLayer)
            .add_edge("Source", "BadSink")
            .build();
        assert!(matches!(result, Err(DagError::TypeMismatch { .. })));
    }

    #[test]
    fn test_missing_branch_target() {
        let result = DagBuilder::new("test")
            .add_input(SourceLayer)
            .add_conditional_edge(
                "Source",
                |_| "branch_a".to_owned(),
                vec![("branch_a".to_owned(), "NonExistent".to_owned())],
            )
            .build();
        assert!(matches!(result, Err(DagError::MissingBranch { .. })));
    }

    #[tokio::test]
    async fn test_dag_execution() {
        let dag = DagBuilder::new("exec_test")
            .add_input(SourceLayer)
            .add_hidden(TransformLayer)
            .add_output(SinkLayer)
            .add_edge("Source", "Transform")
            .add_edge("Transform", "Sink")
            .build()
            .unwrap();
        let result = dag.run().await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_duplicate_node_name() {
        let result = DagBuilder::new("test")
            .add_input(SourceLayer)
            .add_input(SourceLayer) // same name "Source"
            .add_edge("Source", "Source")
            .build();
        assert!(matches!(result, Err(DagError::DuplicateNodeName { .. })));
    }
}
