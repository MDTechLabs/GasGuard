import {
  FindingWithRefactorSuggestions,
  RefactorFindingInput,
  RefactorSuggestion,
  RefactorSuggestionCategory,
  RefactorSuggestionEffort,
  RefactorSuggestionLocation,
  RefactorSuggestionOptions,
  RefactorSuggestionPriority,
} from "./types";

const DEFAULT_REPEATED_FINDING_THRESHOLD = 2;

export class StellarRefactorSuggestionEngine {
  suggestForFindings(
    findings: RefactorFindingInput[],
    options: RefactorSuggestionOptions = {},
  ): RefactorSuggestion[] {
    const suggestions = new Map<string, RefactorSuggestion>();
    const threshold =
      options.repeatedFindingThreshold ?? DEFAULT_REPEATED_FINDING_THRESHOLD;

    for (const suggestion of this.detectRepeatedPatterns(findings, threshold)) {
      suggestions.set(suggestion.id, suggestion);
    }

    findings.forEach((finding, index) => {
      for (const suggestion of this.detectFindingSuggestions(finding, index)) {
        suggestions.set(suggestion.id, suggestion);
      }
    });

    return Array.from(suggestions.values()).sort((a, b) => {
      const priorityOrder: Record<RefactorSuggestionPriority, number> = {
        high: 0,
        medium: 1,
        low: 2,
      };
      return (
        priorityOrder[a.priority] - priorityOrder[b.priority] ||
        a.id.localeCompare(b.id)
      );
    });
  }

  attachSuggestionsToFindings<T extends RefactorFindingInput>(
    findings: T[],
    options: RefactorSuggestionOptions = {},
  ): Array<FindingWithRefactorSuggestions<T>> {
    const suggestions = this.suggestForFindings(findings, options);

    return findings.map((finding, index) => {
      const findingId = this.findingId(finding, index);
      return {
        ...finding,
        refactorSuggestions: suggestions.filter((suggestion) =>
          suggestion.relatedFindingIds.includes(findingId),
        ),
      };
    });
  }

  private detectRepeatedPatterns(
    findings: RefactorFindingInput[],
    threshold: number,
  ): RefactorSuggestion[] {
    const groups = new Map<
      string,
      Array<{ finding: RefactorFindingInput; index: number }>
    >();

    findings.forEach((finding, index) => {
      const key = `${finding.ruleId}:${this.findingFile(finding)}`;
      const group = groups.get(key) ?? [];
      group.push({ finding, index });
      groups.set(key, group);
    });

    return Array.from(groups.values())
      .filter((group) => group.length >= threshold)
      .map((group) => {
        const first = group[0].finding;
        const file = this.findingFile(first);
        const relatedFindingIds = group.map(({ finding, index }) =>
          this.findingId(finding, index),
        );
        const locations = group.map(({ finding }) =>
          this.findingLocation(finding),
        );

        return this.createSuggestion({
          category: "repeated-pattern",
          description:
            `Rule ${first.ruleId} appears ${group.length} times in ${file}. ` +
            "Consider extracting a shared helper or guard so the same remediation is made once and reused.",
          effort: group.length > 3 ? "large" : "medium",
          locations,
          priority: group.length > 3 ? "high" : "medium",
          relatedFindingIds,
          title: `Consolidate repeated ${first.ruleId} remediation`,
        });
      });
  }

