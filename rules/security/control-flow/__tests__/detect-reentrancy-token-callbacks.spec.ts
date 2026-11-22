import {
  detectReentrancyTokenCallbacks,
  RULE_ID,
} from "../detect-reentrancy-token-callbacks";
import { toNormalizedFindings } from "../../_shared/solidity-source";

describe("detectReentrancyTokenCallbacks", () => {
  describe("ERC-721 receiver callback reentrancy", () => {
    it("detects reentrancy when safeTransferFrom is called before state write (CEI violation)", () => {
      const code = `
        contract VulnerableNFTVault {
          mapping(address => uint256) public balances;
          IERC721 public nft;

          function withdrawNFT(uint256 tokenId) external {
            require(balances[msg.sender] > 0, "No balance");
            nft.safeTransferFrom(address(this), msg.sender, tokenId);
            balances[msg.sender] = 0;
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(code);
      expect(result.detected).toBe(true);
      expect(result.findings).toHaveLength(1);

      const f = result.findings[0];
      expect(f.ruleId).toBe(RULE_ID);
      expect(f.severity).toBe("critical");
      expect(f.functionName).toBe("withdrawNFT");
      expect(f.title).toContain("erc721-receiver");
      expect(f.message).toContain("safeTransferFrom");
      expect(f.message).toContain("balances");
      expect(f.evidence.some((e) => e.includes("Call-chain"))).toBe(true);
    });

    it("detects reentrancy when _safeMint is called before updating mint counter", () => {
      const code = `
        contract VulnerableMinter {
          mapping(address => uint256) public mintedCount;
          uint256 public constant MAX_PER_USER = 1;

          function mint(address to, uint256 tokenId) external {
            require(mintedCount[to] < MAX_PER_USER, "Limit exceeded");
            _safeMint(to, tokenId);
            mintedCount[to] += 1;
          }

          function _safeMint(address to, uint256 tokenId) internal {}
        }
      `;

      const result = detectReentrancyTokenCallbacks(code);
      expect(result.detected).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].message).toContain("_safeMint");
      expect(result.findings[0].message).toContain("mintedCount");
    });
  });

  describe("ERC-1155 receiver callback reentrancy", () => {
    it("detects reentrancy in safeBatchTransferFrom before array/mapping cleanup", () => {
      const code = `
        contract MultiTokenVault {
          mapping(address => uint256) public userShares;
          IERC1155 public token;

          function exit(uint256[] memory ids, uint256[] memory amounts) external {
            require(userShares[msg.sender] > 0, "No shares");
            token.safeBatchTransferFrom(address(this), msg.sender, ids, amounts, "");
            delete userShares[msg.sender];
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(code);
      expect(result.detected).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].message).toContain("safeBatchTransferFrom");
      expect(result.findings[0].message).toContain("userShares");
    });
  });

  describe("ERC-777 and ERC-1363 token hook reentrancy", () => {
    it("detects reentrancy when ERC-777 send triggers tokensReceived hook before state write", () => {
      const code = `
        contract TokenLender {
          mapping(address => uint256) public deposits;
          IERC777 public token;

          function withdraw(uint256 amount) external {
            require(deposits[msg.sender] >= amount, "Insufficient");
            token.send(msg.sender, amount, "");
            deposits[msg.sender] -= amount;
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(code);
      expect(result.detected).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].message).toContain("send");
      expect(result.findings[0].message).toContain("deposits");
    });

    it("detects reentrancy with ERC-1363 transferAndCall before order state write", () => {
      const code = `
        contract EscrowMarket {
          mapping(uint256 => bool) public executed;
          IERC1363 public paymentToken;

          function executeOrder(uint256 orderId, address buyer, uint256 amount) external {
            require(!executed[orderId], "Already executed");
            paymentToken.transferAndCall(buyer, amount);
            executed[orderId] = true;
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(code);
      expect(result.detected).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].message).toContain("transferAndCall");
      expect(result.findings[0].message).toContain("executed");
    });
  });

  describe("Cross-function reentrancy across shared state", () => {
    it("flags cross-function reentrancy when caller has nonReentrant but companion function is unguarded", () => {
      const code = `
        contract RewardPool {
          mapping(address => uint256) public balances;
          IERC721 public rewardNft;

          function claimReward(uint256 tokenId) external nonReentrant {
            require(balances[msg.sender] > 0, "No balance");
            rewardNft.safeTransferFrom(address(this), msg.sender, tokenId);
            balances[msg.sender] = 0;
          }

          function transferBalance(address to, uint256 amount) external {
            require(balances[msg.sender] >= amount, "Insufficient");
            balances[msg.sender] -= amount;
            balances[to] += amount;
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(code);
      expect(result.detected).toBe(true);
      expect(result.findings).toHaveLength(1);
      const f = result.findings[0];
      expect(f.title).toContain("Cross-function reentrancy");
      expect(f.message).toContain("transferBalance");
      expect(f.evidence.some((e) => e.includes("transferBalance"))).toBe(true);
    });
  });

  describe("Guarded and intentionally safe designs (counterexamples)", () => {
    it("does not flag contracts following Checks-Effects-Interactions (CEI)", () => {
      const safeCEI = `
        contract SafeNFTVault {
          mapping(address => uint256) public balances;
          IERC721 public nft;

          function withdrawNFT(uint256 tokenId) external {
            require(balances[msg.sender] > 0, "No balance");
            balances[msg.sender] = 0; // Effect before interaction!
            nft.safeTransferFrom(address(this), msg.sender, tokenId);
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(safeCEI);
      expect(result.detected).toBe(false);
      expect(result.findings).toHaveLength(0);
    });

    it("does not flag when both caller and companion functions have nonReentrant guards", () => {
      const safeGuarded = `
        contract FullyGuardedPool {
          mapping(address => uint256) public balances;
          IERC721 public rewardNft;

          function claimReward(uint256 tokenId) external nonReentrant {
            require(balances[msg.sender] > 0, "No balance");
            rewardNft.safeTransferFrom(address(this), msg.sender, tokenId);
            balances[msg.sender] = 0;
          }

          function transferBalance(address to, uint256 amount) external nonReentrant {
            require(balances[msg.sender] >= amount, "Insufficient");
            balances[msg.sender] -= amount;
            balances[to] += amount;
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(safeGuarded);
      expect(result.detected).toBe(false);
      expect(result.findings).toHaveLength(0);
    });

    it("does not flag when only local variables are updated after callback", () => {
      const safeLocals = `
        contract LocalTrackingVault {
          IERC721 public nft;

          function sendAndLog(address recipient, uint256 tokenId) external returns (bool) {
            nft.safeTransferFrom(address(this), recipient, tokenId);
            bool success = true;
            uint256 localCounter = tokenId + 1;
            return success;
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(safeLocals);
      expect(result.detected).toBe(false);
      expect(result.findings).toHaveLength(0);
    });

    it("does not flag event emissions after callback", () => {
      const safeEvents = `
        contract EventOnlyAfterTransfer {
          event TransferDone(address to, uint256 id);
          IERC721 public nft;

          function sendWithEvent(address to, uint256 id) external {
            nft.safeTransferFrom(address(this), to, id);
            emit TransferDone(to, id);
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(safeEvents);
      expect(result.detected).toBe(false);
      expect(result.findings).toHaveLength(0);
    });

    it("does not flag companion functions that are restricted by onlyOwner or auth", () => {
      const restrictedCompanion = `
        contract OwnerRestrictedVault {
          mapping(address => uint256) public balances;
          IERC721 public nft;

          function withdraw(uint256 id) external nonReentrant {
            nft.safeTransferFrom(address(this), msg.sender, id);
            balances[msg.sender] = 0;
          }

          function emergencyReset(address user) external onlyOwner {
            balances[user] = 0;
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(restrictedCompanion);
      expect(result.detected).toBe(false);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("Safe failure and diagnostics on malformed or unsupported input", () => {
    it("fails safely and returns diagnostics for unbalanced braces", () => {
      const broken = "contract Broken { function foo() external {";
      const result = detectReentrancyTokenCallbacks(broken);

      expect(result.detected).toBe(false);
      expect(result.findings).toHaveLength(0);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].message.toLowerCase()).toContain(
        "unbalanced",
      );
    });

    it("fails safely for empty input or non-Solidity input", () => {
      const empty = detectReentrancyTokenCallbacks("");
      expect(empty.detected).toBe(false);
      expect(empty.diagnostics[0].level).toBe("error");
      expect(empty.diagnostics[0].message).toContain("empty");

      const nonSolidity = detectReentrancyTokenCallbacks(
        "console.log('hello world');",
      );
      expect(nonSolidity.detected).toBe(false);
      expect(nonSolidity.diagnostics[0].message).toContain(
        "No Solidity contract",
      );
    });

    it("warns about older pragma versions but still analyzes safely", () => {
      const oldPragma = `
        pragma solidity ^0.5.0;
        contract LegacyVault {
          mapping(address => uint256) public balances;
          function withdraw(address token, uint256 id) external {
            IERC721(token).safeTransferFrom(address(this), msg.sender, id);
            balances[msg.sender] = 0;
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(oldPragma);
      expect(
        result.diagnostics.some((d) => d.message.includes("older than 0.8")),
      ).toBe(true);
      expect(result.findings).toHaveLength(1);
    });
  });

  describe("toNormalizedFindings schema integration", () => {
    it("converts detector results into normalized findings matching the analyzer schema", () => {
      const code = `
        contract Vault {
          mapping(address => uint256) public balances;
          function withdraw(address token, uint256 id) external {
            IERC721(token).safeTransferFrom(address(this), msg.sender, id);
            balances[msg.sender] = 0;
          }
        }
      `;

      const result = detectReentrancyTokenCallbacks(code);
      const normalized = toNormalizedFindings(result, "contracts/Vault.sol");

      expect(normalized).toHaveLength(1);
      const n = normalized[0];
      expect(n.ruleId).toBe(RULE_ID);
      expect(n.location.file).toBe("contracts/Vault.sol");
      expect(n.location.startLine).toBeGreaterThan(0);
      expect(n.suggestedFix.documentationUrl).toBe(
        `https://docs.gasguard.dev/rules/${RULE_ID}`,
      );
      expect(n.metadata.title).toBeDefined();
      expect(n.metadata.confidence).toBe("high");
      expect(n.metadata.evidence).toBeInstanceOf(Array);
      expect(n.metadata.evidence.length).toBeGreaterThan(0);
    });
  });
});
