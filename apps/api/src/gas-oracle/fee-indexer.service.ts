
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PriceFeedService } from './price-feed.service';
import { NetworkConfigService } from './network-config.service';
import { ethers } from 'ethers';
import { SorobanRpc } from '@stellar/stellar-sdk';

@Injectable()
export class FeeIndexerService {
    private readonly logger = new Logger(FeeIndexerService.name);

    constructor(
        private readonly priceFeedService: PriceFeedService,
        private readonly networkConfigService: NetworkConfigService,
    ) {}

    @Cron('*/30 * * * * *')
    async handleCron() {
        this.logger.log('Fetching gas prices...');
        const supportedChains = this.networkConfigService.getSupportedChainIds();
        for (const chainId of supportedChains) {
            const gasPrice = await this.getGasPrice(chainId);
            this.logger.log(`[${chainId}] Gas price: ${gasPrice}`);
        }
    }

    async getGasPrice(chainId: string): Promise<number> {
        if (chainId.startsWith('soroban')) {
            return this.getSorobanGasPrice(chainId);
        } else {
            return this.getEvmGasPrice(chainId);
        }
    }

    async getEvmGasPrice(chainId: string): Promise<number> {
        try {
            const network = this.networkConfigService.getNetworkConfig(chainId);
            const provider = new ethers.JsonRpcProvider(network.rpcUrl);
            const feeData = await provider.getFeeData();
            const gasPrice = feeData.gasPrice;
            const nativeTokenPrice = await this.priceFeedService.getPrice(network.nativeToken);
            // Caclulate the cost of gas in USD
            const gasPriceInUsd = nativeTokenPrice * parseFloat(ethers.formatUnits(gasPrice, 'gwei'));
            return gasPriceInUsd;
        } catch (error) {
            this.logger.error(`Error fetching gas price for ${chainId}:`, error);
            return 0;
        }
    }

    async getSorobanGasPrice(chainId: string): Promise<number> {
        try {
            const network = this.networkConfigService.getNetworkConfig(chainId);
            const server = new SorobanRpc.Server(network.rpcUrl);
            const networkStatus = await server.getNetwork();
            const gasPrice = networkStatus.sorobanData.baseFee;
            const nativeTokenPrice = await this.priceFeedService.getPrice(network.nativeToken);
            // Caclulate the cost of gas in USD
            const gasPriceInUsd = nativeTokenPrice * parseFloat(gasPrice);
            return gasPriceInUsd;
        } catch (error) {
            this.logger.error(`Error fetching gas price for ${chainId}:`, error);
            return 0;
        }
    }
}