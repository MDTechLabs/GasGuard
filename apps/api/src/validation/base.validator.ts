import { Request, Response, NextFunction } from "express";

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  constraint: string;
}

export class BaseValidator {
  protected static readonly ETHEREUM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
  protected static readonly STELLAR_ADDRESS_REGEX = /^[GC][A-Z0-9]{55}$/;
  protected static readonly SOLANA_ADDRESS_REGEX =
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  protected static readonly MAX_GAS_LIMIT = 30000000; // 30M gas
  protected static readonly MIN_GAS_LIMIT = 21000; // Base transaction gas
  protected static readonly MAX_GAS_PRICE = 1000000000000; // 1000 gwei in wei
  protected static readonly MIN_GAS_PRICE = 1000000000; // 1 gwei in wei

  protected static readonly SUPPORTED_CHAINS = [
    1, 56, 137, 42161, 10, 43114, 250,
  ]; // ETH, BSC, Polygon, Arbitrum, Optimism, Avalanche, Fantom

  /**
   * Validates an Ethereum address format
   */
  static isValidEthereumAddress(address: string): boolean {
    return this.ETHEREUM_ADDRESS_REGEX.test(address);
  }

  /**
   * Validates a Stellar address format
   */
  static isValidStellarAddress(address: string): boolean {
    return this.STELLAR_ADDRESS_REGEX.test(address);
  }

  /**
   * Validates a Solana address format
   */
  static isValidSolanaAddress(address: string): boolean {
    return this.SOLANA_ADDRESS_REGEX.test(address);
  }

  /**
   * Validates a blockchain address based on chain
   */
  static isValidAddress(address: string, chainId?: number): boolean {
    if (!address || typeof address !== "string") {
      return false;
    }

    // For Stellar/Soroban
    if (chainId === 0 || !chainId) {
      // Assuming 0 or undefined for Stellar
      return this.isValidStellarAddress(address);
    }

    // For EVM chains
    if (this.SUPPORTED_CHAINS.includes(chainId)) {
      return this.isValidEthereumAddress(address);
    }

    // Default to Ethereum format for unknown chains
    return this.isValidEthereumAddress(address);
  }

  /**
   * Validates a gas limit value
   */
  static isValidGasLimit(gasLimit: string | number): boolean {
    const limit =
      typeof gasLimit === "string" ? parseInt(gasLimit, 10) : gasLimit;
    return (
      !isNaN(limit) &&
      limit >= this.MIN_GAS_LIMIT &&
      limit <= this.MAX_GAS_LIMIT
    );
  }

  /**
   * Validates a gas price value (in wei)
   */
  static isValidGasPrice(gasPrice: string | number): boolean {
    const price =
      typeof gasPrice === "string" ? parseInt(gasPrice, 10) : gasPrice;
    return (
      !isNaN(price) &&
      price >= this.MIN_GAS_PRICE &&
      price <= this.MAX_GAS_PRICE
    );
  }

  /**
   * Validates a chain ID
   */
  static isValidChainId(chainId: number): boolean {
    return this.SUPPORTED_CHAINS.includes(chainId);
  }

  /**
   * Validates a transaction type
   */
  static isValidTransactionType(txType: string): boolean {
    return ["transfer", "contract-call", "swap"].includes(txType);
  }

  /**
   * Validates a URL format
   */
  static isValidUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return ["http:", "https:", "git:"].includes(parsedUrl.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Validates a positive number
   */
  static isValidPositiveNumber(value: string | number): boolean {
    const num = typeof value === "string" ? parseFloat(value) : value;
    return !isNaN(num) && num > 0;
  }

  /**
   * Sends a validation error response
   */
  protected static sendValidationError(
    res: Response,
    errors: ValidationError[],
    requestId?: string,
  ): void {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        timestamp: new Date().toISOString(),
        requestId: requestId || "unknown",
      },
      validationErrors: errors,
    });
  }

  /**
   * Sends a server error response
   */
  protected static sendServerError(
    res: Response,
    error: any,
    requestId?: string,
  ): void {
    res.status(500).json({
      error: {
        code: "VALIDATION_EXCEPTION",
        message: "An error occurred during validation",
        timestamp: new Date().toISOString(),
        requestId: requestId || "unknown",
      },
    });
  }
}
