import axios from 'axios';
import axiosRetry from 'axios-retry';
import { FailoverStrategy, RpcEndpoint } from './failover-strategy';
import { HealthCheckService } from '@monitoring/health-check';

export class RpcClient {
  private strategy: FailoverStrategy;
  private healthService: HealthCheckService;
  private healthyUrls: Set<string> = new Set();
  private endpoints: RpcEndpoint[];

  constructor(endpoints: RpcEndpoint[]) {
    this.endpoints = endpoints;
    this.strategy = new FailoverStrategy(endpoints);
    this.healthService = new HealthCheckService();
    this.endpoints.forEach(e => this.healthyUrls.add(e.url));
    
    // Initial health check
    this.checkHealth();
    // Periodically check health
    setInterval(() => this.checkHealth(), 30000);
  }

  private async checkHealth() {
    for (const endpoint of this.endpoints) {
      const health = await this.healthService.checkEndpoint(endpoint.url);
      if (health.isAlive) {
        this.healthyUrls.add(endpoint.url);
      } else {
        this.healthyUrls.delete(endpoint.url);
      }
    }
  }

  async call(method: string, params: any[]): Promise<any> {
    const endpoint = this.strategy.getBestEndpoint(this.healthyUrls);
    if (!endpoint) {
      throw new Error('No healthy RPC endpoints available');
    }

    const client = axios.create({
      baseURL: endpoint.url,
      timeout: 10000,
    });

    axiosRetry(client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.response?.status === 429;
      },
    });

    try {
      const response = await client.post('', {
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now(),
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      return response.data.result;
    } catch (error) {
      // If a specific endpoint fails, mark it as unhealthy temporarily
      this.healthyUrls.delete(endpoint.url);
      throw error;
    }
  }
}
