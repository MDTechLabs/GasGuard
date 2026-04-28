#!/usr/bin/env node
/**
 * Binary Distribution Builder
 *
 * Bundles the GasGuard CLI into a standalone executable using pkg.
 * Supports cross-platform targets: linux, macos, windows.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DIST_DIR = path.resolve(__dirname, '../dist/bin');
const ENTRY = path.resolve(__dirname, '../packages/cli/src/index.ts');

const TARGETS = [
  { name: 'linux', target: 'node18-linux-x64' },
  { name: 'macos', target: 'node18-macos-x64' },
  { name: 'win', target: 'node18-win-x64' },
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function build() {
  ensureDir(DIST_DIR);

  for (const { name, target } of TARGETS) {
    const output = path.join(DIST_DIR, `gasguard-${name}`);
    console.log(`Building ${name} binary -> ${output}`);

    try {
      execSync(
        `npx pkg ${ENTRY} --target ${target} --output ${output} --compress GZip`,
        { stdio: 'inherit' }
      );
      console.log(`✓ ${name} binary built`);
    } catch (err) {
      console.error(`✗ Failed to build ${name}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\nAll binaries built successfully.');
}

build();
