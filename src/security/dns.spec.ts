import { isPrivateIP, createSafeAgent } from './dns';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';

jest.mock('dns');

describe('DNS Security Module', () => {
  describe('isPrivateIP', () => {
    it('should identify IPv4 loopback as private', () => {
      expect(isPrivateIP('127.0.0.1')).toBe(true);
      expect(isPrivateIP('127.123.0.1')).toBe(true);
    });

    it('should identify IPv4 zero address as private', () => {
      expect(isPrivateIP('0.0.0.0')).toBe(true);
    });

    it('should identify private IPv4 ranges', () => {
      expect(isPrivateIP('10.0.0.1')).toBe(true);
      expect(isPrivateIP('192.168.1.1')).toBe(true);
      expect(isPrivateIP('172.16.0.1')).toBe(true);
      expect(isPrivateIP('172.31.255.255')).toBe(true);
    });

    it('should identify carrier-grade NAT as private', () => {
      expect(isPrivateIP('100.64.0.1')).toBe(true);
      expect(isPrivateIP('100.127.255.255')).toBe(true);
    });

    it('should identify link-local IPv4 as private', () => {
      expect(isPrivateIP('169.254.169.254')).toBe(true);
    });

    it('should identify IPv6 loopback as private', () => {
      expect(isPrivateIP('::1')).toBe(true);
      expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
    });

    it('should identify private IPv6 ranges', () => {
      expect(isPrivateIP('fc00::1')).toBe(true);
      expect(isPrivateIP('fd00::1')).toBe(true);
      expect(isPrivateIP('fe80::1')).toBe(true);
    });

    it('should allow public IP addresses', () => {
      expect(isPrivateIP('8.8.8.8')).toBe(false);
      expect(isPrivateIP('1.1.1.1')).toBe(false);
      expect(isPrivateIP('172.15.255.255')).toBe(false); // Just outside private range
      expect(isPrivateIP('172.32.0.0')).toBe(false); // Just outside private range
      expect(isPrivateIP('2606:4700:4700::1111')).toBe(false);
    });
  });

  describe('createSafeAgent', () => {
    let mockLookup: jest.Mock;

    beforeEach(() => {
      mockLookup = dns.lookup as unknown as jest.Mock;
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    it('should return an http.Agent when protocol is http', () => {
      const agent = createSafeAgent('http');
      expect(agent).toBeInstanceOf(http.Agent);
    });

    it('should return an https.Agent when protocol is https', () => {
      const agent = createSafeAgent('https');
      expect(agent).toBeInstanceOf(https.Agent);
    });

    it('should allow DNS lookup for public IPs', (done) => {
      mockLookup.mockImplementation((hostname, options, callback) => {
        callback(null, '8.8.8.8', 4);
      });

      const agent = createSafeAgent('http') as any;
      agent.options.lookup('example.com', {}, (err: any, address: string, family: number) => {
        expect(err).toBeNull();
        expect(address).toBe('8.8.8.8');
        done();
      });
    });

    it('should reject DNS lookup for private IPs', (done) => {
      mockLookup.mockImplementation((hostname, options, callback) => {
        callback(null, '127.0.0.1', 4);
      });

      const agent = createSafeAgent('http') as any;
      agent.options.lookup('internal.example.com', {}, (err: any) => {
        expect(err).toBeDefined();
        expect(err.code).toBe('EDNSREBIND');
        expect(err.message).toContain('DNS rebinding protection triggered');
        done();
      });
    });

    it('should pass through DNS lookup errors', (done) => {
      const dnsError = new Error('ENOTFOUND');
      mockLookup.mockImplementation((hostname, options, callback) => {
        callback(dnsError, null, null);
      });

      const agent = createSafeAgent('http') as any;
      agent.options.lookup('nonexistent.example.com', {}, (err: any) => {
        expect(err).toBe(dnsError);
        done();
      });
    });
  });
});
