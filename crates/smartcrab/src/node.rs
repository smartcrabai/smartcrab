use std::any::TypeId;

use async_trait::async_trait;

use crate::dto::{Dto, DtoObject};
use crate::error::Result;

/// Base trait for all nodes.
pub trait Node: Send + Sync + 'static {
    fn name(&self) -> &str;
}

/// A node that produces data from an external source.
#[async_trait]
pub trait InputNode: Node {
    type TriggerData: Dto;
    type Output: Dto;
    async fn run(&self, trigger: Self::TriggerData) -> Result<Self::Output>;
}

/// A node that transforms data.
#[async_trait]
pub trait HiddenNode: Node {
    type Input: Dto;
    type Output: Dto;
    async fn run(&self, input: Self::Input) -> Result<Self::Output>;
}

/// A node that consumes data and performs a side effect.
#[async_trait]
pub trait OutputNode: Node {
    type Input: Dto;
    async fn run(&self, input: Self::Input) -> Result<()>;
}

// ---------------------------------------------------------------------------
// Object-safe dynamic dispatch wrappers
// ---------------------------------------------------------------------------

/// Object-safe wrapper for `InputNode`.
#[async_trait]
pub trait InputNodeDyn: Node {
    fn trigger_data_type_id(&self) -> TypeId;
    fn trigger_data_type_name(&self) -> &'static str;
    fn output_type_id(&self) -> TypeId;
    fn output_type_name(&self) -> &'static str;
    async fn run_dyn(&self, trigger: &dyn DtoObject) -> Result<Box<dyn DtoObject>>;
}

#[async_trait]
impl<T: InputNode> InputNodeDyn for T {
    fn trigger_data_type_id(&self) -> TypeId {
        TypeId::of::<T::TriggerData>()
    }

    fn trigger_data_type_name(&self) -> &'static str {
        std::any::type_name::<T::TriggerData>()
    }

    fn output_type_id(&self) -> TypeId {
        TypeId::of::<T::Output>()
    }

    fn output_type_name(&self) -> &'static str {
        std::any::type_name::<T::Output>()
    }

    async fn run_dyn(&self, trigger: &dyn DtoObject) -> Result<Box<dyn DtoObject>> {
        let concrete = trigger
            .as_any()
            .downcast_ref::<T::TriggerData>()
            .ok_or_else(|| {
                crate::error::SmartCrabError::Graph(crate::error::GraphError::TypeMismatch {
                    from: "trigger".to_owned(),
                    to: self.name().to_owned(),
                    output_type: trigger.dto_type_name().to_owned(),
                    input_type: std::any::type_name::<T::TriggerData>().to_owned(),
                })
            })?;
        let output = self.run(concrete.clone()).await?;
        Ok(Box::new(output))
    }
}

/// Object-safe wrapper for `HiddenNode`.
#[async_trait]
pub trait HiddenNodeDyn: Node {
    fn input_type_id(&self) -> TypeId;
    fn input_type_name(&self) -> &'static str;
    fn output_type_id(&self) -> TypeId;
    fn output_type_name(&self) -> &'static str;
    async fn run_dyn(&self, input: &dyn DtoObject) -> Result<Box<dyn DtoObject>>;
}

#[async_trait]
impl<T: HiddenNode> HiddenNodeDyn for T {
    fn input_type_id(&self) -> TypeId {
        TypeId::of::<T::Input>()
    }

    fn input_type_name(&self) -> &'static str {
        std::any::type_name::<T::Input>()
    }

    fn output_type_id(&self) -> TypeId {
        TypeId::of::<T::Output>()
    }

    fn output_type_name(&self) -> &'static str {
        std::any::type_name::<T::Output>()
    }

    async fn run_dyn(&self, input: &dyn DtoObject) -> Result<Box<dyn DtoObject>> {
        let concrete = input.as_any().downcast_ref::<T::Input>().ok_or_else(|| {
            crate::error::SmartCrabError::Graph(crate::error::GraphError::TypeMismatch {
                from: "runtime".to_owned(),
                to: self.name().to_owned(),
                output_type: input.dto_type_name().to_owned(),
                input_type: std::any::type_name::<T::Input>().to_owned(),
            })
        })?;
        let output = self.run(concrete.clone()).await?;
        Ok(Box::new(output))
    }
}

/// Object-safe wrapper for `OutputNode`.
#[async_trait]
pub trait OutputNodeDyn: Node {
    fn input_type_id(&self) -> TypeId;
    fn input_type_name(&self) -> &'static str;
    async fn run_dyn(&self, input: &dyn DtoObject) -> Result<()>;
}

#[async_trait]
impl<T: OutputNode> OutputNodeDyn for T {
    fn input_type_id(&self) -> TypeId {
        TypeId::of::<T::Input>()
    }

    fn input_type_name(&self) -> &'static str {
        std::any::type_name::<T::Input>()
    }

    async fn run_dyn(&self, input: &dyn DtoObject) -> Result<()> {
        let concrete = input.as_any().downcast_ref::<T::Input>().ok_or_else(|| {
            crate::error::SmartCrabError::Graph(crate::error::GraphError::TypeMismatch {
                from: "runtime".to_owned(),
                to: self.name().to_owned(),
                output_type: input.dto_type_name().to_owned(),
                input_type: std::any::type_name::<T::Input>().to_owned(),
            })
        })?;
        self.run(concrete.clone()).await
    }
}

