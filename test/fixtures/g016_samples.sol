// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract G016Sample {
    // Flagged: redundant payable double-cast.
    function redundantCast(address addr) external pure returns (address) {
        return address(payable(addr));
    }

    // Flagged: redundant uint160 round-trip.
    function redundantUint160(uint160 x) external pure returns (address) {
        return address(uint160(x));
    }

    // Flagged: redundant triple-cast chain.
    function redundantTripleCast(uint256 x) external pure returns (address) {
        return address(uint160(uint256(x)));
    }

    // Not flagged: necessary bytes32 -> address narrowing.
    function necessaryConversion(bytes32 b) external pure returns (address) {
        return address(uint256(b));
    }
}
