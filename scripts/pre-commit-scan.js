#!/usr/bin/env node
const { execSync, spawnSync } = require('child_process');
const path = require('path');

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch (err) {
    console.error('Failed to get staged files:', err.message);
    process.exit(1);
  }
}

function filterScannable(files) {
  const exts = ['.sol', '.vy', '.rs'];
  return files.filter(f => exts.includes(path.extname(f)));
}

function runScanOnFile(file) {
  console.log(`Running GasGuard scan on staged file: ${file}`);

  const runner = 'node';
  const args = ['-r', 'ts-node/register', 'scripts/run-precommit-scan.ts', file];

  const res = spawnSync(runner, args, { stdio: 'inherit' });
  if (res.error) {
    console.error('Failed to start scan process:', res.error);
    return res.status || 1;
  }
  return res.status;
}

async function main() {
  const staged = getStagedFiles();
  const targets = filterScannable(staged);

  if (targets.length === 0) {
    console.log('No scannable staged files found. Skipping GasGuard pre-commit scan.');
    process.exit(0);
  }

  let failed = false;
  for (const f of targets) {
    const code = runScanOnFile(f);
    if (code !== 0) {
      failed = true;
      console.error(`GasGuard scan failed for ${f} (exit ${code})`);
      break;
    }
  }

  if (failed) process.exit(1);
  console.log('GasGuard pre-commit scan passed.');
  process.exit(0);
}

main();
