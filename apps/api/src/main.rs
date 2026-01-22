use anyhow::Result;
use clap::{Parser, Subcommand};
use colored::Colorize;
use gasguard_engine::{ContractScanner, ScanAnalyzer};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "gasguard")]
#[command(about = "GasGuard: Automated Optimization Suite for Stellar Soroban Contracts")]
#[command(version = "0.1.0")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Scan a single Rust file for optimization opportunities
    Scan {
        /// Path to the Rust file to scan
        file: PathBuf,
        /// Output format (console, json)
        #[arg(short, long, default_value = "console")]
        format: String,
    },
    /// Scan all Rust files in a directory
    ScanDir {
        /// Path to the directory to scan
        directory: PathBuf,
        /// Output format (console, json)
        #[arg(short, long, default_value = "console")]
        format: String,
    },
    /// Analyze storage optimization potential
    Analyze {
        /// Path to the Rust file or directory to analyze
        path: PathBuf,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let scanner = ContractScanner::new();

    match cli.command {
        Commands::Scan { file, format } => {
            println!("🔍 Scanning file: {:?}", file);

            let result = scanner.scan_file(&file)?;

            match format.as_str() {
                "json" => {
                    println!("{}", result.to_json()?);
                }
                _ => {
                    println!("{}", ScanAnalyzer::format_violations(&result.violations));
                    println!("{}", ScanAnalyzer::generate_summary(&result.violations));

                    if !result.violations.is_empty() {
                        let savings = ScanAnalyzer::calculate_storage_savings(&result.violations);
                        println!("\n{}", savings);
                    }
                }
            }
        }
        Commands::ScanDir { directory, format } => {
            println!("🔍 Scanning directory: {:?}", directory);

            let results = scanner.scan_directory(&directory)?;

            if results.is_empty() {
                println!("✅ No violations found in any files!");
                return Ok(());
            }

            let total_violations: usize = results.iter().map(|r| r.violations.len()).sum();

            match format.as_str() {
                "json" => {
                    println!("{}", serde_json::to_string_pretty(&results)?);
                }
                _ => {
                    for result in &results {
                        println!("\n📁 File: {}", result.source);
                        println!("{}", ScanAnalyzer::format_violations(&result.violations));
                    }

                    println!(
                        "\n{}",
                        format!(
                            "📊 Total violations across {} files: {}",
                            results.len(),
                            total_violations
                        )
                        .bold()
                    );

                    let all_violations: Vec<_> =
                        results.iter().flat_map(|r| r.violations.clone()).collect();
                    let savings = ScanAnalyzer::calculate_storage_savings(&all_violations);
                    println!("\n{}", savings);
                }
            }
        }
        Commands::Analyze { path } => {
            println!("📊 Analyzing storage optimization potential: {:?}", path);

            let results = if path.is_file() {
                vec![scanner.scan_file(&path)?]
            } else {
                scanner.scan_directory(&path)?
            };

            if results.is_empty() {
                println!("✅ No optimization opportunities found!");
                return Ok(());
            }

            let all_violations: Vec<_> =
                results.iter().flat_map(|r| r.violations.clone()).collect();
            let savings = ScanAnalyzer::calculate_storage_savings(&all_violations);

            println!("\n🎯 Storage Analysis Report");
            println!("========================");
            println!("Files analyzed: {}", results.len());
            println!("Total violations: {}", all_violations.len());
            println!("\n{}", savings);

            // Group violations by type
            let mut unused_vars = 0;
            for violation in &all_violations {
                if violation.rule_name == "unused-state-variables" {
                    unused_vars += 1;
                }
            }

            if unused_vars > 0 {
                println!("\n🔧 Recommendations:");
                println!(
                    "  • Remove {} unused state variables to reduce storage costs",
                    unused_vars
                );
                println!("  • Consider using more efficient data types where possible");
                println!("  • Implement lazy loading patterns for rarely accessed data");
            }
        }
    }

    Ok(())
}
