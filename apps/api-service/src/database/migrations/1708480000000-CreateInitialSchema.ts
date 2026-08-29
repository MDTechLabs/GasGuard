import { MigrationInterface, QueryRunner } from "typeorm";
import { DatabaseIndexOptimization } from "../optimization/index-optimization";

export class CreateInitialSchema1708480000000 implements MigrationInterface {
  name = "CreateInitialSchema1708480000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create tables
    await queryRunner.query(`
            CREATE TABLE "transactions" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "transaction_hash" character varying(100) NOT NULL,
                "merchant_id" character varying(100) NOT NULL,
                "chain_id" character varying(50) NOT NULL,
                "contract_address" character varying(50) NOT NULL,
                "gas_used" numeric(30,18) NOT NULL,
                "gas_price" numeric(30,18),
                "transaction_fee" numeric(30,18) NOT NULL,
                "status" character varying(20) NOT NULL,
                "error_message" text,
                "transaction_type" character varying(50) NOT NULL,
                "function_name" character varying(100),
                "function_params" jsonb,
                "created_at" TIMESTAMP NOT NULL,
                "created_at_auto" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "region" character varying(50),
                "user_id" character varying(100),
                "retry_count" integer NOT NULL DEFAULT '0',
                "priority" character varying(50),
                CONSTRAINT "PK_a219afd8dd77ed80f5a862f1db9" PRIMARY KEY ("id")
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "merchants" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying(100) NOT NULL,
                "slug" character varying(100) NOT NULL,
                "description" character varying(255) NOT NULL,
                "status" character varying(50) NOT NULL,
                "plan" character varying(100) NOT NULL,
                "tier" character varying(100) NOT NULL,
                "website" character varying(255),
                "email" character varying(255),
                "country" character varying(50),
                "last_active_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL,
                "created_at_auto" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "is_verified" boolean NOT NULL DEFAULT false,
                "metadata" jsonb,
                "category" character varying(50),
                CONSTRAINT "PK_b223995b7b6c33111200919b5c0" PRIMARY KEY ("id")
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "chains" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying(50) NOT NULL,
                "chain_id" character varying(50) NOT NULL,
                "network" character varying(100) NOT NULL,
                "status" character varying(50) NOT NULL,
                "type" character varying(100) NOT NULL,
                "average_gas_price" numeric(10,2),
                "gas_volatility" numeric(10,2),
                "transaction_count" integer NOT NULL DEFAULT '0',
                "reliability_score" numeric(10,2) NOT NULL DEFAULT '100',
                "created_at" TIMESTAMP NOT NULL,
                "created_at_auto" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "config" jsonb,
                "rpc_url" character varying(255),
                "currency" character varying(50),
                CONSTRAINT "PK_91b9a3cac5d5c951020318c6519" PRIMARY KEY ("id")
            )
        `);

    await queryRunner.query(`
            CREATE TABLE "analysis_results" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "merchant_id" character varying(100) NOT NULL,
                "chain_id" character varying(50) NOT NULL,
                "contract_address" character varying(100) NOT NULL,
                "source_code" text NOT NULL,
                "language" character varying(20) NOT NULL,
                "status" character varying(20) NOT NULL,
                "findings" jsonb NOT NULL,
                "violation_count" integer NOT NULL,
                "estimated_gas_savings" numeric(10,2),
                "estimated_cost_savings" numeric(10,2),
                "created_at" TIMESTAMP NOT NULL,
                "created_at_auto" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "analyzer_version" character varying(100),
                "metadata" jsonb,
                "priority" character varying(50),
                "error_message" text,
                CONSTRAINT "PK_c3a0c5d5c951020318c6519a21b" PRIMARY KEY ("id")
            )
        `);

