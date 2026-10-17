# Reliability load suite

See [docs/RELIABILITY_LOAD_TESTING.md](../../docs/RELIABILITY_LOAD_TESTING.md).

```bash
npm run test:load                                  # specs (LOAD_SCALE=1..100 for longer runs)
npm run load:report -- --scenario chaos --seed 7   # human-readable report
```
