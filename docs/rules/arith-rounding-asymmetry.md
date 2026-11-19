# Inconsistent rounding direction between deposits and withdrawals (`arith-rounding-asymmetry`)

Issue: #1370 · Detector: `rules/security/math/detect-rounding-direction-asymmetry.ts` · Tests: `rules/security/math/__tests__/detect-rounding-direction-asymmetry.spec.ts`

## What it detects

Vault-style share/asset conversion paths (`convertToShares`, `deposit`, `mint`, `withdraw`, `redeem`, `convertToAssets` and the `preview*` functions) whose rounding direction violates the declared accounting policy, so value can move systematically from the protocol to users. `analyzeRoundingPaths(code)` also returns every path with its floor/ceiling direction, exchange-rate terms and formula.

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

Paths are found by ERC-4626-style function names. A function that only calls another path (for example `deposit` returning `previewDeposit(assets)`) inherits that path's direction. Direction is read from helpers (`mulDivUp`/`mulDivDown`, `ceilDiv`, `Rounding.Up`/`Down`), the `(a + b - 1) / b` idiom, and plain division (floor).

Policies (option `policy`, or a `// rounding-policy: <name>` comment):
- `protocol-favoring` (default, ERC-4626): deposit, convertToShares, previewDeposit, redeem, previewRedeem and convertToAssets round down; mint, previewMint, withdraw and previewWithdraw round up. Asymmetric rounding that matches this is not flagged.
- `paired-only`: an action and its preview must round the same way.
- `none`: only the directions are reported through `analyzeRoundingPaths`.

## Severity and confidence

High when an action rounds in the user's favor (repeatable by dust-sized deposits or deposit/withdraw loops); medium for a preview that disagrees with the policy or with its action.

## Assumptions and limitations

- Conversion paths are recognised by ERC-4626-style names; custom names are not mapped.
- Functions that take a `Rounding` parameter choose the direction at the call site and are skipped.
- The comparison is syntactic; equivalent formulas written differently are not unified.

## False-positive considerations

Contracts with a deliberate non-ERC-4626 policy should declare it with `// rounding-policy: paired-only` or `none`; otherwise they are compared with the protocol-favoring convention.

## Fixtures

Vulnerable:

```solidity
contract Vault {
  uint256 public totalAssets;
  uint256 public totalSupply;
  function deposit(uint256 assets) external returns (uint256 shares) {
    shares = Math.mulDivUp(assets, totalSupply, totalAssets);
  }
}
```

Safe counterexample:

```solidity
contract Vault {
  uint256 public totalAssets;
  uint256 public totalSupply;
  function deposit(uint256 assets) external returns (uint256 shares) {
    shares = Math.mulDiv(assets, totalSupply, totalAssets);
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "arith-rounding-asymmetry",
  "message": "deposit() [deposit (assets in, shares out)] rounds up, but the declared protocol-favoring policy requires rounding down; the user receives more value than they paid for.",
  "severity": "high",
  "location": {
    "file": "Fixture.sol",
    "startLine": 5,
    "endLine": 5
  },
  "suggestedFix": {
    "description": "Round down (mulDiv / Math.Rounding.Floor) in deposit().",
    "documentationUrl": "https://docs.gasguard.dev/rules/arith-rounding-asymmetry"
  },
  "metadata": {
    "title": "Rounding direction violates the protocol-favoring accounting policy",
    "confidence": "high",
    "function": "deposit",
    "evidence": [
      "shares = Math.mulDivUp(assets, totalSupply, totalAssets)",
      "rounding: ceil",
      "required: floor",
      "exchange-rate terms: totalAssets+totalSupply",
      "a dust-sized deposit or a repeated deposit/withdraw loop extracts the rounding difference each round"
    ],
    "rationale": "The rounding error favors the caller and can be repeated, so value moves systematically from the protocol to users; severity high.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/math/__tests__/detect-rounding-direction-asymmetry.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
