use std::collections::BTreeMap;

/// Context used to render template files.
pub struct TemplateContext {
    pub name: String,
    pub local_path: Option<String>,
}

impl TemplateContext {
    fn name_snake(&self) -> String {
        self.name.replace('-', "_")
    }

    fn smartcrab_dep(&self) -> String {
        match &self.local_path {
            Some(path) => format!("smartcrab = {{ path = \"{}\" }}", path),
            None => "smartcrab = { git = \"https://github.com/takumi3488/smartcrab\" }".to_owned(),
        }
    }

    fn render(&self, template: &str) -> String {
        template
            .replace("{{name}}", &self.name)
            .replace("{{name_snake}}", &self.name_snake())
            .replace("{{smartcrab_dep}}", &self.smartcrab_dep())
    }
}

/// Render all template files, returning a map of relative path -> content.
pub fn render_all(ctx: &TemplateContext) -> BTreeMap<String, String> {
    let mut files = BTreeMap::new();

    let templates: Vec<(&str, &str)> = vec![
        ("Cargo.toml", include_str!("files/cargo_toml.txt")),
        ("SmartCrab.toml", include_str!("files/smartcrab_toml.txt")),
        ("Dockerfile", include_str!("files/dockerfile.txt")),
        ("compose.yml", include_str!("files/compose_yml.txt")),
        (".gitignore", include_str!("files/gitignore.txt")),
        ("src/main.rs", include_str!("files/main_rs.txt")),
        ("src/dto/mod.rs", include_str!("files/dto_mod_rs.txt")),
        (
            "src/dto/discord.rs",
            include_str!("files/dto_discord_rs.txt"),
        ),
        ("src/dto/cron.rs", include_str!("files/dto_cron_rs.txt")),
        ("src/node/mod.rs", include_str!("files/node_mod_rs.txt")),
        (
            "src/node/input/mod.rs",
            include_str!("files/node_input_mod_rs.txt"),
        ),
        (
            "src/node/input/discord_input.rs",
            include_str!("files/node_input_discord_rs.txt"),
        ),
        (
            "src/node/input/cron_input.rs",
            include_str!("files/node_input_cron_rs.txt"),
        ),
        (
            "src/node/hidden/mod.rs",
            include_str!("files/node_hidden_mod_rs.txt"),
        ),
        (
            "src/node/hidden/claude_code_node.rs",
            include_str!("files/node_hidden_claude_code_rs.txt"),
        ),
        (
            "src/node/output/mod.rs",
            include_str!("files/node_output_mod_rs.txt"),
        ),
        (
            "src/node/output/discord_output.rs",
            include_str!("files/node_output_discord_rs.txt"),
        ),
        ("src/graph/mod.rs", include_str!("files/graph_mod_rs.txt")),
        (
            "src/graph/discord_pipeline.rs",
            include_str!("files/graph_discord_pipeline_rs.txt"),
        ),
        (
            "src/graph/cron_pipeline.rs",
            include_str!("files/graph_cron_pipeline_rs.txt"),
        ),
        (
            "tests/graph_test.rs",
            include_str!("files/graph_test_rs.txt"),
        ),
    ];

    for (path, template) in templates {
        files.insert(path.to_owned(), ctx.render(template));
    }

    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_all_produces_expected_files() {
        let ctx = TemplateContext {
            name: "my-bot".to_owned(),
            local_path: None,
        };
        let files = render_all(&ctx);

        assert!(files.contains_key("Cargo.toml"));
        assert!(files.contains_key("src/main.rs"));
        assert!(files.contains_key("src/dto/mod.rs"));
        assert!(files.contains_key("src/graph/mod.rs"));
        assert!(files.contains_key("tests/graph_test.rs"));

        // Check that placeholders are replaced
        let cargo = &files["Cargo.toml"];
        assert!(cargo.contains("my-bot"));
        assert!(cargo.contains("my_bot"));
        assert!(!cargo.contains("{{name}}"));
        assert!(!cargo.contains("{{name_snake}}"));
        assert!(!cargo.contains("{{smartcrab_dep}}"));
    }

    #[test]
    fn test_render_with_local_path() {
        let ctx = TemplateContext {
            name: "my-bot".to_owned(),
            local_path: Some("../smartcrab".to_owned()),
        };
        let files = render_all(&ctx);
        let cargo = &files["Cargo.toml"];
        assert!(cargo.contains("path = \"../smartcrab\""));
    }

    #[test]
    fn test_name_snake_conversion() {
        let ctx = TemplateContext {
            name: "my-cool-bot".to_owned(),
            local_path: None,
        };
        assert_eq!(ctx.name_snake(), "my_cool_bot");
    }
}
