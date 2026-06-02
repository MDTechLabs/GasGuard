import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { HealthModule } from "../../src/health/health.module";
import { ScannerModule } from "../../src/scanner/scanner.module";
import { RulesModule } from "../../src/rules/rules.module";

describe("Basic API E2E Tests", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule, ScannerModule, RulesModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("should return health check status", async () => {
    const response = await request(app.getHttpServer())
      .get("/health")
      .expect(200);

    expect(response.body).toHaveProperty("status");
    expect(response.body).toHaveProperty("service");
    expect(response.body.status).toBe("healthy");
  });

  it("should return health readiness", async () => {
    const response = await request(app.getHttpServer())
      .get("/health/ready")
      .expect(200);

    expect(response.body).toHaveProperty("status", "healthy");
  });

  it("should return health liveness", async () => {
    const response = await request(app.getHttpServer())
      .get("/health/live")
      .expect(200);

    expect(response.body).toHaveProperty("status", "healthy");
  });

  it("should scan code successfully", async () => {
    const response = await request(app.getHttpServer())
      .post("/scanner/scan")
      .send({
        code: `
          use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};
          
          #[contracttype]
          pub struct TestContract {
              pub owner: Address,
              pub counter: u64,
          }
          
          #[contractimpl]
          impl TestContract {
              pub fn new(owner: Address) -> Self {
                  Self {
                      owner,
                      counter: 0,
                  }
              }
              
              pub fn increment(&mut self) {
                  self.counter += 1;
              }
          }
        `,
        source: "test-contract.rs",
      })
      .expect(200);

    expect(response.body).toHaveProperty("scanTime");
    expect(response.body).toHaveProperty("violations");
    expect(response.body).toHaveProperty("hasViolations");
  });

  it("should get all rules", async () => {
    const response = await request(app.getHttpServer())
      .get("/rules")
      .expect(200);

    expect(Array.isArray(response.body)).toBeTruthy();
    expect(response.body.length).toBeGreaterThan(0);
  });

  it("should handle 404 for non-existent routes", async () => {
    const response = await request(app.getHttpServer())
      .get("/non-existent-endpoint")
      .expect(404);

    expect(response.body).toBeDefined();
  });

  it("should handle empty code gracefully", async () => {
    const response = await request(app.getHttpServer())
      .post("/scanner/scan")
      .send({
        code: "",
        source: "empty-test",
      })
      .expect(200);

    expect(response.body).toHaveProperty("violations");
  });
});
