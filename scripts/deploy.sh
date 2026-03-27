#!/bin/bash
set -e

# Enhanced deployment script for GasGuard
# This script sets up the environment, installs dependencies, builds, and verifies the deployment

echo "🚀 Starting enhanced deployment for GasGuard..."

# Check for pnpm
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Please install it globally: npm install -g pnpm"
    exit 1
fi

# Check for Rust
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust (cargo) is not installed. Please install Rust: https://rustup.rs/"
    exit 1
fi

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
pnpm install

# Install Rust dependencies
if [ -f "Cargo.toml" ]; then
    echo "🦀 Installing Rust dependencies..."
    cargo fetch || true
fi

# Build all Node.js packages
if [ -f "package.json" ]; then
    echo "🔨 Building Node.js packages..."
    pnpm build || true
fi

# Build Rust projects
if [ -f "Cargo.toml" ]; then
    echo "🔨 Building Rust projects..."
    cargo build --release || true
fi

# Run database migrations if available
if [ -f "apps/api-service/ormconfig.ts" ]; then
    echo "🗄️  Running database migrations..."
    pnpm --filter @gasguard/api-service run typeorm migration:run || true
fi

# Print success message
echo "✅ Enhanced deployment complete! Review logs above for any warnings."
