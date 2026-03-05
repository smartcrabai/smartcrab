use std::any::TypeId;

use async_trait::async_trait;

use crate::dto::{Dto, DtoObject};
use crate::error::Result;

/// Base trait for all layers.
pub trait Layer: Send + Sync + 'static {
    fn name(&self) -> &str;
}

/// A layer that produces data from an external source.
#[async_trait]
pub trait InputLayer: Layer {
    type TriggerData: Dto;
    type Output: Dto;
    async fn run(&self, trigger: Self::TriggerData) -> Result<Self::Output>;
}

/// A layer that transforms data.
#[async_trait]
pub trait HiddenLayer: Layer {
    type Input: Dto;
    type Output: Dto;
    async fn run(&self, input: Self::Input) -> Result<Self::Output>;
}

/// A layer that consumes data and performs a side effect.
#[async_trait]
pub trait OutputLayer: Layer {
    type Input: Dto;
    async fn run(&self, input: Self::Input) -> Result<()>;
}

// ---------------------------------------------------------------------------
// Object-safe dynamic dispatch wrappers
// ---------------------------------------------------------------------------

/// Object-safe wrapper for `InputLayer`.
#[async_trait]
pub trait InputLayerDyn: Layer {
    fn trigger_data_type_id(&self) -> TypeId;
    fn trigger_data_type_name(&self) -> &'static str;
    fn output_type_id(&self) -> TypeId;
    fn output_type_name(&self) -> &'static str;
    async fn run_dyn(&self, trigger: &dyn DtoObject) -> Result<Box<dyn DtoObject>>;
}

#[async_trait]
impl<T: InputLayer> InputLayerDyn for T {
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

/// Object-safe wrapper for `HiddenLayer`.
#[async_trait]
pub trait HiddenLayerDyn: Layer {
    fn input_type_id(&self) -> TypeId;
    fn input_type_name(&self) -> &'static str;
    fn output_type_id(&self) -> TypeId;
    fn output_type_name(&self) -> &'static str;
    async fn run_dyn(&self, input: &dyn DtoObject) -> Result<Box<dyn DtoObject>>;
}

#[async_trait]
impl<T: HiddenLayer> HiddenLayerDyn for T {
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

/// Object-safe wrapper for `OutputLayer`.
#[async_trait]
pub trait OutputLayerDyn: Layer {
    fn input_type_id(&self) -> TypeId;
    fn input_type_name(&self) -> &'static str;
    async fn run_dyn(&self, input: &dyn DtoObject) -> Result<()>;
}

#[async_trait]
impl<T: OutputLayer> OutputLayerDyn for T {
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

/// Type-erased layer enum used in the Graph engine.
pub enum AnyLayer {
    Input(Box<dyn InputLayerDyn>),
    Hidden(Box<dyn HiddenLayerDyn>),
    Output(Box<dyn OutputLayerDyn>),
}

impl AnyLayer {
    pub fn name(&self) -> &str {
        match self {
            AnyLayer::Input(l) => l.name(),
            AnyLayer::Hidden(l) => l.name(),
            AnyLayer::Output(l) => l.name(),
        }
    }

    /// Returns the `TypeId` of the trigger data (if Input layer).
    pub fn trigger_data_type_id(&self) -> Option<TypeId> {
        match self {
            AnyLayer::Input(l) => Some(l.trigger_data_type_id()),
            _ => None,
        }
    }

    /// Returns the trigger data type name (if Input layer).
    pub fn trigger_data_type_name(&self) -> Option<&'static str> {
        match self {
            AnyLayer::Input(l) => Some(l.trigger_data_type_name()),
            _ => None,
        }
    }

    /// Returns the `TypeId` of the output DTO (if any).
    pub fn output_type_id(&self) -> Option<TypeId> {
        match self {
            AnyLayer::Input(l) => Some(l.output_type_id()),
            AnyLayer::Hidden(l) => Some(l.output_type_id()),
            AnyLayer::Output(_) => None,
        }
    }

    /// Returns the output type name (if any).
    pub fn output_type_name(&self) -> Option<&'static str> {
        match self {
            AnyLayer::Input(l) => Some(l.output_type_name()),
            AnyLayer::Hidden(l) => Some(l.output_type_name()),
            AnyLayer::Output(_) => None,
        }
    }

