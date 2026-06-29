export interface RedundantParameter {
  parameter: string;
  event: string;
  line: number;
  reason: string;
}

export interface RedundantEventParametersResult {
  detected: boolean;
  redundancies: RedundantParameter[];
  message: string;
  suggestion: string;
}

interface ParsedEvent {
  name: string;
  params: string[];
  line: number;
}

const EVENT_PATTERN = /event\s+(\w+)\s*\(([^)]*)\)/g;
const SOROBAN_EVENT_PATTERN = /pub\s+struct\s+(\w+)\s*\{([^}]*)\}/g;

function extractEvents(code: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const lines = code.split('\n');

  let match: RegExpExecArray | null;
  while ((match = EVENT_PATTERN.exec(code)) !== null) {
    const eventName = match[1];
    const paramsStr = match[2];
    const params = paramsStr.split(',').map(p => p.trim()).filter(Boolean);
    const lineStart = code.slice(0, match.index).split('\n').length;
    events.push({ name: eventName, params, line: lineStart });
  }

  while ((match = SOROBAN_EVENT_PATTERN.exec(code)) !== null) {
    const eventName = match[1];
    const fieldsStr = match[2];
    const params = fieldsStr.split('\n')
      .map(f => f.trim())
      .filter(f => f && !f.startsWith('//'))
      .map(f => {
        const parts = f.split(':');
        return parts[0]?.trim() ?? '';
      })
      .filter(Boolean);
    const lineStart = code.slice(0, match.index).split('\n').length;
    events.push({ name: eventName, params, line: lineStart });
  }

  return events;
}

function findRedundantParams(events: ParsedEvent[]): RedundantParameter[] {
  const redundancies: RedundantParameter[] = [];
  const seen = new Map<string, Set<string>>();

  for (const event of events) {
    function normalizeParam(p: string): string {
      return p.toLowerCase()
        .replace(/\b(indexed|memory|calldata|storage)\b/g, '')
        .replace(/\s+/g, '')
        .trim();
    }

    const normalized = event.params.map(normalizeParam);
    const seenParams = new Set<string>();

    for (let i = 0; i < normalized.length; i++) {
      const param = normalized[i];
      const original = event.params[i];

      if (event.params.some((p, j) => j !== i && normalizeParam(p) === param)) {
        redundancies.push({
          parameter: original,
          event: event.name,
          line: event.line,
          reason: `Duplicate parameter \`${original}\` appears multiple times in event \`${event.name}\`.`,
        });
      }

      if (seenParams.has(param) && !redundancies.some(r => r.parameter === original && r.event === event.name)) {
        redundancies.push({
          parameter: original,
          event: event.name,
          line: event.line,
          reason: `Redundant parameter \`${original}\` in event \`${event.name}\`.`,
        });
      }
      seenParams.add(param);
    }

    const addressParams = event.params.filter(p => /address/i.test(p));
    const nonAddressParams = event.params.filter(p => !/address/i.test(p));
    for (const addr of addressParams) {
      if (nonAddressParams.some(p => p.toLowerCase().includes(addr.toLowerCase().replace(/^address\s+/, '')))) {
        redundancies.push({
          parameter: addr,
          event: event.name,
          line: event.line,
          reason: `Address parameter \`${addr}\` in event \`${event.name}\` may be redundant if the caller or contract address can be derived from context.`,
        });
      }
    }
  }

  return redundancies;
}

export function detectRedundantEventParameters(code: string): RedundantEventParametersResult {
  const events = extractEvents(code);
  const redundancies = findRedundantParams(events);

  if (redundancies.length === 0) {
    return { detected: false, redundancies: [], message: 'No redundant event parameters detected.', suggestion: '' };
  }

  return {
    detected: true,
    redundancies,
    message: `${redundancies.length} redundant event parameter(s) detected across ${events.length} event(s).`,
    suggestion: 'Remove redundant parameters to reduce event log costs and improve contract efficiency.',
  };
}
