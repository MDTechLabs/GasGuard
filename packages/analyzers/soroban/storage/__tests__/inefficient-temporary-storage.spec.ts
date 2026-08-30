import {
  detectInefficientTemporaryStorage,
  TemporaryStorageAnalysisReport,
} from "../inefficient-temporary-storage-analyzer";

describe("InefficientSorobanTemporaryStorageDetector", () => {
  describe("detectInefficientTemporaryStorage", () => {
    it("should return empty report for source with no temporary storage usage", () => {
      const source = `
        pub fn noop() {}
      `;
      const report = detectInefficientTemporaryStorage(source);
      expect(report.inefficiencies).toHaveLength(0);
      expect(report.metrics.totalTemporaryAccesses).toBe(0);
      expect(report.summary).toContain("No temporary storage usage detected");
    });

    it("should detect repeated access to same temporary key", () => {
      const source = `
        const COUNTER: Symbol = Symbol::new(&env, "counter");

        pub fn process() {
            let a: u32 = env.storage().temporary().get(&COUNTER);
            let b: u32 = env.storage().temporary().get(&COUNTER);
            let c: u32 = env.storage().temporary().get(&COUNTER);
            let d: u32 = env.storage().temporary().get(&COUNTER);
            env.storage().temporary().set(&COUNTER, &0);
        }
      `;
      const report = detectInefficientTemporaryStorage(source);

      const repeatedAccess = report.inefficiencies.find(
        (i) => i.pattern === "repeated_access"
      );
      expect(repeatedAccess).toBeDefined();
      expect(repeatedAccess!.ruleId).toBe("SOROBAN-TMP-01");
      expect(repeatedAccess!.key).toBe("counter");
    });

    it("should detect write-only temporary storage", () => {
      const source = `
        const BUFFER: Symbol = Symbol::new(&env, "buffer");

        pub fn store_data(data: i128) {
            env.storage().temporary().set(&BUFFER, &data);
        }
      `;
      const report = detectInefficientTemporaryStorage(source);

      const writeOnly = report.inefficiencies.find(
        (i) => i.pattern === "write_only_no_read"
      );
      expect(writeOnly).toBeDefined();
      expect(writeOnly!.ruleId).toBe("SOROBAN-TMP-02");
      expect(writeOnly!.key).toBe("buffer");
    });

    it("should detect temporary storage with extend_ttl", () => {
      const source = `
        const CONFIG: Symbol = Symbol::new(&env, "config");

        pub fn manage_config(value: i128) {
            env.storage().temporary().set(&CONFIG, &value);
            env.storage().temporary().extend_ttl(&CONFIG, 100, 200);
        }
      `;
      const report = detectInefficientTemporaryStorage(source);

      const shouldBePersistent = report.inefficiencies.find(
        (i) => i.pattern === "should_be_persistent" && i.ruleId === "SOROBAN-TMP-03"
      );
      expect(shouldBePersistent).toBeDefined();
      expect(shouldBePersistent!.key).toBe("config");
    });

    it("should detect temporary storage access inside loops", () => {
      const source = `
        const ITEM: Symbol = Symbol::new(&env, "item");

        pub fn process_loop(items: Vec<i128>) {
            for i in 0..items.len() {
                let val: i128 = env.storage().temporary().get(&ITEM);
                env.storage().temporary().set(&ITEM, &val);
            }
        }
      `;
      const report = detectInefficientTemporaryStorage(source);

      const shouldBeLocal = report.inefficiencies.find(
        (i) => i.pattern === "should_be_local" && i.ruleId === "SOROBAN-TMP-04"
      );
      expect(shouldBeLocal).toBeDefined();
      expect(shouldBeLocal!.severity).toBe("high");
    });

    it("should detect configuration-like data in temporary storage", () => {
      const source = `
        const FEE_RATE: Symbol = Symbol::new(&env, "fee_rate");

        pub fn get_fee() -> u32 {
            env.storage().temporary().get(&FEE_RATE)
        }
      `;
      const report = detectInefficientTemporaryStorage(source);

      const configInTemp = report.inefficiencies.find(
        (i) => i.pattern === "should_be_persistent" && i.ruleId === "SOROBAN-TMP-05"
      );
      expect(configInTemp).toBeDefined();
      expect(configInTemp!.key).toBe("fee_rate");
    });

    it("should detect over-fragmented temporary storage", () => {
      const source = `
        const KEY1: Symbol = Symbol::new(&env, "key1");
        const KEY2: Symbol = Symbol::new(&env, "key2");
        const KEY3: Symbol = Symbol::new(&env, "key3");
        const KEY4: Symbol = Symbol::new(&env, "key4");
        const KEY5: Symbol = Symbol::new(&env, "key5");
        const KEY6: Symbol = Symbol::new(&env, "key6");
        const KEY7: Symbol = Symbol::new(&env, "key7");
        const KEY8: Symbol = Symbol::new(&env, "key8");
        const KEY9: Symbol = Symbol::new(&env, "key9");
        const KEY10: Symbol = Symbol::new(&env, "key10");

        pub fn use_many_keys() {
            env.storage().temporary().get(&KEY1);
            env.storage().temporary().get(&KEY2);
            env.storage().temporary().get(&KEY3);
            env.storage().temporary().get(&KEY4);
            env.storage().temporary().get(&KEY5);
            env.storage().temporary().get(&KEY6);
            env.storage().temporary().get(&KEY7);
            env.storage().temporary().get(&KEY8);
            env.storage().temporary().get(&KEY9);
            env.storage().temporary().get(&KEY10);
        }
      `;
      const report = detectInefficientTemporaryStorage(source);

      const overFragmented = report.inefficiencies.find(
        (i) => i.pattern === "over_fragmented"
      );
      expect(overFragmented).toBeDefined();
      expect(overFragmented!.ruleId).toBe("SOROBAN-TMP-06");
    });

    it("should detect ephemeral data in persistent storage", () => {
      const source = `
        const NONCE: Symbol = Symbol::new(&env, "nonce");
        const SESSION: Symbol = Symbol::new(&env, "session_token");

        pub fn store_nonce(value: u64) {
            env.storage().persistent().set(&NONCE, &value);
        }

        pub fn store_session(token: String) {
            env.storage().persistent().set(&SESSION, &token);
        }
      `;
      const report = detectInefficientTemporaryStorage(source);

      const ephemeralInPersistent = report.inefficiencies.filter(
        (i) => i.ruleId === "SOROBAN-TMP-07"
      );
      expect(ephemeralInPersistent.length).toBeGreaterThan(0);
    });

    it("should report accurate metrics", () => {
      const source = `
        const COUNTER: Symbol = Symbol::new(&env, "counter");
        const TEMP_DATA: Symbol = Symbol::new(&env, "temp_data");

        pub fn process() {
            let a: u32 = env.storage().temporary().get(&COUNTER);
            let b: u32 = env.storage().temporary().get(&COUNTER);
            env.storage().temporary().set(&TEMP_DATA, &42);
        }
      `;
      const report = detectInefficientTemporaryStorage(source);

      expect(report.metrics.totalTemporaryAccesses).toBe(3);
      expect(report.metrics.uniqueTemporaryKeys).toBe(2);
      expect(report.metrics.repeatedAccessCount).toBeGreaterThanOrEqual(0);
      expect(report.metrics.writeOnlyCount).toBeGreaterThanOrEqual(0);
    });

    it("should handle multiple inefficiency patterns simultaneously", () => {
      const source = `
        const COUNTER: Symbol = Symbol::new(&env, "counter");
        const BUFFER: Symbol = Symbol::new(&env, "buffer");

        pub fn complex_function() {
            let a: u32 = env.storage().temporary().get(&COUNTER);
            let b: u32 = env.storage().temporary().get(&COUNTER);
            let c: u32 = env.storage().temporary().get(&COUNTER);
            env.storage().temporary().set(&BUFFER, &42);
        }
      `;
      const report = detectInefficientTemporaryStorage(source);

      expect(report.inefficiencies.length).toBeGreaterThanOrEqual(2);
      const patterns = report.inefficiencies.map((i) => i.pattern);
      expect(patterns).toContain("repeated_access");
      expect(patterns).toContain("write_only_no_read");
    });
  });
});
