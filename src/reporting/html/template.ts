/**
 * HTML Report Template
 *
 * A modern, responsive template for GasGuard analysis reports.
 */

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderLocation = (location: any): string => {
  const line =
    typeof location.startLine === "number" ? `:${location.startLine}` : "";
  return `${escapeHtml(location.file)}${line}`;
};

const renderRefactorSuggestions = (suggestions: any[] = []): string => {
  if (suggestions.length === 0) {
    return "";
  }

  return `
        <section class="refactor-section">
            <div class="section-heading">
                <h2>Refactor Suggestions</h2>
                <span>${suggestions.length} linked recommendations</span>
            </div>
            <div class="suggestion-list">
                ${suggestions
                  .map(
                    (suggestion) => `
                    <article class="suggestion-card priority-${escapeHtml(suggestion.priority)}">
                        <div class="suggestion-meta">
                            <span>${escapeHtml(suggestion.priority)} priority</span>
                            <span>${escapeHtml(suggestion.category)}</span>
                            <span>${escapeHtml(suggestion.effort)} effort</span>
                        </div>
                        <h3>${escapeHtml(suggestion.title)}</h3>
                        <p>${escapeHtml(suggestion.description)}</p>
                        <div class="suggestion-locations">
                            ${(suggestion.locations ?? []).map(renderLocation).join(" · ")}
                        </div>
                    </article>
                `,
                  )
                  .join("")}
            </div>
        </section>
  `;
};

const renderIssueRefactorLinks = (issue: any): string => {
  const suggestions = issue.refactorSuggestions ?? [];
  if (suggestions.length === 0) {
    return "";
  }

  return `
                        <div class="issue-refactors">
                            <span>Related refactors</span>
                            <ul>
                                ${suggestions
                                  .map(
                                    (suggestion: any) => `
                                    <li>${escapeHtml(suggestion.title)}</li>
                                `,
                                  )
                                  .join("")}
                            </ul>
                        </div>
  `;
};

