import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from "typeorm";

export enum MetricAggregationWindow {
  MINUTE = "minute",
  HOUR = "hour",
  DAY = "day",
}

@Entity("api_performance_metrics")
export class ApiPerformanceMetric {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  endpoint: string;

  @Column({ type: "varchar", length: 10 })
  method: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  path: string;

  @Column({ type: "integer" })
  statusCode: number;

  @Column({ type: "bigint" })
  responseTime: number; // in milliseconds

  @Column({ type: "timestamp" })
  timestamp: Date;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: "varchar", length: 100, nullable: true })
  requestId: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  ip: string;

  @Column({ type: "text", nullable: true })
  userAgent: string;
}

// Aggregated metrics for historical analysis
@Entity("api_performance_aggregates")
export class ApiPerformanceAggregate {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  endpoint: string;

  @Column({ type: "varchar", length: 20 })
  method: string;

  @Column({ type: "varchar", length: 20 })
  aggregationWindow: MetricAggregationWindow;

  @Column({ type: "timestamp" })
  timestamp: Date;

  @Column({ type: "bigint" })
  totalRequests: number;

  @Column({ type: "bigint" })
  successfulRequests: number;

  @Column({ type: "bigint" })
  failedRequests: number;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  successRate: number;

  @Column({ type: "bigint" })
  minResponseTime: number;

  @Column({ type: "bigint" })
  maxResponseTime: number;

  @Column({ type: "decimal", precision: 15, scale: 2 })
  avgResponseTime: number;

  @Column({ type: "decimal", precision: 15, scale: 2 })
  p50ResponseTime: number;

  @Column({ type: "decimal", precision: 15, scale: 2 })
  p90ResponseTime: number;

  @Column({ type: "decimal", precision: 15, scale: 2 })
  p95ResponseTime: number;

  @Column({ type: "decimal", precision: 15, scale: 2 })
  p99ResponseTime: number;

  @Column({ type: "decimal", precision: 15, scale: 2 })
  stdDevResponseTime: number;

  @CreateDateColumn()
  createdAt: Date;
}
