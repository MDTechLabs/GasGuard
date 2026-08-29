import { detectExcessiveEventTopics } from '../../rules/stellar/events/detect-excessive-event-topics';
import { FixtureLoader } from '../../libs/testing/src/fixture-loader';

describe('detectExcessiveEventTopics', () => {
  describe('topic count violations', () => {
    it('flags an event with 5 topics', () => {
      const code = `env.events().publish((a, b, c, d, e), data)`;
      const result = detectExcessiveEventTopics(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].topicCount).toBe(5);
      expect(result.message).toMatch(/topic count exceeds 4/);
    });

    it('does not flag an event with exactly 4 topics', () => {
      const code = `env.events().publish((a, b, c, d), data)`;
      const result = detectExcessiveEventTopics(code);
      expect(result.detected).toBe(false);
    });
  });

  describe('large payload type violations', () => {
    it('flags Bytes in the topics tuple', () => {
      const code = `env.events().publish((symbol_short!("log"), Bytes::from_slice(&env, &[1,2,3])), ())`;
      const result = detectExcessiveEventTopics(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].hasLargePayload).toBe(true);
      expect(result.message).toMatch(/large payload types/);
    });

    it('flags String in the topics tuple', () => {
      const code = `env.events().publish((symbol_short!("mint"), String::from_str(&env, "x")), amt)`;
      const result = detectExcessiveEventTopics(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].hasLargePayload).toBe(true);
    });

    it('flags Vec in the topics tuple', () => {
      const code = `env.events().publish((symbol_short!("info"), Vec::new(&env)), data)`;
      const result = detectExcessiveEventTopics(code);
      expect(result.detected).toBe(true);
      expect(result.violations[0].hasLargePayload).toBe(true);
    });
  });

  describe('safe cases', () => {
    it('does not flag 2 plain topics', () => {
      const code = `env.events().publish((symbol_short!("mint"), addr), amount)`;
      const result = detectExcessiveEventTopics(code);
      expect(result.detected).toBe(false);
      expect(result.violations).toHaveLength(0);
    });

    it('does not flag code with no event calls', () => {
      const code = `let x = 1 + 1;`;
      const result = detectExcessiveEventTopics(code);
      expect(result.detected).toBe(false);
    });
  });

  describe('multiple events', () => {
    it('reports all violating events in one result', () => {
      const code = `
        env.events().publish((a, b, c, d, e), data);
        env.events().publish((symbol_short!("log"), Bytes::from_slice(&env, &[])), ());
        env.events().publish((symbol_short!("ok"), addr), ());
      `;
      const result = detectExcessiveEventTopics(code);
      expect(result.detected).toBe(true);
      expect(result.violations).toHaveLength(2);
    });
  });

  describe('fixture validation', () => {
    it('fixture matches expected structure', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/stellar-excessive-event-topics.json'
      );
      expect(fixture.id).toBe('stellar-excessive-event-topics-1');
      expect(fixture.expectedFindings).toHaveLength(2);
      expect(fixture.metadata?.category).toBe('events');
    });

    it('detector agrees with fixture violations', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/stellar-excessive-event-topics.json'
      );
      const result = detectExcessiveEventTopics(fixture.input);
      expect(result.detected).toBe(true);
      expect(result.violations).toHaveLength(2);
      expect(result.violations.some((v) => v.topicCount > 4)).toBe(true);
      expect(result.violations.some((v) => v.hasLargePayload)).toBe(true);
    });
  });
});
