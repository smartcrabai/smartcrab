mod commands;
mod templates;

use clap::{Parser, Subcommand, ValueEnum};

use commands::viz::VizFormat;

#[derive(Parser)]
#[command(name = "crab", version, about = "SmartCrab project scaffolding tool")]
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
    /// Build and run the SmartCrab project
    Run {
        /// Build in release mode
        #[arg(long)]
        release: bool,
    },
    /// Visualize Graph definitions
    Viz {
        /// Graph name to visualize (all Graphs if omitted)
        graph: Option<String>,

        /// Output format
        #[arg(long, value_enum, default_value_t = VizFormatArg::Mermaid)]
        format: VizFormatArg,

        /// Output file path (stdout if omitted)
        #[arg(long)]
        output: Option<String>,

        /// Hide type annotations
        #[arg(long)]
        no_types: bool,

        /// Show execution order numbers
        #[arg(long)]
        show_order: bool,
    },
}

#[derive(Clone, ValueEnum)]
enum VizFormatArg {
    Mermaid,
    Dot,
    Ascii,
}

impl From<VizFormatArg> for VizFormat {
    fn from(arg: VizFormatArg) -> Self {
        match arg {
            VizFormatArg::Mermaid => VizFormat::Mermaid,
            VizFormatArg::Dot => VizFormat::Dot,
            VizFormatArg::Ascii => VizFormat::Ascii,
        }
    }
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
        Commands::Run { release } => {
            if let Err(e) = commands::run::run(release) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
        Commands::Viz {
            graph,
            format,
            output,
            no_types,
            show_order,
        } => {
            if let Err(e) = commands::viz::run(
                graph.as_deref(),
                format.into(),
                output.as_deref(),
                no_types,
                show_order,
            ) {
                eprintln!("Error: {e}");
                std::process::exit(1);
            }
        }
    }
}
