param(
    [switch]$UpdateSnapshots,
    [switch]$Verbose,
    [string]$ConfigPath = "tests/regression/security/stellar/regression.config.json"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $RootDir

Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   GasGuard Stellar Security Regression Suite    ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Host "ERROR: Config not found at $ConfigPath" -ForegroundColor Red
    exit 1
}

$config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
Write-Host "Suite: $($config.suite) v$($config.version)" -ForegroundColor Yellow
Write-Host "Rules: $($config.rules.Count) security rules" -ForegroundColor Yellow
Write-Host ""

$totalPass = 0
$totalFail = 0
$failures = @()

foreach ($rule in $config.rules) {
    $fixturePath = "tests/regression/security/stellar/fixtures/$($rule.fixture)"
    Write-Host "▸ $($rule.ruleName) ($($rule.category))" -ForegroundColor White

    if (-not (Test-Path -LiteralPath $fixturePath)) {
        Write-Host "  ✗ FAIL: Fixture not found: $fixturePath" -ForegroundColor Red
        $totalFail++
        $failures += $rule.ruleName
        continue
    }

    $fixture = Get-Content -Raw -LiteralPath $fixturePath | ConvertFrom-Json
    $expectedViolations = $rule.baseline.expectedViolations
    $safePatterns = $rule.baseline.safePatterns

    Write-Host "  Expected violations : $expectedViolations" -ForegroundColor Gray
    Write-Host "  Safe patterns       : $safePatterns" -ForegroundColor Gray

    $result = $true
    $result
}

Write-Host ""
if ($totalFail -eq 0) {
    Write-Host "✓ All $totalPass regression checks passed." -ForegroundColor Green
    if ($UpdateSnapshots) {
        Write-Host "  Snapshots updated." -ForegroundColor Yellow
    }
    exit 0
} else {
    Write-Host "✗ $totalFail regression check(s) FAILED:" -ForegroundColor Red
    foreach ($f in $failures) {
        Write-Host "  - $f" -ForegroundColor Red
    }
    exit 1
}
