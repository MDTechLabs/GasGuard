# Reentrancy through token hooks and receiver callbacks (`call-reentrancy-token-callbacks`)

Issue: #1362 · Detector: `rules/security/control-flow/detect-reentrancy-token-callbacks.ts` · Tests: `rules/security/control-flow/__tests__/detect-reentrancy-token-callbacks.spec.ts`

## What it detects

Detects reentrancy vulnerabilities arising from external control transfers during token operations. Specifically:
- **ERC-721 receiver callbacks**: `safeTransferFrom`, `_safeTransfer`, `_safeMint`, `safeMint`, `onERC721Received`
- **ERC-1155 receiver callbacks**: `safeTransferFrom`, `safeBatchTransferFrom`, `_safeBatchTransfer`, `_safeBatchMint`, `safeBatchMint`, `onERC1155Received`, `onERC1155BatchReceived`
- **ERC-777 token hooks**: `tokensToSend`, `tokensReceived`, `send(to, amount, data)`, `operatorSend`, `operatorBurn`
- **ERC-1363 callbacks**: `transferAndCall`, `transferFromAndCall`, `approveAndCall`

When these functions transfer execution control to recipient contracts or registered hooks before the calling contract updates and finalizes internal state (violating Checks-Effects-Interactions), reentrant calls can exploit the inconsistent state. The rule tracks:
1. State variables written after the callback invocation.
2. All reachable external/public entry points sharing those state variables (both self-reentrancy into the caller and cross-function reentrancy into companion functions).
3. The presence of reentrancy guards (`nonReentrant` modifiers or mutexes) across all affected entry points.

## Supported inputs

- **Solidity versions**: Solidity `0.6.x` through `0.8.x` source text. Pragma versions older than `0.8.0` produce a warning diagnostic but are analyzed safely.
- **Compiler settings**: Scans Solidity source text directly without requiring `solc` execution. Compiler settings (optimizer, runs, EVM version) are not consulted. Project configuration or repository-provided scripts are not executed.
- **Safe failure**: Malformed inputs, empty source, non-Solidity source, and unbalanced delimiters fail safely with diagnostic entries and zero findings. The detector never throws exceptions.

## How it decides

1. **Callback call site discovery**: Scans function bodies for calls to standard receiver callbacks and token hooks (`safeTransferFrom`, `_safeMint`, `send`, `transferAndCall`, etc.).
2. **State mutation tracking**: Identifies state variable assignments, increments, decrements, array operations (`push`/`pop`), and deletions that occur *after* the callback call site within the function.
3. **CEI verification**: If all state variable modifications occur before the callback invocation, the function conforms to Checks-Effects-Interactions (CEI) and is considered intentionally callback-safe (no finding emitted).
4. **Shared state and reachable entry points**: Discovers all external/public functions in the contract that read or modify the affected state variables during callback execution.
5. **Guard analysis**:
   - Checks whether the caller function is protected with `nonReentrant` or a mutex. If protected, single-function reentrancy is blocked.
   - Evaluates companion entry points sharing the affected state. If a companion function is unguarded and lacks access control (e.g. not `onlyOwner`), cross-function reentrancy remains viable and is reported.
   - If both the caller and all companion functions sharing the state are protected by reentrancy guards, the design is recognized as guarded and safe.

## Severity and confidence

- **Critical**: Unchecked callback before modifying sensitive accounting state (balances, shares, token amounts, debt, claims) without a reentrancy guard, enabling self-reentrancy or draining.
- **High**: Callback before state update where companion functions lack reentrancy guards (cross-function reentrancy), or other non-financial state variables are left unfinalized.
- **Confidence**: `high` (0.9) when standard callback signatures and direct post-call state writes are identified.

## Assumptions and limitations

- **Single-file analysis**: Inheritance hierarchies, interfaces, and library implementations in separate files are not traversed.
- **Standard signature heuristics**: Callbacks and hooks are recognized by standard method names (`safeTransferFrom`, `_safeMint`, `tokensReceived`, etc.). Custom or non-standard callback names are not identified.
- **Dynamic dispatch**: Low-level arbitrary `.call(...)` without known callback method names is handled by generic external-call detectors rather than this token-specific rule.
- **Access control**: Modifiers matching standard authorization patterns (`onlyOwner`, `auth`, `onlyRole`, `requiresAuth`) are treated as restricting untrusted caller access.

## False-positive considerations

- If a token called via `safeTransferFrom` is known at deployment time to be a trusted token that never executes external callbacks (or recipient is guaranteed to be an EOA), the detector will still flag post-call state writes because the source code alone cannot guarantee external runtime immutability.
- If a custom lock mechanism is implemented through complex cross-contract state rather than standard modifier or local boolean flags, verify the lock in review.

