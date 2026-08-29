// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BatchBalanceChecker
/// @notice Gas-optimized view helper that queries `balanceOf(address)` for
/// multiple ERC-20 tokens across multiple accounts in a single call, using
/// low-level `staticcall`s instead of per-token high-level interface calls.
/// @dev Non-contract addresses or tokens that revert on `balanceOf` yield a
/// `0` entry for that (token, account) pair instead of reverting the whole
/// batch, so a single misbehaving token can't block the rest of the query.
/// Deployed once and queried directly (no state, no constructor args), akin
/// to a lightweight on-chain multicall helper.
contract BatchBalanceChecker {
    /// @notice Queries `balanceOf(account)` for every (token, account) pair
    /// in the Cartesian product of `tokens` x `accounts`.
    /// @param tokens The ERC-20 token addresses to query.
    /// @param accounts The accounts to query balances for.
    /// @return balances A flat array of length `tokens.length * accounts.length`,
    /// laid out as `balances[i * accounts.length + j]` = balance of
    /// `accounts[j]` in `tokens[i]`. Entries default to `0` for calls that
    /// revert or target a non-contract address.
    function batchBalances(address[] memory tokens, address[] memory accounts)
        external
        view
        returns (uint256[] memory balances)
    {
        uint256 tokenCount = tokens.length;
        uint256 accountCount = accounts.length;
        balances = new uint256[](tokenCount * accountCount);

        // keccak256("balanceOf(address)") selector, built once in memory
        // scratch space and reused for every staticcall.
        // Safety: writes only to scratch memory (0x00-0x44); makes only
        // `staticcall`s (no state mutation possible); loop bound is fixed
        // by input array lengths, no unbounded external growth.
        // Gas: builds the 4-byte selector + address calldata once outside
        // the loop instead of re-encoding via `abi.encodeWithSelector` on
        // every iteration.
        assembly {
            // Store selector for balanceOf(address) = 0x70a08231, left-padded
            // to 4 bytes at memory offset 0x00.
            mstore(0x00, 0x70a0823100000000000000000000000000000000000000000000000000000000)

            let tokensData := add(tokens, 0x20)
            let accountsData := add(accounts, 0x20)
            let balancesData := add(balances, 0x20)

            for { let i := 0 } lt(i, tokenCount) { i := add(i, 1) } {
                let token := mload(add(tokensData, mul(i, 0x20)))
                let rowOffset := mul(i, accountCount)

                for { let j := 0 } lt(j, accountCount) { j := add(j, 1) } {
                    let account := mload(add(accountsData, mul(j, 0x20)))

                    // Encode the account argument right after the selector.
                    mstore(0x04, account)

                    // staticcall(gas, target, argsOffset, argsSize, retOffset, retSize)
                    let success := staticcall(gas(), token, 0x00, 0x24, 0x24, 0x20)

                    let value := 0
                    if and(success, gt(returndatasize(), 0x1f)) {
                        value := mload(0x24)
                    }

                    mstore(add(balancesData, mul(add(rowOffset, j), 0x20)), value)
                }
            }
        }
    }
}
