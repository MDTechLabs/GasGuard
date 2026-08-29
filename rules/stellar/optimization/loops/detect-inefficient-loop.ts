// Detect inefficient loops in contract code
export interface LoopDetectionResult {
  detected: boolean;
  lines: number[];
  message: string;
  suggestion: string;
}

/**
 * Detects loops that contain storage accesses or unchecked arithmetic which can be gas‑inefficient.
 * Currently supports a simple regex search for `for` loops containing `env.storage()` or `unchecked`.
 */
export function detectInefficientLoop(code: string): LoopDetectionResult {
  const loopRegex = /for\s*\([^)]*\)\s*{[^}]*?(env\.storage\([^)]*\)|unchecked)[^}]*}/gs;
  const matches = [...code.matchAll(loopRegex)];
  if (matches.length === 0) {
    return {
      detected: false,
      lines: [],
      message: "No inefficient loops detected.",
      suggestion: "",
    };
  }
  const lines = matches.map(m => {
    const preceding = code.slice(0, m.index ?? 0);
    return preceding.split(/\r?\n/).length; // line number of the loop start
  });
  return {
    detected: true,
    lines,
    message: `Inefficient loop(s) found on line(s): ${lines.join(", ")}`,
    suggestion: "Consider moving storage reads outside the loop or using unchecked blocks where safe.",
  };
}
