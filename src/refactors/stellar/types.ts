export type RefactorSuggestionPriority = "high" | "medium" | "low";

export type RefactorSuggestionEffort = "small" | "medium" | "large";

export type RefactorSuggestionCategory =
  | "authorization"
  | "error-handling"
  | "performance"
  | "repeated-pattern"
  | "rule-fix";

export interface RefactorFindingLocation {
  file: string;
  startLine: number;
  endLine?: number;
}

export interface RefactorFindingInput {
  ruleId: string;
  message: string;
  filePath?: string;
  line?: number;
  location?: RefactorFindingLocation;
  severity?: string;
  confidence?: number;
  suggestedFix?: {
    description: string;
    codeSnippet?: string;
    documentationUrl?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface RefactorSuggestionLocation {
  file: string;
  startLine?: number;
  endLine?: number;
}

export interface RefactorSuggestion {
  id: string;
  title: string;
  description: string;
  category: RefactorSuggestionCategory;
  priority: RefactorSuggestionPriority;
  effort: RefactorSuggestionEffort;
  relatedFindingIds: string[];
  locations: RefactorSuggestionLocation[];
  reportText: string;
}

export type FindingWithRefactorSuggestions<T extends RefactorFindingInput> =
  T & {
    refactorSuggestions: RefactorSuggestion[];
  };

export interface RefactorSuggestionOptions {
  repeatedFindingThreshold?: number;
}
