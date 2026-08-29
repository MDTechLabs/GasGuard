import { CallGraphBuilder, ContractFile } from './call-graph-builder';

describe('CallGraphBuilder (Multi-Contract Execution Call-Graph Generator)', () => {
  let builder: CallGraphBuilder;

  beforeEach(() => {
    builder = new CallGraphBuilder({
      defaultBaseGasInternal: 200,
      defaultBaseGasExternal: 21000,
      sstoreGasCost: 20000,
      sloadGasCost: 2100,
      callOverheadGas: 2600,
    });
  });

  it('should parse multi-contract import graphs and construct nodes & entry points', () => {
    const files: ContractFile[] = [
      {
        path: 'contracts/Vault.sol',
        content: `
          import "./Token.sol";
          contract Vault {
            address public token;
            uint256 public totalDeposits;

            function deposit(uint256 amount) external payable {
              totalDeposits = totalDeposits + amount;
              Token.transferFrom(msg.sender, address(this), amount);
            }

            function withdraw(uint256 amount) public {
              helperCheck();
              Token.transfer(msg.sender, amount);
            }

            function helperCheck() internal view {}
          }
        `,
      },
      {
        path: 'contracts/Token.sol',
        content: `
          contract Token {
            mapping(address => uint256) public balances;

            function transfer(address to, uint256 amount) public returns (bool) {
              balances[msg.sender] = balances[msg.sender] - amount;
              balances[to] = balances[to] + amount;
              return true;
            }

            function transferFrom(address from, address to, uint256 amount) external returns (bool) {
              balances[from] = balances[from] - amount;
              balances[to] = balances[to] + amount;
              return true;
            }
          }
        `,
      },
    ];

    const graph = builder.parseContracts(files);

    expect(graph.contracts).toContain('Vault');
    expect(graph.contracts).toContain('Token');

    // Entry points should include external/public functions
    expect(graph.entryPoints).toContain('Vault::deposit');
    expect(graph.entryPoints).toContain('Vault::withdraw');
    expect(graph.entryPoints).toContain('Token::transfer');
    expect(graph.entryPoints).toContain('Token::transferFrom');

    // Verify Vault::deposit node
    const depositNode = graph.nodes.get('Vault::deposit');
    expect(depositNode).toBeDefined();
    expect(depositNode?.visibility).toBe('external');
    expect(depositNode?.isPayable).toBe(true);
    expect(depositNode?.stateAccesses).toContain('totalDeposits');
  });

  it('should detect cross-contract external calls and internal function calls', () => {
    const files: ContractFile[] = [
      {
        path: 'contracts/Bank.sol',
        content: `
          contract Bank {
            function processPayouts() external {
              audit();
              Vault.deposit(100);
            }

            function audit() internal {}
          }
        `,
      },
    ];

    const graph = builder.parseContracts(files);

    const internalEdge = graph.edges.find(
      (e) => e.sourceId === 'Bank::processPayouts' && e.targetId === 'Bank::audit'
    );
    expect(internalEdge).toBeDefined();
    expect(internalEdge?.callType).toBe('internal');

    const crossContractEdge = graph.edges.find(
      (e) => e.sourceId === 'Bank::processPayouts' && e.targetContract === 'Vault'
    );
    expect(crossContractEdge).toBeDefined();
    expect(crossContractEdge?.targetFunction).toBe('deposit');
  });

  it('should flag calls made inside loops with loop multipliers', () => {
    const files: ContractFile[] = [
      {
        path: 'contracts/BatchPayer.sol',
        content: `
          contract BatchPayer {
            function batchDistribute(address[] memory recipients) external {
              for (uint i = 0; i < recipients.length; i++) {
                Token.transfer(recipients[i], 100);
              }
            }
          }
        `,
      },
    ];

    const graph = builder.parseContracts(files);
    const loopEdge = graph.edges.find((e) => e.sourceId === 'BatchPayer::batchDistribute');

    expect(loopEdge).toBeDefined();
    expect(loopEdge?.isInLoop).toBe(true);
    expect(loopEdge?.loopMultiplier).toBe(10);
  });
});
