pub mod agent;
pub mod chat;
pub mod dag;
pub mod dto;
pub mod error;
pub mod layer;
pub mod runtime;
pub mod telemetry;

/// Convenience re-exports for common usage.
pub mod prelude {
    pub use async_trait::async_trait;

    pub use crate::agent::AgentExecutor;
    pub use crate::dag::{Dag, DagBuilder};
    pub use crate::dto::{Dto, DtoObject};
    pub use crate::error::{DagError, Result, SmartCrabError};
    pub use crate::layer::{HiddenLayer, InputLayer, Layer, OutputLayer};
    pub use crate::runtime::Runtime;
}
