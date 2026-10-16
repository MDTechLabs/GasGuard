import {
  isMetadataOrLoopback,
  validateUrlForSsrf,
  preventSsrf,
  createSsrfSafeAgent,
} from './ssrf';

describe('SSRF Runtime Security Module', () => {
  describe('isMetadataOrLoopback', () => {
    it('identifies cloud metadata hostnames', () => {
      expect(isMetadataOrLoopback('169.254.169.254')).toBe(true);
      expect(isMetadataOrLoopback('metadata.google.internal')).toBe(true);
      expect(isMetadataOrLoopback('instance-data')).toBe(true);
    });

    it('identifies loopback addresses', () => {
      expect(isMetadataOrLoopback('localhost')).toBe(true);
      expect(isMetadataOrLoopback('127.0.0.1')).toBe(true);
      expect(isMetadataOrLoopback('::1')).toBe(true);
      expect(isMetadataOrLoopback('0.0.0.0')).toBe(true);
    });

    it('allows external domains', () => {
      expect(isMetadataOrLoopback('api.stellar.org')).toBe(false);
      expect(isMetadataOrLoopback('github.com')).toBe(false);
    });
  });

  describe('validateUrlForSsrf', () => {
    it('blocks private IP literals', async () => {
      const res = await validateUrlForSsrf('http://192.168.1.100/admin');
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('PRIVATE_IP_ADDRESS');
    });

    it('blocks metadata URLs', async () => {
      const res = await validateUrlForSsrf('http://169.254.169.254/latest/meta-data/');
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('RESTRICTED_HOST');
    });

    it('blocks non-HTTP protocols', async () => {
      const res = await validateUrlForSsrf('file:///etc/passwd');
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('DISALLOWED_PROTOCOL');
    });

    it('enforces allowlist when specified', async () => {
      const allowList = ['api.example.com'];
      const denied = await validateUrlForSsrf('https://evil.com/webhook', { allowList, skipDns: true });
      expect(denied.valid).toBe(false);
      expect(denied.reason).toContain('HOST_NOT_IN_ALLOWLIST');

      const allowed = await validateUrlForSsrf('https://api.example.com/data', { allowList, skipDns: true });
      expect(allowed.valid).toBe(true);
    });
  });

  describe('preventSsrf legacy helper', () => {
    it('blocks localhost and private IPs', () => {
      expect(preventSsrf('http://localhost:8080')).toBe(false);
      expect(preventSsrf('http://10.0.0.1/status')).toBe(false);
      expect(preventSsrf('https://stellar.org')).toBe(true);
    });

    it('handles empty or malformed inputs', () => {
      expect(preventSsrf('')).toBe(false);
      expect(preventSsrf('invalid-url')).toBe(false);
    });
  });

  describe('createSsrfSafeAgent', () => {
    it('returns an agent instance with lookup protection', () => {
      const agent = createSsrfSafeAgent('https');
      expect(agent).toBeDefined();
    });
  });
});
