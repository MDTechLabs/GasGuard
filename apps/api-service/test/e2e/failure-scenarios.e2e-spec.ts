import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { E2ETestModule } from "./e2e-test.module";

describe("Failure Scenarios E2E Tests", () => {
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

  it("should handle invalid transaction data gracefully", async () => {
    const response = await request(app.getHttpServer())
      .post("/scanner/scan")
      .send({
        code: "", // Empty code
        source: "", // Empty source
      })
      .expect(200); // Should still return 200 but with validation info

    expect(response.body).toBeDefined();
  });

  it("should handle malformed requests", async () => {
    const response = await request(app.getHttpServer())
      .post("/scanner/scan")
      .send("invalid json")
      .expect(400);

    expect(response.body).toBeDefined();
  });

  it("should handle non-existent endpoints", async () => {
    const response = await request(app.getHttpServer())
      .get("/non-existent-endpoint")
      .expect(404);

    expect(response.body).toBeDefined();
  });

  it("should handle timeout scenarios", async () => {
    // Test with timeout
    const response = await request(app.getHttpServer())
      .get("/health")
      .timeout(5000)
      .expect(200);

    expect(response.body).toHaveProperty("status");
  });

  it("should maintain service availability under stress", async () => {
    const stressRequests = 20;
    const requests = Array(stressRequests)
      .fill(null)
      .map(() => request(app.getHttpServer()).get("/health"));

    const responses = await Promise.all(requests);
    const successful = responses.filter((r) => r.status === 200);

    // Most requests should succeed
    expect(successful.length).toBeGreaterThan(stressRequests * 0.8);
  });
});
