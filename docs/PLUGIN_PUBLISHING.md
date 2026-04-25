# GasGuard Plugin Publishing System

## Overview

The GasGuard Plugin Publishing System provides a standardized way to develop, package, and distribute plugins that extend the analysis capabilities of GasGuard. Plugins can add new rules, analysis capabilities, and functionality to support additional languages and optimization strategies.

## Table of Contents

- [Plugin Structure](#plugin-structure)
- [Plugin Manifest](#plugin-manifest)
- [Version Compatibility](#version-compatibility)
- [Developing a Plugin](#developing-a-plugin)
- [Publishing](#publishing)
- [Discovery](#discovery)
- [Best Practices](#best-practices)

## Plugin Structure

### Minimum Plugin Package

```
my-plugin/
├── plugin.json                 # Plugin manifest
├── dist/
│   └── plugin.so              # Compiled plugin binary
├── README.md                  # Plugin documentation
└── LICENSE                    # License file
```

### Recommended Plugin Package

```
my-plugin/
├── plugin.json                # Plugin manifest
├── src/                       # Source code
│   ├── lib.rs                # Main plugin code
│   ├── rules/                # Individual rule modules
│   └── config.rs             # Configuration handling
├── dist/                      # Compiled artifacts
│   ├── plugin.so             # Main compiled plugin
│   └── checksums.txt         # SHA256 checksums
├── tests/                     # Test files
├── docs/                      # Plugin documentation
├── examples/                  # Usage examples
├── README.md                  # User documentation
├── DEVELOPMENT.md            # Developer guide
├── LICENSE                   # License file
├── Cargo.toml               # For Rust plugins
└── .gasguardignore          # Exclusions for packaging
```

## Plugin Manifest

The `plugin.json` file defines your plugin and its requirements.

### Example Manifest

```json
{
  "id": "gas-optimization-pro",
  "name": "Gas Optimization Pro",
  "version": "1.0.0",
  "description": "Advanced gas optimization rules for Solidity contracts",
  "languages": ["solidity"],
  "capabilities": ["gas-optimization", "custom"],
  "main": "dist/plugin.so",
  "gasguardVersion": {
    "min": "1.0.0",
    "max": "2.0.0"
  },
  "author": {
    "name": "Your Name",
    "email": "you@example.com",
    "url": "https://github.com/yourname"
  },
  "license": "MIT",
  "homepage": "https://github.com/yourname/gasguard-optimization-pro",
  "keywords": ["optimization", "gas", "solidity"]
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (lowercase, hyphens only, 3-50 chars) |
| `name` | string | Display name |
| `version` | string | Semantic version (e.g., "1.0.0") |
| `description` | string | What the plugin does |
| `languages` | string[] | Supported languages (solidity, rust, vyper, etc.) |
| `capabilities` | string[] | Categories (gas-optimization, security-analysis, code-quality, custom) |
| `main` | string | Path to compiled plugin binary |
| `gasguardVersion` | object | Required GasGuard version range |

### Recommended Fields

| Field | Type | Description |
|-------|------|-------------|
| `author` | object | Author contact information |
| `license` | string | SPDX license identifier (MIT, Apache-2.0, etc.) |
| `homepage` | string | Plugin homepage URL |
| `repository` | object | Git repository information |
| `keywords` | string[] | Discovery keywords |
| `status` | string | stable, beta, alpha, or deprecated |

### Advanced Fields

```json
{
  "dependencies": {
    "plugin-id": {
      "versionRange": {
        "min": "1.0.0",
        "max": "2.0.0"
      },
      "optional": false
    }
  },
  "peerDependencies": {
    "complementary-plugin": {
      "min": "1.0.0"
    }
  },
  "conflicts": ["conflicting-plugin-id"],
  "configSchema": {
    "type": "object",
    "properties": {
      "enableAdvanced": {
        "type": "boolean",
        "default": true
      }
    }
  },
  "defaultConfig": {
    "enableAdvanced": true
  }
}
```

## Version Compatibility

### Semantic Versioning

GasGuard uses semantic versioning: `MAJOR.MINOR.PATCH[-prerelease][+metadata]`

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes
- **Prerelease**: Alpha/beta versions (e.g., "1.0.0-alpha.1")

### Version Ranges

Specify compatible versions using version ranges:

```json
{
  "gasguardVersion": {
    "min": "1.0.0",      // Minimum (inclusive)
    "max": "2.0.0",      // Maximum (exclusive)
    "excludeVersions": ["1.0.5", "1.1.2"]  // Specific excluded versions
  }
}
```

### Compatibility Rules

1. **Your version vs. Core version**: Plugin's `gasguardVersion` must match the installed core
2. **Plugin dependencies**: All required plugin dependencies must be loaded
3. **Plugin conflicts**: No conflicting plugins can be simultaneously loaded

### Example Compatibility Scenarios

```json
// Plugin works with GasGuard 1.x
{
  "gasguardVersion": {
    "min": "1.0.0",
    "max": "2.0.0"
  }
}

// Plugin requires minimum version
{
  "gasguardVersion": {
    "min": "1.1.0"
  }
}

// Plugin avoids specific buggy versions
{
  "gasguardVersion": {
    "min": "1.0.0",
    "max": "2.0.0",
    "excludeVersions": ["1.1.0"]
  }
}
```

## Developing a Plugin

### Step 1: Create Plugin Structure

```bash
cargo new gasguard-my-plugin --lib
cd gasguard-my-plugin
```

### Step 2: Set Up Dependencies

Update `Cargo.toml`:

```toml
[package]
name = "gasguard-my-plugin"
version = "1.0.0"

[lib]
crate-type = ["cdylib"]

[dependencies]
gasguard-ast = { path = "../gasguard/libs/ast" }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

### Step 3: Implement Plugin Entry Point

Create `src/lib.rs`:

```rust
use gasguard_ast::UnifiedAST;
use serde_json::json;

#[no_mangle]
pub extern "C" fn create_rule() -> *mut dyn gasguard_rule_engine::Rule {
    Box::into_raw(Box::new(MyPluginRule))
}

struct MyPluginRule;

impl gasguard_rule_engine::Rule for MyPluginRule {
    fn id(&self) -> &str { "my-rule" }
    
    fn name(&self) -> &str { "My Rule" }
    
    fn description(&self) -> &str { "My plugin rule" }
    
    fn check(&self, ast: &UnifiedAST) -> Vec<gasguard_rule_engine::RuleViolation> {
        // Implement analysis logic
        vec![]
    }
}
```

### Step 4: Create plugin.json

Copy the template and customize:

```bash
cp packages/plugins/plugin.template.json plugin.json
# Edit plugin.json with your plugin details
```

### Step 5: Add Required Documentation

Create `README.md`:

```markdown
# My Plugin

Description of what your plugin does.

## Installation

\`\`\`
gasguard plugin install my-plugin
\`\`\`

## Configuration

\`\`\`json
{
  "enableFeature": true
}
\`\`\`

## Rules

- **RULE-001**: Description of first rule
- **RULE-002**: Description of second rule

## Examples

// Examples showing how rules work

## License

MIT
```

### Step 6: Build and Test

```bash
# Build the plugin
cargo build --release

# Create output directory
mkdir -p dist
cp target/release/libgasguard_my_plugin.so dist/plugin.so

# Validate plugin
gasguard plugin validate ./plugin.json

# Test locally
gasguard analyze --plugin ./dist/plugin.so contract.sol
```

## Publishing

### Pre-Publication Checklist

- [ ] `plugin.json` is valid (run validator)
- [ ] All dependencies are correctly specified
- [ ] Plugin builds without warnings
- [ ] Tests pass
- [ ] Documentation is complete
- [ ] License is specified (preferably MIT or Apache-2.0)
- [ ] Version follows semantic versioning
- [ ] Binary is compiled for target platforms

### Publishing Platforms

#### 1. GasGuard Plugin Registry (Official)

Push to official registry:

```bash
# Login to registry
gasguard plugin login

# Publish
gasguard plugin publish ./plugin.json
```

#### 2. GitHub Releases (Self-hosted)

1. Create GitHub repository
2. Upload compiled binaries to releases
3. Tag releases with version
4. Host `plugin.json` in repository

#### 3. Custom Registry

Host `plugin.json` and binary files on your own server.

### Version Publishing

When publishing updates:

```bash
# Increment version in plugin.json
# Update CHANGELOG

# Create git tag
git tag v1.0.1

# Publish
gasguard plugin publish ./plugin.json
```

## Discovery

### Plugin Discovery CLI

```bash
# Search plugins
gasguard plugin search "optimization"

# View plugin details
gasguard plugin info gas-optimization-pro

# List installed plugins
gasguard plugin list

# Show available versions
gasguard plugin versions gas-optimization-pro
```

### Plugin Registry Browser

Visit [https://plugins.gasguard.dev](https://plugins.gasguard.dev) to browse available plugins.

### Publishing to Registry

Submit your plugin:

1. Ensure `plugin.json` is complete
2. Create pull request to plugin registry
3. Repository is validated
4. Plugin appears on registry site

## Best Practices

### Plugin Development

1. **Start small**: Begin with one focused rule
2. **Test thoroughly**: Include unit tests for all rules
3. **Document well**: Clear README and inline comments
4. **Follow conventions**: Use consistent naming and structure
5. **Version properly**: Use semantic versioning from start
6. **Handle errors**: Gracefully handle parse errors and edge cases

### Plugin Publishing

1. **Publish early**: Use beta/alpha status for early releases
2. **Test compatibility**: Verify with multiple GasGuard versions
3. **Keep manifests accurate**: Update gasguardVersion ranges correctly
4. **Use proper dependencies**: Specify exact version requirements
5. **Document breaking changes**: Update CHANGELOG for major updates
6. **Communicate status**: Use status field (stable, beta, deprecated)

### Plugin Quality

1. **Performance**: Analyze efficiently, avoid N² algorithms
2. **False positives**: Minimize false positives with careful logic
3. **Configurability**: Allow users to customize behavior
4. **Consistency**: Follow GasGuard naming and conventions
5. **Error messages**: Provide helpful, actionable messages
6. **Examples**: Include example violations and fixes

### Version Management

1. **MAJOR** (breaking): When incompatible with prior versions
2. **MINOR** (features): New rules, new capabilities
3. **PATCH** (fixes): Bug fixes, performance improvements
4. **Prerelease**: Use for testing before stable release

### Example Version Progression

```
1.0.0-alpha.1  → Initial alpha release
1.0.0-beta.1   → Feature complete, testing
1.0.0-beta.2   → Bug fixes from beta testing
1.0.0          → Stable release
1.0.1          → Bug fix
1.1.0          → New feature
2.0.0          → Breaking changes
```

## Troubleshooting

### Plugin Loading Issues

**Error: "Plugin binary not found"**
- Check `main` path in plugin.json
- Verify binary exists at specified path
- Ensure binary is compiled for correct platform

**Error: "Version incompatibility"**
- Check plugin's `gasguardVersion` matches installed version
- Use `gasguard plugin validate` to check compatibility

### Manifest Validation

```bash
# Validate plugin manifest
gasguard plugin validate plugin.json

# Shows all errors and warnings
```

### Dependency Resolution

```bash
# Check plugin dependencies
gasguard plugin deps plugin.json

# Shows dependency tree and versions
```

## Support and Community

- **Documentation**: [https://docs.gasguard.dev/plugins](https://docs.gasguard.dev/plugins)
- **GitHub Discussions**: [https://github.com/MDTechLabs/GasGuard/discussions](https://github.com/MDTechLabs/GasGuard/discussions)
- **Issues**: [https://github.com/MDTechLabs/GasGuard/issues](https://github.com/MDTechLabs/GasGuard/issues)
- **Examples**: [https://github.com/MDTechLabs/GasGuard/tree/main/examples/plugins](https://github.com/MDTechLabs/GasGuard/tree/main/examples/plugins)

## License

Plugin publishing documentation is part of GasGuard and is licensed under MIT.
