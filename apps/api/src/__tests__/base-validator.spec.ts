import { BaseValidator } from "../validation/base.validator";

describe("BaseValidator", () => {
  describe("isValidEthereumAddress", () => {
    it("should validate correct Ethereum addresses", () => {
      expect(
        BaseValidator.isValidEthereumAddress(
          "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        ),
      ).toBe(true);
      expect(
        BaseValidator.isValidEthereumAddress(
          "0x0000000000000000000000000000000000000000",
        ),
      ).toBe(true);
    });

    it("should reject invalid Ethereum addresses", () => {
      expect(BaseValidator.isValidEthereumAddress("")).toBe(false);
      expect(BaseValidator.isValidEthereumAddress("0x")).toBe(false);
      expect(
        BaseValidator.isValidEthereumAddress(
          "0x742d35Cc6634C0532925a3b844Bc454e4438f44",
        ),
      ).toBe(false); // too short
      expect(
        BaseValidator.isValidEthereumAddress(
          "0x742d35Cc6634C0532925a3b844Bc454e4438f44ee",
        ),
      ).toBe(false); // too long
      expect(
        BaseValidator.isValidEthereumAddress(
          "742d35Cc6634C0532925a3b844Bc454e4438f44e",
        ),
      ).toBe(false); // missing 0x
      expect(
        BaseValidator.isValidEthereumAddress(
          "0x742d35Cc6634C0532925a3b844Bc454e4438f44g",
        ),
      ).toBe(false); // invalid char
    });
  });

  describe("isValidStellarAddress", () => {
    it("should validate correct Stellar addresses", () => {
      expect(
        BaseValidator.isValidStellarAddress(
          "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        ),
      ).toBe(true);
      expect(
        BaseValidator.isValidStellarAddress(
          "GC7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        ),
      ).toBe(true);
    });

    it("should reject invalid Stellar addresses", () => {
      expect(BaseValidator.isValidStellarAddress("")).toBe(false);
      expect(
        BaseValidator.isValidStellarAddress(
          "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSG",
        ),
      ).toBe(false); // too short
      expect(
        BaseValidator.isValidStellarAddress(
          "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZZ",
        ),
      ).toBe(false); // too long
      expect(
        BaseValidator.isValidStellarAddress(
          "HA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        ),
      ).toBe(false); // wrong prefix
    });
  });

  describe("isValidAddress", () => {
    it("should validate Ethereum addresses for EVM chains", () => {
      expect(
        BaseValidator.isValidAddress(
          "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          1,
        ),
      ).toBe(true); // Ethereum
      expect(
        BaseValidator.isValidAddress(
          "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
          137,
        ),
      ).toBe(true); // Polygon
    });

    it("should validate Stellar addresses for Stellar chain", () => {
      expect(
        BaseValidator.isValidAddress(
          "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
          0,
        ),
      ).toBe(true);
    });

    it("should default to Ethereum validation for unknown chains", () => {
      expect(
        BaseValidator.isValidAddress(
          "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        ),
      ).toBe(true);
      expect(
        BaseValidator.isValidAddress(
          "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        ),
      ).toBe(false);
    });
  });

  describe("isValidGasLimit", () => {
    it("should validate gas limits within range", () => {
      expect(BaseValidator.isValidGasLimit(21000)).toBe(true);
      expect(BaseValidator.isValidGasLimit(30000000)).toBe(true);
      expect(BaseValidator.isValidGasLimit("21000")).toBe(true);
    });

    it("should reject gas limits outside range", () => {
      expect(BaseValidator.isValidGasLimit(20000)).toBe(false); // too low
      expect(BaseValidator.isValidGasLimit(40000000)).toBe(false); // too high
      expect(BaseValidator.isValidGasLimit("invalid")).toBe(false);
    });
  });

  describe("isValidGasPrice", () => {
    it("should validate gas prices within range", () => {
      expect(BaseValidator.isValidGasPrice(1000000000)).toBe(true); // 1 gwei
      expect(BaseValidator.isValidGasPrice(1000000000000)).toBe(true); // 1000 gwei
      expect(BaseValidator.isValidGasPrice("1000000000")).toBe(true);
    });

    it("should reject gas prices outside range", () => {
      expect(BaseValidator.isValidGasPrice(500000000)).toBe(false); // too low
      expect(BaseValidator.isValidGasPrice(2000000000000)).toBe(false); // too high
      expect(BaseValidator.isValidGasPrice("invalid")).toBe(false);
    });
  });

  describe("isValidChainId", () => {
    it("should validate supported chain IDs", () => {
      expect(BaseValidator.isValidChainId(1)).toBe(true); // Ethereum
      expect(BaseValidator.isValidChainId(137)).toBe(true); // Polygon
      expect(BaseValidator.isValidChainId(56)).toBe(true); // BSC
    });

    it("should reject unsupported chain IDs", () => {
      expect(BaseValidator.isValidChainId(999)).toBe(false);
      expect(BaseValidator.isValidChainId(0)).toBe(false);
    });
  });

  describe("isValidTransactionType", () => {
    it("should validate supported transaction types", () => {
      expect(BaseValidator.isValidTransactionType("transfer")).toBe(true);
      expect(BaseValidator.isValidTransactionType("contract-call")).toBe(true);
      expect(BaseValidator.isValidTransactionType("swap")).toBe(true);
    });

    it("should reject unsupported transaction types", () => {
      expect(BaseValidator.isValidTransactionType("invalid")).toBe(false);
      expect(BaseValidator.isValidTransactionType("")).toBe(false);
    });
  });

  describe("isValidUrl", () => {
    it("should validate correct URLs", () => {
      expect(BaseValidator.isValidUrl("https://github.com/user/repo")).toBe(
        true,
      );
      expect(BaseValidator.isValidUrl("http://example.com")).toBe(true);
      expect(BaseValidator.isValidUrl("git@github.com:user/repo.git")).toBe(
        true,
      );
    });

    it("should reject invalid URLs", () => {
      expect(BaseValidator.isValidUrl("")).toBe(false);
      expect(BaseValidator.isValidUrl("not-a-url")).toBe(false);
      expect(BaseValidator.isValidUrl("ftp://example.com")).toBe(false);
    });
  });

  describe("isValidTimestamp", () => {
    it("should validate ISO timestamps", () => {
      expect(BaseValidator.isValidTimestamp("2024-01-01T00:00:00.000Z")).toBe(
        true,
      );
      expect(BaseValidator.isValidTimestamp("2024-01-01T00:00:00Z")).toBe(true);
    });

    it("should reject invalid timestamps", () => {
      expect(BaseValidator.isValidTimestamp("")).toBe(false);
      expect(BaseValidator.isValidTimestamp("2024-01-01")).toBe(false);
      expect(BaseValidator.isValidTimestamp("invalid")).toBe(false);
    });
  });
});
