import {
  Analyzer,
  Language,
  AnalysisResult,
  AnalyzerConfig,
  Rule,
} from "./analyzer-interface";

export class AnalyzerRegistry {
  private analyzers: Map<string, Analyzer> = new Map();
  private languageMap: Map<Language | string, Analyzer[]> = new Map();

  register(analyzer: Analyzer): void {
    const name = analyzer.getName();

    if (this.analyzers.has(name)) {
      throw new Error(`Analyzer with name "${name}" is already registered`);
    }

    this.analyzers.set(name, analyzer);

    // Update language map
    for (const language of analyzer.getSupportedLanguages()) {
      if (!this.languageMap.has(language)) {
        this.languageMap.set(language, []);
      }
      this.languageMap.get(language)!.push(analyzer);
    }
  }

  async unregister(name: string): Promise<void> {
    const analyzer = this.analyzers.get(name);

    if (!analyzer) {
      return;
    }

    await analyzer.dispose();

    this.analyzers.delete(name);

    for (const language of analyzer.getSupportedLanguages()) {
      const analyzers = this.languageMap.get(language);
      if (analyzers) {
        const index = analyzers.indexOf(analyzer);
        if (index !== -1) {
          analyzers.splice(index, 1);
        }
        if (analyzers.length === 0) {
          this.languageMap.delete(language);
        }
      }
    }
  }

  getAnalyzer(name: string): Analyzer | undefined {
    return this.analyzers.get(name);
  }

  getAnalyzersForLanguage(language: Language | string): Analyzer[] {
    return this.languageMap.get(language) || [];
  }

  getAllAnalyzers(): Analyzer[] {
    return Array.from(this.analyzers.values());
  }

  getSupportedLanguages(): Array<Language | string> {
    return Array.from(this.languageMap.keys());
  }

  isLanguageSupported(language: Language | string): boolean {
    return this.languageMap.has(language);
  }

  getAllRules(language?: Language | string): Rule[] {
    const analyzers = language
      ? this.getAnalyzersForLanguage(language)
      : this.getAllAnalyzers();

    const allRules: Rule[] = [];

    for (const analyzer of analyzers) {
      allRules.push(...analyzer.getRules());
    }

    return allRules;
  }

  async initializeAll(config?: AnalyzerConfig): Promise<void> {
    const promises = Array.from(this.analyzers.values()).map((analyzer) =>
      analyzer.initialize(config),
    );

    await Promise.all(promises);
  }

  async disposeAll(): Promise<void> {
    const promises = Array.from(this.analyzers.values()).map((analyzer) =>
      analyzer.dispose(),
    );

    await Promise.all(promises);

    this.analyzers.clear();
    this.languageMap.clear();
  }

  async analyze(
    code: string,
    filePath: string,
    language: Language | string,
    config?: AnalyzerConfig,
    analyzerName?: string,
  ): Promise<AnalysisResult> {
    let analyzers: Analyzer[];

    if (analyzerName) {
      const analyzer = this.getAnalyzer(analyzerName);
      if (!analyzer) {
        throw new Error(`Analyzer "${analyzerName}" not found`);
      }
      if (!analyzer.supportsLanguage(language)) {
        throw new Error(
          `Analyzer "${analyzerName}" does not support language "${language}"`,
        );
      }
      analyzers = [analyzer];
    } else {
      analyzers = this.getAnalyzersForLanguage(language);
      if (analyzers.length === 0) {
        throw new Error(`No analyzer found for language "${language}"`);
      }
    }

    if (analyzers.length === 1) {
      return analyzers[0]!.analyze(code, filePath, config);
    }

    const results = await Promise.all(
      analyzers.map((analyzer) => analyzer.analyze(code, filePath, config)),
    );
    return this.mergeResults(results);
  }

  async analyzeMultiple(
    files: Map<string, string>,
    languageMap: Map<string, Language | string>,
    config?: AnalyzerConfig,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();

    // Group files by language
    const filesByLanguage = new Map<Language | string, Map<string, string>>();

    for (const [filePath, code] of files.entries()) {
      const language = languageMap.get(filePath);
      if (!language) {
        continue;
      }

      if (!filesByLanguage.has(language)) {
        filesByLanguage.set(language, new Map());
      }

      filesByLanguage.get(language)!.set(filePath, code);
    }

    // Analyze each language group
    const allResults: AnalysisResult[] = [];

    for (const [language, languageFiles] of filesByLanguage.entries()) {
      const analyzers = this.getAnalyzersForLanguage(language);

      for (const analyzer of analyzers) {
        const result = await analyzer.analyzeMultiple(languageFiles, config);
        allResults.push(result);
      }
    }

    // Merge all results
    const mergedResult = this.mergeResults(allResults);
    mergedResult.analysisTime = Date.now() - startTime;

    return mergedResult;
  }

  private mergeResults(results: AnalysisResult[]): AnalysisResult {
    if (results.length === 0) {
      return {
        findings: [],
        filesAnalyzed: 0,
        analysisTime: 0,
        analyzerVersion: "registry-1.0.0",
        summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      };
    }

    if (results.length === 1) {
      return results[0]!;
    }

    const allFindings = results.flatMap((r) => r.findings);
    const allErrors = results.flatMap((r) => r.errors || []);
    const totalFiles = results.reduce((sum, r) => sum + r.filesAnalyzed, 0);
    const totalTime = results.reduce((sum, r) => sum + r.analysisTime, 0);
    const totalGasSavings = results.reduce(
      (sum, r) => sum + (r.totalEstimatedGasSavings || 0),
      0,
    );

    return {
      findings: allFindings,
      filesAnalyzed: totalFiles,
      analysisTime: totalTime,
      analyzerVersion: "registry-1.0.0",
      summary: {
        critical: allFindings.filter((f) => f.severity === "critical").length,
        high: allFindings.filter((f) => f.severity === "high").length,
        medium: allFindings.filter((f) => f.severity === "medium").length,
        low: allFindings.filter((f) => f.severity === "low").length,
        info: allFindings.filter((f) => f.severity === "info").length,
      },
      totalEstimatedGasSavings:
        totalGasSavings > 0 ? totalGasSavings : undefined,
      errors: allErrors.length > 0 ? allErrors : undefined,
    };
  }
}
