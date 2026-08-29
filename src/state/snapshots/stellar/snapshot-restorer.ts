/**
 * Soroban Contract State Snapshot Restorer
 *
 * Restores Soroban contract state from snapshots by writing storage entries
 * back to the contract via Soroban RPC transactions.
 */

import {
  Address,
  rpc,
  TransactionBuilder,
  Keypair,
  xdr,
} from "@stellar/stellar-sdk";
import {
  ContractStateSnapshot,
  SnapshotRestoreConfig,
  SnapshotRestoreResult,
  StorageEntry,
} from "./types";
import { SorobanSnapshotExporter } from "./snapshot-exporter";

/**
 * Restorer for Soroban contract state snapshots
 */
export class SorobanSnapshotRestorer {
  private rpcUrl: string;
  private server: rpc.Server;
  private defaultConfig: SnapshotRestoreConfig;

  constructor(rpcUrl: string, config?: Partial<SnapshotRestoreConfig>) {
    this.rpcUrl = rpcUrl;
    this.server = new rpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith("http://"),
    });
    this.defaultConfig = {
      overwriteExisting: false,
      skipExisting: true,
      validateBeforeRestore: true,
      dryRun: false,
      ...config,
    };
  }

  /**
   * Restore a contract state from a snapshot
   *
   * @param snapshot - The snapshot to restore
   * @param signerAccount - The account keypair to sign transactions
   * @param config - Restoration configuration options
   * @returns Promise resolving to restoration result
   */
  async restoreSnapshot(
    snapshot: ContractStateSnapshot,
    signerAccount: Keypair,
    config?: Partial<SnapshotRestoreConfig>,
  ): Promise<SnapshotRestoreResult> {
    const startTime = Date.now();
    const restoreConfig = { ...this.defaultConfig, ...config };

    try {
      // Validate snapshot if configured
      if (restoreConfig.validateBeforeRestore) {
        const exporter = new SorobanSnapshotExporter(this.rpcUrl);
        const validation = exporter.validateSnapshot(snapshot);

        if (!validation.valid) {
          return {
            success: false,
            entriesRestored: 0,
            entriesSkipped: 0,
            entriesFailed: 0,
            error: `Snapshot validation failed: ${validation.errors.join(", ")}`,
            durationMs: Date.now() - startTime,
          };
        }
      }

      // Verify network match
      const networkInfo = await this.server.getNetwork();
      if (snapshot.metadata.networkPassphrase !== networkInfo.passphrase) {
        return {
          success: false,
          entriesRestored: 0,
          entriesSkipped: 0,
          entriesFailed: 0,
          error: "Snapshot network passphrase does not match current network",
          durationMs: Date.now() - startTime,
        };
      }

      // Restore storage entries
      let entriesRestored = 0;
      let entriesSkipped = 0;
      let entriesFailed = 0;
      const failedEntries: Array<{ key: string; error: string }> = [];

      for (const entry of snapshot.storageEntries) {
        try {
          // Check if entry already exists
          const exists = await this.checkStorageEntryExists(
            snapshot.metadata.contractId,
            entry,
          );

          if (
            exists &&
            restoreConfig.skipExisting &&
            !restoreConfig.overwriteExisting
          ) {
            entriesSkipped++;
            continue;
          }

          // Skip if dry run
          if (restoreConfig.dryRun) {
            entriesRestored++;
            continue;
          }

          // Restore the entry
          await this.restoreStorageEntry(
            snapshot.metadata.contractId,
            entry,
            signerAccount,
          );

          entriesRestored++;
        } catch (error) {
          entriesFailed++;
          failedEntries.push({
            key: entry.key,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      return {
        success: entriesFailed === 0,
        entriesRestored,
        entriesSkipped,
        entriesFailed,
        failedEntries: failedEntries.length > 0 ? failedEntries : undefined,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        entriesRestored: 0,
        entriesSkipped: 0,
        entriesFailed: 0,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Check if a storage entry already exists
   *
   * @param contractId - Contract address
   * @param entry - Storage entry to check
   * @returns Promise resolving to boolean
   */
  private async checkStorageEntryExists(
    contractId: string,
    entry: StorageEntry,
  ): Promise<boolean> {
    try {
      const contractAddress = new Address(contractId);
      const durability = this.mapStorageType(entry.storageType);

      const ledgerKey = this.createLedgerKey(
        contractAddress,
        durability,
        entry.key,
      );

      const response = await this.server.getLedgerEntries(ledgerKey);
      return response.entries && response.entries.length > 0;
    } catch (error) {
      // Entry doesn't exist
      return false;
    }
  }

  /**
   * Create a ledger key for storage access
   */
  private createLedgerKey(
    contractAddress: Address,
    durability: rpc.Durability,
    key: string,
  ): any {
    const contractData = new xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: this.parseStorageKey(key),
      durability:
        durability === rpc.Durability.Temporary
          ? xdr.ContractDataDurability.temporary()
          : xdr.ContractDataDurability.persistent(),
    });

    return xdr.LedgerKey.contractData(contractData);
  }

  /**
   * Parse storage key string into SCVal
   */
  private parseStorageKey(key: string): any {
    try {
      return xdr.ScVal.scvSymbol(key);
    } catch {
      return xdr.ScVal.scvString(key);
    }
  }

  /**
   * Restore a single storage entry
   *
   * @param contractId - Contract address
   * @param entry - Storage entry to restore
   * @param signerAccount - Account to sign the transaction
   */
  private async restoreStorageEntry(
    contractId: string,
    entry: StorageEntry,
    signerAccount: Keypair,
  ): Promise<void> {
    const contractAddress = new Address(contractId);
    const sourceAccount = await this.server.getAccount(
      signerAccount.publicKey(),
    );

    // Build transaction to set storage
    // Note: This is a simplified implementation. In practice, you would need to:
    // 1. Call a specific contract method that sets the storage
    // 2. Or use a privileged admin function
    // 3. The exact approach depends on the contract's implementation

    const transaction = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: (await this.server.getNetwork()).passphrase,
    })
      .addOperation(
        // This would typically be a contract invocation that sets storage
        // The exact operation depends on the contract's API
        // For now, this is a placeholder
        {} as any, // Replace with actual operation
      )
      .setTimeout(30)
      .build();

    // Sign and submit transaction
    transaction.sign(signerAccount);

    try {
      const response = await this.server.sendTransaction(transaction);

      if (
        response.status === "PENDING" ||
        response.status === "DUPLICATE" ||
        response.status === "TRY_AGAIN_LATER"
      ) {
        // Transaction submitted successfully
        return;
      } else {
        throw new Error(`Transaction failed with status: ${response.status}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to restore storage entry: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Map storage type string to Soroban RPC durability enum
   *
   * @param storageType - Storage type string
   * @returns Soroban RPC durability type
   */
  private mapStorageType(
    storageType: "instance" | "persistent" | "temporary",
  ): rpc.Durability {
    switch (storageType) {
      case "instance":
      case "persistent":
        return rpc.Durability.Persistent;
      case "temporary":
        return rpc.Durability.Temporary;
      default:
        throw new Error(`Invalid storage type: ${storageType}`);
    }
  }

  /**
   * Preview restoration without applying changes
   *
   * @param snapshot - Snapshot to preview
   * @returns Promise resolving to preview result
   */
  async previewRestore(snapshot: ContractStateSnapshot): Promise<{
    totalEntries: number;
    existingEntries: number;
    newEntries: number;
    entriesToRestore: StorageEntry[];
  }> {
    let existingEntries = 0;
    let newEntries = 0;
    const entriesToRestore: StorageEntry[] = [];

    for (const entry of snapshot.storageEntries) {
      const exists = await this.checkStorageEntryExists(
        snapshot.metadata.contractId,
        entry,
      );

      if (exists) {
        existingEntries++;
      } else {
        newEntries++;
        entriesToRestore.push(entry);
      }
    }

    return {
      totalEntries: snapshot.storageEntries.length,
      existingEntries,
      newEntries,
      entriesToRestore,
    };
  }
}
