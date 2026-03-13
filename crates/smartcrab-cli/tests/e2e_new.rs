use std::path::Path;

use predicates::prelude::*;
use tempfile::TempDir;

fn smartcrab_cmd() -> assert_cmd::Command {
    assert_cmd::cargo_bin_cmd!("crab")
}

/// Resolve the absolute path to the `crates/smartcrab` directory.
fn smartcrab_crate_path() -> Result<String, String> {
    let manifest_dir = env!("CARGO_MANIFEST_DIR"); // crates/smartcrab-cli
    Ok(Path::new(manifest_dir)
        .parent()
        .ok_or("manifest dir has no parent")?
        .join("smartcrab")
        .to_string_lossy()
        .into_owned())
}

/// Run `smartcrab new` in a temp directory and return the temp dir and project path.
fn generate_project(
    name: &str,
) -> Result<(TempDir, std::path::PathBuf), Box<dyn std::error::Error>> {
    let tmp = TempDir::new()?;
    let local_path = smartcrab_crate_path()?;

    smartcrab_cmd()
        .args(["new", name, "--local-path", &local_path, "--path"])
        .arg(tmp.path())
        .assert()
        .success()
        .stdout(predicate::str::contains(format!(
            "Created project `{name}`"
        )));

    let project_dir = tmp.path().join(name);
    Ok((tmp, project_dir))
}

// -----------------------------------------------------------------------
// File existence tests
// -----------------------------------------------------------------------

#[test]
fn generated_project_has_expected_root_files() -> Result<(), Box<dyn std::error::Error>> {
    let (_tmp, project) = generate_project("file-check")?;

    let expected_files = [
        "Cargo.toml",
        "SmartCrab.toml",
        "Dockerfile",
        "compose.yml",
        ".gitignore",
    ];
    for file in &expected_files {
        assert!(project.join(file).is_file(), "Missing root file: {file}");
    }
    Ok(())
}

#[test]
fn generated_project_has_expected_src_structure() -> Result<(), Box<dyn std::error::Error>> {
    let (_tmp, project) = generate_project("src-check")?;

    let expected_files = [
        "src/main.rs",
        // dto
        "src/dto/mod.rs",
        "src/dto/discord.rs",
        "src/dto/cron.rs",
        // layer
        "src/node/mod.rs",
        "src/node/input/mod.rs",
        "src/node/input/discord_input.rs",
        "src/node/input/cron_input.rs",
        "src/node/hidden/mod.rs",
        "src/node/hidden/claude_code_node.rs",
        "src/node/output/mod.rs",
        "src/node/output/discord_output.rs",
        // graph
        "src/graph/mod.rs",
        "src/graph/discord_pipeline.rs",
        "src/graph/cron_pipeline.rs",
        // tests
        "tests/graph_test.rs",
    ];
    for file in &expected_files {
        assert!(project.join(file).is_file(), "Missing source file: {file}");
    }
    Ok(())
}

#[test]
fn generated_project_contains_no_unresolved_placeholders() -> Result<(), Box<dyn std::error::Error>>
{
    let (_tmp, project) = generate_project("placeholder-check")?;

    let placeholders = ["{{name}}", "{{name_snake}}", "{{smartcrab_dep}}"];

    for entry in walkdir(&project)? {
        if !entry.is_file() {
            continue;
        }
        // Skip non-text files
        let ext = entry.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "rs" | "toml" | "yml" | "txt" | "") {
            continue;
        }
        let content = std::fs::read_to_string(&entry).unwrap_or_default();
        for ph in &placeholders {
            assert!(
                !content.contains(ph),
                "Unresolved placeholder {ph} in {}",
                entry.display()
            );
        }
    }
    Ok(())
}

#[test]
fn generated_cargo_toml_has_correct_name() -> Result<(), Box<dyn std::error::Error>> {
    let (_tmp, project) = generate_project("my-cool-bot")?;

    let cargo_toml = std::fs::read_to_string(project.join("Cargo.toml"))?;
    assert!(cargo_toml.contains("name = \"my-cool-bot\""));
    // binary name should use snake_case
    assert!(cargo_toml.contains("name = \"my_cool_bot\""));
    Ok(())
}

#[test]
fn generated_smartcrab_toml_has_correct_name() -> Result<(), Box<dyn std::error::Error>> {
    let (_tmp, project) = generate_project("toml-check")?;

    let content = std::fs::read_to_string(project.join("SmartCrab.toml"))?;
    assert!(content.contains("name = \"toml-check\""));
    Ok(())
}

