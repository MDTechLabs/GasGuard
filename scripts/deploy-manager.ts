import { execSync } from 'child_process';
import * as fs from 'fs';

export type Environment = 'development' | 'staging' | 'production';

export interface DeployConfig {
  env: Environment;
  buildCommand: string;
  outputDir: string;
  healthCheckUrl?: string;
}

const ENV_CONFIGS: Record<Environment, Partial<DeployConfig>> = {
  development: { buildCommand: 'npm run build:dev', outputDir: 'dist/dev' },
  staging: { buildCommand: 'npm run build:staging', outputDir: 'dist/staging' },
  production: { buildCommand: 'npm run build', outputDir: 'dist/prod' },
};

export class DeploymentManager {
  private config: DeployConfig;

  constructor(env: Environment, overrides: Partial<DeployConfig> = {}) {
    this.config = { env, ...ENV_CONFIGS[env], ...overrides } as DeployConfig;
  }

  async deploy(): Promise<void> {
    console.log(`[deploy] Starting ${this.config.env} deployment...`);
    this.runBuild();
    this.validateOutput();
    if (this.config.healthCheckUrl) {
      await this.healthCheck();
    }
    console.log(`[deploy] ✅ ${this.config.env} deployment complete`);
  }

  private runBuild(): void {
    console.log(`[deploy] Running: ${this.config.buildCommand}`);
    execSync(this.config.buildCommand, { stdio: 'inherit' });
  }

  private validateOutput(): void {
    if (!fs.existsSync(this.config.outputDir)) {
      throw new Error(`Build output not found at ${this.config.outputDir}`);
    }
    console.log(`[deploy] Output validated at ${this.config.outputDir}`);
  }

  private async healthCheck(): Promise<void> {
    const res = await fetch(this.config.healthCheckUrl!);
    if (!res.ok) {
      throw new Error(`Health check failed: ${res.status} ${this.config.healthCheckUrl}`);
    }
    console.log(`[deploy] Health check passed`);
  }
}

export async function runDeploy(env: Environment): Promise<void> {
  const manager = new DeploymentManager(env);
  await manager.deploy();
}
