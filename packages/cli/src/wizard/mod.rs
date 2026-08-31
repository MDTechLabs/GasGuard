mod interactive_diff;

use anyhow::{anyhow, Context, Result};
use colored::Colorize;
use dialoguer::{theme::ColorfulTheme, Confirm, Select};
use gasguard_auto_fix::{FixEngine, FixPreview};
use gasguard_engine::ContractScanner;
use gasguard_rule_engine::RuleViolation;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::collect_scannable_files;
use interactive_diff::{render_git_style_diff, DiffPreview};

#[derive(Debug, Clone)]
struct WizardIssue {
    file_path: PathBuf,
    violation: RuleViolation,
    preview: FixPreview,
}

#[derive(Debug, Default, Clone)]
pub struct WizardSummary {
    pub reviewed: usize,
    pub applied: usize,
    pub skipped: usize,
    pub files_modified: usize,
    pub aborted: bool,
}

pub fn run_interactive_fix_wizard(path: &Path, scanner: &ContractScanner) -> Result<WizardSummary> {
    let fix_engine = FixEngine::new();
    let issues = collect_fixable_issues(path, scanner, &fix_engine)?;

    if issues.is_empty() {
        println!(
            "{}",
            "No safe auto-fix opportunities found for interactive mode."
                .green()
                .bold()
        );
        return Ok(WizardSummary::default());
    }

    println!(
        "{}",
        format!(
            "Interactive mode loaded {} fixable issue(s). Review each preview and choose what to apply.",
            issues.len()
        )
        .bold()
    );

    let theme = ColorfulTheme::default();
    let mut summary = WizardSummary::default();
    let mut selected_by_file: BTreeMap<PathBuf, Vec<RuleViolation>> = BTreeMap::new();

    for (index, issue) in issues.iter().enumerate() {
        summary.reviewed += 1;

        println!();
        println!(
            "{}",
            format!(
                "[{}/{}] {}:{}",
                index + 1,
                issues.len(),
                issue.file_path.display(),
                issue.preview.line_number
            )
            .bold()
        );
        println!("Rule: {}", issue.preview.rule_name.yellow().bold());
        println!("Why: {}", issue.preview.description);
        println!(
            "Confidence: {}",
            format!("{:.0}%", issue.preview.confidence * 100.0).cyan()
        );

        let file_contents = fs::read_to_string(&issue.file_path)
            .with_context(|| format!("Failed to read {}", issue.file_path.display()))?;
        let file_lines: Vec<&str> = file_contents.lines().collect();
        let line_index = issue.preview.line_number.saturating_sub(1);
        let before_context = line_index
            .checked_sub(1)
            .and_then(|idx| file_lines.get(idx))
            .copied();
        let after_context = file_lines.get(line_index + 1).copied();

        let diff = render_git_style_diff(&DiffPreview {
            file_path: &issue.file_path.to_string_lossy(),
            line_number: issue.preview.line_number,
            before_context,
            original_line: &issue.preview.original_line,
            suggested_line: &issue.preview.suggested_line,
            after_context,
        });
        println!("{}", diff);

        let selection = Select::with_theme(&theme)
            .with_prompt("Choose an action")
            .items(&[
                "Apply this optimization",
                "Skip this optimization",
                "Apply all remaining safe optimizations in this file",
                "Quit wizard",
            ])
            .default(0)
            .interact()?;

        match selection {
            0 => {
                selected_by_file
                    .entry(issue.file_path.clone())
                    .or_default()
                    .push(issue.violation.clone());
                summary.applied += 1;
            }
            1 => {
                summary.skipped += 1;
            }
            2 => {
                let pending_for_file = issues[index..]
                    .iter()
                    .filter(|candidate| candidate.file_path == issue.file_path)
                    .map(|candidate| candidate.violation.clone())
                    .collect::<Vec<_>>();

                let remaining_count = pending_for_file.len();
                selected_by_file
                    .entry(issue.file_path.clone())
                    .or_default()
                    .extend(pending_for_file);
                summary.applied += remaining_count;

                let skipped_after_this = issues[index + remaining_count..]
                    .iter()
                    .take_while(|candidate| candidate.file_path == issue.file_path)
                    .count();
                summary.skipped += skipped_after_this;
            }
            _ => {
                summary.aborted = true;
                summary.skipped += issues.len().saturating_sub(index + 1);
                break;
            }
        }
    }

    if selected_by_file.is_empty() {
        println!("{}", "No changes selected.".yellow());
        return Ok(summary);
    }

    if !Confirm::with_theme(&theme)
        .with_prompt("Write the selected changes to disk?")
        .default(true)
        .interact()?
    {
        println!("{}", "Aborted before writing any changes.".yellow());
        summary.aborted = true;
        return Ok(summary);
    }

    for (file_path, accepted) in selected_by_file {
        let original = fs::read_to_string(&file_path)
            .with_context(|| format!("Failed to read {}", file_path.display()))?;
        let updated = fix_engine
            .apply_fixes(&file_path, &accepted)
            .map_err(|e| anyhow!(e))
            .with_context(|| format!("Failed to generate fixes for {}", file_path.display()))?;

        if updated == original {
            continue;
        }

        fs::write(&file_path, &updated)
            .with_context(|| format!("Failed to write {}", file_path.display()))?;

        if let Err(error) = scanner.scan_file(&file_path) {
            fs::write(&file_path, original).with_context(|| {
                format!("Failed to restore {} after validation error", file_path.display())
            })?;
            return Err(anyhow!(
                "Refusing to keep changes in {} because the updated file failed validation: {}",
                file_path.display(),
                error
            ));
        }

        summary.files_modified += 1;
    }

    Ok(summary)
}

fn collect_fixable_issues(
    path: &Path,
    scanner: &ContractScanner,
    fix_engine: &FixEngine,
) -> Result<Vec<WizardIssue>> {
    let mut issues = Vec::new();
    let files = if path.is_dir() {
        collect_scannable_files(path)
    } else {
        vec![path.to_path_buf()]
    };

    for file_path in files {
        let result = scanner.scan_file(&file_path).with_context(|| {
            format!("Failed to scan {} for interactive fixes", file_path.display())
        })?;
        let safe_violations = fix_engine.validate_and_filter_fixes(&result.violations);
        if safe_violations.is_empty() {
            continue;
        }

        let report = fix_engine
            .preview_fixes(&file_path, &safe_violations)
            .map_err(|e| anyhow!(e))
            .with_context(|| format!("Failed to build preview for {}", file_path.display()))?;

        for (violation, preview) in safe_violations
            .into_iter()
            .zip(report.previews.into_iter())
        {
            issues.push(WizardIssue {
                file_path: file_path.clone(),
                violation,
                preview,
            });
        }
    }

    issues.sort_by(|left, right| {
        left.file_path
            .cmp(&right.file_path)
            .then(left.preview.line_number.cmp(&right.preview.line_number))
    });
    Ok(issues)
}
