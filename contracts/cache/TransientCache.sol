// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TransientCache
/// @notice EIP-1153 transient storage cache for intra-transaction computation results.
/// @dev Uses TSTORE/TLOAD opcodes (Cancun+) to cache intermediate values without
///      persistent storage writes, saving ~19,900 gas per avoided SSTORE.
library TransientCache {
    /// @dev Store a value in transient storage at the given slot.
    function tstore(bytes32 slot, bytes32 value) internal {
        assembly {
            tstore(slot, value)
        }
    }

    /// @dev Load a value from transient storage at the given slot.
    function tload(bytes32 slot) internal view returns (bytes32 value) {
        assembly {
            value := tload(slot)
        }
    }

    /// @dev Store a uint256 value.
    function tstoreUint(bytes32 slot, uint256 value) internal {
        assembly {
            tstore(slot, value)
        }
    }

    /// @dev Load a uint256 value.
    function tloadUint(bytes32 slot) internal view returns (uint256 value) {
        assembly {
            value := tload(slot)
        }
    }

    /// @dev Store an address value (zero-extended to 32 bytes).
    function tstoreAddr(bytes32 slot, address value) internal {
        assembly {
            tstore(slot, value)
        }
    }

    /// @dev Load an address value.
    function tloadAddr(bytes32 slot) internal view returns (address value) {
        assembly {
            value := tload(slot)
        }
    }

    /// @dev Clear a transient storage slot by writing zero.
    function tclear(bytes32 slot) internal {
        assembly {
            tstore(slot, 0)
        }
    }
}

/// @title TransientCacheConsumer
/// @notice Example contract demonstrating transient storage for fee calculation caching.
/// @dev Caches exchange rate and fee computations within a single transaction to avoid
///      repeated expensive storage reads and intermediate calculations.
contract TransientCacheConsumer {
    using TransientCache for bytes32;

    struct CachedFee {
        bytes32 rateSlot;
        bytes32 feeSlot;
        bytes32 initializedSlot;
    }

    // Storage slots for persistent state
    mapping(address => uint256) public balances;
    uint256 public baseFeeRate;

    // Transient cache slot offsets per user (derived from user address)
    bytes32 private constant RATE_BASE = keccak256("transient.rate");
    bytes32 private constant FEE_BASE = keccak256("transient.fee");
    bytes32 private constant INIT_BASE = keccak256("transient.init");

    event FeeCalculated(address indexed user, uint256 rate, uint256 fee);
    event CacheCleared(address indexed user);

    error ZeroAmount();
    error CacheAlreadyInitialized();

    /// @notice Calculate fee for a user, caching intermediate results in transient storage.
    /// @param user The user address to calculate fees for.
    /// @param amount The input amount.
    /// @return fee The calculated fee.
    function calculateFee(address user, uint256 amount) external returns (uint256 fee) {
        if (amount == 0) revert ZeroAmount();

        bytes32 rateSlot = bytes32(uint256(RATE_BASE) + uint256(uint160(user)));
        bytes32 feeSlot = bytes32(uint256(FEE_BASE) + uint256(uint160(user)));
        bytes32 initSlot = bytes32(uint256(INIT_BASE) + uint256(uint160(user)));

        // Check if already cached this transaction
        if (initSlot.tloadUint() == 1) {
            // Return cached fee
            fee = feeSlot.tloadUint();
            emit FeeCalculated(user, rateSlot.tloadUint(), fee);
            return fee;
        }

        // Compute and cache exchange rate (simulated expensive computation)
        uint256 rate = baseFeeRate;
        // Simulate multi-step rate computation
        rate = rate * (1e18 + uint256(keccak256(abi.encode(user, block.timestamp))) % 1000) / 1e18;

        // Compute fee from rate and amount
        fee = amount * rate / 1e18;

        // Cache results in transient storage
        rateSlot.tstoreUint(rate);
        feeSlot.tstoreUint(fee);
        initSlot.tstoreUint(1);

        emit FeeCalculated(user, rate, fee);
    }

    /// @notice Clear transient cache for a user (called at end of complex operations).
    /// @param user The user whose cache to clear.
    function clearCache(address user) external {
        bytes32 rateSlot = bytes32(uint256(RATE_BASE) + uint256(uint160(user)));
        bytes32 feeSlot = bytes32(uint256(FEE_BASE) + uint256(uint160(user)));
        bytes32 initSlot = bytes32(uint256(INIT_BASE) + uint256(uint160(user)));

        rateSlot.tclear();
        feeSlot.tclear();
        initSlot.tclear();

        emit CacheCleared(user);
    }

    /// @notice Batch calculate fees for multiple users using transient caching.
    /// @param users Array of user addresses.
    /// @param amounts Array of input amounts.
    /// @return fees Array of calculated fees.
    function batchCalculateFee(
        address[] calldata users,
        uint256[] calldata amounts
    ) external returns (uint256[] memory fees) {
        require(users.length == amounts.length, "Length mismatch");
        fees = new uint256[](users.length);

        for (uint256 i = 0; i < users.length; i++) {
            fees[i] = this.calculateFee(users[i], amounts[i]);
        }

        // Clear all caches after batch
        for (uint256 i = 0; i < users.length; i++) {
            this.clearCache(users[i]);
        }
    }
}
