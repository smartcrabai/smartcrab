use std::collections::HashMap;

use crate::error::AppError;

/// Detected node types keyed by node ID, paired with edges as `(from, to)` tuples.
pub(crate) type ParsedPipeline = (HashMap<String, String>, Vec<(String, String)>);

/// A raw node definition parsed from a pipeline YAML file.
#[derive(Debug, serde::Deserialize)]
pub(crate) struct NodeDef {
    #[serde(rename = "type")]
    node_type: Option<String>,
}

/// A raw edge definition parsed from a pipeline YAML file.
#[derive(Debug, serde::Deserialize)]
pub(crate) struct EdgeDef {
    from: String,
    to: String,
}

/// Top-level pipeline definition parsed from YAML.
#[derive(Debug, serde::Deserialize)]
struct PipelineDef {
    #[serde(default)]
    nodes: HashMap<String, NodeDef>,
    #[serde(default)]
    edges: Vec<EdgeDef>,
}

/// Detects the role of a node within a pipeline based on graph topology.
///
/// - A node with no incoming edges is classified as `"input"`.
/// - A node with no outgoing edges is classified as `"output"`.
/// - All other nodes are classified as `"hidden"`.
///
/// If a node already declares an explicit `type` field in YAML, that value is
/// used instead.
#[must_use]
pub(crate) fn auto_detect_node_types(
    nodes: &HashMap<String, NodeDef>,
    edges: &[EdgeDef],
) -> HashMap<String, String> {
    let mut incoming: HashMap<&str, usize> = HashMap::new();
    let mut outgoing: HashMap<&str, usize> = HashMap::new();

    for id in nodes.keys() {
        incoming.insert(id.as_str(), 0);
        outgoing.insert(id.as_str(), 0);
    }

    for edge in edges {
        *outgoing.entry(edge.from.as_str()).or_insert(0) += 1;
        *incoming.entry(edge.to.as_str()).or_insert(0) += 1;
    }

    let mut result = HashMap::new();
    for (id, def) in nodes {
        let detected = if let Some(ref explicit) = def.node_type {
            explicit.clone()
        } else {
            let inc = incoming.get(id.as_str()).copied().unwrap_or(0);
            let out = outgoing.get(id.as_str()).copied().unwrap_or(0);
            if inc == 0 {
                "input".to_owned()
            } else if out == 0 {
                "output".to_owned()
            } else {
                "hidden".to_owned()
            }
        };
        result.insert(id.clone(), detected);
    }
    result
}

/// Validates that a YAML pipeline definition has valid structure.
///
/// Checks:
/// - YAML is parsable as a `PipelineDef`
/// - At least one node exists
/// - All edge endpoints reference declared nodes
/// - At least one input node exists (no incoming edges or explicit type)
///
/// # Errors
///
/// Returns `AppError::Yaml` if the content cannot be parsed, or
/// `AppError::Validation` if structural checks fail.
pub fn validate_pipeline_yaml(yaml_content: &str) -> Result<(), AppError> {
    let def: PipelineDef = serde_yaml::from_str(yaml_content)?;

    if def.nodes.is_empty() {
        return Err(AppError::Validation(
            "Pipeline must define at least one node".to_owned(),
        ));
    }

    // Check that all edge endpoints reference declared nodes
    for edge in &def.edges {
        if !def.nodes.contains_key(&edge.from) {
            return Err(AppError::Validation(format!(
                "Edge references undeclared source node: {}",
                edge.from
            )));
        }
        if !def.nodes.contains_key(&edge.to) {
            return Err(AppError::Validation(format!(
                "Edge references undeclared target node: {}",
                edge.to
            )));
        }
    }

    // Verify at least one input node
    let types = auto_detect_node_types(&def.nodes, &def.edges);
    let has_input = types.values().any(|t| t == "input");
    if !has_input {
        return Err(AppError::Validation(
            "Pipeline must have at least one input node (a node with no incoming edges)".to_owned(),
        ));
    }

    Ok(())
}

