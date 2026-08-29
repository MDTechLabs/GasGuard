/**
 * Detect Excessive Memory Allocation Patterns
 * Flags oversized arrays or structures to prevent large memory usage and increased execution costs.
 */

export interface MemoryAllocationResult {
  detected: boolean;
  allocations: string[];
  message: string;
  suggestion: string;
}

export function detectExcessiveMemoryAllocation(code: string): MemoryAllocationResult {
  const allocations: string[] = [];
  
  // Detect large arrays like [0; 1000]
  const largeArrayRegex = /\[.*?\s*;\s*([1-9][0-9]{3,})\]/g;
  for (const match of code.matchAll(largeArrayRegex)) {
    allocations.push(match[0]);
  }

  // Detect large with_capacity allocations: Vec::with_capacity(1000)
  const capacityRegex = /(?:Vec|String|Bytes|BytesN|Map|Vec\s*<.*?>)::with_capacity\(\s*([1-9][0-9]{3,})\s*\)/g;
  for (const match of code.matchAll(capacityRegex)) {
    allocations.push(match[0]);
  }
  
  // Detect large macro allocations: vec![0; 1000]
  const vecMacroRegex = /vec!\[.*?\s*;\s*([1-9][0-9]{3,})\]/g;
  for (const match of code.matchAll(vecMacroRegex)) {
    allocations.push(match[0]);
  }

  if (allocations.length === 0) {
    return { 
      detected: false, 
      allocations: [], 
      message: 'No excessive memory allocation found.', 
      suggestion: '' 
    };
  }

  return {
    detected: true,
    allocations,
    message: `Large memory allocations detected: ${allocations.join(', ')}.`,
    suggestion: 'Consider using smaller buffers, paginated data structures, or dynamic allocation with upper bounds to optimize memory usage and reduce execution costs.',
  };
}
