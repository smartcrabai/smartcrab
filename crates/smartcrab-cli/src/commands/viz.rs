use std::io;
use std::path::Path;

/// Parsed DAG structure from source code.
#[derive(Debug)]
struct ParsedDag {
    name: String,
    nodes: Vec<ParsedNode>,
    edges: Vec<ParsedEdge>,
}

#[derive(Debug, Clone)]
struct ParsedNode {
    name: String,
    kind: NodeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NodeKind {
    Input,
    Hidden,
    Output,
}

#[derive(Debug)]
struct ParsedEdge {
    from: String,
    to: String,
    label: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VizFormat {
    Mermaid,
    Dot,
    Ascii,
}

pub fn run(
    dag_name: Option<&str>,
    format: VizFormat,
    output_path: Option<&str>,
    no_types: bool,
    show_order: bool,
) -> io::Result<()> {
    let project_dir = super::ensure_smartcrab_project()?;
    let dag_dir = project_dir.join("src/dag");

    if !dag_dir.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "No src/dag/ directory found in the project.",
        ));
    }

    let dags = discover_dags(&dag_dir)?;

    if dags.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "No DAG definitions found in src/dag/.",
        ));
    }

    let selected: Vec<&ParsedDag> = match dag_name {
        Some(name) => {
            let found: Vec<&ParsedDag> = dags.iter().filter(|d| d.name == name).collect();
            if found.is_empty() {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!(
                        "DAG `{name}` not found. Available DAGs: {}",
                        dag_names(&dags)
                    ),
                ));
            }
            found
        }
        None => dags.iter().collect(),
    };

    let mut rendered = String::new();
    for (i, dag) in selected.iter().enumerate() {
        if i > 0 {
            let separator = match format {
                VizFormat::Ascii => "\n---\n\n",
                VizFormat::Mermaid | VizFormat::Dot => "\n\n",
            };
            rendered.push_str(separator);
        }
        let output = render_dag(dag, format, no_types, show_order);
        rendered.push_str(&output);
    }

    match output_path {
        Some(path) => {
            std::fs::write(path, &rendered)?;
            println!("Written to {path}");
        }
        None => {
            print!("{rendered}");
        }
    }

    Ok(())
}

fn dag_names(dags: &[ParsedDag]) -> String {
    dags.iter()
        .map(|d| d.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// Discover all DAG definitions by reading `src/dag/*.rs` files (excluding `mod.rs`).
fn discover_dags(dag_dir: &Path) -> io::Result<Vec<ParsedDag>> {
    let mut dags = Vec::new();

    for entry in std::fs::read_dir(dag_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let file_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default();
        if file_name == "mod" {
            continue;
        }

        let content = std::fs::read_to_string(&path)?;
        if let Some(dag) = parse_dag_source(&content) {
            dags.push(dag);
        }
    }

    dags.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(dags)
}

/// Parse DAG structure from a Rust source file by matching builder patterns.
fn parse_dag_source(content: &str) -> Option<ParsedDag> {
    let name = extract_dag_name(content)?;
    let nodes = extract_nodes(content);
    let edges = extract_edges(content);

    if nodes.is_empty() {
        return None;
    }

    Some(ParsedDag { name, nodes, edges })
}

fn extract_dag_name(content: &str) -> Option<String> {
    // Match DagBuilder::new("name")
    let marker = "DagBuilder::new(\"";
    let start = content.find(marker)? + marker.len();
    let end = content[start..].find('"')? + start;
    Some(content[start..end].to_owned())
}

fn extract_nodes(content: &str) -> Vec<ParsedNode> {
    let mut nodes = Vec::new();

    for (pattern, kind) in [
        (".add_input(", NodeKind::Input),
        (".add_hidden(", NodeKind::Hidden),
        (".add_output(", NodeKind::Output),
    ] {
        let mut search_from = 0;
        while let Some(pos) = content[search_from..].find(pattern) {
            let abs_pos = search_from + pos + pattern.len();
            if let Some(name) = extract_layer_name(&content[abs_pos..]) {
                nodes.push(ParsedNode { name, kind });
            }
            search_from = abs_pos;
        }
    }

    nodes
}

/// Extract the layer struct name from the constructor expression.
/// Handles patterns like: `SourceLayer)`, `SourceLayer::new())`, `SourceLayer { .. })`
fn extract_layer_name(content: &str) -> Option<String> {
    let content = content.trim();
    let mut name = String::new();
    for ch in content.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            name.push(ch);
        } else {
            break;
        }
    }
    if name.is_empty() {
        return None;
    }
    Some(name)
}

