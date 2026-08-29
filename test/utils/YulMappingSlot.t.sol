// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {YulMappingSlot, YulMappingSlotConsumer} from "../../contracts/utils/YulMappingSlot.sol";

/// @title YulMappingSlotTest
/// @notice Deploys YulMappingSlotConsumer and verifies the Yul-computed
/// storage slot / read / write paths against the compiler's own
/// `mapping(address => uint256)` codegen for the exact same slot (issue #718).
contract YulMappingSlotTest is Test {
    YulMappingSlotConsumer internal consumer;

    function setUp() public {
        consumer = new YulMappingSlotConsumer();
    }

    /// @dev The reference implementation of the standard Solidity mapping
    /// slot formula, computed independently of the library under test.
    function referenceSlot(address key, uint256 baseSlot) internal pure returns (bytes32) {
        return keccak256(abi.encode(key, baseSlot));
    }

    function test_computeSlot_matchesStandardMappingLayout() public view {
        address user = address(0xBEEF);
        assertEq(consumer.slotFor(user), referenceSlot(user, 0));
    }

    function testFuzz_computeSlot_matchesStandardMappingLayout(address user) public view {
        assertEq(consumer.slotFor(user), referenceSlot(user, 0));
    }

    function test_writeAssembly_isReadableViaCompilerGeneratedAccessor() public {
        address user = address(0xCAFE);
        consumer.writeAssembly(user, 12345);
        // `balances` is a public mapping — the compiler-generated getter
        // must see the exact same value the Yul path wrote.
        assertEq(consumer.balances(user), 12345);
    }

    function testFuzz_writeAssembly_isReadableViaCompilerGeneratedAccessor(
        address user,
        uint256 value
    ) public {
        consumer.writeAssembly(user, value);
        assertEq(consumer.balances(user), value);
        assertEq(consumer.readAssembly(user), value);
    }

    function test_writeSolidity_isReadableViaAssemblyPath() public {
        address user = address(0xD00D);
        consumer.writeSolidity(user, 999);
        // A value written via a normal Solidity assignment must be visible
        // through the Yul-computed slot too — proof the two paths address
        // the exact same storage location, not just produce equal-looking
        // results by coincidence.
        assertEq(consumer.readAssembly(user), 999);
    }

    function testFuzz_writeSolidity_isReadableViaAssemblyPath(address user, uint256 value) public {
        consumer.writeSolidity(user, value);
        assertEq(consumer.readAssembly(user), value);
    }

    function testFuzz_overwriteDoesNotAffectOtherKeys(
        address userA,
        address userB,
        uint256 valueA,
        uint256 valueB
    ) public {
        vm.assume(userA != userB);
        consumer.writeAssembly(userA, valueA);
        consumer.writeAssembly(userB, valueB);
        assertEq(consumer.readAssembly(userA), valueA);
        assertEq(consumer.readAssembly(userB), valueB);
    }

    function testFuzz_overflowEdgeCases_maxUint256RoundTrips(address user) public {
        consumer.writeAssembly(user, type(uint256).max);
        assertEq(consumer.readAssembly(user), type(uint256).max);
        assertEq(consumer.balances(user), type(uint256).max);
    }
}
