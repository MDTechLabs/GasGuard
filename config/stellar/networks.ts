export interface StellarNetworkConfig {
  name: 'testnet' | 'futurenet' | 'mainnet';
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  explorerUrl: string;
  friendbotUrl?: string;
}

export const NETWORKS: Record<'testnet' | 'futurenet' | 'mainnet', StellarNetworkConfig> = {
  testnet: {
    name: 'testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: process.env.STELLAR_TESTNET_RPC_URL || process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
    horizonUrl: process.env.STELLAR_TESTNET_HORIZON_URL || process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    friendbotUrl: 'https://friendbot.stellar.org',
  },
  futurenet: {
    name: 'futurenet',
    networkPassphrase: 'Test SDF Future Network ; October 2022',
    rpcUrl: process.env.STELLAR_FUTURENET_RPC_URL || process.env.STELLAR_RPC_URL || 'https://rpc-futurenet.stellar.org',
    horizonUrl: process.env.STELLAR_FUTURENET_HORIZON_URL || process.env.STELLAR_HORIZON_URL || 'https://horizon-futurenet.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/futurenet',
    friendbotUrl: 'https://friendbot-futurenet.stellar.org',
  },
  mainnet: {
    name: 'mainnet',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: process.env.STELLAR_MAINNET_RPC_URL || process.env.STELLAR_RPC_URL || 'https://mainnet.stellar.org:443',
    horizonUrl: process.env.STELLAR_MAINNET_HORIZON_URL || process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/public',
  },
};
