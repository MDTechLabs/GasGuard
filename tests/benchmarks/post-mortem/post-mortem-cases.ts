/**
 * Benchmark cases reconstructed from public post-mortems and write-ups of real incidents.
 *
 * Each case is a minimal contract that reproduces the vulnerable pattern named in the
 * incident. Nothing here is copied from an exploited contract. `expectedRules` must be
 * reported. `forbiddenRules` must not be reported, which is how a fixed or guarded version
 * is kept from being flagged again.
 *
 * Adding a case: cite the public incident, keep the reproduction minimal, and state which
 * rules should and should not fire. Patterns the analyzer cannot express belong in
 * docs/post-mortem-benchmark.md under "not covered", not in this list.
 */

export interface PostMortemCase {
  id: string;
  /** Public incident or write-up the pattern comes from. */
  incident: string;
  /** Vulnerability class in plain words. */
  vulnerability: string;
  /** Whether the case is a vulnerable reproduction or a fixed control. */
  kind: "vulnerable" | "control";
  source: string;
  expectedRules: string[];
  forbiddenRules: string[];
  file: string;
}

export const POST_MORTEM_CASES: PostMortemCase[] = [
  {
    id: "the-dao-2016-reentrancy",
    incident: "The DAO (June 2016), withdrawal before balance update",
    vulnerability: "reentrancy through a legacy .call.value() transfer",
    kind: "vulnerable",
    file: "contracts/SimpleDAO.sol",
    source: `pragma solidity ^0.4.19;
contract SimpleDAO {
    mapping(address => uint256) public credit;
    function withdrawBalance() public {
        uint256 amount = credit[msg.sender];
        if (!(msg.sender.call.value(amount)())) { throw; }
        credit[msg.sender] = 0;
    }
}`,
    expectedRules: ["sol-006"],
    forbiddenRules: [],
  },
  {
    id: "tx-origin-wallet-authorisation",
    incident: "Wallet phishing via tx.origin authorisation (class of 2018 wallet incidents)",
    vulnerability: "authorisation by tx.origin lets a malicious intermediary contract act as the owner",
    kind: "vulnerable",
    file: "contracts/PhishableWallet.sol",
    source: `pragma solidity ^0.8.20;
contract PhishableWallet {
    address public owner;
    constructor() { owner = msg.sender; }
    function transferTo(address payable to, uint256 amount) external {
        require(tx.origin == owner, "not owner");
        (bool ok, ) = to.call{value: amount}("");
        require(ok);
    }
}`,
    expectedRules: ["sol-014"],
    forbiddenRules: [],
  },
  {
    id: "the-dao-guarded-control",
    incident: "The DAO (June 2016), after the standard fix",
    vulnerability: "control: the same withdrawal with a reentrancy guard",
    kind: "control",
    file: "contracts/GuardedDAO.sol",
    source: `pragma solidity ^0.8.20;
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
contract GuardedDAO is ReentrancyGuard {
    mapping(address => uint256) public credit;
    function withdrawBalance() public nonReentrant {
        uint256 amount = credit[msg.sender];
        credit[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok);
    }
}`,
    expectedRules: [],
    forbiddenRules: ["sol-006"],
  },
];