/// Type-erased node enum used in the Graph engine.
pub enum AnyNode {
    Input(Box<dyn InputNodeDyn>),
    Hidden(Box<dyn HiddenNodeDyn>),
    Output(Box<dyn OutputNodeDyn>),
}

impl AnyNode {
    pub fn name(&self) -> &str {
        match self {
            AnyNode::Input(l) => l.name(),
            AnyNode::Hidden(l) => l.name(),
            AnyNode::Output(l) => l.name(),
        }
    }

    /// Returns the `TypeId` of the trigger data (if Input node).
    pub fn trigger_data_type_id(&self) -> Option<TypeId> {
        match self {
            AnyNode::Input(l) => Some(l.trigger_data_type_id()),
            _ => None,
        }
    }

    /// Returns the trigger data type name (if Input node).
    pub fn trigger_data_type_name(&self) -> Option<&'static str> {
        match self {
            AnyNode::Input(l) => Some(l.trigger_data_type_name()),
            _ => None,
        }
    }

    /// Returns the `TypeId` of the output DTO (if any).
    pub fn output_type_id(&self) -> Option<TypeId> {
        match self {
            AnyNode::Input(l) => Some(l.output_type_id()),
            AnyNode::Hidden(l) => Some(l.output_type_id()),
            AnyNode::Output(_) => None,
        }
    }

    /// Returns the output type name (if any).
    pub fn output_type_name(&self) -> Option<&'static str> {
        match self {
            AnyNode::Input(l) => Some(l.output_type_name()),
            AnyNode::Hidden(l) => Some(l.output_type_name()),
            AnyNode::Output(_) => None,
        }
    }

    /// Returns the `TypeId` of the input DTO (if any).
    pub fn input_type_id(&self) -> Option<TypeId> {
        match self {
            AnyNode::Input(_) => None,
            AnyNode::Hidden(l) => Some(l.input_type_id()),
            AnyNode::Output(l) => Some(l.input_type_id()),
        }
    }

    /// Returns the input type name (if any).
    pub fn input_type_name(&self) -> Option<&'static str> {
        match self {
            AnyNode::Input(_) => None,
            AnyNode::Hidden(l) => Some(l.input_type_name()),
            AnyNode::Output(l) => Some(l.input_type_name()),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};

    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct MockInput {
        value: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct MockOutput {
        result: String,
    }

    struct MockInputNode;

    impl Node for MockInputNode {
        fn name(&self) -> &str {
            "MockInputNode"
        }
    }

    #[async_trait]
    impl InputNode for MockInputNode {
        type TriggerData = ();
        type Output = MockOutput;
        async fn run(&self, _: ()) -> Result<MockOutput> {
            Ok(MockOutput {
                result: "from input".into(),
            })
        }
    }

    struct MockHiddenNode;

    impl Node for MockHiddenNode {
        fn name(&self) -> &str {
            "MockHiddenNode"
        }
    }

    #[async_trait]
    impl HiddenNode for MockHiddenNode {
        type Input = MockOutput;
        type Output = MockInput;
        async fn run(&self, input: MockOutput) -> Result<MockInput> {
            Ok(MockInput {
                value: input.result,
            })
        }
    }

    struct MockOutputNode;

    impl Node for MockOutputNode {
        fn name(&self) -> &str {
            "MockOutputNode"
        }
    }

    #[async_trait]
    impl OutputNode for MockOutputNode {
        type Input = MockInput;
        async fn run(&self, _input: MockInput) -> Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_input_node_dyn() {
        let node = MockInputNode;
        let trigger: Box<dyn DtoObject> = Box::new(());
        let output = node.run_dyn(trigger.as_ref()).await.unwrap();
        let concrete = output.as_any().downcast_ref::<MockOutput>().unwrap();
        assert_eq!(concrete.result, "from input");
    }

    #[tokio::test]
    async fn test_hidden_node_dyn() {
        let node = MockHiddenNode;
        let input = MockOutput {
            result: "hello".into(),
        };
        let boxed: Box<dyn DtoObject> = Box::new(input);
        let output = node.run_dyn(boxed.as_ref()).await.unwrap();
        let concrete = output.as_any().downcast_ref::<MockInput>().unwrap();
        assert_eq!(concrete.value, "hello");
    }

    #[tokio::test]
    async fn test_output_node_dyn() {
        let node = MockOutputNode;
        let input = MockInput {
            value: "test".into(),
        };
        let boxed: Box<dyn DtoObject> = Box::new(input);
        node.run_dyn(boxed.as_ref()).await.unwrap();
    }

    #[test]
    fn test_any_node_type_info() {
        let input_node = AnyNode::Input(Box::new(MockInputNode));
        assert_eq!(input_node.name(), "MockInputNode");
        assert!(input_node.output_type_id().is_some());
        assert!(input_node.input_type_id().is_none());
        assert!(input_node.trigger_data_type_id().is_some());

        let hidden_node = AnyNode::Hidden(Box::new(MockHiddenNode));
        assert_eq!(hidden_node.name(), "MockHiddenNode");
        assert!(hidden_node.output_type_id().is_some());
        assert!(hidden_node.input_type_id().is_some());
        assert!(hidden_node.trigger_data_type_id().is_none());

        let output_node = AnyNode::Output(Box::new(MockOutputNode));
        assert_eq!(output_node.name(), "MockOutputNode");
        assert!(output_node.output_type_id().is_none());
        assert!(output_node.input_type_id().is_some());
        assert!(output_node.trigger_data_type_id().is_none());
    }
}
