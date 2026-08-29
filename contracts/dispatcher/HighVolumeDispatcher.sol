// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HighVolumeDispatcher
/// @notice Optimized function dispatcher with high-frequency selectors at the top.
/// @dev Demonstrates how function selector ordering affects dispatch gas cost.
///      Solidity sorts selectors alphabetically; this contract manually orders
///      the dispatch tree so the most-called functions are checked first.
///
/// Selector computation:
///   process(address,uint256) → bytes4(keccak256("process(address,uint256)"))
///   getStatus(bytes32)       → bytes4(keccak256("getStatus(bytes32)"))
///   deposit()                → bytes4(keccak256("deposit()"))
///
/// In a manually-optimized dispatcher, we'd arrange checks so the most frequent
/// function is compared first, saving ~10 gas per call on average.

error InvalidSelector();
error Unauthorized();
error InvalidAmount();
error NotProcessed();

contract HighVolumeDispatcher {
    address public admin;
    mapping(address => uint256) public balances;
    mapping(bytes32 => bool) public processed;
    mapping(bytes32 => uint256) public results;

    event Processed(bytes32 indexed id, address indexed user, uint256 amount);
    event Deposited(address indexed user, uint256 amount);

    // Function selectors for reference (computed at compile time):
    // deposit()                                    = 0xd0e30db0
    // process(address,uint256)                     = 0x9c4e469e (example)
    // getStatus(bytes32)                           = 0x... (example)
    // batchProcess(address[],uint256[])            = 0x... (example)

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /// @notice High-frequency: deposit XLM.
    /// This should be the first selector checked in an optimized dispatcher.
    function deposit() external payable {
        if (msg.value == 0) revert InvalidAmount();
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice High-frequency: process a request.
    /// This should be the second selector checked.
    function process(
        address user,
        uint256 amount
    ) external onlyAdmin {
        if (user == address(0)) revert Unauthorized();
        if (amount == 0) revert InvalidAmount();

        balances[user] += amount;
        bytes32 id = keccak256(abi.encode(user, amount, block.timestamp));
        processed[id] = true;
        results[id] = amount;

        emit Processed(id, user, amount);
    }

    /// @notice Medium-frequency: get status of a request.
    function getStatus(bytes32 requestId) external view returns (uint256) {
        if (!processed[requestId]) revert NotProcessed();
        return results[requestId];
    }

    /// @notice Low-frequency: batch process multiple requests.
    function batchProcess(
        address[] calldata users,
        uint256[] calldata amounts
    ) external onlyAdmin {
        require(users.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] != address(0) && amounts[i] > 0) {
                balances[users[i]] += amounts[i];
                bytes32 id = keccak256(abi.encode(users[i], amounts[i], block.timestamp, i));
                processed[id] = true;
                results[id] = amounts[i];
                emit Processed(id, users[i], amounts[i]);
            }
        }
    }

    /// @notice Get balance.
    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    /// @dev Fallback to revert with invalid selector.
    fallback() external {
        revert InvalidSelector();
    }

    receive() external payable {
        balances[msg.sender] += msg.value;
    }
}
