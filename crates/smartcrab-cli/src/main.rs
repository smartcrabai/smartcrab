mod commands;
mod templates;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "smartcrab",
    version,
    about = "SmartCrab project scaffolding tool"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new SmartCrab project
    New {
        /// Project name
        name: String,

        /// Path to a local smartcrab crate (uses path dependency instead of git)
        #[arg(long)]
        local_path: Option<String>,

        /// Output directory (defaults to current directory)
        #[arg(long)]
        path: Option<String>,
    },
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::New {
            name,
            local_path,
            path,
        } => {
            if let Err(e) = commands::new::run(&name, local_path.as_deref(), path.as_deref()) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
    }
}
