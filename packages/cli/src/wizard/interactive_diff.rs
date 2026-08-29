use colored::Colorize;

pub struct DiffPreview<'a> {
    pub file_path: &'a str,
    pub line_number: usize,
    pub before_context: Option<&'a str>,
    pub original_line: &'a str,
    pub suggested_line: &'a str,
    pub after_context: Option<&'a str>,
}

pub fn render_git_style_diff(preview: &DiffPreview<'_>) -> String {
    let mut output = String::new();
    output.push_str(&format!("{}\n", format!("--- a/{}", preview.file_path).red()));
    output.push_str(&format!("{}\n", format!("+++ b/{}", preview.file_path).green()));
    output.push_str(&format!(
        "{}\n",
        format!(
            "@@ -{},1 +{},1 @@",
            preview.line_number, preview.line_number
        )
        .cyan()
        .bold()
    ));

    if let Some(line) = preview.before_context {
        output.push_str(&format!(" {}\n", line.dimmed()));
    }

    output.push_str(&format!("{}\n", format!("-{}", preview.original_line).red()));
    output.push_str(&format!(
        "{}\n",
        format!("+{}", preview.suggested_line).green()
    ));

    if let Some(line) = preview.after_context {
        output.push_str(&format!(" {}\n", line.dimmed()));
    }

    output
}
