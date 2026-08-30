import {
  analyzeFootprintAccess,
  FootprintAccessReport,
} from "../footprint-access-analyzer";

describe("SorobanFootprintAccessAnalyzer", () => {
  describe("analyzeFootprintAccess", () => {
    it("should return empty report for source with no storage accesses", () => {
      const source = `
        pub fn noop() {}
      `;
      const report = analyzeFootprintAccess(source);
      expect(report.findings).toHaveLength(0);
      expect(report.metrics.totalKeys).toBe(0);
      expect(report.summary).toContain("No footprint access patterns detected");
    });

    it("should detect hot keys with high access frequency", () => {
      const source = `
        const BALANCE: Symbol = Symbol::new(&env, "balance");

        pub fn process_transfers() {
            let a: i128 = env.storage().persistent().get(&BALANCE);
            let b: i128 = env.storage().persistent().get(&BALANCE);
            let c: i128 = env.storage().persistent().get(&BALANCE);
            let d: i128 = env.storage().persistent().get(&BALANCE);
            let e: i128 = env.storage().persistent().get(&BALANCE);
            let f: i128 = env.storage().persistent().get(&BALANCE);
        }
      `;
      const report = analyzeFootprintAccess(source);

      const hotKey = report.findings.find((f) => f.pattern === "hot_key");
      expect(hotKey).toBeDefined();
      expect(hotKey!.ruleId).toBe("SOROBAN-FPA-01");
      expect(hotKey!.affectedKeys).toContain("balance");
    });

    it("should detect cold keys with minimal access", () => {
      const source = `
        const RARE_KEY: Symbol = Symbol::new(&env, "rare_key");

        pub fn rarely_used() -> i128 {
            env.storage().persistent().get(&RARE_KEY)
        }
      `;
      const report = analyzeFootprintAccess(source);

      const coldKey = report.findings.find((f) => f.pattern === "cold_key");
      expect(coldKey).toBeDefined();
      expect(coldKey!.ruleId).toBe("SOROBAN-FPA-02");
      expect(coldKey!.affectedKeys).toContain("rare_key");
    });

    it("should detect loop access patterns", () => {
      const source = `
        const ITEM: Symbol = Symbol::new(&env, "item");

        pub fn process_loop(items: Vec<i128>) {
            for i in 0..items.len() {
                let val: i128 = env.storage().persistent().get(&ITEM);
                env.storage().persistent().set(&ITEM, &val);
            }
        }
      `;
      const report = analyzeFootprintAccess(source);

      const loopAccess = report.findings.find((f) => f.pattern === "loop_access");
      expect(loopAccess).toBeDefined();
      expect(loopAccess!.ruleId).toBe("SOROBAN-FPA-03");
      expect(loopAccess!.severity).toBe("high");
    });

    it("should detect imbalanced access patterns", () => {
      const source = `
        const CONFIG: Symbol = Symbol::new(&env, "config");

        pub fn read_heavy() -> i128 {
            let a: i128 = env.storage().persistent().get(&CONFIG);
            let b: i128 = env.storage().persistent().get(&CONFIG);
            let c: i128 = env.storage().persistent().get(&CONFIG);
            let d: i128 = env.storage().persistent().get(&CONFIG);
            let e: i128 = env.storage().persistent().get(&CONFIG);
            env.storage().persistent().set(&CONFIG, &0);
        }
      `;
      const report = analyzeFootprintAccess(source);

      const imbalanced = report.findings.find((f) => f.pattern === "imbalanced_access");
      expect(imbalanced).toBeDefined();
      expect(imbalanced!.ruleId).toBe("SOROBAN-FPA-04");
    });

    it("should detect read-heavy functions", () => {
      const source = `
        const A: Symbol = Symbol::new(&env, "a");
        const B: Symbol = Symbol::new(&env, "b");
        const C: Symbol = Symbol::new(&env, "c");

        pub fn read_heavy_fn() -> i128 {
            let a: i128 = env.storage().persistent().get(&A);
            let b: i128 = env.storage().persistent().get(&B);
            let c: i128 = env.storage().persistent().get(&C);
            let d: i128 = env.storage().persistent().get(&A);
            let e: i128 = env.storage().persistent().get(&B);
            env.storage().persistent().set(&C, &0);
        }
      `;
      const report = analyzeFootprintAccess(source);

      const readHeavy = report.findings.find((f) => f.pattern === "read_heavy");
      expect(readHeavy).toBeDefined();
      expect(readHeavy!.ruleId).toBe("SOROBAN-FPA-05");
    });

    it("should detect write-heavy functions", () => {
      const source = `
        const X: Symbol = Symbol::new(&env, "x");
        const Y: Symbol = Symbol::new(&env, "y");
        const Z: Symbol = Symbol::new(&env, "z");

        pub fn write_heavy_fn() {
            env.storage().persistent().set(&X, &1);
            env.storage().persistent().set(&Y, &2);
            env.storage().persistent().set(&Z, &3);
            env.storage().persistent().set(&X, &4);
            env.storage().persistent().set(&Y, &5);
            let _: i128 = env.storage().persistent().get(&Z);
        }
      `;
      const report = analyzeFootprintAccess(source);

      const writeHeavy = report.findings.find((f) => f.pattern === "write_heavy");
      expect(writeHeavy).toBeDefined();
      expect(writeHeavy!.ruleId).toBe("SOROBAN-FPA-06");
    });

    it("should detect high footprint overlap between functions", () => {
      const source = `
        const A: Symbol = Symbol::new(&env, "a");
        const B: Symbol = Symbol::new(&env, "b");
        const C: Symbol = Symbol::new(&env, "c");
        const D: Symbol = Symbol::new(&env, "d");

        pub fn fn_one() -> i128 {
            let a: i128 = env.storage().persistent().get(&A);
            let b: i128 = env.storage().persistent().get(&B);
            let c: i128 = env.storage().persistent().get(&C);
            let d: i128 = env.storage().persistent().get(&D);
            a + b + c + d
        }

        pub fn fn_two() -> i128 {
            let a: i128 = env.storage().persistent().get(&A);
            let b: i128 = env.storage().persistent().get(&B);
            let c: i128 = env.storage().persistent().get(&C);
            let d: i128 = env.storage().persistent().get(&D);
            a * b * c * d
        }
      `;
      const report = analyzeFootprintAccess(source);

      const highOverlap = report.findings.find((f) => f.pattern === "high_overlap");
      expect(highOverlap).toBeDefined();
      expect(highOverlap!.ruleId).toBe("SOROBAN-FPA-07");
    });

    it("should build function profiles correctly", () => {
      const source = `
        const A: Symbol = Symbol::new(&env, "a");
        const B: Symbol = Symbol::new(&env, "b");

        pub fn profile_test() -> i128 {
            let a: i128 = env.storage().persistent().get(&A);
            let b: i128 = env.storage().persistent().get(&B);
            env.storage().persistent().set(&A, &0);
            a + b
        }
      `;
      const report = analyzeFootprintAccess(source);

      expect(report.functionProfiles.length).toBeGreaterThan(0);
      const profile = report.functionProfiles.find((p) => p.functionName === "profile_test");
      expect(profile).toBeDefined();
      expect(profile!.keysAccessed).toContain("a");
      expect(profile!.keysAccessed).toContain("b");
      expect(profile!.readCount).toBe(2);
      expect(profile!.writeCount).toBe(1);
    });

    it("should report accurate metrics", () => {
      const source = `
        const A: Symbol = Symbol::new(&env, "a");
        const B: Symbol = Symbol::new(&env, "b");

        pub fn metrics_test() -> i128 {
            let a: i128 = env.storage().persistent().get(&A);
            let b: i128 = env.storage().persistent().get(&B);
            env.storage().persistent().set(&A, &42);
            a + b
        }
      `;
      const report = analyzeFootprintAccess(source);

      expect(report.metrics.totalKeys).toBe(2);
      expect(report.metrics.totalReads).toBe(2);
      expect(report.metrics.totalWrites).toBe(1);
      expect(report.metrics.averageAccessDensity).toBeGreaterThan(0);
    });

    it("should track access across multiple storage tiers", () => {
      const source = `
        const INSTANCE_KEY: Symbol = Symbol::new(&env, "instance_key");
        const PERSISTENT_KEY: Symbol = Symbol::new(&env, "persistent_key");
        const TEMP_KEY: Symbol = Symbol::new(&env, "temp_key");

        pub fn multi_tier() {
            env.storage().instance().get(&INSTANCE_KEY);
            env.storage().persistent().get(&PERSISTENT_KEY);
            env.storage().temporary().get(&TEMP_KEY);
        }
      `;
      const report = analyzeFootprintAccess(source);

      expect(report.metrics.totalKeys).toBe(3);

      const keys = Object.values(report.keyAccessMap);
      const tiers = keys.map((k) => k.storageTier);
      expect(tiers).toContain("instance");
      expect(tiers).toContain("persistent");
      expect(tiers).toContain("temporary");
    });
  });
});
