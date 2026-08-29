// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CalldataUnpacker
/// @notice Gas-optimized decoder for tightly bit-packed multicall payloads.
/// Each packed entry is exactly 32 bytes — a 20-byte recipient address
/// followed by a 12-byte `uint96` amount, concatenated back-to-back with
/// none of the standard ABI's 32-byte-per-field padding. Entries are decoded
/// straight off `calldata` with `calldataload` and bit shifts, so unpacking
/// never allocates an intermediate `memory` array the way `abi.decode` does.
contract CalldataUnpacker {
    /// @dev Size in bytes of a single packed entry (20-byte address +
    /// 12-byte uint96).
    uint256 private constant ENTRY_SIZE = 32;

    /// @dev Standard ABI-encoded comparison format used only by
    /// {multicallAbiDecodeBaseline} to benchmark against.
    struct Entry {
        address recipient;
        uint96 amount;
    }

    error InvalidPayloadLength();

    event Unpacked(address indexed recipient, uint96 amount);

    mapping(address => uint256) public totalReceived;

    /// @notice Decodes and processes a batch of transfers from a tightly
    /// packed payload (`entryCount * 32` bytes, no ABI padding), reading
    /// every field directly from `calldata`.
    /// @param payload The packed entries, concatenated back-to-back.
    /// @return processed Number of entries decoded and applied.
    function unpackBatch(bytes calldata payload) external returns (uint256 processed) {
        uint256 length = payload.length;
        if (length == 0 || length % ENTRY_SIZE != 0) revert InvalidPayloadLength();

        uint256 entryCount = length / ENTRY_SIZE;
        for (uint256 i = 0; i < entryCount; ) {
            (address recipient, uint96 amount) = _unpackEntry(payload, i);
            totalReceived[recipient] += amount;
            emit Unpacked(recipient, amount);
            unchecked {
                ++i;
            }
        }

        processed = entryCount;
    }

    /// @notice Exposes {_unpackEntry} for direct unit testing / gas
    /// measurement of a single decode.
    function decodeEntryAt(bytes calldata payload, uint256 index) external pure returns (address recipient, uint96 amount) {
        return _unpackEntry(payload, index);
    }

    /// @notice Standard `abi.decode` baseline: the same batch of transfers,
    /// but ABI-encoded as `Entry[]` (32-byte-padded per field, plus offset
    /// and length words), decoded into a `memory` array the conventional
    /// way. Used to measure the gas savings {unpackBatch} achieves.
    function multicallAbiDecodeBaseline(bytes calldata payload) external returns (uint256 processed) {
        Entry[] memory entries = abi.decode(payload, (Entry[]));
        for (uint256 i = 0; i < entries.length; ) {
            totalReceived[entries[i].recipient] += entries[i].amount;
            emit Unpacked(entries[i].recipient, entries[i].amount);
            unchecked {
                ++i;
            }
        }
        processed = entries.length;
    }

    /// @dev Reads the 32-byte word at `payload[index * 32 : index * 32 + 32]`
    /// directly from calldata and splits it into a 20-byte address (top
    /// bits) and a 12-byte uint96 amount (bottom bits) via shifts — no
    /// bounds-padded ABI field, no memory copy.
    function _unpackEntry(bytes calldata payload, uint256 index) private pure returns (address recipient, uint96 amount) {
        assembly {
            let word := calldataload(add(payload.offset, mul(index, 32)))
            recipient := shr(96, word)
            amount := and(word, sub(shl(96, 1), 1))
        }
    }
}
