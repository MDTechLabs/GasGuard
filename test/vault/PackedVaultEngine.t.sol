// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PackedVaultEngine} from "../../contracts/vault/PackedVaultEngine.sol";

contract PackedVaultEngineTest is Test {
    PackedVaultEngine internal vault;
    address internal alice = address(0xA11CE);

    function setUp() public {
        vault = new PackedVaultEngine();
    }

    function test_deposit_setsBalanceAssetIdAndLockTimestamp() public {
        vm.prank(alice);
        vault.deposit(7, 1000, 1 days);

        (uint128 balance, uint32 assetId, uint64 lockTimestamp) = vault.getPosition(alice, 7);
        assertEq(balance, 1000);
        assertEq(assetId, 7);
        assertEq(lockTimestamp, block.timestamp + 1 days);
    }

    function test_deposit_accumulatesBalanceAcrossMultipleDeposits() public {
        vm.startPrank(alice);
        vault.deposit(1, 100, 1 hours);
        vault.deposit(1, 250, 1 hours);
        vm.stopPrank();

        (uint128 balance, , ) = vault.getPosition(alice, 1);
        assertEq(balance, 350);
    }

    function test_separateAssetIds_doNotShareBalance() public {
        vm.startPrank(alice);
        vault.deposit(1, 100, 1 hours);
        vault.deposit(2, 999, 1 hours);
        vm.stopPrank();

        (uint128 balance1, , ) = vault.getPosition(alice, 1);
        (uint128 balance2, , ) = vault.getPosition(alice, 2);
        assertEq(balance1, 100);
        assertEq(balance2, 999);
    }

    function test_withdraw_revertsWhileLocked() public {
        vm.startPrank(alice);
        vault.deposit(1, 500, 1 days);

        vm.expectRevert(
            abi.encodeWithSelector(
                PackedVaultEngine.PositionLocked.selector,
                uint64(block.timestamp + 1 days),
                uint64(block.timestamp)
            )
        );
        vault.withdraw(1, 100);
        vm.stopPrank();
    }

    function test_withdraw_succeedsAfterLockElapses() public {
        vm.startPrank(alice);
        vault.deposit(1, 500, 1 days);
        vm.warp(block.timestamp + 1 days);
        vault.withdraw(1, 200);
        vm.stopPrank();

        (uint128 balance, , ) = vault.getPosition(alice, 1);
        assertEq(balance, 300);
    }

    function test_withdraw_doesNotChangeAssetIdOrLockTimestampField() public {
        vm.startPrank(alice);
        vault.deposit(9, 500, 1 days);
        vm.warp(block.timestamp + 1 days);
        vault.withdraw(9, 100);
        vm.stopPrank();

        (uint128 balance, uint32 assetId, uint64 lockTimestamp) = vault.getPosition(alice, 9);
        assertEq(balance, 400);
        assertEq(assetId, 9);
        assertEq(lockTimestamp, block.timestamp); // set to (deposit time + 1 days) which now equals current time
    }

    function test_withdraw_revertsOnInsufficientBalance() public {
        vm.startPrank(alice);
        vault.deposit(1, 100, 0);
        vm.expectRevert(
            abi.encodeWithSelector(PackedVaultEngine.InsufficientBalance.selector, uint128(100), uint128(101))
        );
        vault.withdraw(1, 101);
        vm.stopPrank();
    }

    function test_deposit_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(PackedVaultEngine.ZeroAmount.selector);
        vault.deposit(1, 0, 0);
    }

    function test_withdraw_revertsOnZeroAmount() public {
        vm.startPrank(alice);
        vault.deposit(1, 100, 0);
        vm.expectRevert(PackedVaultEngine.ZeroAmount.selector);
        vault.withdraw(1, 0);
        vm.stopPrank();
    }

    /// @dev Depositing past `type(uint128).max` must revert (checked
    /// uint128 arithmetic), not silently wrap into the adjacent assetId
    /// bits — the exact bug bit-packing without care could introduce.
    function test_deposit_revertsOnBalanceOverflow() public {
        vm.startPrank(alice);
        vault.deposit(1, type(uint128).max, 0);
        vm.expectRevert();
        vault.deposit(1, 1, 0);
        vm.stopPrank();
    }

    function testFuzz_depositWithdraw_neverCorruptsAssetIdOrLockTimestamp(
        uint32 assetId,
        uint96 depositAmount,
        uint96 withdrawAmount,
        uint32 lockDuration
    ) public {
        vm.assume(depositAmount > 0);
        vm.assume(withdrawAmount <= depositAmount);

        vm.startPrank(alice);
        vault.deposit(assetId, depositAmount, lockDuration);
        vm.warp(block.timestamp + lockDuration);

        if (withdrawAmount > 0) {
            vault.withdraw(assetId, withdrawAmount);
        }
        vm.stopPrank();

        (uint128 balance, uint32 storedAssetId, uint64 lockTimestamp) = vault.getPosition(alice, assetId);
        assertEq(balance, uint256(depositAmount) - withdrawAmount);
        assertEq(storedAssetId, assetId);
        assertEq(lockTimestamp, block.timestamp);
    }

    function testFuzz_multipleAssetPositions_areIndependent(
        uint32 assetIdA,
        uint32 assetIdB,
        uint96 amountA,
        uint96 amountB
    ) public {
        vm.assume(assetIdA != assetIdB);
        vm.assume(amountA > 0 && amountB > 0);

        vm.startPrank(alice);
        vault.deposit(assetIdA, amountA, 0);
        vault.deposit(assetIdB, amountB, 0);
        vm.stopPrank();

        (uint128 balanceA, uint32 storedA, ) = vault.getPosition(alice, assetIdA);
        (uint128 balanceB, uint32 storedB, ) = vault.getPosition(alice, assetIdB);
        assertEq(balanceA, amountA);
        assertEq(storedA, assetIdA);
        assertEq(balanceB, amountB);
        assertEq(storedB, assetIdB);
    }

    function testFuzz_overflowEdgeCase_depositAtMaxUint128ThenOneMoreReverts(uint32 assetId) public {
        vm.startPrank(alice);
        vault.deposit(assetId, type(uint128).max, 0);
        vm.expectRevert();
        vault.deposit(assetId, 1, 0);
        vm.stopPrank();
    }

    function testFuzz_withdrawMoreThanBalance_alwaysReverts(
        uint32 assetId,
        uint96 depositAmount,
        uint96 excess
    ) public {
        vm.assume(depositAmount > 0);
        vm.assume(excess > 0);
        vm.assume(uint256(depositAmount) + excess <= type(uint128).max);

        vm.startPrank(alice);
        vault.deposit(assetId, depositAmount, 0);
        vm.expectRevert();
        vault.withdraw(assetId, uint128(uint256(depositAmount) + excess));
        vm.stopPrank();
    }
}
