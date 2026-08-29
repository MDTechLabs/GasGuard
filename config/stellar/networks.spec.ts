import { stellarNetworkManager, NETWORKS } from './index';

describe('StellarNetworkManager', () => {
  beforeEach(() => {
    // Reset to default network
    stellarNetworkManager.setNetwork('testnet');
  });

  it('should initialize with default testnet network', () => {
    expect(stellarNetworkManager.getCurrentNetworkName()).toBe('testnet');
    expect(stellarNetworkManager.getCurrentConfig()).toEqual(NETWORKS.testnet);
  });

  it('should allow switching to mainnet', () => {
    stellarNetworkManager.setNetwork('mainnet');
    expect(stellarNetworkManager.getCurrentNetworkName()).toBe('mainnet');
    expect(stellarNetworkManager.getCurrentConfig()).toEqual(NETWORKS.mainnet);
  });

  it('should allow switching to futurenet', () => {
    stellarNetworkManager.setNetwork('futurenet');
    expect(stellarNetworkManager.getCurrentNetworkName()).toBe('futurenet');
    expect(stellarNetworkManager.getCurrentConfig()).toEqual(NETWORKS.futurenet);
  });

  it('should throw error when switching to an invalid network', () => {
    expect(() => {
      stellarNetworkManager.setNetwork('invalid' as any);
    }).toThrow('Unsupported Stellar network: invalid');
  });

  it('should return configuration for a specific network name', () => {
    const mainnetConfig = stellarNetworkManager.getConfig('mainnet');
    expect(mainnetConfig.name).toBe('mainnet');
    expect(mainnetConfig.networkPassphrase).toContain('Public Global');
    expect(mainnetConfig.rpcUrl).toContain('mainnet');
  });
});
