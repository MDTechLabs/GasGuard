import { SuspiciousActivityService, SuspiciousActivityType, AlertSeverity } from './suspicious-activity.service';
import { Transaction, TxStatus, TxType } from './transaction.entity';

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return Object.assign(new Transaction(), {
    id: crypto.randomUUID(),
    txHash: `0x${Math.random().toString(16).slice(2)}`,
    merchantId: 'merchant_1',
    chainId: 1,
    status: TxStatus.SUCCESS,
    type: TxType.TRANSFER,
    gasUsed: 21000,
    timestamp: new Date(),
    ...overrides,
  });
}

describe('SuspiciousActivityService', () => {
  let service: SuspiciousActivityService;

  beforeEach(() => {
    service = new SuspiciousActivityService();
  });

  describe('analyze() — no detection below threshold', () => {
    it('returns detected=false when fewer than 5 transactions', () => {
      for (let i = 0; i < 4; i++) {
        const result = service.analyze(makeTx());
        expect(result.detected).toBe(false);
      }
    });

    it('returns detected=false for normal traffic', () => {
      for (let i = 0; i < 10; i++) {
        const tx = makeTx({ timestamp: new Date(Date.now() - i * 5000) });
        service.analyze(tx);
      }
      const result = service.analyze(makeTx());
      expect(result.detected).toBe(false);
    });
  });

  describe('High failure rate detection', () => {
    it('detects HIGH_FAILURE_RATE when > 70% of last 10 transactions fail', () => {
      // Seed 10 transactions with 8 failures
      const txs = [
        ...Array(8).fill(null).map(() => makeTx({ status: TxStatus.FAILURE })),
        ...Array(2).fill(null).map(() => makeTx({ status: TxStatus.SUCCESS })),
      ];
      let lastResult: any;
      for (const tx of txs) {
        lastResult = service.analyze(tx);
      }
      expect(lastResult.detected).toBe(true);
      expect(lastResult.type).toBe(SuspiciousActivityType.HIGH_FAILURE_RATE);
      expect([AlertSeverity.LOW, AlertSeverity.MEDIUM, AlertSeverity.HIGH]).toContain(lastResult.severity);
      expect(lastResult.detectedAt).toBeDefined();
      expect(lastResult.metadata.failureRate).toBeGreaterThanOrEqual(70);
    });

    it('does not flag when failure rate is below 70%', () => {
      const txs = [
        ...Array(6).fill(null).map(() => makeTx({ status: TxStatus.SUCCESS })),
        ...Array(4).fill(null).map(() => makeTx({ status: TxStatus.FAILURE })),
      ];
      let lastResult: any;
      for (const tx of txs) {
        lastResult = service.analyze(tx);
      }
      // 40% failure — should NOT trigger high failure rate
      if (lastResult.detected) {
        expect(lastResult.type).not.toBe(SuspiciousActivityType.HIGH_FAILURE_RATE);
      }
    });
  });

  describe('Gas spike detection', () => {
    it('detects GAS_SPIKE when latest tx uses > 4x rolling average', () => {
      // 9 normal transactions
      for (let i = 0; i < 9; i++) {
        service.analyze(makeTx({ gasUsed: 21000 }));
      }
      // Spike transaction
      const result = service.analyze(makeTx({ gasUsed: 210000 })); // 10x
      expect(result.detected).toBe(true);
      expect(result.type).toBe(SuspiciousActivityType.GAS_SPIKE);
      expect(result.severity).toBe(AlertSeverity.HIGH); // 10x => HIGH
      expect(result.metadata?.spikeMultiplier).toBeGreaterThanOrEqual(4);
    });

    it('does not flag a normal gas amount', () => {
      for (let i = 0; i < 9; i++) {
        service.analyze(makeTx({ gasUsed: 21000 }));
      }
      const result = service.analyze(makeTx({ gasUsed: 25000 })); // ~1.2x — normal
      if (result.detected) {
        expect(result.type).not.toBe(SuspiciousActivityType.GAS_SPIKE);
      }
    });
  });

  describe('Burst detection', () => {
    it('detects BURST_TRANSACTIONS when >= 5 tx occur within 10 seconds', () => {
      const now = Date.now();
      const txs = Array(6).fill(null).map((_, i) =>
        makeTx({ timestamp: new Date(now - i * 1000) }), // 1s apart within 10s
      );
      let lastResult: any;
      for (const tx of txs) {
        lastResult = service.analyze(tx);
      }
      expect(lastResult.detected).toBe(true);
      expect(lastResult.type).toBe(SuspiciousActivityType.BURST_TRANSACTIONS);
      expect(lastResult.metadata?.burstCount).toBeGreaterThanOrEqual(5);
    });

    it('does not flag transactions spread over time', () => {
      const now = Date.now();
      // Spread 10 transactions over 2 minutes — never > 5 in 10s
      const txs = Array(10).fill(null).map((_, i) =>
        makeTx({ timestamp: new Date(now - i * 15000) }),
      );
      let lastResult: any;
      for (const tx of txs) {
        lastResult = service.analyze(tx);
      }
      if (lastResult.detected) {
        expect(lastResult.type).not.toBe(SuspiciousActivityType.BURST_TRANSACTIONS);
      }
    });
  });
});