    // Create basic indexes
    await queryRunner.query(
      `CREATE INDEX "idx_transaction_hash" ON "transactions" ("transaction_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_id" ON "transactions" ("merchant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_id" ON "transactions" ("chain_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_contract_address" ON "transactions" ("contract_address")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_gas_used" ON "transactions" ("gas_used")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_status" ON "transactions" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_transaction_type" ON "transactions" ("transaction_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_created_at" ON "transactions" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_created_at_auto" ON "transactions" ("created_at_auto")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_region" ON "transactions" ("region")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_id" ON "transactions" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_retry_count" ON "transactions" ("retry_count")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_priority" ON "transactions" ("priority")`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_merchant_name" ON "merchants" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_slug" ON "merchants" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_status" ON "merchants" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_plan" ON "merchants" ("plan")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_tier" ON "merchants" ("tier")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_email" ON "merchants" ("email")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_country" ON "merchants" ("country")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_last_active" ON "merchants" ("last_active_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_created_at" ON "merchants" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_created_at_auto" ON "merchants" ("created_at_auto")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_verified" ON "merchants" ("is_verified")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_category" ON "merchants" ("category")`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_chain_name" ON "chains" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_id_unique" ON "chains" ("chain_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_network" ON "chains" ("network")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_status" ON "chains" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_type" ON "chains" ("type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_gas_price" ON "chains" ("average_gas_price")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_gas_volatility" ON "chains" ("gas_volatility")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_transaction_count" ON "chains" ("transaction_count")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_reliability" ON "chains" ("reliability_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_created_at" ON "chains" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_created_at_auto" ON "chains" ("created_at_auto")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chain_currency" ON "chains" ("currency")`,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_analysis_merchant_id" ON "analysis_results" ("merchant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_chain_id" ON "analysis_results" ("chain_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_contract_address" ON "analysis_results" ("contract_address")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_language" ON "analysis_results" ("language")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_status" ON "analysis_results" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_violation_count" ON "analysis_results" ("violation_count")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_gas_savings" ON "analysis_results" ("estimated_gas_savings")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_cost_savings" ON "analysis_results" ("estimated_cost_savings")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_created_at" ON "analysis_results" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_created_at_auto" ON "analysis_results" ("created_at_auto")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_version" ON "analysis_results" ("analyzer_version")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analysis_priority" ON "analysis_results" ("priority")`,
    );

    // Apply optimized indexes for analytics
    await DatabaseIndexOptimization.applyOptimizedIndexes(queryRunner);

    // Create unique constraints
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD CONSTRAINT "UQ_merchant_name" UNIQUE ("name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD CONSTRAINT "UQ_merchant_slug" UNIQUE ("slug")`,
    );
    await queryRunner.query(
      `ALTER TABLE "chains" ADD CONSTRAINT "UQ_chain_name" UNIQUE ("name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "chains" ADD CONSTRAINT "UQ_chain_id" UNIQUE ("chain_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop optimized indexes first
    const optimizedIndexes = [
      "idx_merchant_chain_date",
      "idx_merchant_status_date",
      "idx_merchant_gas_date",
      "idx_chain_status_date",
      "idx_chain_gas_date",
      "idx_chain_merchant_date",
      "idx_recent_transactions",
      "idx_high_gas_transactions",
      "idx_failed_transactions",
      "idx_analysis_merchant_chain_date",
      "idx_analysis_language_status_date",
      "idx_analysis_savings_date",
      "idx_merchant_status_plan_date",
      "idx_merchant_last_active",
      "idx_chain_status_type_date",
      "idx_chain_reliability_date",
      "idx_transaction_covering",
      "idx_analysis_covering",
    ];

    for (const indexName of optimizedIndexes) {
      try {
        await queryRunner.query(`DROP INDEX IF EXISTS ${indexName}`);
      } catch (error) {
        // Index might not exist, continue
      }
    }

    // Drop tables
    await queryRunner.query(`DROP TABLE "analysis_results"`);
    await queryRunner.query(`DROP TABLE "chains"`);
    await queryRunner.query(`DROP TABLE "merchants"`);
    await queryRunner.query(`DROP TABLE "transactions"`);
  }
}
