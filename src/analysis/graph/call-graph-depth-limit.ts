/**
 * Call-graph depth limits (#1166).
 *
 * Recursive call graphs are unbounded in principle and cyclic in practice. The
 * traversal below walks breadth-first from a set of roots, stops at a caller
 * supplied depth, and records every node it refused to expand, so a report can
 * state exactly where it stopped instead of silently truncating.
 *
 * Deterministic: each frontier is visited in sorted order and nodes appear once
 * however many paths reach them.
 */

export interface CallGraphEdge {
  from: string;
  to: string;
}

export interface DepthLimitOptions {
  /** Maximum number of edges followed from a root. */
  maxDepth: number;
}

export interface TraversalResult {
  /** Visited node ids in breadth-first order. */
  visited: string[];
  /** Nodes found at the depth limit whose children were not expanded. */
  truncated: Array<{ nodeId: string; depth: number }>;
  deepestDepth: number;
}

export const DEFAULT_CALL_GRAPH_MAX_DEPTH = 12;

export class CallGraphDepthLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallGraphDepthLimitError";
  }
}

/** Build an adjacency map; duplicate edges collapse. */
export function buildAdjacency(edges: readonly CallGraphEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    if (typeof edge?.from !== "string" || typeof edge?.to !== "string") {
      throw new CallGraphDepthLimitError("edges must have string from/to fields");
    }
    const targets = adjacency.get(edge.from);
    if (targets) {
      if (!targets.includes(edge.to)) {
        targets.push(edge.to);
      }
    } else {
      adjacency.set(edge.from, [edge.to]);
    }
  }

  for (const targets of adjacency.values()) {
    targets.sort();
  }

  return adjacency;
}

/**
 * Traverse the graph from `roots`, stopping `maxDepth` edges deep.
 *
 * Roots themselves are depth 0. A node whose children were skipped because of
 * the limit is reported in `truncated`.
 */
export function traverseWithDepthLimit(
  roots: readonly string[],
  edges: readonly CallGraphEdge[],
  options: Partial<DepthLimitOptions> = {},
): TraversalResult {
  const maxDepth = options.maxDepth ?? DEFAULT_CALL_GRAPH_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new CallGraphDepthLimitError("maxDepth must be a non-negative integer");
  }

  const adjacency = buildAdjacency(edges);
  const visited = new Set<string>();
  const truncated: Array<{ nodeId: string; depth: number }> = [];
  const order: string[] = [];
  let deepestDepth = 0;

  let frontier = [...new Set(roots)].sort();
  for (const node of frontier) {
    visited.add(node);
  }

  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];

    for (const nodeId of frontier) {
      order.push(nodeId);
      deepestDepth = Math.max(deepestDepth, depth);

      const children = adjacency.get(nodeId) ?? [];
      const unvisitedChildren = children.filter((child) => !visited.has(child));

      if (depth === maxDepth) {
        if (unvisitedChildren.length > 0) {
          truncated.push({ nodeId, depth });
        }
        continue;
      }

      for (const child of unvisitedChildren) {
        visited.add(child);
        next.push(child);
      }
    }

    frontier = [...new Set(next)].sort();
  }

  return {
    visited: order,
    truncated: truncated.sort((left, right) =>
      left.depth === right.depth
        ? left.nodeId < right.nodeId
          ? -1
          : 1
        : left.depth - right.depth,
    ),
    deepestDepth,
  };
}

/** True when the graph contains a cycle reachable from `roots`. */
export function hasReachableCycle(
  roots: readonly string[],
  edges: readonly CallGraphEdge[],
  maxDepth: number = DEFAULT_CALL_GRAPH_MAX_DEPTH,
): boolean {
  const adjacency = buildAdjacency(edges);
  const visiting = new Set<string>();
  const done = new Set<string>();

  const walk = (nodeId: string, depth: number): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (done.has(nodeId) || depth > maxDepth) {
      return false;
    }

    visiting.add(nodeId);
    for (const child of adjacency.get(nodeId) ?? []) {
      if (walk(child, depth + 1)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    done.add(nodeId);
    return false;
  };

  return roots.some((root) => walk(root, 0));
}
