import { RpcProviderManager } from './rpc-provider-manager';
import { providers } from 'ethers';

describe('RpcProviderManager', () => {
  const configs = [
    { url: 'https://mock1', priority: 1 },
    { url: 'https://mock2', priority: 2 }
  ];
  let manager: RpcProviderManager;

  beforeEach(() => {
    manager = new RpcProviderManager('TestChain', configs);
  });

  it('should return the current provider', () => {
    const provider = manager.getCurrentProvider();
    expect(provider).toBeInstanceOf(providers.JsonRpcProvider);
    expect(provider.connection.url).toBe('https://mock1');
  });

  it('should failover to next healthy provider', () => {
    // Simulate unhealthy first provider
    const health = manager.getHealth();
    health[0].healthy = false;
    manager.failover();
    const provider = manager.getCurrentProvider();
    expect(provider.connection.url).toBe('https://mock2');
  });

  it('should cycle through providers on repeated failover', () => {
    manager.failover();
    expect(manager.getCurrentProvider().connection.url).toBe('https://mock2');
    manager.failover();
    expect(manager.getCurrentProvider().connection.url).toBe('https://mock1');
  });

  it('should return all provider URLs', () => {
    expect(manager.getProviderUrls()).toEqual(['https://mock1', 'https://mock2']);
  });
});
