# GasGuard Plugin System

## Overview

The GasGuard Plugin System enables external developers to extend the analysis capabilities of GasGuard by creating custom rules and analyzers. This system provides:

- **Standardized Plugin Format**: Consistent structure for discovering and loading plugins
- **Version Compatibility**: Semantic versioning and compatibility checking
- **Dependency Management**: Plugins can depend on other plugins
- **Flexible Distribution**: Publish to official registry or self-host
- **Rich Documentation**: Complete guides for developers

## Key Features

### ✅ Standardized Plugin Format

- Defined manifest structure (`plugin.json`)
- Clear plugin binary interface
- Metadata for discovery and compatibility

### ✅ Version Compatibility

- Semantic versioning support
- Version range specifications
- Automatic compatibility validation

### ✅ Plugin Dependencies

- Declare dependencies on core versions
- Specify plugin dependencies with version ranges
- Automatic dependency resolution and validation

### ✅ Publishing System

- Official GasGuard Plugin Registry
- Self-hosted plugin distribution
- Direct GitHub integration
- Semantic versioning support

### ✅ Developer Tools

- Plugin templates and examples
- Manifest validation tooling
- Test and build guidance
- Publishing workflows

## Quick Links

### For Plugin Users

- [Plugin Installation Guide](../docs/PLUGIN_MANAGING.md)
- [Plugin Registry](https://plugins.gasguard.dev)
- [Installed Plugins Info](CLI_COMMANDS.md#plugin)

### For Plugin Developers

- **[Plugin Development Guide](../docs/PLUGIN_DEVELOPMENT.md)** ⭐ Start here
- [Plugin Publishing System](../docs/PLUGIN_PUBLISHING.md) - Publishing and distribution
- [Plugin Manifest Reference](#plugin-manifest-reference)
- [Version Compatibility Guide](#version-compatibility)
- [Example Plugins](./examples/)

## Plugin Manifest Reference

### Minimal Plugin (`plugin.json`)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What my plugin does",
  "languages": ["solidity"],
  "capabilities": ["gas-optimization"],
  "main": "dist/plugin.so",
  "gasguardVersion": {
    "min": "1.0.0"
  }
}
```

### Complete Plugin

```json
{
  "id": "advanced-plugin",
  "name": "Advanced Analysis Plugin",
  "version": "1.0.0",
  "description": "Advanced analysis capabilities",
  "languages": ["solidity", "rust", "vyper"],
  "capabilities": ["gas-optimization", "security-analysis", "custom"],
  "main": "dist/plugin.so",

  "author": {
    "name": "Developer Name",
    "email": "dev@example.com",
    "url": "https://github.com/developer"
  },

  "license": "MIT",
  "homepage": "https://github.com/developer/gasguard-advanced",
  "repository": {
    "type": "git",
    "url": "https://github.com/developer/gasguard-advanced.git"
  },
  "bugs": "https://github.com/developer/gasguard-advanced/issues",

  "gasguardVersion": {
    "min": "1.0.0",
    "max": "2.0.0",
    "excludeVersions": ["1.1.0"]
  },

  "dependencies": {
    "base-analyzer": {
      "pluginId": "base-analyzer",
      "versionRange": {
        "min": "1.0.0"
      }
    }
  },

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
  },

  "status": "stable",
  "keywords": ["gas", "optimization", "analysis"]
}
```

See [Plugin Publishing System](../docs/PLUGIN_PUBLISHING.md) for complete field reference.

## Version Compatibility

### Semantic Versioning

```
1.0.0-alpha.1 → 1.0.0-beta.1 → 1.0.0 → 1.0.1 → 1.1.0 → 2.0.0
```

- **MAJOR**: Breaking changes
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes
- **Prerelease**: Alpha/beta versions

### Version Ranges

```json
{
  "gasguardVersion": {
    "min": "1.0.0",      // Required minimum (inclusive)
    "max": "2.0.0",      // Upper limit (exclusive)
    "excludeVersions": ["1.1.0", "1.2.0"]  // Specific excluded versions
  }
}
```

### Compatibility Rules

1. **Plugin requires GasGuard version**: Checked when loading plugin
2. **Plugin dependencies**: All required plugins must be available and compatible
3. **Peer dependencies**: Optional, warnings if missing
4. **Conflicts**: Incompatible plugins cannot both be loaded

## File Structure

```
packages/plugins/
├── plugin-manifest.ts          # Type definitions and interfaces
├── version-compat.ts           # Version comparison and checking
├── manifest-validator.ts       # Manifest validation logic
├── plugin.template.json        # Template for creating new plugins
├── example-plugin.ts           # Example plugin implementation
├── README.md                   # This file
└── mod.rs                      # Rust module file

docs/
├── PLUGIN_PUBLISHING.md        # Publishing guide
├── PLUGIN_DEVELOPMENT.md       # Development guide
└── PLUGIN_MANAGING.md          # User guide
```

## Creating Your First Plugin

### Step 1: Choose Language

- **Rust**: Full compilation to native binary (.so/.dll)
- **TypeScript/Node.js**: Can be compiled or distributed as-is
- **WebAssembly**: Portable binary format

### Step 2: Use Template

```bash
cp packages/plugins/plugin.template.json plugin.json
```

### Step 3: Implement Plugin

See [Plugin Development Guide](../docs/PLUGIN_DEVELOPMENT.md) for language-specific instructions.

### Step 4: Create Manifest

Update `plugin.json` with your plugin details.

### Step 5: Build & Test

```bash
# Build
cargo build --release

# Test
gasguard analyze --plugin ./dist/plugin.so contract.sol

# Validate
gasguard plugin validate plugin.json
```

### Step 6: Publish

```bash
# To official registry
gasguard plugin publish ./plugin.json --registry official

# Or to GitHub
git push origin main
gh release create v1.0.0 dist/plugin.so
```

## Validation

### Manifest Validation

```bash
gasguard plugin validate plugin.json
```

Checks:
- Required fields present
- Valid semantic version
- Valid language list
- URL format validation
- Dependency references
- Version range syntax

### Compatibility Validation

```bash
gasguard plugin check-compatibility plugin.json
```

Checks:
- Core version compatibility
- Dependency availability
- Dependency version compatibility
- Conflicting plugins
- Peer dependency status

## Built-in Plugins

GasGuard includes built-in plugins for supported languages:

### Solidity Plugins
- Gas optimization rules (`SOL-OPT-*`)
- Security analysis rules (`SOL-SEC-*`)
- Code quality rules (`SOL-QUAL-*`)

### Rust Plugins
- Gas efficiency rules (`RUST-EFF-*`)
- Safety checks (`RUST-SAFE-*`)

### Vyper Plugins
- Optimization rules (`VYP-OPT-*`)
- Security analysis (`VYP-SEC-*`)

See [Built-in Rules](../docs/IMPLEMENTATION_SUMMARY.md#built-in-rules) for details.

## Plugin Discovery

### Search Plugins

```bash
gasguard plugin search "gas optimization"
```

### View Plugin Info

```bash
gasguard plugin info my-plugin
```

### List Installed Plugins

```bash
gasguard plugin list
```

### Check Versions

```bash
gasguard plugin versions my-plugin
```

## Common Patterns

### Multi-Rule Plugin

Plugins often provide related rules:

```typescript
class PluginRegistry {
  rules = [
    new LoopOptimizationRule(),
    new CacheOptimizationRule(),
    new StorageOptimizationRule(),
  ];
}
```

### Configurable Rules

Allow users to customize rule behavior:

```json
{
  "configSchema": {
    "properties": {
      "severity": { "type": "string", "enum": ["warning", "error"] }
    }
  }
}
```

### Rule Dependencies

Use outputs from prior rules:

```typescript
class ContextualRule implements Rule {
  dependencies() { return ["pattern-detection"]; }
}
```

## Troubleshooting

### Plugin Won't Load

```bash
# Check manifest validity
gasguard plugin validate plugin.json

# Check compatibility
gasguard plugin check-compatibility plugin.json

# Check binary format
file dist/plugin.so
```

### Version Incompatibility

```bash
# Check core version
gasguard --version

# Check plugin version range
gasguard plugin info my-plugin

# Update plugin.json gasguardVersion range
```

### Dependency Issues

```bash
# Check dependency tree
gasguard plugin deps my-plugin

# Install missing dependencies
gasguard plugin install base-plugin@1.0.0
```

## Best Practices

### Plugin Development

1. **Keep focused**: One plugin = one domain of analysis
2. **Test thoroughly**: Unit and integration tests
3. **Document well**: README, examples, comments
4. **Version carefully**: Semantic versioning from start
5. **Plan compatibility**: Test with multiple core versions

### Plugin Publishing

1. **Complete manifest**: All recommended fields
2. **Version ranges**: Accurate gasguardVersion range
3. **Dependencies**: Specify exact version requirements
4. **Documentation**: Clear README and examples
5. **Licensing**: Use standard SPDX licenses

### Plugin Quality

1. **Performance**: Analyze efficiently, avoid O(n²) operations
2. **Accuracy**: Minimize false positives and false negatives
3. **Configurability**: Allow users to customize behavior
4. **Error handling**: Graceful handling of edge cases
5. **User experience**: Helpful error messages and suggestions

## Resources

### Documentation

- [Plugin Development Guide](../docs/PLUGIN_DEVELOPMENT.md)
- [Plugin Publishing Guide](../docs/PLUGIN_PUBLISHING.md)
- [Manifest Reference](../docs/PLUGIN_PUBLISHING.md#plugin-manifest)
- [Version Compatibility Guide](../docs/PLUGIN_PUBLISHING.md#version-compatibility)

### Tools

- Manifest validator: [manifest-validator.ts](./manifest-validator.ts)
- Version checker: [version-compat.ts](./version-compat.ts)
- Plugin template: [plugin.template.json](./plugin.template.json)
- Example: [example-plugin.ts](./example-plugin.ts)

### Community

- **Registry**: [https://plugins.gasguard.dev](https://plugins.gasguard.dev)
- **Discussions**: [GitHub Discussions](https://github.com/MDTechLabs/GasGuard/discussions)
- **Issues**: [GitHub Issues](https://github.com/MDTechLabs/GasGuard/issues)
- **Examples**: [examples/plugins/](../examples/plugins/)

## Contributing Plugins

### To Official Registry

1. Ensure plugin meets quality standards
2. Create pull request with plugin details
3. Pass automated validation
4. Community review
5. Merge and publish

### Self-Hosting

1. Host plugin binary and manifest on your server
2. Update plugin.json with URLs
3. Share plugin details with users
4. Maintain semantic versioning

## License

Plugin system documentation is part of GasGuard, licensed under MIT.

---

**Ready to create a plugin?** Start with the [Plugin Development Guide](../docs/PLUGIN_DEVELOPMENT.md)! 🚀
