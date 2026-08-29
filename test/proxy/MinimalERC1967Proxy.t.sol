// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MinimalERC1967Proxy} from "../../contracts/proxy/MinimalERC1967Proxy.sol";

/// @dev A trivial implementation contract to delegatecall into: a counter
/// plus a function that reverts with a specific reason, so the test can
/// verify both successful execution and revert-reason forwarding.
contract CounterImplementation {
    uint256 public count;

    function increment() external {
        count += 1;
    }

    function setCount(uint256 newCount) external {
        count = newCount;
    }

    function alwaysReverts() external pure {
        revert("CounterImplementation: intentional revert");
    }
}

/// @dev A second implementation, used to prove the proxy really does read
/// `_IMPLEMENTATION_SLOT` fresh on every call rather than caching the
/// delegatecall target at construction time. Returns a fixed marker via a
/// pure function rather than a state variable, since a state variable's
/// initial value lives in *this* contract's own storage (set at its own
/// construction) and is never copied into the proxy's storage — only
/// runtime bytecode is shared via delegatecall, not storage contents.
contract MarkerImplementation {
    function version() external pure returns (string memory) {
        return "v2";
    }
}

contract MinimalERC1967ProxyTest is Test {
    // bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
    bytes32 internal constant _IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    CounterImplementation internal counterImpl;
    MinimalERC1967Proxy internal proxy;

    function setUp() public {
        counterImpl = new CounterImplementation();
        proxy = new MinimalERC1967Proxy(address(counterImpl));
    }

    function test_constructor_storesImplementationAtERC1967Slot() public view {
        bytes32 stored = vm.load(address(proxy), _IMPLEMENTATION_SLOT);
        assertEq(address(uint160(uint256(stored))), address(counterImpl));
    }

    function test_constructor_emitsUpgradedEvent() public {
        vm.expectEmit(true, false, false, false);
        emit MinimalERC1967Proxy.Upgraded(address(counterImpl));
        new MinimalERC1967Proxy(address(counterImpl));
    }

    function test_constructor_revertsForNonContractImplementation() public {
        vm.expectRevert(bytes("MinimalERC1967Proxy: not a contract"));
        new MinimalERC1967Proxy(address(0xDEAD));
    }

    function test_delegatecall_executesImplementationLogicAgainstProxyStorage() public {
        CounterImplementation(address(proxy)).increment();
        CounterImplementation(address(proxy)).increment();

        // The counter lives in the PROXY's own storage slot 0 (delegatecall
        // semantics), not the implementation contract's storage.
        assertEq(CounterImplementation(address(proxy)).count(), 2);
        assertEq(counterImpl.count(), 0);
    }

    function testFuzz_delegatecall_setCountRoundTrips(uint256 value) public {
        CounterImplementation(address(proxy)).setCount(value);
        assertEq(CounterImplementation(address(proxy)).count(), value);
    }

    function test_delegatecall_forwardsRevertReasonUnchanged() public {
        vm.expectRevert(bytes("CounterImplementation: intentional revert"));
        CounterImplementation(address(proxy)).alwaysReverts();
    }

    function test_delegatecall_readsImplementationFreshOnEveryCall() public {
        MarkerImplementation markerImpl = new MarkerImplementation();

        // Simulate an upgrade by writing a new implementation address
        // directly to the ERC-1967 slot (this proxy exposes no admin
        // upgrade function itself, per the issue's scope — only the
        // storage-slot read/forward mechanics are in scope here).
        vm.store(address(proxy), _IMPLEMENTATION_SLOT, bytes32(uint256(uint160(address(markerImpl)))));

        assertEq(MarkerImplementation(address(proxy)).version(), "v2");
    }

    function test_receive_forwardsPlainEtherTransfers() public {
        // CounterImplementation has no receive/fallback, so a plain ETH
        // transfer through the proxy's delegatecall path reverts (no
        // payable fallback in the implementation) — this still proves the
        // proxy's own `receive()` is wired to `_delegate()` rather than
        // silently accepting funds outside the delegatecall path.
        vm.deal(address(this), 1 ether);
        (bool success, ) = address(proxy).call{value: 1 ether}("");
        assertFalse(success);
    }
}
