use crate::engine::yaml_parser::ResolvedNodeType;
use crate::engine::yaml_schema::NodeAction;

#[derive(Debug, Clone)]
pub struct DynamicNode {
    pub id: String,
    pub name: String,
    pub node_type: ResolvedNodeType,
    pub action: Option<NodeAction>,
}
