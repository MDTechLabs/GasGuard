# CI Troubleshooting Matrix (#1087)

A quick lookup for the failures contributors hit most often on CI. Each row maps
a symptom to the job that reports it, the usual cause, and the smallest fix.

| Symptom | Job / command | Usual cause | Fix |
| --- | --- | --- | --- |
| `tsc -b` reports errors but the job is green | `npm run build` (`tsc -b 2>&1 \|\| true`) | The build script currently swallows `tsc`'s exit status, so type errors do not fail CI | Run `npx tsc -b --pretty false` locally and fix the reported errors before opening the PR |
| Lint failures appear only on CI | `npm run lint` | The script runs `eslint --fix` locally, so uncommitted formatting fixes stay in the working tree | Run `npx eslint "{apps,libs,packages}/**/*.ts"` (without `--fix`), commit the changes it reports |
| `Cannot find module '@engine/...'` | `npm test`, `npm run build` | Path aliases are declared in `tsconfig.json` and re-declared in the Jest `moduleNameMapper`; adding one without the other breaks the other runner | Add the alias to both `tsconfig.json` `paths` and the Jest `moduleNameMapper` |
| Unit tests pass locally, fail on CI with snapshot drift | `npm test` | Snapshots were written on a different Node version or the clock/timezone differs | Delete the stale snapshot file, re-run `npm test`, and commit the regenerated snapshot |
| E2E suite cannot boot the API | `npm run test:e2e` | The E2E config expects databases/queues that CI starts via `docker-compose.yml`; a missing or unhealthy service fails bootstrap | Wait for the compose healthchecks (`docker compose ps`), and re-run once `postgres`/`redis` report healthy |
| Contract tests fail with a compiler version error | `npm run test:contracts` | The Foundry/Hardhat toolchain is pinned by `rust-toolchain.toml` and `foundry.toml`; a mismatched local binary is used | Install the pinned versions, then re-run `npm run test:contracts` |
| Dependency provenance check fails | `npm run provenance:check` | A dependency was added without regenerating provenance metadata | Run `npm run provenance:check` locally, then update the generated manifest and commit it |
| Third-party notices job fails | `npm run license:notices` | A new dependency is not represented in the generated notices | Run `npm run license:notices` and commit the regenerated file |
| Coverage gate fails though tests pass | `npm test -- --coverage` | New files were added without tests, lowering the aggregate percentage | Add focused unit tests for the new module, or extend an existing spec that already covers it |
| Job fails with `ENOSPC` while installing | any install step | The pnpm/npm store and `node_modules` filled the runner disk | Clear the cache step for the job (or `pnpm store prune`) and re-run; avoid committing build output |
| Job times out mid-suite | `npm test` | A spec opens a handle it never closes (server, timer, Redis client) | Call the closer in `afterAll`, or inject a fake clock/timer instead of sleeping |

## General triage order

1. Reproduce the failing command locally with the exact script from `package.json`.
2. Confirm the toolchain versions match the pins in `rust-toolchain.toml` / `package-lock.json`.
3. Check whether the failure is environmental (services, caches, disk) before changing code.
4. Reproduce with `--runInBand` to remove cross-suite interference, then narrow to the offending spec.
5. Only after the local reproduction is green, re-run the single CI job rather than the whole pipeline.
