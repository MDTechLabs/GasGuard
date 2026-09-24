import {
  detectEventEmissionIssues,
  EventEmissionRule,
} from '../events/event-emission.rule';

const CONTRACT = `
pub fn healthy_event(env: Env, user: Address) {
    TransferEvent { from: user, amount: 10i128 }.publish(&env);
}

pub fn raw_event(env: Env) {
    env.events().publish((symbol_short!("deposit"),), 25i128);
}

pub fn spammed_events(env: Env, users: Vec<Address>) {
    for user in users.iter() {
        UserSeenEvent { user }.publish(&env);
        UserSeenEvent { user }.publish(&env);
        UserSeenEvent { user }.publish(&env);
        UserSeenEvent { user }.publish(&env);
        UserSeenEvent { user }.publish(&env);
        UserSeenEvent { user }.publish(&env);
    }
}

pub fn topicless(env: Env) {
    env.events().publish((), ());
}
`;

describe('Soroban event analyzer (#913)', () => {
  const rule = new EventEmissionRule();

  it('detects typed and raw event emissions', () => {
    const report = rule.evaluate(CONTRACT);

    expect(report.metrics.totalEmissions).toBeGreaterThanOrEqual(8);
    const styles = new Set(report.events.map((e) => e.style));
    expect(styles.has('typed_event')).toBe(true);
    expect(styles.has('raw_publish')).toBe(true);
  });

  it('extracts event topics', () => {
    const report = rule.evaluate(CONTRACT);
    const topics = report.events.map((e) => e.topic);

    expect(topics).toContain('TransferEvent');
    expect(topics).toContain('UserSeenEvent');
    expect(topics.some((t) => t.includes('deposit'))).toBe(true);
    expect(report.metrics.uniqueTopics).toBeGreaterThanOrEqual(3);
  });

  it('tracks emission frequency per function', () => {
    const report = rule.evaluate(CONTRACT);
    const spammed = report.events.filter((e) => e.functionName === 'spammed_events');
    expect(spammed.length).toBe(6);
  });

  it('flags functions with excessive event frequency', () => {
    const report = rule.evaluate(CONTRACT);
    const excessive = report.findings.filter((f) => f.rule === 'soroban-excessive-events');
    expect(excessive.length).toBe(1);
    expect(excessive[0].functionName).toBe('spammed_events');
    expect(report.metrics.functionsWithExcessiveEvents).toBe(1);
  });

  it('flags raw publishes without topics', () => {
    const report = rule.evaluate(CONTRACT);
    const topicless = report.findings.filter(
      (f) => f.rule === 'soroban-event-topic-missing',
    );
    expect(topicless.length).toBe(1);
    expect(topicless[0].topic).toBe('<no-topic>');
  });

  it('estimates event-related resource impact', () => {
    const report = rule.evaluate(CONTRACT);
    expect(report.metrics.estimatedResourceUnits).toBeGreaterThan(0);
    expect(
      report.events.every((e) => e.payloadSizeChars >= 0),
    ).toBe(true);
  });

  it('summarizes a clean contract positively', () => {
    const report = rule.evaluate(`
pub fn one_event(env: Env, user: Address) {
    TransferEvent { from: user, amount: 1i128 }.publish(&env);
}
`);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toMatch(/well-structured/i);
  });
});
