#!/usr/bin/env ts-node

/**
 * Rule Documentation Generator
 * 
 * Automatically generates markdown documentation for rules by extracting
 * metadata from rule implementations and creating structured docs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface RuleMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: string;
  language: string;
  dependencies: string[];
  examples?: string[];
  references?: string[];
  filePath: string;
}

interface DocumentationSection {
  title: string;
  category: string;
  rules: RuleMetadata[];
}

class RuleDocumentationGenerator {
  private outputDir: string;
  private rulesDir: string;

  constructor(outputDir: string = 'docs/rules', rulesDir: string = 'packages/rules/src') {
    this.outputDir = outputDir;
    this.rulesDir = rulesDir;
  }

  /**
   * Extract metadata from TypeScript rule files
   */
  private extractTSMetadata(filePath: string): RuleMetadata | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Extract class name and description
      const classMatch = content.match(/export\s+class\s+(\w+).*?implements\s+IRule\s*{[\s\S]*?id\s*=\s*['"`]([^'"`]+)['"`]/s);
      if (!classMatch) return null;

      const className = classMatch[1];
      const ruleId = classMatch[2];

      // Extract name and description
      const nameMatch = content.match(/name\s*=\s*['"`]([^'"`]+)['"`]/);
      const descMatch = content.match(/description\s*=\s*['"`]([^'"`]+)['"`]/);
      
      // Extract dependencies
      const depsMatch = content.match(/getDependencies\(\)\s*{\s*return\s*\[([^\]]*)\]/s);
      const dependencies = depsMatch 
        ? depsMatch[1].split(',').map(d => d.replace(/['"`\s]/g, '')).filter(Boolean)
        : [];

      // Determine category from file path
      const category = this.getCategoryFromPath(filePath);
      
      // Determine language from file path
      const language = this.getLanguageFromPath(filePath);

      // Extract examples from comments
      const examples = this.extractExamples(content);

      return {
        id: ruleId,
        name: nameMatch?.[1] || className,
        description: descMatch?.[1] || 'No description available',
        category,
        severity: 'medium', // Default, can be enhanced
        language,
        dependencies,
        examples,
        filePath
      };
    } catch (error) {
      console.error(`Error extracting metadata from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extract metadata from Rust rule files
   */
  private extractRustMetadata(filePath: string): RuleMetadata | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Look for struct that implements Rule trait
      const structMatch = content.match(/pub\s+struct\s+(\w+)[\s\S]*?impl\s+Rule\s+for\s+\1/);
      if (!structMatch) return null;

      const structName = structMatch[1];

      // Extract name and description from Rule trait implementation
      const nameMatch = content.match(/fn name\(&self\)\s*->\s*&str\s*{\s*['"`]([^'"`]+)['"`]/s);
      const descMatch = content.match(/fn description\(&self\)\s*->\s*&str\s*{\s*['"`]([^'"`]+)['"`]/s);

      // Determine category from file path
      const category = this.getCategoryFromPath(filePath);
      
      // Determine language (Rust rules are typically for Solidity/Soroban)
      const language = this.getLanguageFromPath(filePath);

      return {
        id: structName.toLowerCase(),
        name: nameMatch?.[1] || structName,
        description: descMatch?.[1] || 'No description available',
        category,
        severity: 'medium',
        language,
        dependencies: [], // Rust rules don't currently use dependencies
        filePath
      };
    } catch (error) {
      console.error(`Error extracting metadata from ${filePath}:`, error);
      return null;
    }
  }

  private getCategoryFromPath(filePath: string): string {
    const parts = filePath.split(path.sep);
    if (parts.includes('solidity')) return 'solidity';
    if (parts.includes('soroban')) return 'soroban';
    if (parts.includes('vyper')) return 'vyper';
    return 'general';
  }

  private getLanguageFromPath(filePath: string): string {
    const parts = filePath.split(path.sep);
    if (parts.includes('solidity')) return 'solidity';
    if (parts.includes('soroban')) return 'rust';
    if (parts.includes('vyper')) return 'vyper';
    return path.extname(filePath).replace('.', '');
  }

  private extractExamples(content: string): string[] {
    const examples: string[] = [];
    
    // Look for @example annotations in comments
    const exampleMatches = content.match(/\/\*\*[\s\S]*?\*\/|\/\/.*@example[\s\S]*?(?=\n\/\/|\n\/\*|\n$)/g);
    if (exampleMatches) {
      exampleMatches.forEach(match => {
        if (match.includes('@example')) {
          examples.push(match.trim());
        }
      });
    }
    
    return examples;
  }

  /**
   * Scan for all rule files and extract metadata
   */
  private async scanRules(): Promise<RuleMetadata[]> {
    const rules: RuleMetadata[] = [];

    // Scan TypeScript files
    const tsFiles = await glob('**/*.ts', { 
      cwd: this.rulesDir,
      ignore: ['**/node_modules/**', '**/dist/**']
    });

    for (const file of tsFiles) {
      const fullPath = path.join(this.rulesDir, file);
      const metadata = this.extractTSMetadata(fullPath);
      if (metadata) {
        rules.push(metadata);
      }
    }

    // Scan Rust files
    const rsFiles = await glob('**/*.rs', { 
      cwd: this.rulesDir,
      ignore: ['**/target/**']
    });

    for (const file of rsFiles) {
      const fullPath = path.join(this.rulesDir, file);
      const metadata = this.extractRustMetadata(fullPath);
      if (metadata) {
        rules.push(metadata);
      }
    }

    return rules;
  }

  /**
   * Group rules by category
   */
  private groupRulesByCategory(rules: RuleMetadata[]): DocumentationSection[] {
    const grouped = new Map<string, RuleMetadata[]>();
    
    rules.forEach(rule => {
      if (!grouped.has(rule.category)) {
        grouped.set(rule.category, []);
      }
      grouped.get(rule.category)!.push(rule);
    });

    return Array.from(grouped.entries()).map(([category, rules]) => ({
      title: category.charAt(0).toUpperCase() + category.slice(1) + ' Rules',
      category,
      rules: rules.sort((a, b) => a.name.localeCompare(b.name))
    }));
  }

  /**
   * Generate markdown for a single rule
   */
  private generateRuleMarkdown(rule: RuleMetadata): string {
    let markdown = `## ${rule.name}\n\n`;
    markdown += `**Rule ID:** \`${rule.id}\`\n\n`;
    markdown += `**Language:** ${rule.language}\n\n`;
    markdown += `**Category:** ${rule.category}\n\n`;
    markdown += `**Severity:** ${rule.severity}\n\n`;
    
    if (rule.dependencies.length > 0) {
      markdown += `**Dependencies:** ${rule.dependencies.map(d => `\`${d}\``).join(', ')}\n\n`;
    }

    markdown += `### Description\n\n${rule.description}\n\n`;

    if (rule.examples && rule.examples.length > 0) {
      markdown += `### Examples\n\n`;
      rule.examples.forEach(example => {
        markdown += `${example}\n\n`;
      });
    }

    markdown += `### Implementation\n\n`;
    markdown += `**File:** \`${rule.filePath}\`\n\n`;

    return markdown;
  }

  /**
   * Generate documentation index
   */
  private generateIndex(sections: DocumentationSection[]): string {
    let markdown = `# GasGuard Rules Documentation\n\n`;
    markdown += `This documentation is automatically generated from the rule implementations.\n\n`;
    markdown += `## Overview\n\n`;
    markdown += `GasGuard includes ${sections.reduce((sum, s) => sum + s.rules.length, 0)} rules across ${sections.length} categories.\n\n`;

    sections.forEach(section => {
      markdown += `### [${section.title}](rules/${section.category.toLowerCase()}.md)\n\n`;
      section.rules.forEach(rule => {
        markdown += `- [${rule.name}](rules/${section.category.toLowerCase()}.md#${rule.name.toLowerCase().replace(/\s+/g, '-')}) - ${rule.description}\n`;
      });
      markdown += '\n';
    });

    markdown += `---\n\n`;
    markdown += `*This documentation was generated automatically by the Rule Documentation Generator.*\n`;

    return markdown;
  }

  /**
   * Generate all documentation files
   */
  async generate(): Promise<void> {
    console.log('Scanning for rules...');
    const rules = await this.scanRules();
    console.log(`Found ${rules.length} rules`);

    if (rules.length === 0) {
      console.log('No rules found. Nothing to document.');
      return;
    }

    // Group rules by category
    const sections = this.groupRulesByCategory(rules);

    // Create output directory
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Generate category-specific files
    for (const section of sections) {
      const fileName = `${section.category.toLowerCase()}.md`;
      const filePath = path.join(this.outputDir, fileName);
      
      let markdown = `# ${section.title}\n\n`;
      
      section.rules.forEach(rule => {
        markdown += this.generateRuleMarkdown(rule);
        markdown += '---\n\n';
      });

      fs.writeFileSync(filePath, markdown);
      console.log(`Generated: ${filePath}`);
    }

    // Generate index file
    const indexPath = path.join(this.outputDir, '..', 'RULES.md');
    const indexMarkdown = this.generateIndex(sections);
    fs.writeFileSync(indexPath, indexMarkdown);
    console.log(`Generated: ${indexPath}`);

    console.log('Documentation generation complete!');
  }
}

// CLI interface
if (require.main === module) {
  const generator = new RuleDocumentationGenerator();
  generator.generate().catch(console.error);
}

export { RuleDocumentationGenerator };
export type { RuleMetadata };
