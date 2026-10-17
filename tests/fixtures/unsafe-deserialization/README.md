# Unsafe Deserialization Fixture Repositories

Fixture repositories exercising `UnsafeDeserializationAnalyzer`:

- `vulnerable-app`: An Express/Node service with dangerous `node-serialize`, `serialize-to-js`, and `yaml.unsafeLoad` patterns.
- `safe-app`: A hardened Node service relying exclusively on `JSON.parse` and `yaml.safeLoad`.
- `regression-app`: A Python service containing native `pickle.loads` and unconstrained `yaml.load`.
