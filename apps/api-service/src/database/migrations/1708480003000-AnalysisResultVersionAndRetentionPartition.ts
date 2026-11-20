import { MigrationInterface, QueryRunner } from "typeorm";

export class AnalysisResultVersionAndRetentionPartition1708480003000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // #1231: optimistic-concurrency counter for scan (analysis result) updates
    await queryRunner.query(
      `ALTER TABLE "analysis_results" ADD "version" integer NOT NULL DEFAULT 1`,
    );

    // #1232: range-partitioned-by-created_at copy of the table. Old data can
    // be dropped by detaching/dropping a partition instead of a bulk DELETE.
    // No PK/indexes are copied (the PK would have to include created_at).
    await queryRunner.query(
      `CREATE TABLE "analysis_results_partitioned" (LIKE "analysis_results" INCLUDING DEFAULTS) PARTITION BY RANGE ("created_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "analysis_results_p2026" PARTITION OF "analysis_results_partitioned" FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')`,
    );
    await queryRunner.query(
      `CREATE TABLE "analysis_results_pdefault" PARTITION OF "analysis_results_partitioned" DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "analysis_results_partitioned"`);
    await queryRunner.query(`ALTER TABLE "analysis_results" DROP COLUMN "version"`);
  }
}
