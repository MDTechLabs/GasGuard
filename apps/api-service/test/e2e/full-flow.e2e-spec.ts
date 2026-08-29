import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/core";
import request from "supertest";
import { E2ETestModule } from "./e2e-test.module";

describe("Full Flow E2E Tests", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [E2ETestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should run a full scan, estimate, and tier simulation flow", async () => {
    // 1. Scan code
    const scanResponse = await request(app.getHttpServer())
      .post("/scanner/scan")
      .send({
        code: `use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};
        #[contracttype]
        pub struct TestContract { pub owner: Address, pub counter: u64 }
        #[contractimpl]
        impl TestContract { pub fn new(owner: Address) -> Self { Self { owner, counter: 0 } } }`,
        source: "test-contract.rs",
      })
      .expect(200);
    expect(scanResponse.body).toBeDefined();
    expect(scanResponse.body).toHaveProperty("scanTime");

    // 2. Get tiered estimate
    const estimateResponse = await request(app.getHttpServer())
      .post("/tiered-pricing/estimate")
      .send({
        chainId: "testnet",
        gasUnits: 100000,
        userUsage: {
          userId: "user1",
          currentTier: "starter",
          currentMonthRequests: 10,
          monthlyUsage: [],
          averageRequestsPerMonth: 10,
          peakRequestsPerMonth: 10,
          tierHistory: [],
          billingPeriodStart: new Date(),
          billingPeriodEnd: new Date(),
        },
      })
      .expect(200);
    expect(estimateResponse.body).toBeDefined();
    expect(estimateResponse.body.data).toHaveProperty("finalPricePerRequest");

    // 3. Simulate upgrade
    const simulateResponse = await request(app.getHttpServer())
      .post("/tiered-pricing/simulate-upgrade")
      .send({
        userUsage: {
          userId: "user1",
          currentTier: "starter",
          currentMonthRequests: 10,
          monthlyUsage: [],
          averageRequestsPerMonth: 10,
          peakRequestsPerMonth: 10,
          tierHistory: [],
          billingPeriodStart: new Date(),
          billingPeriodEnd: new Date(),
        },
        targetTier: "developer",
      })
      .expect(201);
    expect(simulateResponse.body).toBeDefined();
    expect(simulateResponse.body.data).toHaveProperty("fromTier", "starter");
    expect(simulateResponse.body.data).toHaveProperty("toTier", "developer");
  });
});
