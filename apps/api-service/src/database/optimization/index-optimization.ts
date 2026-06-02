import { Logger } from "@nestjs/common";
import { QueryRunner, TableColumn } from "typeorm";

export class DatabaseIndexOptimization {
  private static readonly logger = new Logger("DatabaseIndexOptimization");

  /**
   * Optimize database indexes for analytics queries
   * These indexes are specifically designed for:
   * 1. Gas usage aggregation per merchant
   * 2. Transaction success metrics
   * 3. Chain reliability and gas volatility metrics
   * 4. Dashboard performance improvements
   */
  static async applyOptimizedIndexes(queryRunner: QueryRunner): Promise<void> {
    this.logger.log("Starting database index optimization...");

    try {
      // 1. Composite indexes for merchant analytics
      await this.createIndexIfNotExists(
        queryRunner,
        "transactions",
        "idx_merchant_chain_date",
        ["merchant_id", "chain_id", "created_at"],
      );

      await this.createIndexIfNotExists(
        queryRunner,
        "transactions",
        "idx_merchant_status_date",
        ["merchant_id", "status", "created_at"],
      );

      await this.createIndexIfNotExists(
        queryRunner,
        "transactions",
        "idx_merchant_gas_date",
        ["merchant_id", "gas_used", "created_at"],
      );

      // 2. Composite indexes for chain analytics
      await this.createIndexIfNotExists(
        queryRunner,
        "transactions",
        "idx_chain_status_date",
        ["chain_id", "status", "created_at"],
      );

      await this.createIndexIfNotExists(
        queryRunner,
        "transactions",
        "idx_chain_gas_date",
        ["chain_id", "gas_used", "created_at"],
      );

      await this.createIndexIfNotExists(
        queryRunner,
        "transactions",
        "idx_chain_merchant_date",
        ["chain_id", "merchant_id", "created_at"],
      );

      // 3. Partial indexes for recent/frequent data
      await this.createPartialIndexIfNotExists(
        queryRunner,
        "transactions",
        "idx_recent_transactions",
        ["created_at", "status"],
        "created_at > NOW() - INTERVAL '30 days' AND status = 'success'",
      );

      await this.createPartialIndexIfNotExists(
        queryRunner,
        "transactions",
        "idx_high_gas_transactions",
        ["gas_used", "created_at"],
        "gas_used > 1000000", // High gas usage threshold
      );

      await this.createPartialIndexIfNotExists(
        queryRunner,
        "transactions",
        "idx_failed_transactions",
        ["created_at", "error_message"],
        "status = 'failed' AND error_message IS NOT NULL",
      );

      // 4. Indexes for analysis results
      await this.createIndexIfNotExists(
        queryRunner,
        "analysis_results",
        "idx_analysis_merchant_chain_date",
        ["merchant_id", "chain_id", "created_at"],
      );

      await this.createIndexIfNotExists(
        queryRunner,
        "analysis_results",
        "idx_analysis_language_status_date",
        ["language", "status", "created_at"],
      );

      await this.createIndexIfNotExists(
        queryRunner,
        "analysis_results",
        "idx_analysis_savings_date",
        ["estimated_gas_savings", "created_at"],
      );

      // 5. Indexes for merchant analytics
      await this.createIndexIfNotExists(
        queryRunner,
        "merchants",
        "idx_merchant_status_plan_date",
        ["status", "plan", "created_at"],
      );

      await this.createIndexIfNotExists(
        queryRunner,
        "merchants",
        "idx_merchant_last_active",
        ["last_active_at", "status"],
      );

      // 6. Indexes for chain analytics
      await this.createIndexIfNotExists(
        queryRunner,
        "chains",
        "idx_chain_status_type_date",
        ["status", "type", "created_at"],
      );

      await this.createIndexIfNotExists(
        queryRunner,
        "chains",
        "idx_chain_reliability_date",
        ["reliability_score", "created_at"],
      );

      // 7. Covering indexes for common query patterns
      await this.createCoveringIndexIfNotExists(
        queryRunner,
        "transactions",
        "idx_transaction_covering",
        ["merchant_id", "chain_id", "status", "created_at"],
        ["gas_used", "transaction_fee", "contract_address"],
      );

      await this.createCoveringIndexIfNotExists(
        queryRunner,
        "analysis_results",
        "idx_analysis_covering",
        ["merchant_id", "chain_id", "status", "created_at"],
        ["violation_count", "estimated_gas_savings", "language"],
      );

      this.logger.log("Database index optimization completed successfully");
    } catch (error) {
      this.logger.error("Failed to apply database index optimization", error);
      throw error;
    }
  }

