/**
 * Stellar Wallet Integration Module
 * 
 * Provides integration with Stellar wallets, specifically Freighter wallet
 * for transaction signing and contract interaction flows.
 */

export interface StellarWallet {
  isConnected: boolean;
  publicKey: string | null;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  signTransaction(xdr: string, network: string): Promise<string>;
  signAuthEntry(entry: string): Promise<string>;
}

export interface FreighterWalletConfig {
  appName?: string;
  network?: 'testnet' | 'mainnet' | 'futurenet';
}

/**
 * Freighter wallet integration
 * 
 * Implements the StellarWallet interface for Freighter browser extension
 */
export class FreighterWallet implements StellarWallet {
  private config: FreighterWalletConfig;
  private _isConnected: boolean = false;
  private _publicKey: string | null = null;

  constructor(config: FreighterWalletConfig = {}) {
    this.config = {
      appName: config.appName || 'GasGuard',
      network: config.network || 'testnet',
      ...config
    };
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get publicKey(): string | null {
    return this._publicKey;
  }

  /**
   * Connect to Freighter wallet
   * @returns The public key of the connected wallet
   */
  async connect(): Promise<string> {
    try {
      // Check if Freighter is installed
      if (!this.isFreighterAvailable()) {
        throw new Error('Freighter wallet is not installed');
      }

      // Request access to the wallet
      const publicKey = await this.getFreighterPublicKey();
      
      this._publicKey = publicKey;
      this._isConnected = true;

      return publicKey;
    } catch (error) {
      this._isConnected = false;
      this._publicKey = null;
      throw new Error(`Failed to connect to Freighter: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Disconnect from the wallet
   */
  async disconnect(): Promise<void> {
    this._isConnected = false;
    this._publicKey = null;
  }

  /**
   * Sign a Stellar transaction
   * @param xdr - The transaction XDR string
   * @param network - The network to sign for
   * @returns The signed transaction XDR
   */
  async signTransaction(xdr: string, network: string): Promise<string> {
    if (!this._isConnected || !this._publicKey) {
      throw new Error('Wallet is not connected');
    }

    try {
      const signedXDR = await this.freighterSignTransaction(xdr, network);
      return signedXDR;
    } catch (error) {
      throw new Error(`Failed to sign transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Sign a Soroban auth entry
   * @param entry - The auth entry XDR string
   * @returns The signed auth entry XDR
   */
  async signAuthEntry(entry: string): Promise<string> {
    if (!this._isConnected || !this._publicKey) {
      throw new Error('Wallet is not connected');
    }

    try {
      const signedEntry = await this.freighterSignAuthEntry(entry);
      return signedEntry;
    } catch (error) {
      throw new Error(`Failed to sign auth entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if Freighter is available in the browser
   */
  private isFreighterAvailable(): boolean {
    return typeof window !== 'undefined' && 
           'freighterApi' in window;
  }

  /**
   * Get public key from Freighter
   */
  private async getFreighterPublicKey(): Promise<string> {
    const freighter = (window as any).freighterApi;
    const publicKey = await freighter.getPublicKey();
    
    if (!publicKey) {
      throw new Error('No public key returned from Freighter');
    }

    return publicKey;
  }

  /**
   * Sign transaction using Freighter
   */
  private async freighterSignTransaction(xdr: string, network: string): Promise<string> {
    const freighter = (window as any).freighterApi;
    const signedXDR = await freighter.signXDR(xdr, {
      network: this.config.network || network,
      networkPassphrase: this.getNetworkPassphrase(this.config.network || network)
    });
    
    return signedXDR;
  }

  /**
   * Sign auth entry using Freighter
   */
  private async freighterSignAuthEntry(entry: string): Promise<string> {
    const freighter = (window as any).freighterApi;
    const signedEntry = await freighter.signAuthEntry(entry);
    
    return signedEntry;
  }

  /**
   * Get network passphrase for the given network
   */
  private getNetworkPassphrase(network: string): string {
    switch (network) {
      case 'mainnet':
        return 'Public Global Stellar Network ; September 2015';
      case 'testnet':
        return 'Test SDF Network ; September 2015';
      case 'futurenet':
        return 'Test SDF Future Network ; October 2022';
      default:
        return 'Test SDF Network ; September 2015';
    }
  }
}

/**
 * Wallet manager for Stellar wallets
 */
export class StellarWalletManager {
  private currentWallet: StellarWallet | null = null;

  /**
   * Initialize a wallet connection
   */
  async connectWallet(walletType: 'freighter' = 'freighter', config?: FreighterWalletConfig): Promise<StellarWallet> {
    switch (walletType) {
      case 'freighter':
        this.currentWallet = new FreighterWallet(config);
        break;
      default:
        throw new Error(`Unsupported wallet type: ${walletType}`);
    }

    await this.currentWallet.connect();
    return this.currentWallet;
  }

  /**
   * Get the currently connected wallet
   */
  getCurrentWallet(): StellarWallet | null {
    return this.currentWallet;
  }

  /**
   * Disconnect the current wallet
   */
  async disconnect(): Promise<void> {
    if (this.currentWallet) {
      await this.currentWallet.disconnect();
      this.currentWallet = null;
    }
  }

  /**
   * Check if a wallet is connected
   */
  isConnected(): boolean {
    return this.currentWallet?.isConnected || false;
  }
}

// Export singleton instance
export const stellarWalletManager = new StellarWalletManager();
