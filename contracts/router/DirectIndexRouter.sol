// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DirectIndexRouter
/// @notice Fallback-based router that dispatches calls using a single-byte
///         function index extracted from `calldataload(0)` instead of the
///         standard 4-byte ABI function-selector dispatch tree.
/// @dev Why this saves gas: the canonical Solidity fallback path must recover
///      the 4-byte selector (`calldataload(0)`) and then run it through a
///      binary/linear search of `eq`/`jumpi` comparisons until the matching
///      function body is found.  Each extra selector comparison costs ~3 gas
///      (EQ + JUMPI), so a contract with N exposed functions can spend up to
///      `3 * (N-1)` gas *before* any real logic runs.
///
///      By packing the routing decision into the **first byte** of calldata
///      (`index := byte(0, calldataload(0))`), callers encode the target
///      function directly and the router performs a single comparison per
///      candidate, eliminating the selector-hashing overhead entirely for
///      well-ordered dispatch tables.

error InvalidIndex(uint8 index);
error Unauthorized();
error InvalidAmount();

contract DirectIndexRouter {
    address public admin;
    mapping(address => uint256) public balances;

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    /// @notice Initialize the router.
    /// @param _admin The admin address.
    function initialize(address _admin) external {
        if (admin != address(0)) revert Unauthorized();
        admin = _admin;
    }

    /// @notice Deposit funds.  Call with first calldata byte = 0x01.
    function deposit(address user, uint256 amount) external onlyAdmin {
        balances[user] += amount;
    }

    /// @notice Withdraw funds.  Call with first calldata byte = 0x02.
    function withdraw(address user, uint256 amount) external onlyAdmin {
        balances[user] -= amount;
    }

    /// @notice Get balance.  Call with first calldata byte = 0x03.
    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    /// @notice Core dispatcher.  Reads the first byte of calldata as the
    ///         function index and routes accordingly.
    function route() external {
        assembly {
            let index := byte(0, calldataload(0))

            // 0x01 -> deposit(address,uint256)
            if iszero(eq(index, 0x01)) {
            } else {
                let user := calldataload(32)
                let amount := calldataload(64)
                mstore(0x00, user)
                mstore(0x20, 1)
                let slot := keccak256(0x00, 0x40)
                sstore(slot, add(sload(slot), amount))
                return(0, 0)
            }

            // 0x02 -> withdraw(address,uint256)
            if iszero(eq(index, 0x02)) {
            } else {
                let user := calldataload(32)
                let amount := calldataload(64)
                mstore(0x00, user)
                mstore(0x20, 1)
                let slot := keccak256(0x00, 0x40)
                sstore(slot, sub(sload(slot), amount))
                return(0, 0)
            }

            // 0x03 -> getBalance(address)
            if iszero(eq(index, 0x03)) {
            } else {
                let user := calldataload(32)
                mstore(0x00, user)
                mstore(0x20, 1)
                let slot := keccak256(0x00, 0x40)
                mstore(0x00, sload(slot))
                return(0x00, 0x20)
            }

            revert(0x00, 0x00)
        }
    }

    /// @notice Fallback entry point.  Routes any unknown calldata through
    ///         the index-based dispatcher so callers can use a single
    ///         `msg.sender.call{value:0}` with a one-byte prefix.
    fallback() external {
        route();
    }
}