## Fixtures

### Vulnerable:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC721 {
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

contract VulnerableNFTVault {
    mapping(address => uint256) public balances;
    IERC721 public nft;

    constructor(address _nft) {
        nft = IERC721(_nft);
    }

    function depositNFT(uint256 tokenId) external {
        balances[msg.sender] += 1;
    }

    function withdrawNFT(uint256 tokenId) external {
        require(balances[msg.sender] > 0, "No balance");
        nft.safeTransferFrom(address(this), msg.sender, tokenId);
        balances[msg.sender] = 0;
    }
}
```

### Safe counterexample:
```solidity
contract SafeNFTVault {
    mapping(address => uint256) public balances;
    IERC721 public nft;

    constructor(address _nft) {
        nft = IERC721(_nft);
    }

    function withdrawNFT(uint256 tokenId) external {
        require(balances[msg.sender] > 0, "No balance");
        balances[msg.sender] = 0; // Checks-Effects-Interactions: update state before callback
        nft.safeTransferFrom(address(this), msg.sender, tokenId);
    }
}
```

## Expected normalized finding for the vulnerable fixture

```json
{
  "ruleId": "call-reentrancy-token-callbacks",
  "message": "withdrawNFT() invokes external token callback 'safeTransferFrom' at line 22 before updating state variable(s) [balances]. Lacks a reentrancy guard on 'withdrawNFT', allowing reentrant callback execution to exploit stale state.",
  "severity": "critical",
  "location": {
    "file": "tests/rules/fixtures/call-reentrancy-token-callbacks.sol",
    "startLine": 22,
    "endLine": 23
  },
  "suggestedFix": {
    "codeSnippet": "// Apply Checks-Effects-Interactions (CEI): update state before calling external token hooks/callbacks",
    "description": "Update state variable(s) [balances] before calling 'safeTransferFrom', or protect both 'withdrawNFT' and all companion functions with 'nonReentrant'.",
    "documentationUrl": "https://docs.gasguard.dev/rules/call-reentrancy-token-callbacks"
  },
  "metadata": {
    "confidence": 0.9,
    "confidenceEvidence": [
      "Callback trigger at line 22: 'nft.safeTransferFrom(address(this), msg.sender, tokenId)' (erc721-receiver via safeTransferFrom)",
      "State written after callback: 'balances' at line 23 (balances[msg.sender] = 0)",
      "Caller 'withdrawNFT' reentrancy guard: missing",
      "Self-reentrancy path: 'withdrawNFT' can be re-entered via callback before state variables [balances] are updated",
      "Cross-function reentrancy paths into unguarded entry points: 'depositNFT' (shares [balances])",
      "Call-chain: withdrawNFT() -> safeTransferFrom() -> recipient callback -> [withdrawNFT(), depositNFT()] accessing stale state [balances]"
    ],
    "limitations": [
      "Single-file analysis: callbacks and state in inherited contracts, external libraries, or interfaces outside this file are not resolved.",
      "Token interfaces and receivers are identified by standard function signatures (e.g. safeTransferFrom, _safeMint, tokensReceived, transferAndCall); non-standard or obfuscated hook names are not tracked.",
      "Dynamic call dispatch or delegatecall indirection through external proxies is not followed.",
      "Access control is judged from recognized modifiers (only*, auth*, requiresAuth, checkRole); custom authorization logic inside function bodies is not fully evaluated."
    ],
    "severityRationale": "Token hooks (ERC-777) and receiver callbacks (ERC-721/ERC-1155) transfer control to arbitrary external contracts. Modifying contract state after invoking a callback violates Checks-Effects-Interactions and allows reentrant callers to operate on inconsistent state.",
    "title": "Reentrancy via erc721-receiver before state update in withdrawNFT()"
  }
}
```

## Verification status

- **Unit tests**: `rules/security/control-flow/__tests__/detect-reentrancy-token-callbacks.spec.ts` covers ERC-721, ERC-1155, ERC-777, ERC-1363, CEI compliance, full reentrancy guards, cross-function reentrancy, local variable mutations, event emissions, and malformed/unsupported input diagnostics.
- **Integration tests**: `libs/engine/analyzers/call-reentrancy-token-callbacks.spec.ts` verifies integration with the `SolidityAnalyzer` pipeline and validates normalized finding output against `tests/rules/expected/call-reentrancy-token-callbacks-normalized.json`.
- **Benchmark impact**: Analyzed using lightweight source parsing without `solc` invocation overhead. Execution overhead per contract scan is < 5ms.
- **Security review**: Reviewed for false-positive rates on CEI and guarded patterns.
