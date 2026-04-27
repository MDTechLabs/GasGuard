/**
 * HTML Report Template
 * 
 * A modern, responsive template for GasGuard analysis reports.
 */

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

        <h2 style="margin-bottom: 1.5rem">Detected Issues</h2>
        <div class="issue-list">
            ${data.issues.map((issue: any) => \`
                <div class="issue-card" style="border-left-color: \${issue.confidence > 0.8 ? 'var(--critical)' : 'var(--high)'}">
                    <div class="issue-header">
                        <span class="rule-id">\${issue.ruleId}</span>
                        <div style="display: flex; align-items: center; gap: 0.5rem">
                            <span style="font-size: 0.75rem; color: var(--text-muted)">Confidence: \${Math.round(issue.confidence * 100)}%</span>
                            <div class="confidence-bar">
                                <div class="confidence-fill" style="width: \${issue.confidence * 100}%"></div>
                            </div>
                        </div>
                    </div>
                    <div class="file-path">\${issue.filePath}:\${issue.line}</div>
                    <div class="issue-message">\${issue.message}</div>
                </div>
            \`).join('')}
        </div>

        <div class="footer">
            Generated by GasGuard &copy; ${new Date().getFullYear()}
        </div>
    </div>
</body>
</html>
\`;
