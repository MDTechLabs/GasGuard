# GasGuard CLI Reference

## Rerun Failed Scans

Rerun previously failed scans with configurable retry limits and parallel execution.

### Command
```bash
gasguard rerun-failed [options]
```

### Options
- `-l, --limit <number>`: Maximum scans to rerun (default: all)
- `-p, --parallel <number>`: Parallel execution count (default: 1)

### Example
```bash
# Rerun up to 10 failed scans with 3 parallel workers
gasguard rerun-failed --limit 10 --parallel 3
```

### Notes
- Failed scans are identified from previous run states
- Retry logic includes exponential backoff (1s, 2s, 4s)
- Maximum retry attempts: 3 by default