fn extract_edges(content: &str) -> Vec<ParsedEdge> {
    let mut edges = Vec::new();

    // Match .add_edge("from", "to")
    let pattern = ".add_edge(\"";
    let mut search_from = 0;
    while let Some(pos) = content[search_from..].find(pattern) {
        let abs_pos = search_from + pos + pattern.len();
        if let Some((from, to)) = extract_edge_pair(&content[abs_pos..]) {
            edges.push(ParsedEdge {
                from,
                to,
                label: None,
            });
        }
        search_from = abs_pos;
    }

    // Match .add_conditional_edge("from", ..., vec![("label", "to")])
    // Simplified: extract branch pairs
    let cond_pattern = ".add_conditional_edge(\"";
    search_from = 0;
    while let Some(pos) = content[search_from..].find(cond_pattern) {
        let abs_pos = search_from + pos + cond_pattern.len();
        if let Some(from_end) = content[abs_pos..].find('"') {
            let from = content[abs_pos..abs_pos + from_end].to_owned();
            // Extract all ("label".to_owned(), "target".to_owned()) pairs
            let remaining = &content[abs_pos + from_end..];
            for (label, to) in extract_conditional_branches(remaining) {
                edges.push(ParsedEdge {
                    from: from.clone(),
                    to,
                    label: Some(label),
                });
            }
        }
        search_from = abs_pos;
    }

    edges
}

fn extract_edge_pair(content: &str) -> Option<(String, String)> {
    // Expects: from", "to")
    let end_from = content.find('"')?;
    let from = content[..end_from].to_owned();

    let rest = &content[end_from + 1..];
    // Skip to next quote
    let start_to = rest.find('"')? + 1;
    let end_to = rest[start_to..].find('"')? + start_to;
    let to = rest[start_to..end_to].to_owned();

    Some((from, to))
}

fn extract_conditional_branches(content: &str) -> Vec<(String, String)> {
    let mut branches = Vec::new();

    // Look for patterns like ("label".to_owned(), "target".to_owned()) or ("label", "target")
    // within vec![...] or similar
    let mut pos = 0;
    while pos < content.len() {
        // Find a string literal pair pattern: "label"...,"target"
        if let Some(start) = content[pos..].find("(\"") {
            let abs_start = pos + start + 2;
            if let Some(end_label) = content[abs_start..].find('"') {
                let label = content[abs_start..abs_start + end_label].to_owned();
                let rest = &content[abs_start + end_label + 1..];
                // Find next string literal for target
                if let Some(target_start) = rest.find('"') {
                    let target_rest = &rest[target_start + 1..];
                    if let Some(target_end) = target_rest.find('"') {
                        let target = target_rest[..target_end].to_owned();
                        // Validate: target should look like a valid identifier
                        if target.chars().all(|c| c.is_alphanumeric() || c == '_')
                            && !target.is_empty()
                        {
                            branches.push((label, target));
                        }
                    }
                }
            }
            pos = abs_start;
        } else {
            break;
        }
    }

    branches
}

// ---------------------------------------------------------------------------
// Rendering (simplified, standalone - mirrors core viz output format)
// ---------------------------------------------------------------------------

fn render_dag(dag: &ParsedDag, format: VizFormat, no_types: bool, show_order: bool) -> String {
    match format {
        VizFormat::Mermaid => render_mermaid(dag, no_types, show_order),
        VizFormat::Dot => render_dot(dag, no_types, show_order),
        VizFormat::Ascii => render_ascii(dag, no_types, show_order),
    }
}

fn kind_str(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Input => "Input",
        NodeKind::Hidden => "Hidden",
        NodeKind::Output => "Output",
    }
}

fn kind_emoji(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Input => "\u{1F4E5}",
        NodeKind::Hidden => "\u{2699}\u{FE0F}",
        NodeKind::Output => "\u{1F4E4}",
    }
}

fn render_mermaid(dag: &ParsedDag, no_types: bool, show_order: bool) -> String {
    let mut out = String::from("flowchart TD\n");

    for (idx, node) in dag.nodes.iter().enumerate() {
        let emoji = kind_emoji(node.kind);
        let kind = kind_str(node.kind);

        let mut label = format!("{emoji} {}", node.name);
        if show_order {
            label = format!("#{} {label}", idx + 1);
        }
        if !no_types {
            label.push_str(&format!("<br/>{kind}"));
        }

        let shape = match node.kind {
            NodeKind::Input => format!("    {}([\"{label}\"])", node.name),
            NodeKind::Hidden => format!("    {}[\"{label}\"]", node.name),
            NodeKind::Output => format!("    {}{{\"{label}\"}}", node.name),
        };
        out.push_str(&shape);
        out.push('\n');
    }

    out.push('\n');

    for edge in &dag.edges {
        match &edge.label {
            Some(label) => {
                out.push_str(&format!(
                    "    {} -->|\"{}\"| {}\n",
                    edge.from, label, edge.to
                ));
            }
            None => {
                out.push_str(&format!("    {} --> {}\n", edge.from, edge.to));
            }
        }
    }

    out
}

