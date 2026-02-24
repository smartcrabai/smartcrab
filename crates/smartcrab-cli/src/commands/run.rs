use std::io;
use std::process::Command;

pub fn run(release: bool) -> io::Result<()> {
    let project_dir = super::ensure_smartcrab_project()?;

    // Build first to detect compilation errors
    let mut build_cmd = Command::new("cargo");
    build_cmd.arg("build");
    if release {
        build_cmd.arg("--release");
    }
    build_cmd.current_dir(&project_dir);

    let build_status = build_cmd.status()?;
    if !build_status.success() {
        return Err(io::Error::other("Build failed"));
    }

    // Run (won't rebuild since build just succeeded)
    let mut run_cmd = Command::new("cargo");
    run_cmd.arg("run");
    if release {
        run_cmd.arg("--release");
    }
    run_cmd.current_dir(&project_dir);

    let run_status = run_cmd.status()?;
    if !run_status.success() {
        return Err(io::Error::other("Application exited with an error"));
    }

    Ok(())
}