/// Parses pipeline YAML and returns the detected node types and edges.
///
/// This is used by the `validate_pipeline` command to return structured
/// information to the frontend.
///
/// # Errors
///
/// Returns `AppError::Yaml` if the content cannot be parsed.
pub fn parse_pipeline_yaml(yaml_content: &str) -> Result<ParsedPipeline, AppError> {
    let def: PipelineDef = serde_yaml::from_str(yaml_content)?;
    let node_types = auto_detect_node_types(&def.nodes, &def.edges);
    let edges = def
        .edges
        .iter()
        .map(|e| (e.from.clone(), e.to.clone()))
        .collect();
    Ok((node_types, edges))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_yaml_passes_validation() {
        let yaml = r"
nodes:
  source:
    type: input
  transform: {}
  sink: {}
edges:
  - from: source
    to: transform
  - from: transform
    to: sink
";
        assert!(validate_pipeline_yaml(yaml).is_ok());
    }

    #[test]
    fn empty_nodes_fails() {
        let yaml = r"
nodes: {}
edges: []
";
        let Err(e) = validate_pipeline_yaml(yaml) else {
            panic!("expected validation error")
        };
        assert!(e.to_string().contains("at least one node"));
    }

    #[test]
    fn undeclared_source_node_in_edge_fails() {
        let yaml = r"
nodes:
  sink: {}
edges:
  - from: ghost
    to: sink
";
        let Err(e) = validate_pipeline_yaml(yaml) else {
            panic!("expected validation error")
        };
        assert!(e.to_string().contains("ghost"));
    }

    #[test]
    fn undeclared_target_node_in_edge_fails() {
        let yaml = r"
nodes:
  source: {}
edges:
  - from: source
    to: ghost
";
        let Err(e) = validate_pipeline_yaml(yaml) else {
            panic!("expected validation error")
        };
        assert!(e.to_string().contains("ghost"));
    }

    #[test]
    fn auto_detect_identifies_input_hidden_output() {
        let yaml = r"
nodes:
  a: {}
  b: {}
  c: {}
edges:
  - from: a
    to: b
  - from: b
    to: c
";
        let def: PipelineDef = serde_yaml::from_str(yaml).unwrap_or_else(|_| PipelineDef {
            nodes: HashMap::new(),
            edges: Vec::new(),
        });
        let types = auto_detect_node_types(&def.nodes, &def.edges);
        assert_eq!(types.get("a").map(String::as_str), Some("input"));
        assert_eq!(types.get("b").map(String::as_str), Some("hidden"));
        assert_eq!(types.get("c").map(String::as_str), Some("output"));
    }

    #[test]
    fn explicit_type_overrides_detection() {
        let yaml = r"
nodes:
  a:
    type: hidden
  b: {}
edges:
  - from: a
    to: b
";
        let def: PipelineDef = serde_yaml::from_str(yaml).unwrap_or_else(|_| PipelineDef {
            nodes: HashMap::new(),
            edges: Vec::new(),
        });
        let types = auto_detect_node_types(&def.nodes, &def.edges);
        assert_eq!(types.get("a").map(String::as_str), Some("hidden"));
    }

    #[test]
    fn invalid_yaml_fails() {
        let yaml = "not: [valid: yaml: content";
        assert!(validate_pipeline_yaml(yaml).is_err());
    }

    #[test]
    fn parse_pipeline_yaml_returns_types_and_edges() {
        let yaml = r"
nodes:
  src: {}
  dst: {}
edges:
  - from: src
    to: dst
";
        let result = parse_pipeline_yaml(yaml);
        assert!(result.is_ok());
        let (types, edges) = result.unwrap_or_default();
        assert_eq!(types.get("src").map(String::as_str), Some("input"));
        assert_eq!(types.get("dst").map(String::as_str), Some("output"));
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0], ("src".to_owned(), "dst".to_owned()));
    }

    #[test]
    fn no_input_node_fails_validation() {
        // All nodes have incoming edges, so none are detected as input
        let yaml = r"
nodes:
  a:
    type: hidden
  b:
    type: output
edges:
  - from: a
    to: b
  - from: b
    to: a
";
        let Err(e) = validate_pipeline_yaml(yaml) else {
            panic!("expected validation error")
        };
        assert!(e.to_string().contains("input node"));
    }
}
