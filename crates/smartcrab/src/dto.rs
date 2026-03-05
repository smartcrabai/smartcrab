use std::any::Any;
use std::fmt::Debug;

use serde::{Deserialize, Serialize};

/// Marker trait for data transfer objects passed between layers.
///
/// This trait is automatically implemented for any type that satisfies
/// `Serialize + Deserialize + Clone + Debug + Send + Sync + 'static`.
pub trait Dto:
    Serialize + for<'de> Deserialize<'de> + Clone + Debug + Send + Sync + 'static
{
    /// Returns the type name for runtime type checking.
    fn type_name(&self) -> &'static str {
        std::any::type_name::<Self>()
    }
}

impl<T> Dto for T where
    T: Serialize + for<'de> Deserialize<'de> + Clone + Debug + Send + Sync + 'static
{
}

/// Object-safe version of `Dto` for type-erased usage inside the Graph engine.
pub trait DtoObject: Debug + Send + Sync + 'static {
    fn as_any(&self) -> &dyn Any;
    fn clone_box(&self) -> Box<dyn DtoObject>;
    fn dto_type_name(&self) -> &'static str;
    fn serialize_json(&self) -> serde_json::Result<String>;
}

impl<T: Dto> DtoObject for T {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn clone_box(&self) -> Box<dyn DtoObject> {
        Box::new(self.clone())
    }

    fn dto_type_name(&self) -> &'static str {
        std::any::type_name::<T>()
    }

    fn serialize_json(&self) -> serde_json::Result<String> {
        serde_json::to_string(self)
    }
}

impl Clone for Box<dyn DtoObject> {
    fn clone(&self) -> Self {
        self.clone_box()
    }
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};

    use super::*;

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    struct TestDto {
        message: String,
        count: u32,
    }

    #[test]
    fn test_dto_type_name() {
        let dto = TestDto {
            message: "hello".into(),
            count: 42,
        };
        assert!(dto.type_name().contains("TestDto"));
    }

    #[test]
    fn test_dto_object_downcast() {
        let dto = TestDto {
            message: "hello".into(),
            count: 42,
        };
        let boxed: Box<dyn DtoObject> = Box::new(dto.clone());
        let downcasted = boxed.as_any().downcast_ref::<TestDto>().unwrap();
        assert_eq!(downcasted, &dto);
    }

    #[test]
    fn test_dto_object_clone_box() {
        let dto = TestDto {
            message: "test".into(),
            count: 1,
        };
        let boxed: Box<dyn DtoObject> = Box::new(dto.clone());
        let cloned = boxed.clone_box();
        let downcasted = cloned.as_any().downcast_ref::<TestDto>().unwrap();
        assert_eq!(downcasted, &dto);
    }

    #[test]
    fn test_dto_object_type_name() {
        let dto = TestDto {
            message: "test".into(),
            count: 1,
        };
        let boxed: Box<dyn DtoObject> = Box::new(dto);
        assert!(boxed.dto_type_name().contains("TestDto"));
    }

    #[test]
    fn test_dto_object_serialize_json() {
        let dto = TestDto {
            message: "hello".into(),
            count: 42,
        };
        let boxed: Box<dyn DtoObject> = Box::new(dto);
        let json = boxed.serialize_json().unwrap();
        assert!(json.contains("hello"));
        assert!(json.contains("42"));
    }
}