// -----------------------------------------------------------------------
// Error condition tests
// -----------------------------------------------------------------------

#[test]
fn new_rejects_existing_directory() -> Result<(), Box<dyn std::error::Error>> {
    let tmp = TempDir::new()?;
    let local_path = smartcrab_crate_path()?;

    // First generation succeeds
    smartcrab_cmd()
        .args(["new", "dup-project", "--local-path", &local_path, "--path"])
        .arg(tmp.path())
        .assert()
        .success();

    // Second generation should fail
    smartcrab_cmd()
        .args(["new", "dup-project", "--local-path", &local_path, "--path"])
        .arg(tmp.path())
        .assert()
        .failure()
        .stderr(predicate::str::contains("already exists"));
    Ok(())
}

#[test]
fn new_rejects_invalid_name() -> Result<(), Box<dyn std::error::Error>> {
    let tmp = TempDir::new()?;

    smartcrab_cmd()
        .args(["new", "--path"])
        .arg(tmp.path())
        .args(["--", "-invalid"])
        .assert()
        .failure();
    Ok(())
}

// -----------------------------------------------------------------------
// cargo fmt / clippy / test on the generated project
// -----------------------------------------------------------------------

#[test]
fn generated_project_passes_cargo_fmt() -> Result<(), Box<dyn std::error::Error>> {
    let (_tmp, project) = generate_project("fmt-check")?;

    let output = std::process::Command::new("cargo")
        .args(["fmt", "--check"])
        .current_dir(&project)
        .output()?;

    assert!(
        output.status.success(),
        "cargo fmt --check failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

#[test]
fn generated_project_passes_cargo_clippy() -> Result<(), Box<dyn std::error::Error>> {
    let (_tmp, project) = generate_project("clippy-check")?;

    let output = std::process::Command::new("cargo")
        .args(["clippy", "--", "-D", "clippy::correctness"])
        .env("RUSTFLAGS", "-D warnings")
        .current_dir(&project)
        .output()?;

    assert!(
        output.status.success(),
        "cargo clippy failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

#[test]
fn generated_project_passes_cargo_build() -> Result<(), Box<dyn std::error::Error>> {
    let (_tmp, project) = generate_project("build-check")?;

    let output = std::process::Command::new("cargo")
        .args(["build"])
        .env("RUSTFLAGS", "-D warnings")
        .current_dir(&project)
        .output()?;

    assert!(
        output.status.success(),
        "cargo build failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

#[test]
fn generated_project_passes_cargo_test() -> Result<(), Box<dyn std::error::Error>> {
    let (_tmp, project) = generate_project("test-check")?;

    let output = std::process::Command::new("cargo")
        .args(["test"])
        .env("RUSTFLAGS", "-D warnings")
        .current_dir(&project)
        .output()?;

    assert!(
        output.status.success(),
        "cargo test failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

#[test]
fn generated_project_passes_cargo_check() -> Result<(), Box<dyn std::error::Error>> {
    let (_tmp, project) = generate_project("check-check")?;

    let output = std::process::Command::new("cargo")
        .args(["check"])
        .env("RUSTFLAGS", "-D warnings")
        .current_dir(&project)
        .output()?;

    assert!(
        output.status.success(),
        "cargo check failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

#[test]
fn generated_project_runs_and_fails_without_discord_token() -> Result<(), Box<dyn std::error::Error>>
{
    let (_tmp, project) = generate_project("run-check")?;

    let output = std::process::Command::new("cargo")
        .args(["run"])
        .env_remove("DISCORD_TOKEN")
        .current_dir(&project)
        .output()?;

    assert!(
        !output.status.success(),
        "expected cargo run to fail without DISCORD_TOKEN, but it succeeded"
    );

    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("DISCORD_TOKEN not set"),
        "expected DISCORD_TOKEN error in stderr, got:\n{stderr}"
    );
    Ok(())
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/// Simple recursive directory walker that returns all file paths.
fn walkdir(dir: &Path) -> Result<Vec<std::path::PathBuf>, std::io::Error> {
    let mut result = Vec::new();
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            let path = entry?.path();
            if path.is_dir() {
                result.extend(walkdir(&path)?);
            } else {
                result.push(path);
            }
        }
    }
    Ok(result)
}
