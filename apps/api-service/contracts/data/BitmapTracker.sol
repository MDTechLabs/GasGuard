// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title BitmapTracker
/// @notice Demonstrates replacing `mapping(uint256 => bool)` flag storage with a
///         packed bitmap, so 256 boolean flags share a single 32-byte storage slot
///         instead of each flag paying for its own slot.
/// @dev Gas motivation
///      -------------
///      A `mapping(uint256 => bool)` writes to a brand-new storage slot for every
///      distinct key the first time it is set (~20,000 gas, `SSTORE` from a zero
///      slot). A bitmap instead maps `index / 256` to a `uint256` "bucket" and
///      flips a single bit (`index % 256`) inside it. Once a bucket has been
///      touched once (i.e. any one of its 256 flags has been set), setting any
///      of the other 255 flags in that same bucket only pays the "warm, non-zero
///      to non-zero" `SSTORE` cost (a few thousand gas) instead of the fresh-slot
///      cost, because the slot the EVM touches already holds a non-zero value.
///
///      The same underlying mechanism (`_buckets`) is exposed through three
///      semantically named accessor pairs — operational flags, processed nonces
///      and user claims — because in a real deployment these are conceptually
///      distinct namespaces (you don't want a nonce and a claim id to collide on
///      the same bit) even though the bit-twiddling code is identical. Each
///      namespace gets its own bucket mapping so callers can't accidentally
///      collide indices across namespaces.
contract BitmapTracker {
    /// @dev One bucket = 256 packed boolean flags. `_buckets[namespace][bucketIndex]`
    ///      is a `uint256` whose bit `i` represents flag `bucketIndex * 256 + i`.
    ///      Namespaces are kept in separate mappings (rather than a shared one
    ///      keyed by an enum) purely for clarity/type-safety at the call site;
    ///      the bit-shift logic below is shared via internal helpers.
    mapping(uint256 => uint256) private _operationalFlags;
    mapping(uint256 => uint256) private _processedNonces;
    mapping(uint256 => uint256) private _userClaims;

    /// @notice Generic bitmap accessor, used directly by tests to exercise the
    ///         core set/isSet mechanism without tying assertions to any one
    ///         named namespace.
    mapping(uint256 => uint256) private _generic;

    event FlagSet(uint256 indexed index);
    event NonceProcessed(uint256 indexed nonce);
    event ClaimRecorded(uint256 indexed claimId);

    // ------------------------------------------------------------------
    // Generic bitmap (demonstrates the core pattern)
    // ------------------------------------------------------------------

    /// @notice Returns whether `index` is set in the generic bitmap.
    /// @dev `index / 256` selects the storage slot ("bucket"); `index % 256`
    ///      selects which of the 256 bits inside that word to read. The
    ///      right-shift by `index % 256` moves the target bit into bit 0,
    ///      then `& 1` isolates it.
    function isSet(uint256 index) public view returns (bool) {
        return _isSet(_generic, index);
    }

    /// @notice Sets `index` in the generic bitmap.
    /// @dev `1 << (index % 256)` builds a mask with a single bit at the target
    ///      position; OR-ing it into the bucket sets that bit while leaving
    ///      every other flag in the same 256-bit word untouched.
    function set(uint256 index) public {
        _set(_generic, index);
        emit FlagSet(index);
    }

    /// @notice Clears `index` in the generic bitmap.
    function unset(uint256 index) public {
        _unset(_generic, index);
    }

    // ------------------------------------------------------------------
    // Operational flags namespace
    // ------------------------------------------------------------------

    function isOperationalFlagSet(uint256 index) external view returns (bool) {
        return _isSet(_operationalFlags, index);
    }

    function setOperationalFlag(uint256 index) external {
        _set(_operationalFlags, index);
        emit FlagSet(index);
    }

    // ------------------------------------------------------------------
    // Processed nonces namespace (e.g. relayer / meta-tx replay protection)
    // ------------------------------------------------------------------

    function isNonceProcessed(uint256 nonce) external view returns (bool) {
        return _isSet(_processedNonces, nonce);
    }

    function markNonceProcessed(uint256 nonce) external {
        require(!_isSet(_processedNonces, nonce), "BitmapTracker: nonce already processed");
        _set(_processedNonces, nonce);
        emit NonceProcessed(nonce);
    }

    // ------------------------------------------------------------------
    // User claims namespace (e.g. airdrop / whitelist claim tracking)
    // ------------------------------------------------------------------

    function isClaimed(uint256 claimId) external view returns (bool) {
        return _isSet(_userClaims, claimId);
    }

    function recordClaim(uint256 claimId) external {
        require(!_isSet(_userClaims, claimId), "BitmapTracker: already claimed");
        _set(_userClaims, claimId);
        emit ClaimRecorded(claimId);
    }

    // ------------------------------------------------------------------
    // Shared bit-shift helpers
    // ------------------------------------------------------------------

    function _isSet(mapping(uint256 => uint256) storage bucket, uint256 index) private view returns (bool) {
        uint256 bucketIndex = index >> 8; // index / 256
        uint256 bitOffset = index & 0xff; // index % 256
        uint256 word = bucket[bucketIndex];
        return (word >> bitOffset) & 1 == 1;
    }

    function _set(mapping(uint256 => uint256) storage bucket, uint256 index) private {
        uint256 bucketIndex = index >> 8; // index / 256
        uint256 bitOffset = index & 0xff; // index % 256
        bucket[bucketIndex] |= (1 << bitOffset);
    }

    function _unset(mapping(uint256 => uint256) storage bucket, uint256 index) private {
        uint256 bucketIndex = index >> 8;
        uint256 bitOffset = index & 0xff;
        bucket[bucketIndex] &= ~(1 << bitOffset);
    }
}
