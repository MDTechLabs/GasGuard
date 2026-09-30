# GasGuard CLI: Shell Completion

GasGuard supports command-line autocompletion for `bash`, `zsh`, and `fish`.

## Installation

To load completions in your current shell session, add the following to your profile (`~/.bashrc`, `~/.zshrc`, or your fish config):

### Bash
```bash
source <(gasguard completion bash)


# GasGuard CLI: Exit Codes

GasGuard CLI uses standardized exit codes to facilitate reliable scripting, automation, and CI/CD pipeline integration.

## Exit Code Reference

| Exit Code | Error Domain | Description |
| :--- | :--- | :--- |
| **0** | Success | Command executed successfully without errors. |
| **1** | General Error | Unexpected runtime error or unhandled exception. |
| **2** | Validation Error | Invalid command-line arguments, options, or input payloads. |
| **3** | Policy Violation | Transaction or smart contract violates active gas or security policies. |
| **4** | Network Error | Connection failure, RPC timeout, or Horizon node unreachability. |
| **5** | Authentication Error | Missing, expired, or invalid API keys/signatures. |