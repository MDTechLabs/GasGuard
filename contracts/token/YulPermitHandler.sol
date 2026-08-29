// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title YulPermitHandler
/// @notice Executes ERC-20 EIP-2612 permit calls using zero-allocation Yul assembly.
/// @dev Avoids abi.encodeWithSelector and dynamic memory allocation for improved gas efficiency.

error PermitCallFailed();

interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

contract YulPermitHandler {
    /// @dev permit(address,address,uint256,uint256,uint8,bytes32,bytes32)
    bytes4 private constant PERMIT_SELECTOR =
        bytes4(
            keccak256(
                "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)"
            )
        );

    /// @notice Executes an ERC20 permit using inline Yul.
    /// @param token Address of the ERC20 token supporting EIP-2612.
    /// @param owner Token owner.
    /// @param spender Approved spender.
    /// @param value Allowance amount.
    /// @param deadline Permit deadline.
    /// @param v Signature recovery id.
    /// @param r Signature parameter.
    /// @param s Signature parameter.
    function executePermit(
        address token,
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        bool success;

        assembly {
            // -----------------------------------------------------------------
            // Scratch Memory Layout (0x00 - 0xE3)
            //
            // 0x00 : selector (4 bytes)
            // 0x04 : owner
            // 0x24 : spender
            // 0x44 : value
            // 0x64 : deadline
            // 0x84 : v
            // 0xA4 : r
            // 0xC4 : s
            //
            // Total calldata size = 4 + (7 * 32) = 228 bytes (0xE4)
            // -----------------------------------------------------------------

            let ptr := 0x00

            // Function selector (left-shifted into the first 4 bytes)
            mstore(ptr, shl(224, PERMIT_SELECTOR))

            // Arguments
            mstore(add(ptr, 0x04), owner)
            mstore(add(ptr, 0x24), spender)
            mstore(add(ptr, 0x44), value)
            mstore(add(ptr, 0x64), deadline)
            mstore(add(ptr, 0x84), v)
            mstore(add(ptr, 0xA4), r)
            mstore(add(ptr, 0xC4), s)

            // Execute permit()
            success := call(
                gas(),
                token,
                0,
                ptr,
                0xE4,
                0,
                0
            )

            // Bubble up any revert reason from the token contract
            if iszero(success) {
                let size := returndatasize()

                if gt(size, 0) {
                    returndatacopy(0x00, 0x00, size)
                    revert(0x00, size)
                }
            }
        }

        // Fallback custom error if no revert data exists
        if (!success) {
            revert PermitCallFailed();
        }
    }
}