    /// Returns the `TypeId` of the input DTO (if any).
    pub fn input_type_id(&self) -> Option<TypeId> {
        match self {
            AnyLayer::Input(_) => None,
            AnyLayer::Hidden(l) => Some(l.input_type_id()),
            AnyLayer::Output(l) => Some(l.input_type_id()),
        }
    }

    /// Returns the input type name (if any).
    pub fn input_type_name(&self) -> Option<&'static str> {
        match self {
            AnyLayer::Input(_) => None,
            AnyLayer::Hidden(l) => Some(l.input_type_name()),
            AnyLayer::Output(l) => Some(l.input_type_name()),
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

    struct MockInputLayer;

    impl Layer for MockInputLayer {
        fn name(&self) -> &str {
            "MockInputLayer"
        }
    }

    #[async_trait]
    impl InputLayer for MockInputLayer {
        type TriggerData = ();
        type Output = MockOutput;
        async fn run(&self, _: ()) -> Result<MockOutput> {
            Ok(MockOutput {
                result: "from input".into(),
            })
        }
    }

    struct MockHiddenLayer;

    impl Layer for MockHiddenLayer {
        fn name(&self) -> &str {
            "MockHiddenLayer"
        }
    }

    #[async_trait]
    impl HiddenLayer for MockHiddenLayer {
        type Input = MockOutput;
        type Output = MockInput;
        async fn run(&self, input: MockOutput) -> Result<MockInput> {
            Ok(MockInput {
                value: input.result,
            })
        }
    }

    struct MockOutputLayer;

    impl Layer for MockOutputLayer {
        fn name(&self) -> &str {
            "MockOutputLayer"
        }
    }

    #[async_trait]
    impl OutputLayer for MockOutputLayer {
        type Input = MockInput;
        async fn run(&self, _input: MockInput) -> Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_input_layer_dyn() {
        let layer = MockInputLayer;
        let trigger: Box<dyn DtoObject> = Box::new(());
        let output = layer.run_dyn(trigger.as_ref()).await.unwrap();
        let concrete = output.as_any().downcast_ref::<MockOutput>().unwrap();
        assert_eq!(concrete.result, "from input");
    }

    #[tokio::test]
    async fn test_hidden_layer_dyn() {
        let layer = MockHiddenLayer;
        let input = MockOutput {
            result: "hello".into(),
        };
        let boxed: Box<dyn DtoObject> = Box::new(input);
        let output = layer.run_dyn(boxed.as_ref()).await.unwrap();
        let concrete = output.as_any().downcast_ref::<MockInput>().unwrap();
        assert_eq!(concrete.value, "hello");
    }

    #[tokio::test]
    async fn test_output_layer_dyn() {
        let layer = MockOutputLayer;
        let input = MockInput {
            value: "test".into(),
        };
        let boxed: Box<dyn DtoObject> = Box::new(input);
        layer.run_dyn(boxed.as_ref()).await.unwrap();
    }

    #[test]
    fn test_any_layer_type_info() {
        let input_layer = AnyLayer::Input(Box::new(MockInputLayer));
        assert_eq!(input_layer.name(), "MockInputLayer");
        assert!(input_layer.output_type_id().is_some());
        assert!(input_layer.input_type_id().is_none());
        assert!(input_layer.trigger_data_type_id().is_some());

        let hidden_layer = AnyLayer::Hidden(Box::new(MockHiddenLayer));
        assert_eq!(hidden_layer.name(), "MockHiddenLayer");
        assert!(hidden_layer.output_type_id().is_some());
        assert!(hidden_layer.input_type_id().is_some());
        assert!(hidden_layer.trigger_data_type_id().is_none());

        let output_layer = AnyLayer::Output(Box::new(MockOutputLayer));
        assert_eq!(output_layer.name(), "MockOutputLayer");
        assert!(output_layer.output_type_id().is_none());
        assert!(output_layer.input_type_id().is_some());
        assert!(output_layer.trigger_data_type_id().is_none());
    }
}
