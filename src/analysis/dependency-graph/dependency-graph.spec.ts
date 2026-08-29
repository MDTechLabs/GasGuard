import { SorobanDependencyAnalyzer } from './index';

describe('SorobanDependencyAnalyzer', () => {
  let analyzer: SorobanDependencyAnalyzer;

  beforeEach(() => {
    analyzer = new SorobanDependencyAnalyzer();
  });

  const mockTokenSource = `
    #![no_std]
    use soroban_sdk::{contract, contractimpl, Env, Address};

    #[contract]
    pub struct Token;

    #[contractimpl]
    impl Token {
        pub fn initialize(env: Env, admin: Address) {
            // init
        }

        pub fn transfer(env: Env, from: Address, to: Address, amount: i127) {
            // transfer
        }
    }
  `;

  const mockVaultSource = `
    #![no_std]
    use soroban_sdk::{contract, contractimpl, Env, Address};
    use crate::token::TokenClient;

    #[contract]
    pub struct Vault;

    #[contractimpl]
    impl Vault {
        pub fn deposit(env: Env, from: Address, token_id: Address, amount: i127) {
            let client = TokenClient::new(&env, &token_id);
            client.transfer(&from, &env.current_contract_address(), &amount);
        }
    }
  `;

  const mockAggregatorSource = `
    #![no_std]
    use soroban_sdk::{contract, contractimpl, Env, Address, symbol_short};

    #[contract]
    pub struct Aggregator;

    #[contractimpl]
    impl Aggregator {
        pub fn trade(env: Env, vault_id: Address) {
            // Call via invoke_contract
            env.invoke_contract::<()>(
                &vault_id,
                &symbol_short!("deposit"),
                (env.current_contract_address(), 100i127).into_val(&env),
            );
        }
    }
  `;

  it('should parse contracts and detect interactions', () => {
    const files = [
      { filePath: 'src/token.rs', source: mockTokenSource },
      { filePath: 'src/vault.rs', source: mockVaultSource },
      { filePath: 'src/aggregator.rs', source: mockAggregatorSource },
    ];

    const graph = analyzer.analyze(files);

    // Assert nodes
    expect(graph.nodes.length).toBe(3);
    const nodeNames = graph.nodes.map(n => n.name);
    expect(nodeNames).toContain('Token');
    expect(nodeNames).toContain('Vault');
    expect(nodeNames).toContain('Aggregator');

    // Assert edges
    // Vault uses TokenClient -> Vault depends on Token (client)
    // Aggregator invokes vault_id -> Aggregator depends on Vault (invoke)
    expect(graph.edges.length).toBe(2);

    const vaultToToken = graph.edges.find(e => e.source === 'Vault' && e.target === 'Token');
    expect(vaultToToken).toBeDefined();
    expect(vaultToToken?.type).toBe('client');

    const aggregatorToVault = graph.edges.find(e => e.source === 'Aggregator' && e.target === 'Vault');
    expect(aggregatorToVault).toBeDefined();
    expect(aggregatorToVault?.type).toBe('invoke');
  });

  it('should detect circular dependencies', () => {
    const circularA = `
      #[contract]
      pub struct ContractA;
      impl ContractA {
          pub fn call_b(env: Env, id: Address) {
              let client = ContractBClient::new(&env, &id);
          }
      }
    `;

    const circularB = `
      #[contract]
      pub struct ContractB;
      impl ContractB {
          pub fn call_a(env: Env, id: Address) {
              let client = ContractAClient::new(&env, &id);
          }
      }
    `;

    const files = [
      { filePath: 'src/a.rs', source: circularA },
      { filePath: 'src/b.rs', source: circularB },
    ];

    analyzer.analyze(files);
    const cycles = analyzer.detectCycles();

    expect(cycles.length).toBeGreaterThan(0);
    const cycle = cycles[0];
    expect(cycle).toContain('ContractA');
    expect(cycle).toContain('ContractB');
  });

  it('should calculate topological deployment order', () => {
    const files = [
      { filePath: 'src/token.rs', source: mockTokenSource },
      { filePath: 'src/vault.rs', source: mockVaultSource },
      { filePath: 'src/aggregator.rs', source: mockAggregatorSource },
    ];

    analyzer.analyze(files);
    const order = analyzer.getTopologicalOrder();

    // Since Aggregator depends on Vault, and Vault depends on Token,
    // Token must be deployed/registered first, then Vault, then Aggregator.
    // Topological sort outputs dependencies first in reverse-order traversal,
    // so Token will be post-visited before Vault, which is post-visited before Aggregator.
    // Hence: ['Token', 'Vault', 'Aggregator']
    expect(order.indexOf('Token')).toBeLessThan(order.indexOf('Vault'));
    expect(order.indexOf('Vault')).toBeLessThan(order.indexOf('Aggregator'));
  });

  it('should generate a valid Mermaid diagram', () => {
    const files = [
      { filePath: 'src/token.rs', source: mockTokenSource },
      { filePath: 'src/vault.rs', source: mockVaultSource },
    ];

    analyzer.analyze(files);
    const mermaid = analyzer.generateMermaid();

    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('Vault["Vault');
    expect(mermaid).toContain('Token["Token');
    expect(mermaid).toContain('Vault -- client --> Token');
  });
});
