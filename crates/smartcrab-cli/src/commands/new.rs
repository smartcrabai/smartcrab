use std::fs;
use std::io;
use std::path::PathBuf;

use crate::templates::{TemplateContext, render_all};

/// Execute the `smartcrab new` command.
pub fn run(name: &str, local_path: Option<&str>, output_dir: Option<&str>) -> io::Result<()> {
    validate_name(name).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;

    let base = match output_dir {
        Some(p) => PathBuf::from(p),
        None => std::env::current_dir()?,
    };
    let project_dir = base.join(name);

    if project_dir.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("Directory already exists: {}", project_dir.display()),
        ));
    }

    let ctx = TemplateContext {
        name: name.to_owned(),
        local_path: local_path.map(str::to_owned),
    };

    let files = render_all(&ctx);

    for (rel_path, content) in &files {
        let full_path = project_dir.join(rel_path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&full_path, content)?;
    }

    println!("Created project `{name}` at {}", project_dir.display());
    println!();
    println!("Next steps:");
    println!("  cd {name}");
    println!("  cargo build");
    println!("  cargo test");

    Ok(())
}

/// Validate that a project name is a valid Rust crate name.
pub fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Project name cannot be empty".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(
            "Project name can only contain alphanumeric characters, hyphens, and underscores"
                .into(),
        );
    }
    if name.starts_with('-') || name.starts_with('_') {
        return Err("Project name cannot start with a hyphen or underscore".into());
    }
    if name.starts_with(|c: char| c.is_ascii_digit()) {
        return Err("Project name cannot start with a digit".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_name_valid() {
        assert!(validate_name("my-project").is_ok());
        assert!(validate_name("my_project").is_ok());
        assert!(validate_name("project123").is_ok());
    }

    #[test]
    fn test_validate_name_invalid() {
        assert!(validate_name("").is_err());
        assert!(validate_name("-bad").is_err());
        assert!(validate_name("_bad").is_err());
        assert!(validate_name("has space").is_err());
        assert!(validate_name("123project").is_err());
    }
}
