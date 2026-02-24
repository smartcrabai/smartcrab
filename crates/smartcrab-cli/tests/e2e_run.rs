use predicates::prelude::*;
use tempfile::TempDir;

fn smartcrab_cmd() -> assert_cmd::Command {
    assert_cmd::cargo_bin_cmd!("smartcrab")
}

// -----------------------------------------------------------------------
// run command tests
// -----------------------------------------------------------------------

#[test]
fn run_rejects_outside_project() {
    let tmp = TempDir::new().unwrap();

    smartcrab_cmd()
        .args(["run"])
        .current_dir(tmp.path())
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("Not a SmartCrab project"));
}

#[test]
fn run_accepts_release_flag() {
    let tmp = TempDir::new().unwrap();

    // Should fail because not a SmartCrab project, but the --release flag should be accepted
    smartcrab_cmd()
        .args(["run", "--release"])
        .current_dir(tmp.path())
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("Not a SmartCrab project"));
}
