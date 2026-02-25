import { providers } from 'ethers';

export interface RpcProviderConfig {
  url: string;
  priority: number; // Lower is higher priority
  name?: string;
  apiKey?: string;
}

export interface RpcProviderHealth {
  url: string;
  healthy: boolean;
  lastChecked: number;
  responseTime: number;
  errorCount: number;
  successCount: number;
}

export class RpcProviderManager {
  private providers: RpcProviderConfig[] = [];
  private health: Map<string, RpcProviderHealth> = new Map();
  private currentProviderIndex: number = 0;
  private chainName: string;

  constructor(chainName: string, configs: RpcProviderConfig[]) {
    this.chainName = chainName;
    this.providers = configs.sort((a, b) => a.priority - b.priority);
    this.providers.forEach(cfg => {
      this.health.set(cfg.url, {
        url: cfg.url,
        healthy: true,
        lastChecked: 0,
        responseTime: 0,
        errorCount: 0,
        successCount: 0,
      });
    });
  }

  public getCurrentProvider(): providers.JsonRpcProvider {
    const cfg = this.providers[this.currentProviderIndex];
    return new providers.JsonRpcProvider(cfg.url);
  }

  public async checkHealth(timeoutMs = 2000): Promise<void> {
    for (const [i, cfg] of this.providers.entries()) {
      const provider = new providers.JsonRpcProvider(cfg.url);
      const start = Date.now();
      let healthy = false;
      try {
        await Promise.race([
          provider.getBlockNumber(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
        ]);
        healthy = true;
      } catch (e) {
        healthy = false;
      }
      const health = this.health.get(cfg.url)!;
      health.healthy = healthy;
      health.lastChecked = Date.now();
      health.responseTime = healthy ? Date.now() - start : timeoutMs;
      if (healthy) health.successCount++;
      else health.errorCount++;
      this.health.set(cfg.url, health);
    }
  }

  public failover(): boolean {
    const prevIndex = this.currentProviderIndex;
    for (let i = 0; i < this.providers.length; i++) {
      const idx = (this.currentProviderIndex + i + 1) % this.providers.length;
      const health = this.health.get(this.providers[idx].url);
      if (health && health.healthy) {
        this.currentProviderIndex = idx;
        return true;
      }
    }
    return false;
  }

  public getHealth(): RpcProviderHealth[] {
    return Array.from(this.health.values());
  }

  public getProviderUrls(): string[] {
    return this.providers.map(p => p.url);
  }
}