export const getReportTemplate = (data: any) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GasGuard Analysis Report - ${data.projectName}</title>
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --text: #1e293b;
            --text-muted: #64748b;
            --border: #e2e8f0;
            --critical: #ef4444;
            --high: #f97316;
            --medium: #f59e0b;
            --low: #10b981;
            --info: #3b82f6;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        body {
            background-color: var(--bg);
            color: var(--text);
            line-height: 1.5;
            padding: 2rem;
        }

        .container {
            max-width: 1000px;
            margin: 0 auto;
        }

        header {
            margin-bottom: 2rem;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            border-bottom: 2px solid var(--border);
            padding-bottom: 1rem;
        }

        h1 {
            font-size: 2rem;
            color: var(--primary-dark);
        }

        .version {
            font-size: 0.875rem;
            color: var(--text-muted);
            background: var(--border);
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            margin-left: 1rem;
        }

        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }

        .metric-card {
            background: var(--card-bg);
            padding: 1.5rem;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid var(--border);
        }

        .metric-label {
            font-size: 0.875rem;
            color: var(--text-muted);
            margin-bottom: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .metric-value {
            font-size: 1.5rem;
            font-weight: 700;
        }

        .severity-critical { color: var(--critical); }
        .severity-high { color: var(--high); }
        .severity-medium { color: var(--medium); }
        .severity-low { color: var(--low); }

        .section-heading {
            display: flex;
            justify-content: space-between;
            gap: 1rem;
            align-items: baseline;
            margin-bottom: 1rem;
        }

        .section-heading span {
            color: var(--text-muted);
            font-size: 0.875rem;
        }

        .refactor-section {
            margin-bottom: 2rem;
        }

        .suggestion-list {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 1rem;
        }

        .suggestion-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-top: 4px solid var(--info);
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            padding: 1.25rem;
        }

        .suggestion-card.priority-high { border-top-color: var(--high); }
        .suggestion-card.priority-medium { border-top-color: var(--medium); }
        .suggestion-card.priority-low { border-top-color: var(--low); }

        .suggestion-card h3 {
            font-size: 1rem;
            margin: 0.5rem 0;
        }

        .suggestion-card p {
            color: var(--text-muted);
            font-size: 0.925rem;
        }

        .suggestion-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 0.4rem;
        }

        .suggestion-meta span {
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 999px;
            color: var(--text-muted);
            font-size: 0.75rem;
            padding: 0.15rem 0.45rem;
            text-transform: capitalize;
        }

        .suggestion-locations {
            color: var(--text-muted);
            font-family: monospace;
            font-size: 0.75rem;
            margin-top: 0.75rem;
        }

        .issue-list {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .issue-card {
            background: var(--card-bg);
            padding: 1.5rem;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border-left: 4px solid var(--primary);
            transition: transform 0.2s;
        }

        .issue-card:hover {
            transform: translateX(4px);
        }

        .issue-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.5rem;
        }

        .rule-id {
            font-weight: 600;
            color: var(--primary-dark);
            font-family: monospace;
        }

        .file-path {
            font-size: 0.875rem;
            color: var(--text-muted);
            margin-bottom: 0.5rem;
        }

        .issue-message {
            font-size: 1rem;
            margin-bottom: 0.75rem;
        }

        .issue-refactors {
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 8px;
            margin-top: 0.75rem;
            padding: 0.75rem;
        }

        .issue-refactors span {
            color: var(--text-muted);
            display: block;
            font-size: 0.75rem;
            font-weight: 700;
            letter-spacing: 0.04em;
            margin-bottom: 0.35rem;
            text-transform: uppercase;
        }

        .issue-refactors ul {
            margin-left: 1rem;
        }

        .issue-refactors li {
            color: var(--text);
            font-size: 0.875rem;
        }


        .confidence-bar {
            height: 4px;
            background: var(--border);
            border-radius: 2px;
            overflow: hidden;
            width: 100px;
        }

        .confidence-fill {
            height: 100%;
            background: var(--primary);
        }

        .footer {
            margin-top: 4rem;
            text-align: center;
            font-size: 0.875rem;
            color: var(--text-muted);
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div>
                <h1>GasGuard Report <span class="version">${data.version}</span></h1>
                <p style="color: var(--text-muted)">Project: ${data.projectName}</p>
            </div>
            <div style="text-align: right">
                <p>Scanned on ${new Date(data.metrics.scannedAt).toLocaleString()}</p>
                <p>Duration: ${data.metrics.durationMs}ms</p>
            </div>
        </header>

        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-label">Total Issues</div>
                <div class="metric-value">${data.metrics.totalIssues}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Critical</div>
                <div class="metric-value severity-critical">${data.metrics.criticalIssues}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">High</div>
                <div class="metric-value severity-high">${data.metrics.highIssues}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Files Scanned</div>
                <div class="metric-value">${data.metrics.totalFiles}</div>
            </div>
        </div>

        ${renderRefactorSuggestions(data.refactorSuggestions)}

        <h2 style="margin-bottom: 1.5rem">Detected Issues</h2>
        <div class="issue-list">
            ${data.issues
              .map(
                (issue: any) => `
                <div class="issue-card" style="border-left-color: ${issue.confidence > 0.8 ? "var(--critical)" : "var(--high)"}">
                    <div class="issue-header">
                        <span class="rule-id">${escapeHtml(issue.ruleId)}</span>
                        <div style="display: flex; align-items: center; gap: 0.5rem">
                            <span style="font-size: 0.75rem; color: var(--text-muted)">Confidence: ${Math.round(issue.confidence * 100)}%</span>
                            <div class="confidence-bar">
                                <div class="confidence-fill" style="width: ${issue.confidence * 100}%"></div>
                            </div>
                        </div>
                    </div>
                    <div class="file-path">${escapeHtml(issue.filePath)}:${issue.line}</div>
                    <div class="issue-message">${escapeHtml(issue.message)}</div>
                    ${renderIssueRefactorLinks(issue)}
                </div>
            `,
              )
              .join("")}
        </div>

        <div class="footer">
            Generated by GasGuard &copy; ${new Date().getFullYear()}
        </div>
    </div>
</body>
</html>
	`;
