import { StellarNetworkConfig, NETWORKS } from './networks';

export * from './networks';

export class StellarNetworkManager {
  private currentNetwork: 'testnet' | 'futurenet' | 'mainnet';

  constructor() {
    // Default to environment variable STELLAR_NETWORK, or fallback to 'testnet'
    const envNetwork = process.env.STELLAR_NETWORK || 'testnet';
    if (this.isValidNetwork(envNetwork)) {
      this.currentNetwork = envNetwork as 'testnet' | 'futurenet' | 'mainnet';
    } else {
      this.currentNetwork = 'testnet';
    }
  }

  /**
   * Set/switch the active network environment
   */
  setNetwork(network: 'testnet' | 'futurenet' | 'mainnet'): void {
    if (!this.isValidNetwork(network)) {
      throw new Error(`Unsupported Stellar network: ${network}`);
    }
    this.currentNetwork = network;
  }

  /**
   * Get the active network name
   */
  getCurrentNetworkName(): 'testnet' | 'futurenet' | 'mainnet' {
    return this.currentNetwork;
  }

  /**
   * Get configuration for the active network environment
   */
  getCurrentConfig(): StellarNetworkConfig {
    return NETWORKS[this.currentNetwork];
  }

  /**
   * Get configuration for a specific network environment
   */
  getConfig(network: 'testnet' | 'futurenet' | 'mainnet'): StellarNetworkConfig {
    if (!this.isValidNetwork(network)) {
      throw new Error(`Unsupported Stellar network: ${network}`);
    }
    return NETWORKS[network];
  }

  /**
   * Check if network name is valid
   */
  private isValidNetwork(network: string): boolean {
    return ['testnet', 'futurenet', 'mainnet'].includes(network);
  }
}

// Export a singleton instance
export const stellarNetworkManager = new StellarNetworkManager();