fn render_dot(dag: &ParsedDag, no_types: bool, show_order: bool) -> String {
    let mut out = format!("digraph \"{}\" {{\n", dag.name);
    out.push_str("    rankdir=TB;\n");
    out.push_str("    node [fontname=\"sans-serif\", fontsize=12];\n");
    out.push_str("    edge [fontname=\"sans-serif\", fontsize=10];\n\n");

    for (idx, node) in dag.nodes.iter().enumerate() {
        let emoji = kind_emoji(node.kind);
        let kind = kind_str(node.kind);

        let mut label = format!("{emoji} {}", node.name);
        if show_order {
            label = format!("#{} {label}", idx + 1);
        }
        if !no_types {
            label.push_str(&format!("\\n({kind})"));
        }

        let shape = match node.kind {
            NodeKind::Input => "box, style=rounded",
            NodeKind::Hidden => "box",
            NodeKind::Output => "hexagon",
        };

        out.push_str(&format!(
            "    {} [shape={shape}, label=\"{label}\"];\n",
            node.name
        ));
    }

    out.push('\n');

    for edge in &dag.edges {
        match &edge.label {
            Some(label) => {
                out.push_str(&format!(
                    "    {} -> {} [label=\"{}\"];\n",
                    edge.from, edge.to, label
                ));
            }
            None => {
                out.push_str(&format!("    {} -> {};\n", edge.from, edge.to));
            }
        }
    }

    out.push_str("}\n");
    out
}

fn render_ascii(dag: &ParsedDag, no_types: bool, show_order: bool) -> String {
    let mut out = String::new();

    // Build edge label lookup
    let mut edge_labels: std::collections::HashMap<(&str, &str), Vec<&str>> =
        std::collections::HashMap::new();
    for edge in &dag.edges {
        if let Some(label) = &edge.label {
            edge_labels
                .entry((edge.from.as_str(), edge.to.as_str()))
                .or_default()
                .push(label.as_str());
        }
    }

    for (idx, node) in dag.nodes.iter().enumerate() {
        let emoji = kind_emoji(node.kind);
        let kind = kind_str(node.kind);

        let mut line1 = format!("{emoji} {}", node.name);
        if show_order {
            line1 = format!("#{} {line1}", idx + 1);
        }
        let line2 = format!("({kind} Layer)");

        let content_width = if no_types {
            line1.chars().count() + 2
        } else {
            line1.chars().count().max(line2.chars().count()) + 2
        };
        let box_width = content_width + 2;
        let inner_width = box_width - 2;

        let top = format!(
            "\u{250C}{}\u{2510}",
            "\u{2500}".repeat(box_width.saturating_sub(2))
        );
        let bot = format!(
            "\u{2514}{}\u{2518}",
            "\u{2500}".repeat(box_width.saturating_sub(2))
        );
        let row1 = format!("\u{2502}{}\u{2502}", center_text(&line1, inner_width));

        out.push_str(&top);
        out.push('\n');
        out.push_str(&row1);
        out.push('\n');
        if !no_types {
            let row2 = format!("\u{2502}{}\u{2502}", center_text(&line2, inner_width));
            out.push_str(&row2);
            out.push('\n');
        }
        out.push_str(&bot);
        out.push('\n');

        // Connector to next node
        if idx + 1 < dag.nodes.len() {
            let next = &dag.nodes[idx + 1];
            let labels = edge_labels.get(&(node.name.as_str(), next.name.as_str()));

            let mid = box_width / 2;
            let pad = " ".repeat(mid);
            out.push_str(&format!("{pad}\u{2502}\n"));
            if let Some(labels) = labels {
                for label in labels {
                    out.push_str(&format!("{pad}\u{2502} {label}\n"));
                }
            }
            out.push_str(&format!("{pad}\u{25BC}\n"));
        }
    }

    out
}

