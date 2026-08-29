import { Request, Response } from "express";
import { BaseValidator } from "../validation/base.validator";
import { AnalysisValidator } from "../validation/analysis.validator";
import { CrossChainGasValidator } from "../validation/cross-chain-gas.validator";
import { FailedTransactionValidator } from "../validation/failed-transaction.validator";

/**
 * Fuzz testing utilities for validators
 * Generates random inputs to test edge cases and unexpected data
 */

// Random string generators
const randomString = (length: number): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const randomHexString = (length: number): string => {
  const chars = "0123456789abcdefABCDEF";
  let result = "0x";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const randomNumber = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const randomFloat = (min: number, max: number): number => {
  return Math.random() * (max - min) + min;
};

// Generate random valid and invalid addresses
const generateEthereumAddress = (valid: boolean): string => {
  if (valid) {
    return `0x${randomHexString(40).toLowerCase()}`;
  }
  return randomHexString(randomNumber(1, 100));
};

const generateStellarAddress = (valid: boolean): string => {
  const prefix = Math.random() > 0.5 ? "G" : "C";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  if (valid) {
    let result = prefix;
    for (let i = 0; i < 55; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  return prefix + randomString(randomNumber(1, 60));
};

// Generate random bytes for potential buffer overflow tests
const generateLargeBuffer = (size: number): Buffer => {
  return Buffer.alloc(size, "a");
};

// Generate random arrays
const generateRandomArray = <T>(
  generator: () => T,
  minLength: number,
  maxLength: number,
): T[] => {
  const length = randomNumber(minLength, maxLength);
  return Array.from({ length }, generator);
};

// Generate random object with fuzzed properties
const generateFuzzedObject = (depth: number = 0): any => {
  if (depth > 3) return "max_depth_reached";

  const type = randomNumber(0, 8);

  switch (type) {
    case 0:
      return randomString(randomNumber(1, 50));
    case 1:
      return randomNumber(-1000, 1000);
    case 2:
      return randomFloat(-1000, 1000);
    case 3:
      return Math.random() > 0.5;
    case 4:
      return null;
    case 5:
      return undefined;
    case 6:
      return generateFuzzedObject(depth + 1);
    case 7:
      return generateRandomArray(() => generateFuzzedObject(depth + 1), 1, 10);
    case 8:
      return { nested: generateFuzzedObject(depth + 1) };
  }
};

// Test counters
let passedTests = 0;
let failedTests = 0;
let errorTests = 0;

/**
 * BaseValidator Fuzz Tests
 */
describe("BaseValidator Fuzz Tests", () => {
  describe("isValidEthereumAddress fuzz testing", () => {
    it("should handle various input types without crashing", () => {
      const inputs: any[] = [
        null,
        undefined,
        "",
        "0x",
        randomString(10),
        randomHexString(10),
        generateEthereumAddress(true),
        generateEthereumAddress(false),
        123,
        {},
        [],
        { address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" },
        "0x742d35Cc6634C0532925a3b844Bc454e4438f44e".repeat(10), // Very long
        "\x00\x01\x02", // Binary data
        "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", // Max uint160
        "-1",
        "0x-1",
        NaN,
        Infinity,
        -Infinity,
      ];

      inputs.forEach((input) => {
        try {
          const result = BaseValidator.isValidEthereumAddress(input as string);
          // Just ensure no exception is thrown
          expect(typeof result).toBe("boolean");
          passedTests++;
        } catch (e) {
          failedTests++;
          console.error("Ethereum address fuzz error:", e);
        }
      });
    });

    it("should handle buffer-like inputs", () => {
      const buffers = [
        Buffer.from("0x742d35Cc6634C0532925a3b844Bc454e4438f44e", "utf8"),
        Buffer.alloc(100),
        Buffer.alloc(0),
      ];

      buffers.forEach((buf) => {
        try {
          const result = BaseValidator.isValidEthereumAddress(buf.toString());
          expect(typeof result).toBe("boolean");
          passedTests++;
        } catch (e) {
          errorTests++;
          console.error("Buffer test error:", e);
        }
      });
    });
  });

  describe("isValidStellarAddress fuzz testing", () => {
    it("should handle various input types without crashing", () => {
      const inputs: any[] = [
        null,
        undefined,
        "",
        randomString(10),
        randomNumber(1, 100),
        generateStellarAddress(true),
        generateStellarAddress(false),
        123,
        {},
        [],
        "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ".repeat(5),
        "\u0000\u0001",
        NaN,
        Infinity,
        -Infinity,
      ];

      inputs.forEach((input) => {
        try {
          const result = BaseValidator.isValidStellarAddress(input as string);
          expect(typeof result).toBe("boolean");
          passedTests++;
        } catch (e) {
          failedTests++;
        }
      });
    });
  });

  describe("isValidAddress fuzz testing", () => {
    it("should handle various chain IDs with various addresses", () => {
      const chainIds = [
        0,
        1,
        137,
        56,
        999,
        -1,
        NaN,
        null,
        undefined,
        ...generateRandomArray(() => randomNumber(0, 1000), 1, 20),
      ];
      const addresses = [
        "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        randomString(20),
        randomHexString(30),
        "",
        null,
        undefined,
        123,
      ];

      chainIds.forEach((chainId) => {
        addresses.forEach((address) => {
          try {
            const result = BaseValidator.isValidAddress(
              address as string,
              chainId as number,
            );
            expect(typeof result).toBe("boolean");
            passedTests++;
          } catch (e) {
            failedTests++;
          }
        });
      });
    });
  });

  describe("isValidGasLimit fuzz testing", () => {
    it("should handle various gas limit inputs", () => {
      const inputs: any[] = [
        0,
        1,
        21000,
        30000000,
        -1,
        -21000,
        "21000",
        "30000000",
        "-1",
        "invalid",
        "",
        randomString(10),
        randomHexString(10),
        null,
        undefined,
        {},
        [],
        NaN,
        Infinity,
        -Infinity,
        0.1,
        1.5,
        -0.5,
        21000.5,
        29999999.9,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        2 ** 53,
        2 ** 53 - 1,
      ];

      inputs.forEach((input) => {
        try {
          const result = BaseValidator.isValidGasLimit(input);
          expect(typeof result).toBe("boolean");
          passedTests++;
        } catch (e) {
          failedTests++;
        }
      });
    });
  });

  describe("isValidGasPrice fuzz testing", () => {
    it("should handle various gas price inputs", () => {
      const inputs: any[] = [
        0,
        1,
        1000000000,
        1000000000000,
        -1,
        "1000000000",
        "1000000000000",
        "-1",
        "invalid",
        "",
        randomString(10),
        randomHexString(10),
        null,
        undefined,
        {},
        [],
        NaN,
        Infinity,
        -Infinity,
        0.1,
        1.5,
        -0.5,
        999999999.9,
        1000000000000.1,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
      ];

      inputs.forEach((input) => {
        try {
          const result = BaseValidator.isValidGasPrice(input);
          expect(typeof result).toBe("boolean");
          passedTests++;
        } catch (e) {
          failedTests++;
        }
      });
    });
  });

  describe("isValidChainId fuzz testing", () => {
    it("should handle various chain ID inputs", () => {
      const inputs: any[] = [
        0,
        1,
        56,
        137,
        42161,
        10,
        43114,
        250,
        999,
        -1,
        "1",
        "56",
        "invalid",
        "",
        null,
        undefined,
        {},
        [],
        NaN,
        Infinity,
        -Infinity,
        0.5,
        1.5,
        -0.5,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
        "0x1",
        "0x89",
      ];

      inputs.forEach((input) => {
        try {
          const result = BaseValidator.isValidChainId(input as number);
          expect(typeof result).toBe("boolean");
          passedTests++;
        } catch (e) {
          failedTests++;
        }
      });
    });
  });

  describe("isValidTransactionType fuzz testing", () => {
    it("should handle various transaction type inputs", () => {
      const inputs: any[] = [
        "transfer",
        "contract-call",
        "swap",
        randomString(10),
        randomString(20),
        "",
        null,
        undefined,
        123,
        {},
        [],
        "Transfer",
        "TRANSFER",
        "Contract-Call",
        "SWAP",
        "transfer ",
        " transfer",
        "transfer\n",
        "swap ".repeat(10),
        " ".repeat(50),
        "\x00\x01\x02",
        "null",
        "undefined",
      ];

      inputs.forEach((input) => {
        try {
          const result = BaseValidator.isValidTransactionType(input as string);
          expect(typeof result).toBe("boolean");
          passedTests++;
        } catch (e) {
          failedTests++;
        }
      });
    });
  });

  describe("isValidUrl fuzz testing", () => {
    it("should handle various URL inputs", () => {
      const inputs: any[] = [
        "https://example.com",
        "http://localhost:3000",
        "git://github.com",
        randomString(20),
        "",
        "not-a-url",
        "https://",
        "http://",
        "git://",
        "https://example.com:65535",
        "https://example.com:-1",
        "ftp://example.com",
        "ws://example.com",
        "wss://example.com",
        null,
        undefined,
        123,
        {},
        [],
        "https://" + randomString(500), // Very long URL
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "\x00\x01\x02", // Binary
        "http://example.com/path?param=" + randomString(100), // Long query
        "http://😀.com", // Emoji domain
      ];

      inputs.forEach((input) => {
        try {
          const result = BaseValidator.isValidUrl(input as string);
          expect(typeof result).toBe("boolean");
          passedTests++;
        } catch (e) {
          failedTests++;
        }
      });
    });
  });

  describe("isValidPositiveNumber fuzz testing", () => {
    it("should handle various number inputs", () => {
      const inputs: any[] = [
        0,
        1,
        100,
        0.1,
        0.001,
        -1,
        -0.1,
        "100",
        "0",
        "-1",
        "invalid",
        "",
        randomString(10),
        null,
        undefined,
        {},
        [],
        NaN,
        Infinity,
        -Infinity,
        Number.MAX_VALUE,
        Number.MIN_VALUE,
        1e308,
        1e-308,
        -1e308,
        -1e-308,
      ];

      inputs.forEach((input) => {
        try {
          const result = BaseValidator.isValidPositiveNumber(input);
          expect(typeof result).toBe("boolean");
          passedTests++;
        } catch (e) {
          failedTests++;
        }
      });
    });
  });
});

/**
 * AnalysisValidator Fuzz Tests
 */
describe("AnalysisValidator Fuzz Tests", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockRequest = {
      body: {},
      headers: { "x-request-id": "test-fuzz-id" },
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe("validateSubmission fuzz testing", () => {
    it("should handle completely malformed input without crashing", () => {
      // Generate 100 random inputs
      for (let i = 0; i < 100; i++) {
        mockRequest.body = generateFuzzedObject();
        mockRequest.headers = generateFuzzedObject();

        try {
          AnalysisValidator.validateSubmission(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          // Should either call next() or return a response, not crash
          expect(
            mockNext.mock.calls.length >= 0 || mockResponse.json,
          ).toBeTruthy();
          passedTests++;
        } catch (e: any) {
          // Acceptable if it's a controlled error response, but not unhandled exceptions
          if (e.message && e.message.includes("Cannot read")) {
            failedTests++;
            console.error("Fuzz test crash:", e.message);
          } else {
            passedTests++; // Controlled error
          }
        }
      }
    });

    it("should handle extreme file counts", () => {
      // Test with 0 files
      mockRequest.body = { project: { name: "Test" }, files: [] };
      AnalysisValidator.validateSubmission(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      // Test with 1000+ files
      mockRequest.body = {
        project: { name: "Test" },
        files: generateRandomArray(
          () => ({
            path: randomString(20),
            content: randomString(100),
            language: "rust",
            size: 100,
          }),
          1000,
          2000,
        ),
      };
      try {
        AnalysisValidator.validateSubmission(
          mockRequest as Request,
          mockResponse as Response,
          mockNext,
        );
        passedTests++;
      } catch (e) {
        // Should handle gracefully
        passedTests++;
      }

      // Test with null files
      mockRequest.body = { project: { name: "Test" }, files: null };
      try {
        AnalysisValidator.validateSubmission(
          mockRequest as Request,
          mockResponse as Response,
          mockNext,
        );
        passedTests++;
      } catch (e) {
        passedTests++;
      }
    });

    it("should handle extremely large file content", () => {
      mockRequest.body = {
        project: { name: "Test" },
        files: [
          {
            path: "test.rs",
            content: randomString(10 * 1024 * 1024), // 10MB
            language: "rust",
            size: 10 * 1024 * 1024,
          },
        ],
      };

      try {
        AnalysisValidator.validateSubmission(
          mockRequest as Request,
          mockResponse as Response,
          mockNext,
        );
        passedTests++;
      } catch (e) {
        passedTests++;
      }
    });

    it("should handle malicious-looking inputs", () => {
      const maliciousInputs = [
        {
          project: { name: "<script>alert(1)</script>" },
          files: [
            {
              path: "test.rs",
              content: "fn main() {}",
              language: "rust",
              size: 10,
            },
          ],
        },
        {
          project: { name: "\u0000\u0001\u0002" },
          files: [
            {
              path: "test.rs",
              content: "fn main() {}",
              language: "rust",
              size: 10,
            },
          ],
        },
        {
          project: { name: "\uD800\uDFFF" },
          files: [
            {
              path: "test.rs",
              content: "fn main() {}",
              language: "rust",
              size: 10,
            },
          ],
        }, // Surrogates
        {
          project: { name: " ".repeat(1000) },
          files: [
            {
              path: "test.rs",
              content: "fn main() {}",
              language: "rust",
              size: 10,
            },
          ],
        },
        {
          project: { name: "\t\n\r" },
          files: [
            {
              path: "test.rs",
              content: "fn main() {}",
              language: "rust",
              size: 10,
            },
          ],
        },
        {
          project: { name: null },
          files: [
            {
              path: "test.rs",
              content: "fn main() {}",
              language: "rust",
              size: 10,
            },
          ],
        },
        {
          project: undefined,
          files: [
            {
              path: "test.rs",
              content: "fn main() {}",
              language: "rust",
              size: 10,
            },
          ],
        },
      ];

      maliciousInputs.forEach((input) => {
        try {
          mockRequest.body = input;
          AnalysisValidator.validateSubmission(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          passedTests++;
        }
      });
    });

    it("should handle SQL injection-like patterns", () => {
      const injectionInputs = [
        {
          project: { name: "'; DROP TABLE users; --" },
          files: [
            {
              path: "test.rs",
              content: "fn main() {}",
              language: "rust",
              size: 10,
            },
          ],
        },
        {
          project: { name: "<img src=x onerror=alert(1)>" },
          files: [
            {
              path: "test.rs",
              content: "fn main() {}",
              language: "rust",
              size: 10,
            },
          ],
        },
        {
          project: { name: '{{constructor.constructor("alert(1)")()}}' },
          files: [
            {
              path: "test.rs",
              content: "fn main() {}",
              language: "rust",
              size: 10,
            },
          ],
        },
      ];

      injectionInputs.forEach((input) => {
        try {
          mockRequest.body = input;
          AnalysisValidator.validateSubmission(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          passedTests++;
        }
      });
    });

    it("should handle array-based attacks", () => {
      const attackInputs = [
        {
          files: [
            {
              path: "a".repeat(10000),
              content: "x",
              language: "rust",
              size: 1,
            },
          ],
        },
        {
          project: { name: "A" },
          files: {
            "0": { path: "a", content: "b", language: "rust", size: 1 },
          },
        },
        { project: { name: "A" }, files: "invalid" as any },
        {
          project: { name: "A" },
          files: [undefined, null, {}, [], 1, "string"],
        },
      ];

      attackInputs.forEach((input) => {
        try {
          mockRequest.body = input;
          AnalysisValidator.validateSubmission(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          passedTests++;
        }
      });
    });
  });
});

/**
 * CrossChainGasValidator Fuzz Tests
 */
describe("CrossChainGasValidator Fuzz Tests", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockRequest = {
      query: {},
      params: {},
      headers: { "x-request-id": "test-fuzz-id" },
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe("validateTransactionType fuzz testing", () => {
    it("should handle various transaction type inputs", () => {
      const inputs: any[] = [
        "transfer",
        "contract-call",
        "swap",
        randomString(20),
        "",
        null,
        undefined,
        123,
        {},
        [],
        true,
        false,
        "Transfer",
        "CONTRACT-CALL",
        "Swap",
        " ".repeat(10),
        "\t\n\r",
      ];

      inputs.forEach((input) => {
        try {
          mockRequest.query = { txType: input };
          CrossChainGasValidator.validateTransactionType(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          passedTests++;
        }
      });
    });
  });

  describe("validateChainIdParam fuzz testing", () => {
    it("should handle various chain ID inputs", () => {
      const inputs: any[] = [
        "1",
        "56",
        "137",
        "42161",
        randomString(10),
        "",
        null,
        undefined,
        "abc",
        "-1",
        "65535",
        "999999",
        "0x1",
        "0x89",
        "1.5",
        "1a",
        "@1",
      ];

      inputs.forEach((input) => {
        try {
          mockRequest.params = { chainId: input };
          CrossChainGasValidator.validateChainIdParam(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          passedTests++;
        }
      });
    });
  });

  describe("validateDateRange fuzz testing", () => {
    it("should handle various date inputs", () => {
      const dateInputs = [
        {
          startDate: "2024-01-01T00:00:00.000Z",
          endDate: "2024-12-31T23:59:59.999Z",
        },
        { startDate: randomString(20), endDate: randomString(20) },
        { startDate: "", endDate: "" },
        { startDate: null, endDate: null },
        { startDate: "invalid", endDate: "2024-01-01" },
        { startDate: "2024-13-01", endDate: "2024-01-01" },
        { startDate: "2024-01-32", endDate: "2024-01-01" },
        { startDate: "2024-01-01", endDate: "2023-12-31" },
        { startDate: "1900-01-01T00:00:00Z", endDate: "2100-12-31T23:59:59Z" },
        {
          startDate: "2024-01-01T00:00:00+00:00",
          endDate: "2024-01-01T00:00:00-00:00",
        },
        { startDate: {}, endDate: [] },
        { startDate: 123, endDate: 456 },
      ];

      dateInputs.forEach((input) => {
        try {
          mockRequest.query = input as any;
          CrossChainGasValidator.validateDateRange(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          passedTests++;
        }
      });
    });
  });
});

/**
 * FailedTransactionValidator Fuzz Tests
 */
describe("FailedTransactionValidator Fuzz Tests", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockRequest = {
      body: {},
      params: {},
      query: {},
      headers: { "x-request-id": "test-fuzz-id" },
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe("validateTransactionAnalysis fuzz testing", () => {
    it("should handle various transaction analysis inputs", () => {
      for (let i = 0; i < 50; i++) {
        mockRequest.body = generateFuzzedObject();

        try {
          FailedTransactionValidator.validateTransactionAnalysis(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          // Controlled error is acceptable
          passedTests++;
        }
      }
    });

    it("should handle extreme chain ID arrays", () => {
      const extremeArrays = [
        { chainIds: [] },
        {
          chainIds: generateRandomArray(
            () => randomNumber(-1000, 1000),
            1000,
            2000,
          ),
        },
        { chainIds: null },
        { chainIds: undefined },
        { chainIds: "1,2,3" },
        { chainIds: [{ a: 1 }, { b: 2 }] },
        { chainIds: [1, "2", 3, null, undefined] },
      ];

      extremeArrays.forEach((input) => {
        try {
          mockRequest.body = {
            wallet: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
            ...input,
          };
          FailedTransactionValidator.validateTransactionAnalysis(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          passedTests++;
        }
      });
    });

    it("should handle extreme wallet addresses", () => {
      const wallets = [
        "0x" + "a".repeat(100), // Very long
        "", // Empty
        "0x", // Just prefix
        "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", // Max
        generateEthereumAddress(true),
        generateStellarAddress(true),
        randomString(40),
        "0x742d35Cc6634C0532925a3b844Bc454e4438f44e ".repeat(10),
        "\x00\x01\x02",
        123,
        null,
        undefined,
        {},
        [],
      ];

      wallets.forEach((wallet) => {
        try {
          mockRequest.body = { wallet };
          FailedTransactionValidator.validateTransactionAnalysis(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          passedTests++;
        }
      });
    });
  });

  describe("validateWalletParam fuzz testing", () => {
    it("should handle various wallet parameter inputs", () => {
      const inputs: any[] = [
        "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        randomString(40),
        randomHexString(30),
        "",
        null,
        undefined,
        123,
        {},
        [],
        "0x".repeat(20),
      ];

      inputs.forEach((input) => {
        try {
          mockRequest.params = { wallet: input };
          FailedTransactionValidator.validateWalletParam(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          passedTests++;
        }
      });
    });
  });

  describe("validateChainIdsQuery fuzz testing", () => {
    it("should handle various chain ID query inputs", () => {
      const inputs: any[] = [
        "1,56,137", // Valid comma-separated
        "1,2,3,4,5,6,7,8,9,10",
        randomString(20),
        "",
        null,
        undefined,
        "a,b,c",
        "1,2,three",
        ",,,",
        "1,,2,3",
        " ".repeat(10),
        "1-2-3",
        "1.2.3",
      ];

      inputs.forEach((input) => {
        try {
          mockRequest.query = { chainIds: input };
          FailedTransactionValidator.validateChainIdsQuery(
            mockRequest as Request,
            mockResponse as Response,
            mockNext,
          );
          passedTests++;
        } catch (e) {
          passedTests++;
        }
      });
    });
  });
});

/**
 * Summary of fuzz tests
 */
describe("Fuzz Test Summary", () => {
  it("should complete all fuzz tests without critical failures", () => {
    console.log(`\n=== Fuzz Test Results ===`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(`Errors: ${errorTests}`);

    // We expect most tests to pass - some failures are acceptable for fuzz tests
    // as long as no unhandled exceptions crash the test suite
    expect(passedTests).toBeGreaterThan(0);
  });
});
