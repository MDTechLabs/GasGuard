
import { Inject, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class PriceFeedService {
    private readonly coingeckoApi = 'https://api.coingecko.com/api/v3/simple/price';

    constructor(
        private readonly httpService: HttpService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {}

    async getPrice(tokenId: string): Promise<number> {
        const cachedPrice = await this.cacheManager.get<number>(tokenId);
        if (cachedPrice) {
            return cachedPrice;
        }

        try {
            const response = await firstValueFrom(
                this.httpService.get(this.coingeckoApi, {
                    params: {
                        ids: tokenId,
                        vs_currencies: 'usd',
                    },
                }),
            );
            const price = response.data[tokenId].usd;
            await this.cacheManager.set(tokenId, price, 60000);
            return price;
        } catch (error) {
            console.error(`Error fetching price for ${tokenId}:`, error);
            return 0;
        }
    }
}