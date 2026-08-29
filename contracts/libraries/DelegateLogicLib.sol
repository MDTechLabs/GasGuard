// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DelegateLogicLib
/// @notice Heavy, reusable computation extracted out of `CompactImplementation`.
/// @dev Every function below is declared `public`, so the compiler emits it
/// as a *separately deployable* library contract and replaces each call
/// site in `CompactImplementation` with a small `DELEGATECALL`/`CALL` stub —
/// unlike `internal` library functions, which the compiler inlines into
/// every caller's own bytecode and which therefore provide no deployment
/// size benefit. Keeping the logic here means `CompactImplementation` stays
/// well under the EIP-170 24,576-byte limit no matter how much this library
/// grows.
library DelegateLogicLib {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    struct Tier {
        uint256 minVolume;
        uint256 discountBps;
    }

    /// @notice Resolves which fee tier `volume` falls into out of `tiers`
    /// (sorted ascending by `minVolume`) and returns its discount, in basis
    /// points.
    function resolveTierDiscount(Tier[] memory tiers, uint256 volume) public pure returns (uint256 discountBps) {
        for (uint256 i = tiers.length; i > 0; ) {
            unchecked {
                --i;
            }
            if (volume >= tiers[i].minVolume) {
                return tiers[i].discountBps;
            }
        }
        return 0;
    }

    /// @notice Applies a basis-point discount to `amount`.
    function applyDiscount(uint256 amount, uint256 discountBps) public pure returns (uint256) {
        if (discountBps >= BPS_DENOMINATOR) return 0;
        return amount - ((amount * discountBps) / BPS_DENOMINATOR);
    }

    /// @notice Resolves a caller's tier once and applies its discount across
    /// an entire batch of raw fees, returning the subsidized total.
    function computeBatchFee(Tier[] memory tiers, uint256 cumulativeVolume, uint256[] memory rawFees)
        public
        pure
        returns (uint256 total)
    {
        uint256 discountBps = resolveTierDiscount(tiers, cumulativeVolume);
        for (uint256 i = 0; i < rawFees.length; ) {
            total += applyDiscount(rawFees[i], discountBps);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Rolling-window rate-limit check. `windowUsage` decays
    /// linearly to zero over `windowSize`; returns whether adding
    /// `requested` more usage stays within `limit`, plus the resulting
    /// usage value to persist.
    function checkRateLimit(uint256 windowUsage, uint256 elapsed, uint256 windowSize, uint256 limit, uint256 requested)
        public
        pure
        returns (bool allowed, uint256 newUsage)
    {
        uint256 decayed = elapsed >= windowSize ? 0 : windowUsage - ((windowUsage * elapsed) / windowSize);
        newUsage = decayed + requested;
        allowed = newUsage <= limit;
    }

    /// @notice Recovers the signer of an EIP-191 personal-sign digest over
    /// `hash`, used to authorize privileged tier updates without needing
    /// bespoke access-control code inline in the implementation contract.
    function recoverAuthorizer(bytes32 hash, bytes memory signature) public pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) v += 27;

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        return ecrecover(ethSignedHash, v, r, s);
    }
}