fn center_text(text: &str, width: usize) -> String {
    let text_len = text.chars().count();
    if text_len >= width {
        return format!(" {text} ");
    }
    let total_padding = width - text_len;
    let left = total_padding / 2;
    let right = total_padding - left;
    format!("{}{text}{}", " ".repeat(left), " ".repeat(right))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_DAG: &str = r#"
use smartcrab::prelude::*;

pub fn build() -> std::result::Result<Dag, DagError> {
    DagBuilder::new("my_pipeline")
        .add_input(HttpInput)
        .add_hidden(DataProcessor)
        .add_output(JsonResponder)
        .add_edge("HttpInput", "DataProcessor")
        .add_edge("DataProcessor", "JsonResponder")
        .build()
}
"#;

    #[test]
    fn test_extract_dag_name() {
        assert_eq!(extract_dag_name(SAMPLE_DAG), Some("my_pipeline".to_owned()));
    }

    #[test]
    fn test_extract_nodes() {
        let nodes = extract_nodes(SAMPLE_DAG);
        assert_eq!(nodes.len(), 3);
        assert_eq!(nodes[0].name, "HttpInput");
        assert_eq!(nodes[0].kind, NodeKind::Input);
        assert_eq!(nodes[1].name, "DataProcessor");
        assert_eq!(nodes[1].kind, NodeKind::Hidden);
        assert_eq!(nodes[2].name, "JsonResponder");
        assert_eq!(nodes[2].kind, NodeKind::Output);
    }

    #[test]
    fn test_extract_edges() {
        let edges = extract_edges(SAMPLE_DAG);
        assert_eq!(edges.len(), 2);
        assert_eq!(edges[0].from, "HttpInput");
        assert_eq!(edges[0].to, "DataProcessor");
        assert!(edges[0].label.is_none());
        assert_eq!(edges[1].from, "DataProcessor");
        assert_eq!(edges[1].to, "JsonResponder");
    }

    #[test]
    fn test_parse_dag_source() {
        let dag = parse_dag_source(SAMPLE_DAG).unwrap();
        assert_eq!(dag.name, "my_pipeline");
        assert_eq!(dag.nodes.len(), 3);
        assert_eq!(dag.edges.len(), 2);
    }

    #[test]
    fn test_parse_dag_with_constructor() {
        let content = r#"
DagBuilder::new("test")
    .add_input(SourceLayer)
    .add_hidden(ClaudeCodeLayer::new())
    .add_output(DiscordOutput)
    .add_edge("SourceLayer", "ClaudeCodeLayer")
    .add_edge("ClaudeCodeLayer", "DiscordOutput")
    .build()
"#;
        let dag = parse_dag_source(content).unwrap();
        assert_eq!(dag.nodes.len(), 3);
        assert_eq!(dag.nodes[1].name, "ClaudeCodeLayer");
    }

    #[test]
    fn test_render_mermaid() {
        let dag = parse_dag_source(SAMPLE_DAG).unwrap();
        let output = render_mermaid(&dag, false, false);
        assert!(output.starts_with("flowchart TD\n"));
        assert!(output.contains("HttpInput"));
        assert!(output.contains("DataProcessor"));
        assert!(output.contains("JsonResponder"));
        assert!(output.contains("HttpInput --> DataProcessor"));
        assert!(output.contains("DataProcessor --> JsonResponder"));
    }

    #[test]
    fn test_render_dot() {
        let dag = parse_dag_source(SAMPLE_DAG).unwrap();
        let output = render_dot(&dag, false, false);
        assert!(output.starts_with("digraph \"my_pipeline\""));
        assert!(output.contains("HttpInput"));
        assert!(output.contains("shape=box, style=rounded")); // Input
        assert!(output.contains("shape=hexagon")); // Output
    }

    #[test]
    fn test_render_ascii() {
        let dag = parse_dag_source(SAMPLE_DAG).unwrap();
        let output = render_ascii(&dag, false, false);
        assert!(output.contains("HttpInput"));
        assert!(output.contains("DataProcessor"));
        assert!(output.contains("JsonResponder"));
        assert!(output.contains("\u{2502}")); // │
        assert!(output.contains("\u{25BC}")); // ▼
    }

    #[test]
    fn test_render_show_order() {
        let dag = parse_dag_source(SAMPLE_DAG).unwrap();
        let output = render_mermaid(&dag, false, true);
        assert!(output.contains("#1"));
        assert!(output.contains("#2"));
        assert!(output.contains("#3"));
    }

    #[test]
    fn test_no_dag_in_mod_rs() {
        // mod.rs content should not be parsed as a DAG
        let content = "pub mod discord_pipeline;\npub mod cron_pipeline;\n";
        assert!(parse_dag_source(content).is_none());
    }
}
