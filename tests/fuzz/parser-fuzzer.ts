import * as crypto from 'crypto';

export interface FuzzConfig {
  iterations: number;
  maxLength: number;
  charset?: string;
}

export class ParserFuzzer {
  private readonly defaultCharset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*(){}[]<>.,;:\'"\\|/~`';

  generateRandomInput(length: number, charset?: string): string {
    const chars = charset || this.defaultCharset;
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  generateEdgeCases(): string[] {
    return [
      '',
      ' ',
      '\n\n\n',
      '\t\t\t',
      '0'.repeat(10000),
      crypto.randomBytes(256).toString('hex'),
      '{{{{}}}}',
      ';;;;;;;;',
      '////////',
      'null',
      'undefined',
      'NaN',
    ];
  }

  async fuzzParser(
    parserFn: (input: string) => any,
    config: FuzzConfig
  ): Promise<{ passed: number; failed: number; errors: Array<{ input: string; error: string }> }> {
    let passed = 0;
    let failed = 0;
    const errors: Array<{ input: string; error: string }> = [];

    for (let i = 0; i < config.iterations; i++) {
      const length = Math.floor(Math.random() * config.maxLength) + 1;
      const input = this.generateRandomInput(length, config.charset);

      try {
        parserFn(input);
        passed++;
      } catch (error) {
        failed++;
        errors.push({ input, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return { passed, failed, errors };
  }
}
