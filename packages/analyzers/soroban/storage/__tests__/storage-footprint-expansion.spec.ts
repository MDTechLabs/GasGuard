import {
  detectStorageFootprintExpansion,
  FootprintExpansionReport,
} from "../storage-footprint-expansion-analyzer";

describe("SorobanStorageFootprintExpansionDetector", () => {
  describe("detectStorageFootprintExpansion", () => {
    it("should return empty report for source with no storage writes", () => {
      const source = `
        pub fn noop() {}
      `;
      const report = detectStorageFootprintExpansion(source);
      expect(report.findings).toHaveLength(0);
      expect(report.metrics.totalExpansionRisks).toBe(0);
      expect(report.summary).toContain("No storage footprint expansion risks detected");
    });

    it("should detect unbounded collection growth in loops", () => {
      const source = `
        const ITEMS: Symbol = Symbol::new(&env, "items");

        pub fn add_items(new_items: Vec<i128>) {
            for item in new_items.iter() {
                let mut items: Vec<i128> = env.storage().persistent().get(&ITEMS);
                items.push_back(item);
                env.storage().persistent().set(&ITEMS, &items);
            }
        }
      `;
      const report = detectStorageFootprintExpansion(source);

      const unboundedGrowth = report.findings.find(
        (f) => f.pattern === "unbounded_collection_growth"
      );
      expect(unboundedGrowth).toBeDefined();
      expect(unboundedGrowth!.severity).toBe("high");
      expect(unboundedGrowth!.ruleId).toBe("SOROBAN-EXP-01");
      expect(unboundedGrowth!.growthRisk).toBe("unbounded");
    });

    it("should detect collections without cleanup mechanisms", () => {
      const source = `
        const USERS: Symbol = Symbol::new(&env, "users");

        pub fn add_user(addr: Address) {
            let mut users: Vec<Address> = env.storage().persistent().get(&USERS);
            users.push_back(addr);
            env.storage().persistent().set(&USERS, &users);
        }
      `;
      const report = detectStorageFootprintExpansion(source);

      const noCleanup = report.findings.find(
        (f) => f.pattern === "no_cleanup_mechanism"
      );
      expect(noCleanup).toBeDefined();
      expect(noCleanup!.severity).toBe("high");
      expect(noCleanup!.ruleId).toBe("SOROBAN-EXP-02");
      expect(noCleanup!.growthRisk).toBe("unbounded");
    });

    it("should detect growing map in storage", () => {
      const source = `
        const BALANCES: Symbol = Symbol::new(&env, "balances");

        pub fn update_balance(addr: Address, amount: i128) {
            let mut balances: Map<Address, i128> = env.storage().persistent().get(&BALANCES);
            balances.set(addr, amount);
            env.storage().persistent().set(&BALANCES, &balances);
        }
      `;
      const report = detectStorageFootprintExpansion(source);

      const growingMap = report.findings.find(
        (f) => f.pattern === "growing_map_in_storage"
      );
      expect(growingMap).toBeDefined();
      expect(growingMap!.severity).toBe("medium");
      expect(growingMap!.ruleId).toBe("SOROBAN-EXP-03");
    });

    it("should detect dynamic key generation patterns", () => {
      const source = `
        pub fn store_by_id(id: u64, value: i128) {
            let key = format!("item_{}", id);
            env.storage().persistent().set(&key, &value);
        }
      `;
      const report = detectStorageFootprintExpansion(source);

      const dynamicKey = report.findings.find(
        (f) => f.pattern === "dynamic_key_pattern"
      );
      expect(dynamicKey).toBeDefined();
      expect(dynamicKey!.severity).toBe("high");
      expect(dynamicKey!.ruleId).toBe("SOROBAN-EXP-04");
    });

    it("should detect parameterized DataKey with collection growth", () => {
      const source = `
        enum DataKey {
            UserBalance(Address),
            TotalSupply,
        }

        pub fn add_user_balance(addr: Address, amount: i128) {
            let mut balances: Vec<i128> = env.storage().persistent().get(&DataKey::UserBalance(addr));
            balances.push_back(amount);
            env.storage().persistent().set(&DataKey::UserBalance(addr), &balances);
        }
      `;
      const report = detectStorageFootprintExpansion(source);

      const paramKey = report.findings.find(
        (f) => f.pattern === "unbounded_key_generation"
      );
      expect(paramKey).toBeDefined();
      expect(paramKey!.ruleId).toBe("SOROBAN-EXP-05");
    });

    it("should detect append without bound", () => {
      const source = `
        const QUEUE: Symbol = Symbol::new(&env, "queue");

        pub fn enqueue_if(condition: bool, item: i128) {
            if condition {
                let mut queue: Vec<i128> = env.storage().persistent().get(&QUEUE);
                queue.push_back(item);
                env.storage().persistent().set(&QUEUE, &queue);
            }
        }
      `;
      const report = detectStorageFootprintExpansion(source);

      const appendNoBound = report.findings.find(
        (f) => f.pattern === "append_without_bound"
      );
      expect(appendNoBound).toBeDefined();
      expect(appendNoBound!.ruleId).toBe("SOROBAN-EXP-06");
    });

    it("should report metrics correctly", () => {
      const source = `
        const ITEMS: Symbol = Symbol::new(&env, "items");

        pub fn add_items(new_items: Vec<i128>) {
            for item in new_items.iter() {
                let mut items: Vec<i128> = env.storage().persistent().get(&ITEMS);
                items.push_back(item);
                env.storage().persistent().set(&ITEMS, &items);
            }
        }
      `;
      const report = detectStorageFootprintExpansion(source);

      expect(report.metrics.totalExpansionRisks).toBeGreaterThan(0);
      expect(report.metrics.unboundedRisks).toBeGreaterThanOrEqual(0);
      expect(report.metrics.highSeverityRisks).toBeGreaterThanOrEqual(0);
      expect(report.metrics.functionsAtRisk).toBeGreaterThanOrEqual(0);
    });

    it("should not flag bounded collection operations", () => {
      const source = `
        const MAX_SIZE: Symbol = Symbol::new(&env, "max_size");
        const ITEMS: Symbol = Symbol::new(&env, "items");

        pub fn add_item_bounded(item: i128) {
            let mut items: Vec<i128> = env.storage().persistent().get(&ITEMS);
            if items.len() < 100 {
                items.push_back(item);
                env.storage().persistent().set(&ITEMS, &items);
            }
        }
      `;
      const report = detectStorageFootprintExpansion(source);

      const unboundedRisks = report.findings.filter(
        (f) => f.growthRisk === "unbounded"
      );
      expect(unboundedRisks.length).toBe(0);
    });

    it("should detect multiple risks in same function", () => {
      const source = `
        const DATA: Symbol = Symbol::new(&env, "data");

        pub fn complex_growth(items: Vec<i128>) {
            for item in items.iter() {
                let mut data: Vec<i128> = env.storage().persistent().get(&DATA);
                data.push_back(item);
                env.storage().persistent().set(&DATA, &data);
            }
        }
      `;
      const report = detectStorageFootprintExpansion(source);

      const patterns = report.findings.map((f) => f.pattern);
      expect(patterns).toContain("unbounded_collection_growth");
      expect(patterns).toContain("no_cleanup_mechanism");
    });
  });
});
