import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';

/**
 * Checks if an IP address is a private/internal IP.
 * Protects against basic SSRF and DNS rebinding to internal network assets.
 */
export function isPrivateIP(ip: string): boolean {
  // IPv4 loopback
  if (ip.startsWith('127.')) return true;
  if (ip === '0.0.0.0') return true;

  // IPv4 private ranges
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  
  if (ip.startsWith('172.')) {
    const secondOctet = parseInt(ip.split('.')[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }
  
  // Carrier-grade NAT
  if (ip.startsWith('100.')) {
    const secondOctet = parseInt(ip.split('.')[1], 10);
    if (secondOctet >= 64 && secondOctet <= 127) {
      return true;
    }
  }

  // IPv6 loopback and private
  const lowerIp = ip.toLowerCase();
  if (lowerIp === '::1') return true;
  if (lowerIp.startsWith('fc00:') || lowerIp.startsWith('fd00:')) return true;
  if (lowerIp.startsWith('fe80:')) return true;
  if (lowerIp.startsWith('::ffff:127.')) return true;
  
  // Link-local IPv4
  if (ip.startsWith('169.254.')) return true;

  return false;
}

/**
 * Creates an HTTP/HTTPS agent that protects against DNS rebinding.
 * It overrides the dns.lookup function to ensure the IP doesn't change
 * to a private/internal IP maliciously, and connects directly to the resolved IP.
 */
export function createSafeAgent(protocol: 'http' | 'https'): http.Agent | https.Agent {
  const lookup = (
    hostname: string,
    options: dns.LookupOneOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
  ) => {
    dns.lookup(hostname, options, (err, address, family) => {
      if (err) {
        return callback(err, address, family);
      }

      if (isPrivateIP(address)) {
        const error = new Error(`DNS rebinding protection triggered: resolved IP ${address} for hostname ${hostname} is not allowed.`);
        (error as any).code = 'EDNSREBIND';
        return callback(error as NodeJS.ErrnoException, address, family);
      }

      callback(null, address, family);
    });
  };

  const agentOptions = { lookup };

  return protocol === 'https' ? new https.Agent(agentOptions) : new http.Agent(agentOptions);
}
