/**
 * Soroban Contract State Snapshot Exporter
 *
 * Captures and exports Soroban contract state snapshots by interacting with
 * the Soroban RPC to retrieve storage entries and contract metadata.
 */

import { Address, rpc, Keypair, xdr } from "@stellar/stellar-sdk";
import {
  ContractStateSnapshot,
  ContractMetadata,
  StorageEntry,
  SnapshotExportConfig,
  SnapshotExportResult,
  SnapshotValidationResult,
} from "./types";

/**
 * Exporter for Soroban contract state snapshots
 */
export class SorobanSnapshotExporter {
  private rpcUrl: string;
  private server: rpc.Server;
  private defaultConfig: SnapshotExportConfig;

  constructor(rpcUrl: string, config?: Partial<SnapshotExportConfig>) {
    this.rpcUrl = rpcUrl;
    this.server = new rpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith("http://"),
    });
    this.defaultConfig = {
      includeStorage: true,
      includeMetadata: true,
      ...config,
    };
  }

  /**
   * Export a complete contract state snapshot
   *
   * @param contractId - The contract address to snapshot
   * @param config - Export configuration options
   * @returns Promise resolving to export result
   */
  async exportSnapshot(
    contractId: string,
    config?: Partial<SnapshotExportConfig>,
  ): Promise<SnapshotExportResult> {
    const startTime = Date.now();
    const exportConfig = { ...this.defaultConfig, ...config };

    try {
      // Validate contract ID
      const contractAddress = new Address(contractId);

      // Get current ledger info
      const latestLedger = await this.server.getLatestLedger();

      // Build metadata
      const metadata: ContractMetadata = {
        contractId: contractAddress.toString(),
        networkPassphrase: await this.getNetworkPassphrase(),
        networkUrl: this.server.serverURL.toString(),
        ledgerSequence: latestLedger.sequence,
        timestamp: Date.now(),
      };

      // Get storage entries
      const storageEntries: StorageEntry[] = exportConfig.includeStorage
        ? await this.exportStorageEntries(contractId, exportConfig)
        : [];

      // Build snapshot
      const snapshot: ContractStateSnapshot = {
        snapshotId: this.generateSnapshotId(contractId, latestLedger.sequence),
        metadata,
        storageEntries,
        version: "1.0.0",
      };

      const duration = Date.now() - startTime;

      return {
        success: true,
        snapshot,
        entriesExported: storageEntries.length,
        durationMs: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        entriesExported: 0,
        durationMs: duration,
      };
    }
  }

  /**
   * Export storage entries from a contract
   *
   * @param contractId - The contract address
   * @param config - Export configuration
   * @returns Promise resolving to storage entries array
   */
  private async exportStorageEntries(
    contractId: string,
    config: SnapshotExportConfig,
  ): Promise<StorageEntry[]> {
    const entries: StorageEntry[] = [];
    const contractAddress = new Address(contractId);

    // Define storage keys to export
    // Note: In a real implementation, you would need to know the storage keys
    // or iterate through them if the contract provides an enumeration method
    const storageKeys = await this.discoverStorageKeys(contractId);

    for (const key of storageKeys) {
      try {
        // Filter by key pattern if specified
        if (config.keyPattern && !config.keyPattern.test(key.toString())) {
          continue;
        }

        // Get storage entry for each type
        const storageTypes: Array<"instance" | "persistent" | "temporary"> =
          config.storageTypes || ["instance", "persistent", "temporary"];

        for (const storageType of storageTypes) {
          const entry = await this.getStorageEntry(
            contractAddress,
            key,
            storageType,
          );

          if (entry) {
            // Check max entries limit
            if (config.maxEntries && entries.length >= config.maxEntries) {
              break;
            }

            entries.push(entry);
          }
        }
      } catch (error) {
        // Skip entries that can't be read
        console.warn(`Failed to read storage entry ${key}:`, error);
      }
    }

    return entries;
  }

  /**
   * Get a specific storage entry from the contract
   *
   * @param contractAddress - Contract address
   * @param key - Storage key
   * @param storageType - Type of storage
   * @returns Promise resolving to storage entry or null
   */
  private async getStorageEntry(
    contractAddress: Address,
    key: string,
    storageType: "instance" | "persistent" | "temporary",
  ): Promise<StorageEntry | null> {
    try {
      // Get ledger key for the storage entry
      const ledgerKey = this.buildLedgerKey(contractAddress, key, storageType);

      // Get ledger entry
      const response = await this.server.getLedgerEntries(ledgerKey as any);

      if (!response.entries || response.entries.length === 0) {
        return null;
      }

      const ledgerEntry = response.entries[0];

      // Parse TTL if available
      let ttlExpiration: number | undefined;
      if (ledgerEntry.liveUntilLedgerSeq) {
        ttlExpiration = Number(ledgerEntry.liveUntilLedgerSeq);
      }

      return {
        key,
        value: ledgerEntry.val ? ledgerEntry.val.toXDR("base64") : "",
        storageType,
        ttlExpiration,
        capturedAt: Date.now(),
      };
    } catch (error) {
      // Entry doesn't exist or can't be read
      return null;
    }
  }

  /**
   * Discover storage keys for a contract
   *
   * Note: This is a placeholder. In practice, you would need:
   * 1. Contract-specific knowledge of storage keys
   * 2. Or a contract method that enumerates keys
   * 3. Or to parse the contract's WASM to extract key patterns
   */
  private async discoverStorageKeys(contractId: string): Promise<string[]> {
    // Placeholder implementation
    // In a real scenario, you would need to know the storage keys or
    // have the contract provide a method to enumerate them

    // For now, return an empty array - this should be customized per contract
    console.warn(
      "Storage key discovery is not automatically available. " +
        "You need to provide storage keys specific to your contract.",
    );

    return [];
  }

  /**
   * Build a ledger key for a storage entry
   *
   * @param contractAddress - Contract address
   * @param key - Storage key
   * @param storageType - Type of storage
   * @returns Ledger key XDR
   */
  private buildLedgerKey(
    contractAddress: Address,
    key: string,
    storageType: "instance" | "persistent" | "temporary",
  ): string {
    // Map storage type to Soroban durability enum
    const durability =
      storageType === "instance"
        ? rpc.Durability.Persistent
        : storageType === "persistent"
          ? rpc.Durability.Persistent
          : rpc.Durability.Temporary;

    // Create the ledger key using XDR
    try {
      const ledgerKey = this.createLedgerKeyXDR(
        contractAddress,
        durability,
        key,
      );
      return ledgerKey;
    } catch (error) {
      throw new Error(
        `Failed to build ledger key: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Create a ledger key XDR for a storage entry
   */
  private createLedgerKeyXDR(
    contractAddress: Address,
    durability: rpc.Durability,
    key: string,
  ): string {
    // Create contract data ledger key
    const contractData = new xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: this.parseStorageKey(key),
      durability:
        durability === rpc.Durability.Temporary
          ? xdr.ContractDataDurability.temporary()
          : xdr.ContractDataDurability.persistent(),
    });

    const ledgerKey = xdr.LedgerKey.contractData(contractData);
    return ledgerKey.toXDR("base64");
  }

  /**
   * Parse storage key string into SCVal
   */
  private parseStorageKey(key: string): xdr.ScVal {
    try {
      // Try as symbol
      return xdr.ScVal.scvSymbol(key);
    } catch {
      // Fallback to string
      return xdr.ScVal.scvString(key);
    }
  }

  /**
   * Get network passphrase
   */
  private async getNetworkPassphrase(): Promise<string> {
    try {
      // Get network info from the server
      const networkInfo = await this.server.getNetwork();
      return networkInfo.passphrase;
    } catch (error) {
      // Fallback to testnet default if unable to fetch
      console.warn("Failed to fetch network passphrase, using default:", error);
      return "Test SDF Network ; September 2015"; // Testnet default
    }
  }

  /**
   * Generate a unique snapshot ID
   */
  private generateSnapshotId(
    contractId: string,
    ledgerSequence: number,
  ): string {
    const timestamp = Date.now();
    return `snapshot_${contractId}_${ledgerSequence}_${timestamp}`;
  }

  /**
   * Validate a snapshot before export or restoration
   *
   * @param snapshot - Snapshot to validate
   * @returns Validation result
   */
  validateSnapshot(snapshot: ContractStateSnapshot): SnapshotValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate metadata
    if (!snapshot.metadata.contractId) {
      errors.push("Missing contract ID in metadata");
    }

    if (!snapshot.metadata.networkPassphrase) {
      errors.push("Missing network passphrase in metadata");
    }

    if (
      !snapshot.metadata.ledgerSequence ||
      snapshot.metadata.ledgerSequence < 0
    ) {
      errors.push("Invalid ledger sequence in metadata");
    }

    // Validate storage entries
    if (!snapshot.storageEntries || !Array.isArray(snapshot.storageEntries)) {
      errors.push("Storage entries must be an array");
    } else {
      snapshot.storageEntries.forEach((entry, index) => {
        if (!entry.key) {
          errors.push(`Storage entry ${index} missing key`);
        }
        if (!entry.value && entry.value !== "") {
          errors.push(`Storage entry ${index} missing value`);
        }
        if (
          !entry.storageType ||
          !["instance", "persistent", "temporary"].includes(entry.storageType)
        ) {
          errors.push(`Storage entry ${index} has invalid storage type`);
        }
      });
    }

    // Warnings
    if (snapshot.storageEntries.length === 0) {
      warnings.push("Snapshot contains no storage entries");
    }

    if (snapshot.storageEntries.length > 1000) {
      warnings.push("Snapshot contains a large number of entries (>1000)");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      snapshot,
    };
  }

  /**
   * Export snapshot to JSON string
   *
   * @param snapshot - Snapshot to export
   * @returns JSON string
   */
  exportToJson(snapshot: ContractStateSnapshot): string {
    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Import snapshot from JSON string
   *
   * @param json - JSON string
   * @returns Parsed snapshot
   */
  importFromJson(json: string): ContractStateSnapshot {
    return JSON.parse(json);
  }
}
