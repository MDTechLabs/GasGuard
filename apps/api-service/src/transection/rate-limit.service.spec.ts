import { HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(() => {
    service = new RateLimitService({ maxPerMinute: 3, maxPerHour: 10 });
  });

  describe('check()', () => {
    it('allows transactions below per-minute limit', () => {
      service.record('M1');
      service.record('M1');
      const status = service.check('M1');
      expect(status.allowed).toBe(true);
      expect(status.transactionsLastMinute).toBe(2);
    });

    it('throws 429 when per-minute limit is reached', () => {
      service.record('M1');
      service.record('M1');
      service.record('M1');
      expect(() => service.check('M1')).toThrow(HttpException);
      try {
        service.check('M1');
      } catch (e: any) {
        expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(e.getResponse().retryAfterSeconds).toBeGreaterThan(0);
      }
    });

    it('throws 429 when per-hour limit is reached', () => {
      // Fill the hour bucket without triggering per-minute limit.
      // Use a fresh service with maxPerMinute=100, maxPerHour=5
      const svc = new RateLimitService({ maxPerMinute: 100, maxPerHour: 5 });
      for (let i = 0; i < 5; i++) svc.record('M2');
      expect(() => svc.check('M2')).toThrow(HttpException);
    });

    it('does not bleed limits between merchants', () => {
      service.record('M1');
      service.record('M1');
      service.record('M1');
      // M2 should still be fine
      expect(() => service.check('M2')).not.toThrow();
    });
  });

  describe('getStatus()', () => {
    it('returns current counts without throwing', () => {
      service.record('M3');
      service.record('M3');
      const status = service.getStatus('M3');
      expect(status.transactionsLastMinute).toBe(2);
      expect(status.transactionsLastHour).toBe(2);
      expect(status.limitPerMinute).toBe(3);
      expect(status.limitPerHour).toBe(10);
    });

    it('returns allowed=false when limits are reached, without throwing', () => {
      for (let i = 0; i < 3; i++) service.record('M4');
      const status = service.getStatus('M4');
      expect(status.allowed).toBe(false);
    });
  });

  describe('record()', () => {
    it('increments counts', () => {
      service.record('M5');
      service.record('M5');
      service.record('M5');
      const status = service.getStatus('M5');
      expect(status.transactionsLastMinute).toBe(3);
    });
  });
});
