import { classifyStorageEntries, StorageEntryClassificationReport } from "../storage-entry-classifier";

describe("SorobanStorageEntryClassifier", () => {
  describe("classifyStorageEntries", () => {
    it("should return empty report for source with no storage accesses", () => {
      const source = `
        pub fn noop() {}
      `;
      const report = classifyStorageEntries(source);
      expect(report.entries).toHaveLength(0);
      expect(report.metrics.totalEntries).toBe(0);
      expect(report.summary).toContain("No storage entries detected");
    });

    it("should classify configuration entries correctly", () => {
      const source = `
        const ADMIN: Symbol = Symbol::new(&env, "admin");
        const FEE_RATE: Symbol = Symbol::new(&env, "fee_rate");

        pub fn get_admin() -> Address {
            env.storage().instance().get(&ADMIN)
        }

        pub fn set_admin(new_admin: Address) {
            env.storage().instance().set(&ADMIN, &new_admin);
        }

        pub fn get_fee_rate() -> u32 {
            env.storage().persistent().get(&FEE_RATE)
        }
      `;
      const report = classifyStorageEntries(source);
      expect(report.entries.length).toBeGreaterThan(0);

      const adminEntry = report.entries.find((e) => e.key === "admin");
      expect(adminEntry).toBeDefined();
      expect(adminEntry!.category).toBe("configuration");
      expect(adminEntry!.confidence).toBe("high");

      const feeRateEntry = report.entries.find((e) => e.key === "fee_rate");
      expect(feeRateEntry).toBeDefined();
      expect(feeRateEntry!.category).toBe("configuration");
    });

    it("should classify access control entries", () => {
      const source = `
        const ROLE: Symbol = Symbol::new(&env, "role");
        const PAUSED: Symbol = Symbol::new(&env, "paused");

        pub fn check_role(addr: Address) -> bool {
            env.storage().persistent().get(&ROLE)
        }

        pub fn is_paused() -> bool {
            env.storage().instance().get(&PAUSED)
        }
      `;
      const report = classifyStorageEntries(source);

      const roleEntry = report.entries.find((e) => e.key === "role");
      expect(roleEntry).toBeDefined();
      expect(roleEntry!.category).toBe("access_control");

      const pausedEntry = report.entries.find((e) => e.key === "paused");
      expect(pausedEntry).toBeDefined();
      expect(pausedEntry!.category).toBe("access_control");
    });

    it("should classify token-related entries", () => {
      const source = `
        const TOTAL_SUPPLY: Symbol = Symbol::new(&env, "total_supply");
        const BALANCE: Symbol = Symbol::new(&env, "balance");
        const DECIMALS: Symbol = Symbol::new(&env, "decimals");

        pub fn get_total_supply() -> i128 {
            env.storage().instance().get(&TOTAL_SUPPLY)
        }

        pub fn get_balance(addr: Address) -> i128 {
            env.storage().persistent().get(&BALANCE)
        }

        pub fn get_decimals() -> u32 {
            env.storage().instance().get(&DECIMALS)
        }
      `;
      const report = classifyStorageEntries(source);

      const supplyEntry = report.entries.find((e) => e.key === "total_supply");
      expect(supplyEntry).toBeDefined();
      expect(["token", "counter"]).toContain(supplyEntry!.category);

      const balanceEntry = report.entries.find((e) => e.key === "balance");
      expect(balanceEntry).toBeDefined();
      expect(balanceEntry!.category).toBe("token");
    });

    it("should classify counter entries", () => {
      const source = `
        const NONCE: Symbol = Symbol::new(&env, "nonce");
        const COUNTER: Symbol = Symbol::new(&env, "counter");

        pub fn get_nonce() -> u64 {
            env.storage().persistent().get(&NONCE)
        }

        pub fn increment_counter() {
            let current: u32 = env.storage().persistent().get(&COUNTER);
            env.storage().persistent().set(&COUNTER, &(current + 1));
        }
      `;
      const report = classifyStorageEntries(source);

      const nonceEntry = report.entries.find((e) => e.key === "nonce");
      expect(nonceEntry).toBeDefined();
      expect(nonceEntry!.category).toBe("counter");

      const counterEntry = report.entries.find((e) => e.key === "counter");
      expect(counterEntry).toBeDefined();
      expect(counterEntry!.category).toBe("counter");
    });

    it("should detect cache entries in persistent storage as misclassified", () => {
      const source = `
        const CACHE: Symbol = Symbol::new(&env, "cache");
        const TEMP_BUFFER: Symbol = Symbol::new(&env, "temp_buffer");

        pub fn get_cache() -> i128 {
            env.storage().persistent().get(&CACHE)
        }

        pub fn get_buffer() -> i128 {
            env.storage().persistent().get(&TEMP_BUFFER)
        }
      `;
      const report = classifyStorageEntries(source);

      const cacheEntry = report.entries.find((e) => e.key === "cache");
      expect(cacheEntry).toBeDefined();
      expect(cacheEntry!.category).toBe("cache");

      const misclassWarnings = report.misclassificationWarnings.filter(
        (w) => w.ruleId === "SOROBAN-STOR-CLASS-01"
      );
      expect(misclassWarnings.length).toBeGreaterThan(0);
    });

    it("should detect configuration in temporary storage as misclassified", () => {
      const source = `
        const ADMIN: Symbol = Symbol::new(&env, "admin");

        pub fn get_admin_temp() -> Address {
            env.storage().temporary().get(&ADMIN)
        }
      `;
      const report = classifyStorageEntries(source);

      const misclassWarnings = report.misclassificationWarnings.filter(
        (w) => w.ruleId === "SOROBAN-STOR-CLASS-02"
      );
      expect(misclassWarnings.length).toBeGreaterThan(0);
      expect(misclassWarnings[0].currentTier).toBe("temporary");
      expect(misclassWarnings[0].suggestedTier).toBe("persistent");
    });

    it("should track access types per entry", () => {
      const source = `
        const BALANCE: Symbol = Symbol::new(&env, "balance");

        pub fn update_balance(addr: Address, amount: i128) {
            env.storage().persistent().set(&BALANCE, &amount);
        }

        pub fn read_balance(addr: Address) -> i128 {
            env.storage().persistent().get(&BALANCE)
        }
      `;
      const report = classifyStorageEntries(source);

      const balanceEntry = report.entries.find((e) => e.key === "balance");
      expect(balanceEntry).toBeDefined();
      expect(balanceEntry!.accessTypes.has("set")).toBe(true);
      expect(balanceEntry!.accessTypes.has("get")).toBe(true);
      expect(balanceEntry!.writeCount).toBe(1);
      expect(balanceEntry!.readCount).toBe(1);
    });

    it("should report metrics by category and tier", () => {
      const source = `
        const ADMIN: Symbol = Symbol::new(&env, "admin");
        const BALANCE: Symbol = Symbol::new(&env, "balance");
        const NONCE: Symbol = Symbol::new(&env, "nonce");

        pub fn init() {
            env.storage().instance().set(&ADMIN, &Address::zero());
            env.storage().persistent().set(&BALANCE, &0);
            env.storage().temporary().set(&NONCE, &0);
        }
      `;
      const report = classifyStorageEntries(source);

      expect(report.metrics.totalEntries).toBe(3);
      expect(report.metrics.byTier.instance).toBe(1);
      expect(report.metrics.byTier.persistent).toBe(1);
      expect(report.metrics.byTier.temporary).toBe(1);
      expect(report.metrics.byCategory.configuration).toBe(1);
      expect(report.metrics.byCategory.token).toBe(1);
      expect(report.metrics.byCategory.counter).toBe(1);
    });

    it("should classify metadata entries", () => {
      const source = `
        const VERSION: Symbol = Symbol::new(&env, "version");
        const CREATED: Symbol = Symbol::new(&env, "created_at");

        pub fn get_version() -> u32 {
            env.storage().instance().get(&VERSION)
        }

        pub fn get_created() -> u64 {
            env.storage().persistent().get(&CREATED)
        }
      `;
      const report = classifyStorageEntries(source);

      const versionEntry = report.entries.find((e) => e.key === "version");
      expect(versionEntry).toBeDefined();
      expect(versionEntry!.category).toBe("metadata");
    });
  });
});
