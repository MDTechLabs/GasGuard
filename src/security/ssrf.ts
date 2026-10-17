import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import { isPrivateIP, createSafeAgent } from './dns';

export const METADATA_IP = '169.254.169.254';
export const METADATA_HOSTNAMES = new Set([
  'instance-data',
  'metadata.google.internal',
  'metadata.platform.internal',
  '169.254.169.254',
]);

export interface SsrfValidationOptions {
  allowList?: string[];
  allowedProtocols?: string[];
  allowPrivate?: boolean;
  skipDns?: boolean;
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string }>>;
}

export interface SsrfValidationResult {
  valid: boolean;
  reason?: string;
  resolvedIp?: string;
}

/**
 * Checks if a hostname or IP address targets cloud metadata services or internal loopback.
 */
export function isMetadataOrLoopback(target: string): boolean {
  const lower = target.toLowerCase().trim();
  if (METADATA_HOSTNAMES.has(lower)) return true;
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower === '0.0.0.0') {
    return true;
  }
  return false;
}

/**
 * Validates a target URL string against SSRF attack vectors.
 * Resolves DNS to ensure the destination does not point to a private, loopback, or metadata address.
 */
export async function validateUrlForSsrf(
  urlStr: string,
  options: SsrfValidationOptions = {},
): Promise<SsrfValidationResult> {
  const allowedProtocols = options.allowedProtocols ?? ['http:', 'https:'];
  let parsed: URL;

  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, reason: 'INVALID_URL' };
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    return {
      valid: false,
      reason: `DISALLOWED_PROTOCOL: ${parsed.protocol} is not permitted`,
    };
  }

  const hostname = parsed.hostname;

  if (isMetadataOrLoopback(hostname)) {
    return {
      valid: false,
      reason: `RESTRICTED_HOST: ${hostname} is blocked as a metadata or loopback address`,
    };
  }

  if (options.allowList && options.allowList.length > 0) {
    const isAllowed = options.allowList.some((allowed) => {
      const norm = allowed.trim().toLowerCase();
      return norm === hostname.toLowerCase() || hostname.toLowerCase().endsWith(`.${norm}`);
    });
    if (!isAllowed) {
      return { valid: false, reason: `HOST_NOT_IN_ALLOWLIST: ${hostname}` };
    }
  }

  // If private IPs are permitted, skip DNS validation
  if (options.allowPrivate) {
    return { valid: true };
  }

  // Check if hostname is an immediate literal IP
  if (isPrivateIP(hostname)) {
    return {
      valid: false,
      reason: `PRIVATE_IP_ADDRESS: ${hostname}`,
      resolvedIp: hostname,
    };
  }

  if (options.skipDns) {
    return { valid: true };
  }

  // Resolve DNS to verify underlying IP address
  try {
    const lookupFn = options.dnsLookup ?? ((h: string) => dns.promises.lookup(h, { all: true }));
    const addresses = await lookupFn(hostname);
    for (const addr of addresses) {
      if (isPrivateIP(addr.address)) {
        return {
          valid: false,
          reason: `DNS_RESOLVED_PRIVATE_IP: ${hostname} resolved to ${addr.address}`,
          resolvedIp: addr.address,
        };
      }
    }
    return { valid: true, resolvedIp: addresses[0]?.address };
  } catch (err: any) {
    return {
      valid: false,
      reason: `DNS_RESOLUTION_FAILED: ${err.message || String(err)}`,
    };
  }
}

/**
 * Legacy SSRF prevention helper maintained for backward compatibility.
 */
export function preventSsrf(url?: string, allowlist?: string[]): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (isMetadataOrLoopback(parsed.hostname) || isPrivateIP(parsed.hostname)) {
      return false;
    }
    if (allowlist && allowlist.length > 0) {
      return allowlist.includes(parsed.hostname);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns an HTTP or HTTPS Agent configured with anti-rebinding DNS validation.
 */
export function createSsrfSafeAgent(protocol: 'http' | 'https'): http.Agent | https.Agent {
  return createSafeAgent(protocol);
}