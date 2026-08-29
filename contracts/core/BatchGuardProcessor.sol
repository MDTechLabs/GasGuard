// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BatchGuardProcessor
/// @notice Batch processing contract using calldata parameters for external functions.
/// @dev All external functions use `calldata` instead of `memory` for reference types
///      to avoid unnecessary memory allocation and calldata-to-memory copying.

error InvalidLength();
error ZeroAddress();
error BatchTooLarge();
error OperationFailed();

contract BatchGuardProcessor {
    struct TransferRequest {
        address from;
        address to;
        uint256 amount;
    }

    struct BatchResult {
        bool success;
        uint256 gasUsed;
        string reason;
    }

    mapping(address => uint256) public balances;
    uint256 public totalProcessed;

    event BatchProcessed(uint256 count, uint256 totalGas);
    event TransferCompleted(address from, address to, uint256 amount);

    uint256 public constant MAX_BATCH_SIZE = 100;

    /// @notice Process a batch of transfers using calldata (not memory).
    /// @param requests Array of transfer requests stored in calldata.
    /// @return results Array of batch results.
    function processBatch(
        calldata TransferRequest[] requests
    ) external returns (BatchResult[] memory results) {
        if (requests.length == 0) revert InvalidLength();
        if (requests.length > MAX_BATCH_SIZE) revert BatchTooLarge();

        results = new BatchResult[](requests.length);
        uint256 startGas = gasleft();

        for (uint256 i = 0; i < requests.length; i++) {
            calldata TransferRequest memory req = requests[i];

            if (req.from == address(0) || req.to == address(0)) {
                results[i] = BatchResult(false, 0, "Zero address");
                continue;
            }

            if (balances[req.from] < req.amount) {
                results[i] = BatchResult(false, 0, "Insufficient balance");
                continue;
            }

            uint256 gasBefore = gasleft();
            balances[req.from] -= req.amount;
            balances[req.to] += req.amount;
            uint256 gasAfter = gasleft();

            totalProcessed++;
            results[i] = BatchResult(true, gasBefore - gasAfter, "");
            emit TransferCompleted(req.from, req.to, req.amount);
        }

        emit BatchProcessed(requests.length, startGas - gasleft());
    }

    /// @notice Validate a batch of addresses using calldata.
    /// @param addresses Array of addresses to validate.
    /// @return valid Array of booleans indicating validity.
    function validateAddresses(
        calldata address[] addresses
    ) external view returns (bool[] memory valid) {
        valid = new bool[](addresses.length);
        for (uint256 i = 0; i < addresses.length; i++) {
            valid[i] = addresses[i] != address(0);
        }
    }

    /// @notice Compute checksums for a batch of amounts using calldata.
    /// @param amounts Array of amounts.
    /// @return checksums Array of keccak256 checksums.
    function computeChecksums(
        calldata uint256[] amounts
    ) external view returns (bytes32[] memory checksums) {
        checksums = new bytes32[](amounts.length);
        for (uint256 i = 0; i < amounts.length; i++) {
            checksums[i] = keccak256(abi.encode(amounts[i], i));
        }
    }

    /// @notice Deposit funds.
    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }
}
