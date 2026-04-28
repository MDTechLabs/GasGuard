/**
 * Fixture Loader - Load and manage test fixtures from JSON files
 */

import * as fs from 'fs';
import * as path from 'path';
import { RuleTestFixture, RuleTestSuite } from './types';

export class FixtureLoader {
  /**
   * Load a single fixture from JSON file
   */
  static loadFixture(filePath: string): RuleTestFixture {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fixture = JSON.parse(content) as RuleTestFixture;
    
    // Validate fixture structure
    this.validateFixture(fixture);
    
    return fixture;
  }

  /**
   * Load multiple fixtures from a directory
   */
  static loadFixturesFromDir(dirPath: string): RuleTestFixture[] {
    const fixtures: RuleTestFixture[] = [];
    
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Fixture directory not found: ${dirPath}`);
    }

    const files = fs.readdirSync(dirPath).filter((f: string) => f.endsWith('.json'));
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const fixture = this.loadFixture(filePath);
        fixtures.push(fixture);
      } catch (error) {
        console.warn(`Failed to load fixture ${file}:`, error);
      }
    }
    
    return fixtures;
  }

  /**
   * Load a test suite from JSON file
   */
  static loadTestSuite(filePath: string): RuleTestSuite {
    const content = fs.readFileSync(filePath, 'utf-8');
    const suite = JSON.parse(content) as RuleTestSuite;
    
    // Validate all fixtures in suite
    for (const fixture of suite.fixtures) {
      this.validateFixture(fixture);
    }
    
    return suite;
  }

  /**
   * Create a fixture from raw input/output
   */
  static createFixture(
    id: string,
    name: string,
    description: string,
    input: string,
    expectedFindings: RuleTestFixture['expectedFindings'],
    metadata?: RuleTestFixture['metadata']
  ): RuleTestFixture {
    return {
      id,
      name,
      description,
      input,
      expectedFindings,
      metadata,
    };
  }

  /**
   * Save fixture to JSON file
   */
  static saveFixture(fixture: RuleTestFixture, filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const content = JSON.stringify(fixture, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Save test suite to JSON file
   */
  static saveTestSuite(suite: RuleTestSuite, filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const content = JSON.stringify(suite, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Validate fixture structure
   */
  private static validateFixture(fixture: RuleTestFixture): void {
    if (!fixture.id) {
      throw new Error('Fixture must have an id');
    }
    if (!fixture.name) {
      throw new Error('Fixture must have a name');
    }
    if (!fixture.input) {
      throw new Error('Fixture must have input');
    }
    if (!Array.isArray(fixture.expectedFindings)) {
      throw new Error('Fixture must have expectedFindings array');
    }
  }
}
