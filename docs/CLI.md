# GasGuard CLI: Shell Completion

GasGuard supports command-line autocompletion for `bash`, `zsh`, and `fish`.

## Scan resource limits

Local scans check the number and combined size of supported source files before
starting analysis. The defaults are 10,000 files and 100 MiB of source. Files
under `node_modules`, `.git`, `target`, `dist`, and `build` are excluded by
default. Configure limits in `gasguard.config.json` or override them per run:

```json
{
	"scan": {
		"maxFiles": 10000,
		"maxBytes": 104857600
	}
}
```

```sh
gasguard scan ./contracts --max-files 5000 --max-bytes 52428800
```

Discovery stops as soon as a configured limit is exceeded. The CLI reports
`FILE_LIMIT_EXCEEDED` or `SIZE_LIMIT_EXCEEDED` and does not start analysis.

## Installation

To load completions in your current shell session, add the following to your profile (`~/.bashrc`, `~/.zshrc`, or your fish config):

### Bash
```bash
source <(gasguard completion bash)
