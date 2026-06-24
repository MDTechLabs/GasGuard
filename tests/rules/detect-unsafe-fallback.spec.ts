import { detectUnsafeFallback } from '../../rules/security/fallbacks/detect-unsafe-fallback';
import { FixtureLoader } from '../../libs/testing/src/fixture-loader';

describe('detectUnsafeFallback', () => {
  // ----------------------------------------------------------------------- //
  //  delegatecall in fallback                                               //
  // ----------------------------------------------------------------------- //
  describe('delegatecall in fallback', () => {
    it('flags fallback with delegatecall to an address variable', () => {
      const code = `
        contract Proxy {
            address public target;

            fallback(bytes calldata data) external returns (bytes memory) {
                (bool success, bytes memory ret) = target.delegatecall(data);
                require(success);
                return ret;
            }
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(true);
      expect(
        result.violations.some((v) => v.kind === 'delegatecall-in-fallback'),
      ).toBe(true);
    });

    it('does NOT flag fallback with delegatecall to an inline address(...) cast', () => {
      const code = `
        contract FixedProxy {
            fallback(bytes calldata data) external returns (bytes memory) {
                (bool success, bytes memory ret) =
                    address(0x1234567890123456789012345678901234567890).delegatecall(data);
                require(success);
                return ret;
            }
        }
      `;
      // The body contains `address(` so the heuristic treats it as a
      // hardcoded / controlled target.
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(false);
    });
  });

  // ----------------------------------------------------------------------- //
  //  state modification in receive                                          //
  // ----------------------------------------------------------------------- //
  describe('state modification in receive()', () => {
    it('flags receive() that modifies a mapping', () => {
      const code = `
        contract Vault {
            mapping(address => uint256) public deposits;

            receive() external payable {
                deposits[msg.sender] += msg.value;
            }
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(true);
      expect(
        result.violations.some(
          (v) => v.kind === 'state-modification-in-receive',
        ),
      ).toBe(true);
    });

    it('does NOT flag receive() that only emits an event', () => {
      const code = `
        contract EventReceiver {
            event Received(address indexed, uint256);

            receive() external payable {
                emit Received(msg.sender, msg.value);
            }
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(false);
    });

    it('does NOT flag empty receive()', () => {
      const code = `
        contract EtherReceiver {
            receive() external payable {}
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(false);
    });
  });

  // ----------------------------------------------------------------------- //
  //  arbitrary external call in fallback                                    //
  // ----------------------------------------------------------------------- //
  describe('arbitrary external call in fallback', () => {
    it('flags fallback that calls to a decoded address', () => {
      const code = `
        contract Router {
            fallback(bytes calldata) external payable {
                address target = abi.decode(msg.data[4:], (address));
                (bool ok,) = target.call{value: msg.value}("");
                require(ok);
            }
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(true);
      expect(
        result.violations.some((v) => v.kind === 'arbitrary-external-call'),
      ).toBe(true);
    });

    it('does NOT flag fallback that does not make external calls', () => {
      const code = `
        contract Logger {
            event Log(bytes data);
            fallback(bytes calldata data) external {
                emit Log(data);
            }
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(false);
    });
  });

  // ----------------------------------------------------------------------- //
  //  reentrancy-vulnerable fallback                                         //
  // ----------------------------------------------------------------------- //
  describe('reentrancy-vulnerable fallback', () => {
    it('flags fallback that makes a value call to msg.sender', () => {
      const code = `
        contract Vulnerable {
            receive() external payable {
                (bool ok,) = msg.sender.call{value: address(this).balance}("");
                require(ok);
            }
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(true);
      expect(
        result.violations.some(
          (v) => v.kind === 'reentrancy-vulnerable-fallback',
        ),
      ).toBe(true);
    });
  });

  // ----------------------------------------------------------------------- //
  //  complex logic in fallback                                              //
  // ----------------------------------------------------------------------- //
  describe('complex logic in fallback', () => {
    it('flags fallback with a for loop', () => {
      const code = `
        contract Distributor {
            address[] public recipients;

            fallback() external payable {
                for (uint256 i = 0; i < recipients.length; i++) {
                    // distribute
                }
            }
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(true);
      expect(
        result.violations.some((v) => v.kind === 'complex-logic-in-fallback'),
      ).toBe(true);
    });
  });

  // ----------------------------------------------------------------------- //
  //  No fallback / receive functions                                        //
  // ----------------------------------------------------------------------- //
  describe('no fallback/receive functions', () => {
    it('returns detected=false when no fallback or receive exists', () => {
      const code = `
        contract Simple {
            function greet() external pure returns (string memory) {
                return "hello";
            }
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(false);
      expect(result.message).toMatch(/No fallback/);
    });
  });

  // ----------------------------------------------------------------------- //
  //  Multiple violations                                                    //
  // ----------------------------------------------------------------------- //
  describe('multiple violations', () => {
    it('reports all violations when a function has several issues', () => {
      const code = `
        contract Bad {
            receive() external payable {
                for (uint256 i = 0; i < 10; i++) {
                    (bool ok,) = msg.sender.call{value: 1 ether}("");
                    require(ok);
                }
            }
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(true);
      const kinds = result.violations.map((v) => v.kind);
      expect(kinds).toContain('reentrancy-vulnerable-fallback');
      expect(kinds).toContain('complex-logic-in-fallback');
    });
  });

  // ----------------------------------------------------------------------- //
  //  Fixture validation                                                     //
  // ----------------------------------------------------------------------- //
  describe('fixture validation', () => {
    it('fixture matches expected structure', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/unsafe-fallback.json',
      );
      expect(fixture.id).toBe('detect-unsafe-fallback-1');
      expect(fixture.expectedFindings).toHaveLength(5);
      expect(fixture.metadata?.category).toBe('security');
    });

    it('detector agrees with fixture violations', () => {
      const fixture = FixtureLoader.loadFixture(
        './tests/rules/fixtures/unsafe-fallback.json',
      );
      const result = detectUnsafeFallback(fixture.input);
      expect(result.detected).toBe(true);

      const kinds = result.violations.map((v) => v.kind);
      expect(kinds).toContain('delegatecall-in-fallback');
      expect(kinds).toContain('state-modification-in-receive');
      expect(kinds).toContain('arbitrary-external-call');
      expect(kinds).toContain('reentrancy-vulnerable-fallback');
      expect(kinds).toContain('complex-logic-in-fallback');
    });
  });

  describe('message and suggestion', () => {
    it('provides a useful message and suggestion when violations are found', () => {
      const code = `
        contract Bad {
            receive() external payable {
                balances[msg.sender] = msg.value;
            }
            mapping(address => uint256) public balances;
        }
      `;
      const result = detectUnsafeFallback(code);
      expect(result.detected).toBe(true);
      expect(result.message).toMatch(/state-modification-in-receive/);
      expect(result.suggestion).toMatch(/Audit every fallback/);
    });
  });
});
