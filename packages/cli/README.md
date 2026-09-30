# GasGuard CLI

## Usage

Run `gasguard scan [path]` to scan Solidity, Vyper, and Rust files. Progress is shown only when stderr is a terminal. Use `--no-progress` to disable the spinner, `--quiet` to suppress status output, or `--config <file>` to select a configuration file. Quiet mode keeps errors and command result payloads, including JSON/SARIF reports and AST output.

Create a default configuration with `gasguard init`. Run `gasguard init --interactive` in a terminal to choose include and exclude patterns, report format, summary behavior, confidence threshold, and automatic-fix defaults. Interactive mode requires a TTY; use plain `gasguard init` in scripts. `--force` replaces an existing config.

`gasguard config show` prints the effective configuration. `gasguard config set <key> <value>` edits the selected config file. The root `--config` option applies to scan, init, and config commands.

## Configuration inheritance

Configuration files may specify an `extends` path. Relative paths are resolved from the file declaring `extends`; absolute paths are also accepted.

```json
{
  "extends": "./config/base.json",
  "scan": {
    "exclude": ["vendor/**"]
  }
}
```

Nested objects are merged recursively, while arrays and scalar values in the child replace the parent values. Inheritance chains are supported. Missing parent files, malformed JSON, invalid `extends` values, and cycles are reported as errors.

Scan settings support `include` and `exclude` glob patterns, plus a positive integer `maxFiles`. Output settings support `format` (`text`, `json`, `sarif`, or `both`), `summary`, and `confidenceThreshold` between 0 and 1. Explicit scan flags take precedence over config defaults.

## Troubleshooting

- `Interactive setup requires a TTY`: rerun `gasguard init` without `--interactive`, or run it from an interactive terminal.
- `Configuration inheritance cycle detected`: remove the reference that points back to a config already in the inheritance chain.
- `Configuration file not found`: verify the parent path relative to the config that declares it, or correct the `--config` path.
- No progress indicator appears in a script: progress is terminal-only; omit redirection for interactive output or use `--no-progress` to state the intent explicitly.
