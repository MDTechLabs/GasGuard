# Unchecked block scope and arithmetic invariants (`arith-unchecked-invariants`)

Issue: #1365 · Detector: `rules/security/math/detect-unchecked-arithmetic-invariants.ts` · Tests: `rules/security/math/__tests__/detect-unchecked-arithmetic-invariants.spec.ts`

## What it detects

Arithmetic inside `unchecked { ... }` that has no bound proving it cannot overflow or underflow: additions, subtractions, multiplications, `**`, `++`/`--` and compound assignments (`+=`, `-=`, `*=`), including accumulators in loops. The finding names the missing invariant (for example `balances >= amount` before `balances - amount`) instead of a generic overflow warning.

## Supported inputs

- Solidity 0.8.x source text (checked arithmetic by default). Sources with an older `pragma solidity` are still analyzed but get a warning diagnostic.
- Single file; inheritance, imports and library bodies are not resolved. No compiler settings are read, and no project scripts or configuration are executed.
- Input larger than 2,000,000 characters, empty input, non-string input, unbalanced braces and non-Solidity text are rejected with a diagnostic (`diagnostics[].level === "error" | "info"`) and zero findings; the detector never throws.

## How it decides

1. The function body is split into statements with block nesting.
2. Operands of each operation are followed through local assignments to see whether they come from caller-supplied parameters of public/external functions.
3. A dominating `require`, `assert`, `if (...) revert` or `if (...) return` (same or enclosing block, earlier in the function) that mentions the operands in a comparison counts as the bound. For subtraction both operands must appear; for multiplication every non-constant operand must; for additions/increments one operand is enough.
4. The standard counter idiom (`unchecked { ++i; }` inside a `for`/`while` whose condition bounds `i`) is accepted.

## Severity and confidence

High when an operand derives from a caller-supplied parameter (high confidence); medium otherwise (medium confidence). Constant-only arithmetic is ignored.

## Assumptions and limitations

- Textual analysis of one file: guards in modifiers, base contracts or other functions are not seen.
- A guard counts when its condition mentions the operand; its arithmetic is not proven correct, so a guard against an unrelated limit can hide a real overflow.
- Value ranges are not tracked.
- Explicit casts are not evaluated; a narrowing cast of an unchecked result is reported only as extra evidence.

## False-positive considerations

Bounds established in a modifier, an inherited function or by contract-wide invariants (for example total supply caps) are not visible and produce a finding. A guard in a sibling `if` branch is correctly not accepted.

## Fixtures

Vulnerable:

```solidity
contract Vault {
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    unchecked {
      balances[msg.sender] = balances[msg.sender] - amount;
    }
  }
}
```

Safe counterexample:

```solidity
contract Vault {
  mapping(address => uint256) public balances;
  function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "insufficient");
    unchecked {
      balances[msg.sender] = balances[msg.sender] - amount;
    }
  }
}
```

Expected normalized finding for the vulnerable fixture (`toNormalizedFindings(result, "Fixture.sol")`):

```json
{
  "ruleId": "arith-unchecked-invariants",
  "message": "`balances - amount` (-) runs in an unchecked block in withdraw() with no dominating check that establishes: balances >= amount.",
  "severity": "high",
  "location": {
    "file": "Fixture.sol",
    "startLine": 5,
    "endLine": 5
  },
  "suggestedFix": {
    "description": "Add a dominating check for balances >= amount, or move the operation out of the unchecked block.",
    "documentationUrl": "https://docs.gasguard.dev/rules/arith-unchecked-invariants"
  },
  "metadata": {
    "title": "Unchecked arithmetic without a bounding invariant",
    "confidence": "high",
    "function": "withdraw",
    "evidence": [
      "balances[msg.sender] = balances[msg.sender] - amount",
      "operand(s) amount derive from caller-supplied parameters"
    ],
    "rationale": "Caller-influenced operands let an attacker choose values that wrap silently; severity high.",
    "diagnostics": [],
    "limitations": [
      "see LIMITATIONS in the detector module"
    ]
  }
}
```

`metadata` also carries `diagnostics` and `limitations`. Use `toNormalizedFindings` from `rules/security/_shared/solidity-source.ts` to convert a result into the analyzer pipeline's `Finding` shape.

## Verification status

Unit tests (vulnerable, safe, boundary, malformed-input cases) are in `rules/security/math/__tests__/detect-unchecked-arithmetic-invariants.spec.ts`. They have not been run yet, and no benchmark or independent security review has been recorded; both are open items for this rule.
