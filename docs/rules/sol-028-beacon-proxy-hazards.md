# Beacon Proxy Initialization and Upgrade Hazards (`sol-028`)

Detector: `libs/engine/analyzers/beacon-proxy-hazard-detector.ts`
Tests: `libs/engine/analyzers/beacon-proxy-hazard-detector.spec.ts`

## What it detects

Hazardous patterns in beacon proxy deployments and beacon upgrades:

1. `uninitialized-proxy-deployment`: Deploying a `BeaconProxy` with empty initialization calldata (`""`), leaving the proxy open to front-running initialization.
2. `unvalidated-beacon-address`: Deploying a beacon proxy without validating that the beacon address is non-zero and has deployed contract code.
3. `unprotected-beacon-upgrade`: Beacon `upgradeTo` or `setImplementation` functions lacking authorization controls (`onlyOwner`), allowing arbitrary implementation overwrites for all proxies.
4. `empty-implementation-upgrade`: Upgrading beacon implementation without checking `code.length > 0`, which would brick all proxies pointing to the beacon.
5. `missing-initializer-disable`: Upgradeable implementation logic contracts that fail to call `_disableInitializers()` in the constructor.

## Recognized as safe

- Beacon proxy deployments passing encoded initialization calldata atomically.
- Validating `beacon.code.length > 0` before deployment.
- Beacon upgrades restricted to `onlyOwner` and checking `newImplementation.code.length > 0`.
- Calling `_disableInitializers()` in logic constructors.

## Severity and rationale

Severity: HIGH.
Flaws in beacon proxy administration affect all child proxy instances simultaneously. An uninitialized proxy allows attackers to assume contract ownership, while corrupted implementation upgrades brick all proxies.
