use anyhow::Result;
use clap::{Parser, Subcommand};
use gasguard_engine::{ContractScanner, ScanAnalyzer, TieredScanner, UserUsage, UsageTier};
use std::path::PathBuf;
use serde_json;

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
        /// Path to Rust file to scan
        file: PathBuf,
        /// Output format (console, json)
        #[arg(short, long, default_value = "console")]
        format: String,
        /// Automatically apply safe gas optimization fixes
        #[arg(long)]
        auto_fix: bool,
        /// Path to custom rule plugin (.so/.dll)
        #[arg(long)]
        plugin: Option<PathBuf>,
    },
    /// Scan all Rust files in a directory
    ScanDir {
        /// Path to directory to scan
        directory: PathBuf,
        /// Output format (console, json)
        #[arg(short, long, default_value = "console")]
        format: String,
        /// Path to custom rule plugin (.so/.dll)
        #[arg(long)]
        plugin: Option<PathBuf>,
    },
    /// Automatically apply safe gas optimization fixes
    Fix {
        /// Path to file or directory to fix
        path: PathBuf,
        /// Preview changes without applying
        #[arg(long)]
        preview: bool,
    },
    /// Analyze storage optimization potential
    Analyze {
        /// Path to Rust file or directory to analyze
        path: PathBuf,
    },
    /// Scan with tiered pricing
    TieredScan {
        /// Path to Rust file to scan
        file: PathBuf,
        /// User tier (starter, developer, professional, enterprise)
        #[arg(long, default_value = "developer")]
        tier: String,
        /// Current month usage
        #[arg(long, default_value = "500")]
        usage: i64,
        /// Output format (console, json)
        #[arg(short, long, default_value = "console")]
        format: String,
    },
    /// Show tier information and comparison
    Tiers {
        /// Show specific tier details
        #[arg(long)]
        tier: Option<String>,
        /// Show tier comparison
        #[arg(long)]
        comparison: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let scanner = ContractScanner::new();

    match cli.command {
        Commands::Scan { file, format, auto_fix, plugin } => {
            println!("🔍 Scanning file: {:?}", file);

            let mut scanner = ContractScanner::new();
            if let Some(plugin_path) = plugin {
                let loader = gasguard_plugin_system::PluginLoader::new();
                match unsafe { loader.load_rule(plugin_path) } {
                    Ok(rule) => {
                        println!("🔌 Loaded plugin rule: {}", rule.name());
                        // Note: We need a way to add rules to the engine. 
                        // For now, this is a demonstration of the plugin loader.
                    },
                    Err(e) => eprintln!("⚠️ Failed to load plugin: {}", e),
                }
            }

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
                        
                        if auto_fix {
                            println!("\n🛠️ Applying safe fixes...");
                            let fix_engine = gasguard_auto_fix::FixEngine::new();
                            match fix_engine.apply_fixes(&file, &result.violations) {
                                Ok(fixed_content) => {
                                    std::fs::write(&file, fixed_content)?;
                                    println!("✅ Fixes applied successfully!");
                                },
                                Err(e) => eprintln!("❌ Failed to apply fixes: {}", e),
                            }
                        }
                    }
                }
            }
        }
        Commands::ScanDir { directory, format, plugin } => {
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
                }
            }
        }
        Commands::Fix { path, preview } => {
            println!("🛠️ Fixing optimization issues in: {:?}", path);
            let result = scanner.scan_file(&path)?;
            
            if result.violations.is_empty() {
                println!("✅ No violations found to fix.");
                return Ok(());
            }

            let fix_engine = gasguard_auto_fix::FixEngine::new();
            if preview {
                println!("📝 Previewing fixes (no changes will be made):");
                // In a real implementation, we would show a diff
                println!("Safe fixes available for {} violations.", result.violations.len());
            } else {
                match fix_engine.apply_fixes(&path, &result.violations) {
                    Ok(fixed_content) => {
                        std::fs::write(&path, fixed_content)?;
                        println!("✅ Fixes applied successfully!");
                    },
                    Err(e) => eprintln!("❌ Failed to apply fixes: {}", e),
                }
            }
        }
        Commands::TieredScan { file, tier, usage, format } => {
            println!("🔍 Scanning file with tiered pricing: {:?}", file);
            
            // Parse tier
            let usage_tier = match tier.as_str() {
                "starter" => UsageTier::Starter,
                "developer" => UsageTier::Developer,
                "professional" => UsageTier::Professional,
                "enterprise" => UsageTier::Enterprise,
                _ => {
                    eprintln!("❌ Invalid tier. Must be: starter, developer, professional, enterprise");
                    return Ok(());
                }
            };
            
            // Create user usage object
            let user_usage = UserUsage {
                user_id: "cli-user".to_string(),
                current_tier: usage_tier.clone(),
                current_month_requests: usage,
                monthly_usage: vec![],
                average_requests_per_month: usage as f64,
                peak_requests_per_month: usage,
            };
            
            // Initialize tiered scanner
            let tiered_scanner = TieredScanner::new();
            
            // Validate tier access
            let validation = tiered_scanner.validate_tier_access(&user_usage);
            if !validation.can_proceed {
                eprintln!("❌ {}", validation.message);
                return Ok(());
            }
            
            // Read file content
            let content = std::fs::read_to_string(&file)?;
            
            // Perform tiered scan
            let result = tiered_scanner.scan_with_tier(&content, file.to_string_lossy().to_string(), &user_usage)?;
            
            match format.as_str() {
                "json" => {
                    println!("{}", serde_json::to_string_pretty(&result)?);
                }
                _ => {
                    println!("\n🎯 Tiered Scan Results");
                    println!("======================");
                    println!("File: {}", result.base_result.source);
                    println!("Applied Tier: {:?}", result.applied_tier);
                    println!("Tier Discount: {:.1}%", result.tier_discount);
                    println!("Final Price: {:.8} XLM", result.final_price_per_request);
                    println!("Usage: {}/{} ({:.1}%)", result.current_usage, 
                        if result.remaining_requests == i64::MAX { "∞".to_string() } else { result.remaining_requests.to_string() },
                        result.usage_percentage);
                    
                    if !result.base_result.violations.is_empty() {
                        println!("\n{}", ScanAnalyzer::format_violations(&result.base_result.violations));
                        let savings = ScanAnalyzer::calculate_storage_savings(&result.base_result.violations);
                        println!("\n{}", savings);
                    }
                    
                    if let Some(recommended) = result.recommended_tier {
                        println!("\n💡 Recommendation: Consider upgrading to {:?} tier", recommended);
                    }
                    
                    if let Some(savings) = result.upgrade_savings {
                        println!("💰 Potential savings: {:.8} XLM per scan", savings);
                    }
                    
                    if let Some(warning) = result.downgrade_warning {
                        println!("\n⚠️  {}", warning);
                    }
                }
            }
        }
        Commands::Tiers { tier, comparison } => {
            let tiered_scanner = TieredScanner::new();
            
            if let Some(tier_name) = tier {
                let usage_tier = match tier_name.as_str() {
                    "starter" => UsageTier::Starter,
                    "developer" => UsageTier::Developer,
                    "professional" => UsageTier::Professional,
                    "enterprise" => UsageTier::Enterprise,
                    _ => {
                        eprintln!("❌ Invalid tier. Must be: starter, developer, professional, enterprise");
                        return Ok(());
                    }
                };
                
                if let Some(tier_config) = tiered_scanner.get_tier_config(&usage_tier) {
                    println!("\n📋 {} Tier Details", tier_config.name);
                    println!("========================");
                    println!("Description: {}", tier_config.description);
                    println!("Request Limit: {}", 
                        if tier_config.request_limit == -1 { "Unlimited".to_string() } else { tier_config.request_limit.to_string() });
                    println!("Price per Request: {:.8} XLM", tier_config.base_price_per_request);
                    println!("Discount: {:.1}%", tier_config.discount_percentage);
                    println!("Rate Limit: {} requests/minute", tier_config.rate_limit_per_minute);
                    println!("Priority Support: {}", if tier_config.priority_support { "Yes" } else { "No" });
                    println!("Custom Pricing: {}", if tier_config.custom_pricing { "Yes" } else { "No" });
                    println!("\nFeatures:");
                    for feature in &tier_config.features {
                        println!("  • {}", feature);
                    }
                }
            } else if comparison {
                let tiers = tiered_scanner.get_all_tiers();
                
                println!("\n📊 Tier Comparison");
                println!("==================");
                println!("{:<15} {:<12} {:<15} {:<10} {:<8}", "Tier", "Limit", "Price/Request", "Discount", "Features");
                println!("{}", "-".repeat(70));
                
                for tier_config in tiers {
                    let limit_str = if tier_config.request_limit == -1 { 
                        "Unlimited".to_string() 
                    } else { 
                        tier_config.request_limit.to_string() 
                    };
                    
                    println!("{:<15} {:<12} {:<15} {:<10} {:<8}", 
                        tier_config.name,
                        limit_str,
                        format!("{:.8} XLM", tier_config.base_price_per_request),
                        format!("{:.1}%", tier_config.discount_percentage),
                        tier_config.features.len().to_string()
                    );
                }
                
                println!("\n💡 Use 'gasguard tiered-scan --tier <tier>' to scan with a specific tier");
            } else {
                println!("📋 Available Tiers:");
                println!("  • starter     - Up to 1,000 requests/month");
                println!("  • developer   - Up to 10,000 requests/month");
                println!("  • professional - Up to 100,000 requests/month");
                println!("  • enterprise  - Unlimited requests");
                println!("\n💡 Use '--comparison' to see detailed comparison or '--tier <name>' for tier details");
            }
        }
    }

    Ok(())
}
