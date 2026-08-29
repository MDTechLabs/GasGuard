import { detectDuplicateEventEmissions } from '../../rules/auditability/events/detect-duplicate-event-emissions';
import { GasGuardEngine } from '../../packages/rules/gasGuard/gasguard.engine';

describe('detectDuplicateEventEmissions', () => {
  it('detects duplicate Solidity event emissions in the same function', () => {
    const code = `
      function transfer(address to, uint256 amount) external {
        emit Transfer(msg.sender, to, amount);
        emit Transfer(msg.sender, to, amount);
      }
    `;

    const result = detectDuplicateEventEmissions(code);

    expect(result.detected).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].count).toBe(2);
    expect(result.suggestion).toMatch(/Consolidate/);
  });

  it('detects duplicate Solidity event emissions in constructors', () => {
    const code = `
      constructor(address owner) {
        emit OwnerSet(owner);
        emit OwnerSet(owner);
      }
    `;

    const result = detectDuplicateEventEmissions(code);

    expect(result.detected).toBe(true);
    expect(result.violations).toHaveLength(1);
  });

  it('detects duplicate Soroban env.events publish calls', () => {
    const code = `
      pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        env.events().publish((symbol_short!("transfer"), from.clone(), to.clone()), amount);
        env.events().publish((symbol_short!("transfer"), from.clone(), to.clone()), amount);
      }
    `;

    const result = detectDuplicateEventEmissions(code);

    expect(result.detected).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].duplicateLines.length).toBe(1);
  });

  it('detects duplicate Soroban publish calls when Env has a custom variable name', () => {
    const code = `
      pub fn transfer(e: Env, amount: i128) {
        e.events().publish((symbol_short!("transfer"),), amount);
        e.events().publish((symbol_short!("transfer"),), amount);
      }
    `;

    const result = detectDuplicateEventEmissions(code);

    expect(result.detected).toBe(true);
    expect(result.violations).toHaveLength(1);
  });

  it('detects duplicate typed Soroban event publish calls', () => {
    const code = `
      pub fn increment(env: Env, count: u32) {
        IncrementEvent { count }.publish(&env);
        IncrementEvent { count }.publish(&env);
      }
    `;

    const result = detectDuplicateEventEmissions(code);

    expect(result.detected).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].eventKey).toContain('IncrementEvent');
  });

  it('does not flag different event payloads', () => {
    const code = `
      pub fn update(env: Env, old_value: u32, new_value: u32) {
        env.events().publish((symbol_short!("update"),), old_value);
        env.events().publish((symbol_short!("update"),), new_value);
      }
    `;

    const result = detectDuplicateEventEmissions(code);

    expect(result.detected).toBe(false);
    expect(result.violations).toHaveLength(0);
  });

  it('does not compare event emissions across separate functions', () => {
    const code = `
      function a(address user) external {
        emit Updated(user);
      }

      function b(address user) external {
        emit Updated(user);
      }
    `;

    const result = detectDuplicateEventEmissions(code);

    expect(result.detected).toBe(false);
  });

  it('does not compare event emissions across separate Rust methods', () => {
    const code = `
      impl Token {
        pub fn mint(env: Env, user: Address, amount: i128) {
          env.events().publish((symbol_short!("transfer"), user.clone()), amount);
        }

        pub fn burn(env: Env, user: Address, amount: i128) {
          env.events().publish((symbol_short!("transfer"), user.clone()), amount);
        }
      }
    `;

    const result = detectDuplicateEventEmissions(code);

    expect(result.detected).toBe(false);
  });

  it('does not collapse different string literal topics', () => {
    const code = `
      pub fn update(env: Env, amount: i128) {
        env.events().publish((symbol_short!("mint"),), amount);
        env.events().publish((symbol_short!("burn"),), amount);
      }
    `;

    const result = detectDuplicateEventEmissions(code);

    expect(result.detected).toBe(false);
  });

  it('ignores commented out duplicate emissions', () => {
    const code = `
      function transfer(address to, uint256 amount) external {
        emit Transfer(msg.sender, to, amount);
        // emit Transfer(msg.sender, to, amount);
      }
    `;

    const result = detectDuplicateEventEmissions(code);

    expect(result.detected).toBe(false);
  });

  it('surfaces duplicate Soroban events through the GasGuard engine', async () => {
    const engine = new GasGuardEngine();
    const result = await engine.scan({
      language: 'soroban',
      source: `
        pub fn transfer(env: Env, amount: i128) {
          env.events().publish((symbol_short!("transfer"),), amount);
          env.events().publish((symbol_short!("transfer"),), amount);
        }
      `,
    });

    expect(
      result.issues.some(
        (issue) => issue.ruleId === 'detect-duplicate-event-emissions',
      ),
    ).toBe(true);
  });
});
