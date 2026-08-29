import * as fs from 'fs';
import * as path from 'path';

export interface GasBenchmarkFixture {
  name: string;
  description?: string;
  originalContract: string;
  refactoredContract: string;
  method: string;
  estimatedGasDelta: number;
}

export interface GasExecutionTrace {
  gasUsed: number;
  resourceUnits: number;
  status: 'success' | 'reverted' | 'error';
  error?: string;
}

export interface GasExecutionExecutor {
  execute(contract: string): Promise<GasExecutionTrace>;
}

export interface GasBenchmarkReport {
  fixtureName: string;
  description?: string;
  original: GasExecutionTrace;
  refactored: GasExecutionTrace;
  actualDelta: number;
  estimatedDelta: number;
  deltaDifference: number;
  accuracy: number;
  generatedAt: string;
}

export class GasComparator {
  constructor(private readonly options: { executor?: GasExecutionExecutor } = {}) {}

  async benchmarkFixture(fixture: GasBenchmarkFixture): Promise<GasBenchmarkReport> {
    const executor = this.options.executor ?? new DefaultGasExecutionExecutor();

    const [original, refactored] = await Promise.all([
      executor.execute(fixture.originalContract),
      executor.execute(fixture.refactoredContract),
    ]);

    const actualDelta = Math.max(0, original.gasUsed - refactored.gasUsed);
    const estimatedDelta = fixture.estimatedGasDelta;
    const deltaDifference = Math.abs(actualDelta - estimatedDelta);
    const accuracy = estimatedDelta === 0 ? (actualDelta === 0 ? 1 : 0) : Math.max(0, 1 - deltaDifference / estimatedDelta);

    return {
      fixtureName: fixture.name,
      description: fixture.description,
      original,
      refactored,
      actualDelta,
      estimatedDelta,
      deltaDifference,
      accuracy,
      generatedAt: new Date().toISOString(),
    };
  }

  async benchmarkFixtures(fixtures: GasBenchmarkFixture[]): Promise<GasBenchmarkReport[]> {
    return Promise.all(fixtures.map((fixture) => this.benchmarkFixture(fixture)));
  }

  loadFixturesFromDirectory(dirPath: string): GasBenchmarkFixture[] {
    const resolvedDir = path.resolve(dirPath);
    if (!fs.existsSync(resolvedDir)) {
      return [];
    }

    return fs
      .readdirSync(resolvedDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .sort()
      .map((fileName) => {
        const absolutePath = path.join(resolvedDir, fileName);
        const contents = fs.readFileSync(absolutePath, 'utf8');
        return JSON.parse(contents) as GasBenchmarkFixture;
      });
  }

  async benchmarkDirectory(dirPath: string): Promise<GasBenchmarkReport[]> {
    const fixtures = this.loadFixturesFromDirectory(dirPath);
    return this.benchmarkFixtures(fixtures);
  }

  exportReport(reports: GasBenchmarkReport[]): string {
    const lines = ['Gas Benchmark Report', '===================='];
    for (const report of reports) {
      lines.push(`- ${report.fixtureName}: actualDelta=${report.actualDelta}, estimatedDelta=${report.estimatedDelta}, accuracy=${(report.accuracy * 100).toFixed(1)}%`);
    }

    return lines.join('\n');
  }

  async exportReportToFile(reports: GasBenchmarkReport[], outputPath: string): Promise<string> {
    const output = this.exportReport(reports);
    const resolvedPath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, output, 'utf8');
    return resolvedPath;
  }
}

export class DefaultGasExecutionExecutor implements GasExecutionExecutor {
  async execute(contract: string): Promise<GasExecutionTrace> {
    const normalized = contract.trim().toLowerCase();
    const baseCost = normalized.includes('storage') ? 12000 : 8000;
    const operationCount = (normalized.match(/set\(|get\(|call\(|transfer\(/g) || []).length;
    return {
      gasUsed: baseCost + operationCount * 2000,
      resourceUnits: baseCost + operationCount * 2000,
      status: 'success',
    };
  }
}

if (require.main === module) {
  const fixturesDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'fixtures');
  const comparator = new GasComparator();

  comparator.benchmarkDirectory(fixturesDir).then((reports) => {
    const output = comparator.exportReport(reports);
    console.log(output);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
