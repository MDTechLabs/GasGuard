
import { detectUnnecessaryConstructorStorageWrites } from '../detect-unnecessary-constructor-storage-writes';

describe('detectUnnecessaryConstructorStorageWrites', () => {
  it('should not detect any issues in a contract with no constructor', () => {
    const code = `
      contract NoConstructor {
        uint256 public value;
      }
    `;
    const result = detectUnnecessaryConstructorStorageWrites(code);
    expect(result.detected).toBe(false);
  });

  it('should not detect any issues in a constructor with no assignments', () => {
    const code = `
      contract NoAssignments {
        constructor() {}
      }
    `;
    const result = detectUnnecessaryConstructorStorageWrites(code);
    expect(result.detected).toBe(false);
  });

  it('should not detect any issues with single assignments', () => {
    const code = `
      contract SingleAssignments {
        uint256 public owner;
        uint256 public value;

        constructor(uint256 _value) {
          owner = msg.sender;
          value = _value;
        }
      }
    `;
    const result = detectUnnecessaryConstructorStorageWrites(code);
    expect(result.detected).toBe(false);
  });

  it('should detect redundant assignments in the constructor', () => {
    const code = `
      contract RedundantAssignments {
        uint256 public value;

        constructor(uint256 _initialValue) {
          value = 100;
          value = _initialValue;
        }
      }
    `;
    const result = detectUnnecessaryConstructorStorageWrites(code);
    expect(result.detected).toBe(true);
    expect(result.superfluousWrites.length).toBe(1);
    expect(result.superfluousWrites[0].variableName).toBe('value');
    expect(result.superfluousWrites[0].line).toBe(7);
  });

  it('should detect multiple redundant assignments for multiple variables', () => {
    const code = `
      contract MultipleRedundantAssignments {
        uint256 public value;
        address public owner;

        constructor(uint256 _initialValue, address _newOwner) {
          value = 100;
          owner = address(0);
          value = _initialValue;
          owner = _newOwner;
        }
      }
    `;
    const result = detectUnnecessaryConstructorStorageWrites(code);
    expect(result.detected).toBe(true);
    expect(result.superfluousWrites.length).toBe(2);
    expect(result.superfluousWrites[0].variableName).toBe('value');
    expect(result.superfluousWrites[0].line).toBe(9);
    expect(result.superfluousWrites[1].variableName).toBe('owner');
    expect(result.superfluousWrites[1].line).toBe(10);
  });

  it('should handle complex constructor logic', () => {
    const code = `
      contract ComplexConstructor {
        uint256 public value;

        constructor(bool _condition, uint256 _value1, uint256 _value2) {
          value = _value1;
          if (_condition) {
            value = _value2;
          }
        }
      }
    `;
    const result = detectUnnecessaryConstructorStorageWrites(code);
    expect(result.detected).toBe(true);
    expect(result.superfluousWrites.length).toBe(1);
    expect(result.superfluousWrites[0].variableName).toBe('value');
  });
});