  private detectFindingSuggestions(
    finding: RefactorFindingInput,
    index: number,
  ): RefactorSuggestion[] {
    const message = finding.message.toLowerCase();
    const relatedFindingIds = [this.findingId(finding, index)];
    const locations = [this.findingLocation(finding)];
    const suggestions: RefactorSuggestion[] = [];

    if (finding.suggestedFix?.description) {
      suggestions.push(
        this.createSuggestion({
          category: "rule-fix",
          description: `${finding.suggestedFix.description} Promote this fix into a reusable helper, rule fixture, or documented pattern if the same rule can recur elsewhere.`,
          effort: "small",
          locations,
          priority: this.priorityFromFinding(finding, "medium"),
          relatedFindingIds,
          title: `Turn ${finding.ruleId} fix into a reusable pattern`,
        }),
      );
    }

    if (
      this.matchesAny(message, ["loop", "cache", "expensive", "state variable"])
    ) {
      suggestions.push(
        this.createSuggestion({
          category: "performance",
          description:
            "Move repeated reads or expensive computation out of hot paths, cache stable values locally, and add a regression test for the optimized path.",
          effort: "medium",
          locations,
          priority: this.priorityFromFinding(finding, "medium"),
          relatedFindingIds,
          title: "Extract hot-path computation into a cached helper",
        }),
      );
    }

    if (
      this.matchesAny(message, [
        "authorization",
        "permission",
        "owner",
        "admin",
        "access control",
      ])
    ) {
      suggestions.push(
        this.createSuggestion({
          category: "authorization",
          description:
            "Centralize authorization checks behind a named guard so future call sites share the same owner/admin policy and failure behavior.",
          effort: "medium",
          locations,
          priority: this.priorityFromFinding(finding, "high"),
          relatedFindingIds,
          title: "Centralize authorization policy checks",
        }),
      );
    }

    if (
      this.matchesAny(message, [
        "unwrap",
        "expect",
        "panic",
        "error",
        "failure",
      ])
    ) {
      suggestions.push(
        this.createSuggestion({
          category: "error-handling",
          description:
            "Replace ad-hoc failure handling with a typed error path and add coverage for the failure branch so reports remain actionable instead of crash-driven.",
          effort: "small",
          locations,
          priority: this.priorityFromFinding(finding, "medium"),
          relatedFindingIds,
          title: "Normalize failure handling around typed errors",
        }),
      );
    }

    return suggestions;
  }

  private createSuggestion(input: {
    category: RefactorSuggestionCategory;
    description: string;
    effort: RefactorSuggestionEffort;
    locations: RefactorSuggestionLocation[];
    priority: RefactorSuggestionPriority;
    relatedFindingIds: string[];
    title: string;
  }): RefactorSuggestion {
    const locationKey = input.locations
      .map((location) => `${location.file}:${location.startLine ?? 0}`)
      .join("|");
    const id = this.slug(
      [
        input.category,
        input.title,
        input.relatedFindingIds.join("|"),
        locationKey,
      ].join(":"),
    );

    return {
      ...input,
      id,
      reportText: `${input.title}: ${input.description}`,
    };
  }

  private findingId(finding: RefactorFindingInput, index: number): string {
    return this.slug(
      [
        finding.ruleId,
        this.findingFile(finding),
        this.findingLine(finding) ?? index + 1,
        index,
      ].join(":"),
    );
  }

  private findingFile(finding: RefactorFindingInput): string {
    return finding.location?.file ?? finding.filePath ?? "unknown";
  }

  private findingLine(finding: RefactorFindingInput): number | undefined {
    return finding.location?.startLine ?? finding.line;
  }

  private findingLocation(
    finding: RefactorFindingInput,
  ): RefactorSuggestionLocation {
    return {
      file: this.findingFile(finding),
      startLine: this.findingLine(finding),
      endLine: finding.location?.endLine,
    };
  }

  private matchesAny(message: string, keywords: string[]): boolean {
    return keywords.some((keyword) => message.includes(keyword));
  }

  private priorityFromFinding(
    finding: RefactorFindingInput,
    fallback: RefactorSuggestionPriority,
  ): RefactorSuggestionPriority {
    const severity = finding.severity?.toLowerCase();
    if (severity === "critical" || severity === "high") {
      return "high";
    }
    if (severity === "low" || severity === "info") {
      return "low";
    }
    if (typeof finding.confidence === "number" && finding.confidence >= 0.85) {
      return "high";
    }
    return fallback;
  }

  private slug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
  }
}
