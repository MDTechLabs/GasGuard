import axios from 'axios';

export interface EndpointHealth {
  url: string;
  isAlive: boolean;
  latency: number;
  lastChecked: Date;
}

export class HealthCheckService {
  async checkEndpoint(url: string): Promise<EndpointHealth> {
    const start = Date.now();
    try {
      // Basic health check: try to get a simple response or just a TCP connection check
      // For RPCs, we might want to call a simple method like eth_blockNumber
      await axios.post(url, {
        jsonrpc: '2.0',
        method: 'eth_blockNumber', // Default to EVM, but can be customized
        params: [],
        id: 1,
      }, { timeout: 5000 });

      return {
        url,
        isAlive: true,
        latency: Date.now() - start,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        url,
        isAlive: false,
        latency: -1,
        lastChecked: new Date(),
      };
    }
  }
}
