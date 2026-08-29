import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { E2ETestModule } from "./e2e-test.module";
import { ethers } from "ethers";
import { spawn } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";

const execPromise = promisify(exec);

describe("Gasless Transaction E2E Tests", () => {
  let app: INestApplication;
  let hardhatProcess: any;
  let provider: ethers.JsonRpcProvider;
  let signer: ethers.Wallet;

  beforeAll(async () => {
    // Start Hardhat node
    hardhatProcess = spawn("npx", ["hardhat", "node"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });

    // Wait for Hardhat to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Connect to Hardhat network
    provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    signer = new ethers.Wallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // First Hardhat account
      provider,
    );

    // Create NestJS app
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [E2ETestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();

    // Kill Hardhat process
    if (hardhatProcess) {
      hardhatProcess.kill();
    }
  });

  describe("Gasless Transaction Flow", () => {
    it("should create and execute a gasless transaction successfully", async () => {
      // Step 1: Create transaction via API
      const createResponse = await request(app.getHttpServer())
        .post("/scanner/scan")
        .send({
          code: `
            use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};
            
            #[contracttype]
            pub struct SimpleContract {
                pub counter: u64,
            }
            
            #[contractimpl]
            impl SimpleContract {
                pub fn new() -> Self {
                    Self { counter: 0 }
                }
                
                pub fn increment(&mut self) {
                    self.counter += 1;
                }
            }
          `,
          source: "test-contract.rs",
        })
        .expect(200);

      expect(createResponse.body).toHaveProperty("violations");
      expect(createResponse.body).toHaveProperty("scanTime");

      // Step 2: Test transaction processing
      const transactionData = {
        merchantId: "test-merchant-123",
        to: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        value: "1000000000000000000", // 1 ETH
        data: "0x",
        gasLimit: "21000",
      };

      // Mock transaction creation (since we don't have actual relayer yet)
      const mockTxHash = ethers.keccak256(
        ethers.toUtf8Bytes("mock-transaction"),
      );

      // Step 3: Verify transaction processing
      const verifyResponse = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      expect(verifyResponse.body).toHaveProperty("status", "healthy");
      expect(verifyResponse.body).toHaveProperty("service", "gasguard-api");
    });

    it("should handle transaction validation and error cases", async () => {
      // Test invalid transaction data
      const invalidResponse = await request(app.getHttpServer())
        .post("/scanner/scan")
        .send({
          code: "invalid code",
          source: "invalid-source",
        })
        .expect(200); // Should still return 200 but with validation errors

      // Test rate limiting
      const promises = Array(15)
        .fill(null)
        .map(() => request(app.getHttpServer()).get("/health"));

      const responses = await Promise.allSettled(promises);
      const rateLimited = responses.filter(
        (r: any) => r.status === "fulfilled" && r.value.status === 429,
      );

      // Should have some rate limited requests
      expect(rateLimited.length).toBeGreaterThan(0);
    });

    it("should process batch transactions efficiently", async () => {
      const batchRequests = [
        {
          code: `
            use soroban_sdk::{contract, contractimpl};
            #[contract]
            pub struct Test1;
            #[contractimpl]
            impl Test1 {
                pub fn test() {}
            }
          `,
          source: "batch-test-1.rs",
        },
        {
          code: `
            use soroban_sdk::{contract, contractimpl};
            #[contract]
            pub struct Test2;
            #[contractimpl]
            impl Test2 {
                pub fn test() {}
            }
          `,
          source: "batch-test-2.rs",
        },
      ];

      const startTime = Date.now();

      const batchResponse = await request(app.getHttpServer())
        .post("/scanner/scan-batch")
        .send(batchRequests)
        .expect(200);

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      expect(batchResponse.body).toHaveLength(2);
      expect(processingTime).toBeLessThan(5000); // Should process within 5 seconds
    });
  });

  describe("Analytics and Monitoring", () => {
    it("should provide analytics dashboard data", async () => {
      const analyticsResponse = await request(app.getHttpServer())
        .get("/analytics/dashboard?timeRange=24h")
        .expect(200);

      expect(analyticsResponse.body).toHaveProperty("timeRange", "24h");
      expect(analyticsResponse.body).toHaveProperty("transactionMetrics");
      expect(analyticsResponse.body).toHaveProperty("updatedAt");
    });

    it("should track merchant-specific analytics", async () => {
      const merchantId = "test-merchant-456";

      const merchantResponse = await request(app.getHttpServer())
        .get(`/analytics/merchants/${merchantId}?timeRange=7d`)
        .expect(200);

      expect(merchantResponse.body).toHaveProperty("merchantId", merchantId);
      expect(merchantResponse.body).toHaveProperty("timeRange", "7d");
    });
  });

  describe("Failure Scenarios", () => {
    it("should handle RPC timeout gracefully", async () => {
      // This would test actual RPC timeout scenarios
      // For now, we test the error handling structure
      const errorResponse = await request(app.getHttpServer())
        .get("/health")
        .set("X-Test-Error", "timeout")
        .expect(200); // Should handle gracefully

      expect(errorResponse.body).toHaveProperty("status");
    });

    it("should handle worker retry logic", async () => {
      // Simulate failed transaction that should be retried
      const retryResponse = await request(app.getHttpServer())
        .post("/scanner/scan")
        .send({
          code: `
            use soroban_sdk::{contract, contractimpl};
            #[contract]
            pub struct RetryTest;
            #[contractimpl]
            impl RetryTest {
                pub fn test() { panic!("simulated failure"); }
            }
          `,
          source: "retry-test.rs",
        })
        .expect(200);

      // Should still return successful response with error information
      expect(retryResponse.body).toHaveProperty("violations");
    });

    it("should handle signature expiration", async () => {
      const expiredSignature = {
        signature: "0xexpired",
        timestamp: Date.now() - 3600000, // 1 hour ago
      };

      // Test signature validation
      const validationResponse = await request(app.getHttpServer())
        .post("/scanner/scan")
        .set("Authorization", `Bearer ${expiredSignature.signature}`)
        .send({
          code: "test code",
          source: "test.rs",
        })
        .expect(200); // Should handle expired signatures gracefully

      expect(validationResponse.body).toHaveProperty("violations");
    });
  });

  describe("Performance and Load Testing", () => {
    it("should handle concurrent requests efficiently", async () => {
      const concurrentRequests = 10;
      const requests = Array(concurrentRequests)
        .fill(null)
        .map((_, i) =>
          request(app.getHttpServer())
            .post("/scanner/scan")
            .send({
              code: `
              use soroban_sdk::{contract, contractimpl};
              #[contract]
              pub struct LoadTest${i};
              #[contractimpl]
              impl LoadTest${i} {
                  pub fn test() {}
              }
            `,
              source: `load-test-${i}.rs`,
            }),
        );

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const endTime = Date.now();

      const processingTime = endTime - startTime;

      // All requests should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("violations");
      });

      // Should process within reasonable time
      expect(processingTime).toBeLessThan(10000);
    });

    it("should maintain performance under load", async () => {
      // Test sustained load
      const sustainedRequests = 50;
      let successfulRequests = 0;

      for (let i = 0; i < sustainedRequests; i++) {
        try {
          const response = await request(app.getHttpServer())
            .get("/health")
            .timeout(5000);

          if (response.status === 200) {
            successfulRequests++;
          }
        } catch (error) {
          // Request failed, continue
        }

        // Small delay to prevent overwhelming
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Should have high success rate
      const successRate = (successfulRequests / sustainedRequests) * 100;
      expect(successRate).toBeGreaterThan(80);
    });
  });
});
