import { SorobanFunctionInventoryGenerator } from './function-inventory-generator';

const SOURCE = `
impl VaultContract {
  pub fn new(env: Env) -> Self { Self {} }
  pub fn deposit(env: Env, amount: i128, token: Address) {}
  pub fn withdraw(env: Env, amount: i128) {}
  fn calculate_fee(amount: i128) -> i128 { amount / 100 }
  fn validate_caller(env: &Env) -> bool { true }
}
`;

describe('SorobanFunctionInventoryGenerator', () => {
  let generator: SorobanFunctionInventoryGenerator;

  beforeEach(() => {
    generator = new SorobanFunctionInventoryGenerator();
  });

  describe('generate', () => {
    it('should extract contract name', () => {
      const inv = generator.generate(SOURCE, 'contracts/vault.rs');
      expect(inv.contractName).toBe('VaultContract');
    });

    it('should enumerate public and private functions', () => {
      const inv = generator.generate(SOURCE, 'contracts/vault.rs');
      expect(inv.publicCount).toBe(3);
      expect(inv.privateCount).toBe(2);
      expect(inv.totalCount).toBe(5);
    });

    it('should mark constructor functions', () => {
      const inv = generator.generate(SOURCE, 'contracts/vault.rs');
      const ctor = inv.functions.find((f) => f.name === 'new');
      expect(ctor?.isConstructor).toBe(true);
    });

    it('should include file path and timestamp', () => {
      const inv = generator.generate(SOURCE, 'contracts/vault.rs');
      expect(inv.filePath).toBe('contracts/vault.rs');
      expect(inv.generatedAt).toBeInstanceOf(Date);
    });
  });

  describe('with includePrivate=false', () => {
    it('should exclude private functions', () => {
      const gen = new SorobanFunctionInventoryGenerator({ includePrivate: false });
      const inv = gen.generate(SOURCE, 'vault.rs');
      expect(inv.privateCount).toBe(0);
      expect(inv.totalCount).toBe(inv.publicCount + inv.internalCount);
    });
  });
});
