// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DelegateLogicLib} from "../libraries/DelegateLogicLib.sol";

/// @title CompactImplementation
/// @notice Upgradeable tiered-fee logic contract for GasGuard's gas-subsidy
/// module. Every non-trivial computation — tier resolution, discount math,
/// batch fee aggregation, rolling rate limiting and signature recovery — is
/// delegated to {DelegateLogicLib}'s external library functions rather than
/// implemented inline, keeping this contract's own deployed bytecode small
/// and comfortably clear of the EIP-170 24,576-byte limit.
/// @dev Intended to sit behind a minimal proxy (e.g. EIP-1967); the pattern
/// demonstrated here is what keeps *this* implementation contract compact
/// as its feature set grows — new logic should be added to
/// `DelegateLogicLib`, not inlined here.
contract CompactImplementation {
    error NotAuthorizer();
    error RateLimited();

    address public authorizer;
    DelegateLogicLib.Tier[] public tiers;

    mapping(address => uint256) public cumulativeVolume;
    mapping(address => uint256) public rateWindowUsage;
    mapping(address => uint256) public rateWindowStart;

    uint256 public constant RATE_WINDOW_SIZE = 1 hours;
    uint256 public rateLimit;

    event TierUpdated(uint256 index, uint256 minVolume, uint256 discountBps);
    event FeeCharged(address indexed account, uint256 amount);

    constructor(address authorizer_, uint256 rateLimit_) {
        authorizer = authorizer_;
        rateLimit = rateLimit_;
    }

    /// @notice Adds a new fee tier. Requires a signature from `authorizer`
    /// over the tier parameters instead of bespoke inline access control.
    function setTier(uint256 minVolume, uint256 discountBps, bytes calldata signature) external {
        bytes32 digest = keccak256(abi.encode(address(this), minVolume, discountBps));
        if (DelegateLogicLib.recoverAuthorizer(digest, signature) != authorizer) revert NotAuthorizer();

        tiers.push(DelegateLogicLib.Tier({minVolume: minVolume, discountBps: discountBps}));
        emit TierUpdated(tiers.length - 1, minVolume, discountBps);
    }

    /// @notice Charges a batch of raw fees for `msg.sender`, applying their
    /// resolved tier discount and enforcing the rolling rate limit.
    function chargeBatch(uint256[] calldata rawFees) external returns (uint256 total) {
        (bool allowed, uint256 newUsage) = DelegateLogicLib.checkRateLimit(
            rateWindowUsage[msg.sender],
            block.timestamp - rateWindowStart[msg.sender],
            RATE_WINDOW_SIZE,
            rateLimit,
            rawFees.length
        );
        if (!allowed) revert RateLimited();

        rateWindowUsage[msg.sender] = newUsage;
        rateWindowStart[msg.sender] = block.timestamp;

        total = DelegateLogicLib.computeBatchFee(tiers, cumulativeVolume[msg.sender], rawFees);
        cumulativeVolume[msg.sender] += total;

        emit FeeCharged(msg.sender, total);
    }

    function tierCount() external view returns (uint256) {
        return tiers.length;
    }
}
