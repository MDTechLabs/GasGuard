import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { BadRequestException } from "@nestjs/common";
import { TransactionsService } from "./transactions.service";
import { Transaction, TxStatus, TxType } from "./transaction.entity";
import { Granularity } from "./metrics-query.dto";
import { RateLimitService } from "./rate-limit.service";
import { SuspiciousActivityService } from "./suspicious-activity.service";

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return Object.assign(new Transaction(), {
    id: crypto.randomUUID(),
    txHash: `0x${Math.random().toString(16).slice(2)}`,
    merchantId: "merchant_1",
    chainId: 1,
    status: TxStatus.SUCCESS,
    type: TxType.TRANSFER,
    gasUsed: 21000,
    timestamp: new Date(),
    ...overrides,
  });
}

function mockRepo(txs: Transaction[]) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(txs),
    getRawMany: jest
      .fn()
      .mockResolvedValue(
        [...new Set(txs.map((t) => t.chainId))].map((chainId) => ({ chainId })),
      ),
  };
  return {
    create: jest
      .fn()
      .mockImplementation((dto) => Object.assign(new Transaction(), dto)),
    save: jest
      .fn()
      .mockImplementation((e) => Promise.resolve({ ...e, id: "uuid-1" })),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
}

describe("TransactionsService", () => {
  let service: TransactionsService;
  let repoMock: ReturnType<typeof mockRepo>;

  async function init(txs: Transaction[]) {
    repoMock = mockRepo(txs);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        RateLimitService,
        SuspiciousActivityService,
        { provide: getRepositoryToken(Transaction), useValue: repoMock },
      ],
    }).compile();
    service = module.get(TransactionsService);
  }

  describe("record()", () => {
    it("creates and saves a transaction, returns transaction + rateLimit + suspiciousActivity", async () => {
      await init([]);
      const result = await service.record({
        txHash: "0xabc",
        merchantId: "M1",
        chainId: 1,
        status: TxStatus.SUCCESS,
        type: TxType.TRANSFER,
        gasUsed: 21000,
      });
      expect(repoMock.save).toHaveBeenCalledTimes(1);
      expect(result.transaction.id).toBe("uuid-1");
      expect(result.rateLimit).toBeDefined();
      expect(result.rateLimit.allowed).toBe(true);
      expect(result.suspiciousActivity).toBeDefined();
      expect(result.suspiciousActivity.detected).toBe(false);
    });
  });

  describe("getMetrics()", () => {
    it("returns the spec JSON shape with 96.8% success rate", async () => {
      const txs = [
        ...Array(242)
          .fill(null)
          .map(() => makeTx({ status: TxStatus.SUCCESS })),
        ...Array(8)
          .fill(null)
          .map(() => makeTx({ status: TxStatus.FAILURE })),
      ];
      await init(txs);
      const m = await service.getMetrics("1234", 1, { period: "2026-02" });

      expect(m).toMatchObject({
        merchantId: "1234",
        chainId: 1,
        period: "2026-02",
        totalTransactions: 250,
        successfulTransactions: 242,
        successRate: 96.8,
      });
      expect(m.generatedAt).toBeDefined();
    });

    it("returns successRate null when no transactions", async () => {
      await init([]);
      const m = await service.getMetrics("X", 1, {});
      expect(m.successRate).toBeNull();
      expect(m.totalTransactions).toBe(0);
    });

    it("includes breakdownByType correctly", async () => {
      const txs = [
        makeTx({ status: TxStatus.SUCCESS, type: TxType.TRANSFER }),
        makeTx({ status: TxStatus.FAILURE, type: TxType.TRANSFER }),
        makeTx({ status: TxStatus.SUCCESS, type: TxType.SWAP }),
      ];
      await init(txs);
      const m = await service.getMetrics("M1", 1, {});
      const swap = m.breakdownByType.find((b) => b.type === TxType.SWAP);
      expect(swap?.successRate).toBe(100);
      const transfer = m.breakdownByType.find(
        (b) => b.type === TxType.TRANSFER,
      );
      expect(transfer?.successRate).toBe(50);
    });

    it("computes averageGasUsed", async () => {
      await init([makeTx({ gasUsed: 20000 }), makeTx({ gasUsed: 40000 })]);
      const m = await service.getMetrics("M1", 1, {});
      expect(m.averageGasUsed).toBe(30000);
    });
  });

  describe("getMetricsAllChains()", () => {
    it("returns one entry per distinct chainId", async () => {
      const txs = [
        makeTx({ chainId: 1 }),
        makeTx({ chainId: 137 }),
        makeTx({ chainId: 42161 }),
      ];
      await init(txs);
      // stub getMany per chainId call
      repoMock
        .createQueryBuilder()
        .getMany.mockResolvedValueOnce([txs[0]])
        .mockResolvedValueOnce([txs[1]])
        .mockResolvedValueOnce([txs[2]]);

      const results = await service.getMetricsAllChains("merchant_1", {});
      expect(results).toHaveLength(3);
    });
  });

  describe("getTimeSeries()", () => {
    it("returns daily buckets sorted chronologically", async () => {
      const txs = [
        makeTx({ timestamp: new Date("2026-02-03") }),
        makeTx({ timestamp: new Date("2026-02-01") }),
        makeTx({ timestamp: new Date("2026-02-02") }),
      ];
      await init(txs);
      const series = await service.getTimeSeries("merchant_1", 1, {
        granularity: Granularity.DAILY,
      });
      expect(series.map((s) => s.period)).toEqual([
        "2026-02-01",
        "2026-02-02",
        "2026-02-03",
      ]);
    });

    it("returns monthly buckets", async () => {
      const txs = [
        makeTx({ timestamp: new Date("2026-01-15") }),
        makeTx({ timestamp: new Date("2026-02-10") }),
      ];
      await init(txs);
      const series = await service.getTimeSeries("merchant_1", 1, {
        granularity: Granularity.MONTHLY,
      });
      expect(series.map((s) => s.period)).toEqual(["2026-01", "2026-02"]);
    });

    it("returns empty array when no transactions", async () => {
      await init([]);
      const series = await service.getTimeSeries("merchant_1", 1, {});
      expect(series).toEqual([]);
    });
  });

  describe("checkAlerts()", () => {
    it("returns alert=false when above threshold", async () => {
      await init([
        ...Array(99)
          .fill(null)
          .map(() => makeTx({ status: TxStatus.SUCCESS })),
        makeTx({ status: TxStatus.FAILURE }),
      ]);
      const r = await service.checkAlerts("M1", 1, { threshold: 95 });
      expect(r.alert).toBe(false);
      expect(r.successRate).toBe(99);
    });

    it("returns warning when just below threshold", async () => {
      await init([
        ...Array(93)
          .fill(null)
          .map(() => makeTx({ status: TxStatus.SUCCESS })),
        ...Array(7)
          .fill(null)
          .map(() => makeTx({ status: TxStatus.FAILURE })),
      ]);
      const r = await service.checkAlerts("M1", 1, { threshold: 95 });
      expect(r.alert).toBe(true);
      expect(r.severity).toBe("warning");
    });

    it("returns critical when > 10% below threshold", async () => {
      await init([
        ...Array(80)
          .fill(null)
          .map(() => makeTx({ status: TxStatus.SUCCESS })),
        ...Array(20)
          .fill(null)
          .map(() => makeTx({ status: TxStatus.FAILURE })),
      ]);
      const r = await service.checkAlerts("M1", 1, { threshold: 95 });
      expect(r.alert).toBe(true);
      expect(r.severity).toBe("critical");
    });

    it("returns no-data message when store is empty", async () => {
      await init([]);
      const r = await service.checkAlerts("nobody", 999, {});
      expect(r.alert).toBe(false);
      expect(r.message).toMatch(/No data/);
    });
  });

  describe("period validation", () => {
    it("throws BadRequestException on malformed period", async () => {
      await init([]);
      // period validator in DTO would normally catch this,
      // but test the service-level guard too via a raw call
      // We bypass the DTO by calling getMetrics with a crafted query
      // The @Matches decorator on the DTO handles this at controller level;
      // the service's parsePeriod throws BadRequestException for safety
      await expect(
        service.getMetrics("M1", 1, { period: "2026" } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