  /**
   * Create index if it doesn't exist
   */
  private static async createIndexIfNotExists(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string,
    columns: string[],
  ): Promise<void> {
    const columnList = columns.join(", ");
    const query = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columnList})`;

    try {
      await queryRunner.query(query);
      this.logger.log(`Created index: ${indexName} on ${tableName}`);
    } catch (error) {
      this.logger.error(`Failed to create index ${indexName}:`, error);
    }
  }

  /**
   * Create partial index for specific data subsets
   */
  private static async createPartialIndexIfNotExists(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string,
    columns: string[],
    condition: string,
  ): Promise<void> {
    const columnList = columns.join(", ");
    const query = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columnList}) WHERE ${condition}`;

    try {
      await queryRunner.query(query);
      this.logger.log(
        `Created partial index: ${indexName} on ${tableName} with condition: ${condition}`,
      );
    } catch (error) {
      this.logger.error(`Failed to create partial index ${indexName}:`, error);
    }
  }

  /**
   * Create covering index for frequently accessed columns
   */
  private static async createCoveringIndexIfNotExists(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string,
    indexedColumns: string[],
    includedColumns: string[],
  ): Promise<void> {
    const indexedColumnList = indexedColumns.join(", ");
    const includedColumnList = includedColumns.join(", ");
    const query = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${indexedColumnList}) INCLUDE (${includedColumnList})`;

    try {
      await queryRunner.query(query);
      this.logger.log(`Created covering index: ${indexName} on ${tableName}`);
    } catch (error) {
      // PostgreSQL < 11 doesn't support INCLUDE clause, fall back to regular index
      const fallbackQuery = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${indexedColumnList}, ${includedColumnList})`;
      try {
        await queryRunner.query(fallbackQuery);
        this.logger.log(`Created fallback index: ${indexName} on ${tableName}`);
      } catch (fallbackError) {
        this.logger.error(
          `Failed to create covering index ${indexName}:`,
          fallbackError,
        );
      }
    }
  }

  /**
   * Analyze and optimize existing indexes
   */
  static async analyzeIndexPerformance(
    queryRunner: QueryRunner,
  ): Promise<void> {
    this.logger.log("Analyzing index performance...");

    try {
      // Update table statistics
      await queryRunner.query("ANALYZE");

      // Get index usage statistics
      const indexStats = await queryRunner.query(`
        SELECT 
          schemaname,
          tablename,
          indexname,
          idx_scan,
          idx_tup_read,
          idx_tup_fetch,
          pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
        FROM pg_stat_user_indexes 
        WHERE schemaname = 'public'
        ORDER BY idx_scan DESC
      `);

      this.logger.log("Index usage statistics:", indexStats);

      // Identify unused indexes
      const unusedIndexes = await queryRunner.query(`
        SELECT 
          schemaname,
          tablename,
          indexname,
          pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
        FROM pg_stat_user_indexes 
        WHERE idx_scan = 0 AND schemaname = 'public'
      `);

      if (unusedIndexes.length > 0) {
        this.logger.warn("Unused indexes found:", unusedIndexes);
      }
    } catch (error) {
      this.logger.error("Failed to analyze index performance:", error);
    }
  }

  /**
   * Monitor slow queries and suggest index improvements
   */
  static async monitorQueryPerformance(
    queryRunner: QueryRunner,
  ): Promise<void> {
    this.logger.log("Monitoring query performance...");

    try {
      // Get slow queries from pg_stat_statements (if available)
      const slowQueries = await queryRunner.query(`
        SELECT 
          query,
          calls,
          total_time,
          mean_time,
          rows,
          100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
        FROM pg_stat_statements 
        WHERE mean_time > 100  -- Queries taking more than 100ms on average
        ORDER BY total_time DESC
        LIMIT 10
      `);

      if (slowQueries.length > 0) {
        this.logger.warn("Slow queries detected:", slowQueries);
        // Here you could implement automatic index suggestions based on query patterns
      }
    } catch (error) {
      this.logger.error("Failed to monitor query performance:", error);
    }
  }
}
