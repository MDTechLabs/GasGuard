import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { E2ETestModule } from "./e2e-test.module";

describe("Simple Transaction E2E Tests", () => {
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

  it("should create and process a transaction successfully", async () => {
    // Test transaction creation
    const response = await request(app.getHttpServer())
      .post("/scanner/scan")
      .send({
        code: "test code content",
        source: "test-file.rs",
      })
      .expect(200);

    expect(response.body).toBeDefined();
    expect(response.body).toHaveProperty("scanTime");
  });

  it("should handle health check endpoint", async () => {
    const response = await request(app.getHttpServer())
      .get("/health")
      .expect(200);

    expect(response.body).toHaveProperty("status", "healthy");
    expect(response.body).toHaveProperty("service", "gasguard-api");
  });

  it("should handle analytics dashboard", async () => {
    const response = await request(app.getHttpServer())
      .get("/analytics/dashboard")
      .expect(200);

    expect(response.body).toHaveProperty("timeRange");
    expect(response.body).toHaveProperty("updatedAt");
  });

  it("should handle rate limiting", async () => {
    // Make multiple rapid requests to test rate limiting
    const requests = Array(15)
      .fill(null)
      .map(() => request(app.getHttpServer()).get("/health"));

    const responses = await Promise.all(requests);

    // Some requests should be rate limited (429)
    const rateLimited = responses.filter((r) => r.status === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  });

  it("should handle batch processing", async () => {
    const batchData = [
      { code: "code1", source: "file1.rs" },
      { code: "code2", source: "file2.rs" },
    ];

    const response = await request(app.getHttpServer())
      .post("/scanner/scan-batch")
      .send(batchData)
      .expect(200);

    expect(Array.isArray(response.body)).toBeTruthy();
    expect(response.body).toHaveLength(2);
  });
});
