use std::path::Path;

use predicates::prelude::*;
use tempfile::TempDir;

fn smartcrab_cmd() -> assert_cmd::Command {
    assert_cmd::cargo_bin_cmd!("crab")
}

/// Resolve the absolute path to the `crates/smartcrab` directory.
fn smartcrab_crate_path() -> String {
    let manifest_dir = env!("CARGO_MANIFEST_DIR"); // crates/smartcrab-cli
    Path::new(manifest_dir)
        .parent()
        .unwrap()
        .join("smartcrab")
        .to_string_lossy()
        .into_owned()
}

/// Run `smartcrab new` in a temp directory and return the temp dir and project path.
fn generate_project(name: &str) -> (TempDir, std::path::PathBuf) {
    let tmp = TempDir::new().unwrap();
    let local_path = smartcrab_crate_path();

    smartcrab_cmd()
        .args(["new", name, "--local-path", &local_path, "--path"])
        .arg(tmp.path())
        .assert()
        .success()
        .stdout(predicate::str::contains(format!(
            "Created project `{name}`"
        )));

    let project_dir = tmp.path().join(name);
    (tmp, project_dir)
}

// -----------------------------------------------------------------------
// File existence tests
// -----------------------------------------------------------------------

#[test]
fn generated_project_has_expected_root_files() {
    let (_tmp, project) = generate_project("file-check");

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
}

#[test]
fn generated_project_has_expected_src_structure() {
    let (_tmp, project) = generate_project("src-check");

    let expected_files = [
        "src/main.rs",
        // dto
        "src/dto/mod.rs",
        "src/dto/discord.rs",
        "src/dto/cron.rs",
        // layer
        "src/layer/mod.rs",
        "src/layer/input/mod.rs",
        "src/layer/input/discord_input.rs",
        "src/layer/input/cron_input.rs",
        "src/layer/hidden/mod.rs",
        "src/layer/hidden/claude_code_layer.rs",
        "src/layer/output/mod.rs",
        "src/layer/output/discord_output.rs",
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
}

#[test]
fn generated_project_contains_no_unresolved_placeholders() {
    let (_tmp, project) = generate_project("placeholder-check");

    let placeholders = ["{{name}}", "{{name_snake}}", "{{smartcrab_dep}}"];

    for entry in walkdir(&project) {
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
}

#[test]
fn generated_cargo_toml_has_correct_name() {
    let (_tmp, project) = generate_project("my-cool-bot");

    let cargo_toml = std::fs::read_to_string(project.join("Cargo.toml")).unwrap();
    assert!(cargo_toml.contains("name = \"my-cool-bot\""));
    // binary name should use snake_case
    assert!(cargo_toml.contains("name = \"my_cool_bot\""));
}

#[test]
fn generated_smartcrab_toml_has_correct_name() {
    let (_tmp, project) = generate_project("toml-check");

    let content = std::fs::read_to_string(project.join("SmartCrab.toml")).unwrap();
    assert!(content.contains("name = \"toml-check\""));
}

// -----------------------------------------------------------------------
// Error condition tests
// -----------------------------------------------------------------------

#[test]
fn new_rejects_existing_directory() {
    let tmp = TempDir::new().unwrap();
    let local_path = smartcrab_crate_path();

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
}

#[test]
fn new_rejects_invalid_name() {
    let tmp = TempDir::new().unwrap();

    smartcrab_cmd()
        .args(["new", "--path"])
        .arg(tmp.path())
        .args(["--", "-invalid"])
        .assert()
        .failure();
}

// -----------------------------------------------------------------------
// cargo fmt / clippy / test on the generated project
// -----------------------------------------------------------------------

#[test]
fn generated_project_passes_cargo_fmt() {
    let (_tmp, project) = generate_project("fmt-check");

    let output = std::process::Command::new("cargo")
        .args(["fmt", "--check"])
        .current_dir(&project)
        .output()
        .expect("failed to run cargo fmt");

    assert!(
        output.status.success(),
        "cargo fmt --check failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn generated_project_passes_cargo_clippy() {
    let (_tmp, project) = generate_project("clippy-check");

    let output = std::process::Command::new("cargo")
        .args(["clippy", "--", "-D", "clippy::correctness"])
        .env("RUSTFLAGS", "-D warnings")
        .current_dir(&project)
        .output()
        .expect("failed to run cargo clippy");

    assert!(
        output.status.success(),
        "cargo clippy failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn generated_project_passes_cargo_build() {
    let (_tmp, project) = generate_project("build-check");

    let output = std::process::Command::new("cargo")
        .args(["build"])
        .env("RUSTFLAGS", "-D warnings")
        .current_dir(&project)
        .output()
        .expect("failed to run cargo build");

    assert!(
        output.status.success(),
        "cargo build failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn generated_project_passes_cargo_test() {
    let (_tmp, project) = generate_project("test-check");

    let output = std::process::Command::new("cargo")
        .args(["test"])
        .env("RUSTFLAGS", "-D warnings")
        .current_dir(&project)
        .output()
        .expect("failed to run cargo test");

    assert!(
        output.status.success(),
        "cargo test failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn generated_project_passes_cargo_check() {
    let (_tmp, project) = generate_project("check-check");

    let output = std::process::Command::new("cargo")
        .args(["check"])
        .env("RUSTFLAGS", "-D warnings")
        .current_dir(&project)
        .output()
        .expect("failed to run cargo check");

    assert!(
        output.status.success(),
        "cargo check failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/// Simple recursive directory walker that returns all file paths.
fn walkdir(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut result = Vec::new();
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_dir() {
                result.extend(walkdir(&path));
            } else {
                result.push(path);
            }
        }
    }
    result
}
