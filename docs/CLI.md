# GasGuard CLI: Shell Completion

GasGuard supports command-line autocompletion for `bash`, `zsh`, and `fish`.

## Installation

To load completions in your current shell session, add the following to your profile (`~/.bashrc`, `~/.zshrc`, or your fish config):

### Bash

```bash
source <(gasguard completion bash)
```

# GasGuard CLI: Exit Codes

GasGuard CLI uses standardized exit codes to facilitate reliable scripting, automation, and CI/CD pipeline integration.

## Exit Code Reference

| Exit Code | Error Domain         | Description                                                             |
| :-------- | :------------------- | :---------------------------------------------------------------------- |
| **0**     | Success              | Command executed successfully without errors.                           |
| **1**     | General Error        | Unexpected runtime error or unhandled exception.                        |
| **2**     | Validation Error     | Invalid command-line arguments, options, or input payloads.             |
| **3**     | Policy Violation     | Transaction or smart contract violates active gas or security policies. |
| **4**     | Network Error        | Connection failure, RPC timeout, or Horizon node unreachability.        |
| **5**     | Authentication Error | Missing, expired, or invalid API keys/signatures.                       |

## Local Repository Analysis

Run the local analyzer against the current directory or a repository path:

```bash
gasguard analyze-local [path]
```

`analyze-local` is an alias for `scan`. It analyzes Solidity and Rust sources with the bundled GasGuard rule engines. Vyper files are discovered but reported as unsupported until a Vyper engine is available.

The command performs a repository preflight before analysis. Defaults are 10,000 supported files and 100 MiB combined source size. Override either limit when needed:

```bash
gasguard analyze-local ./contracts --max-files 20000 --max-bytes 209715200
```

Use `--format text`, `--format json`, or `--format sarif` to select output. JSON and SARIF reports default to the operating system's temporary directory; pass `--output <file>` to choose another destination. Source files are never modified by analysis. This permits analysis of a locally available archived/read-only checkout without GitHub write access. No remote repository is fetched and the command does not query GitHub archive metadata.

Press Ctrl-C to cancel. Cancellation is cooperative between files; the active file finishes before the command exits with status 130. If preflight rejects a repository, reduce the scanned tree with a smaller path or increase the corresponding limit. File access errors are reported instead of silently treating inaccessible directories as empty.
