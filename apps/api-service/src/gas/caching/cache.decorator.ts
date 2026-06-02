/**
 * Cache Decorator
 * Decorator for caching method results
 */
import { CacheService } from "./cache.service";
import { cacheKeys, getTTL } from "./cache-config";

/**
 * Decorator to cache method results
 * @param queryType - Type of query (e.g., 'baseFee', 'priorityFee')
 * @param keyBuilder - Function to build cache key from method args
 */
export function Cacheable(
  queryType: string,
  keyBuilder?: (args: any[]) => string,
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      // Get CacheService from DI context (assumes it's available)
      const cacheService: CacheService = this.cacheService || this.cache;
      if (!cacheService) {
        return originalMethod.apply(this, args);
      }

      // Build cache key
      const key = keyBuilder
        ? keyBuilder(args)
        : `${propertyKey}:${JSON.stringify(args)}`;

      // Get or fetch
      return cacheService.getOrFetch(
        key,
        queryType,
        () => originalMethod.apply(this, args),
        args[0]?.chainId,
      );
    };

    return descriptor;
  };
}

/**
 * Decorator to invalidate cache
 * @param keyPatterns - Patterns to invalidate (can use chainId from args)
 */
export function InvalidateCache(
  keyPatterns: (args: any[]) => string | string[],
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);

      // Invalidate cache after successful execution
      const cacheService: CacheService = this.cacheService || this.cache;
      if (cacheService) {
        const patterns = keyPatterns(args);
        const patternArray = Array.isArray(patterns) ? patterns : [patterns];

        for (const pattern of patternArray) {
          await cacheService.invalidatePattern(pattern);
        }
      }

      return result;
    };

    return descriptor;
  };
}

/**
 * Helper to build cache keys for common queries
 */
export const cacheKeyBuilders = {
  baseFee: (args: any[]) => cacheKeys.baseFee(args[0]),
  priorityFee: (args: any[]) => cacheKeys.priorityFee(args[0]),
  gasEstimate: (args: any[]) => cacheKeys.gasEstimate(args[0], args[1]),
  chainMetrics: (args: any[]) => cacheKeys.chainMetrics(args[0]),
};
