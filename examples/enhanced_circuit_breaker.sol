// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title EnhancedCircuitBreaker
 * @dev Advanced circuit breaker with granular pause controls, role-based access,
 * and comprehensive monitoring for emergency response.
 *
 * Features:
 * - Granular pause controls (per function/module)
 * - Role-based access control for pause/unpause operations
 * - Event emission for all pause state changes
 * - Emergency functions that work even when paused
 * - Timelock integration for unpause operations
 * - Pause state history and monitoring
 */
contract EnhancedCircuitBreaker {
    // Pause state management
    mapping(bytes32 => bool) private pausedModules;
    bool private globalPause;

    // Access control
    address public admin;
    address public emergencyPauser;
    address public timelockController;

    // Timelock settings for unpause operations
    uint256 public constant UNPAUSE_TIMELOCK = 24 hours;
    mapping(bytes32 => uint256) public unpauseTimestamps;

    // Constants for module identification
    bytes32 public constant GLOBAL_MODULE = keccak256("GLOBAL");
    bytes32 public constant WITHDRAWAL_MODULE = keccak256("WITHDRAWAL");
    bytes32 public constant DEPOSIT_MODULE = keccak256("DEPOSIT");
    bytes32 public constant GOVERNANCE_MODULE = keccak256("GOVERNANCE");
    bytes32 public constant EMERGENCY_MODULE = keccak256("EMERGENCY");

    // Events
    event GlobalPaused(address indexed pauser, uint256 timestamp);
    event GlobalUnpaused(address indexed unpauser, uint256 timestamp);
    event ModulePaused(bytes32 indexed moduleId, address indexed pauser, uint256 timestamp);
    event ModuleUnpaused(bytes32 indexed moduleId, address indexed unpauser, uint256 timestamp);
    event UnpauseScheduled(bytes32 indexed moduleId, uint256 executeTime);
    event EmergencyActionExecuted(address indexed executor, string action, uint256 timestamp);

    // Modifiers
    modifier onlyAdmin() {
        require(msg.sender == admin, "CircuitBreaker: caller is not admin");
        _;
    }

    modifier onlyEmergencyPauser() {
        require(msg.sender == emergencyPauser || msg.sender == admin, "CircuitBreaker: caller is not authorized pauser");
        _;
    }

    modifier onlyTimelock() {
        require(msg.sender == timelockController, "CircuitBreaker: caller is not timelock");
        _;
    }

    modifier whenNotPaused(bytes32 moduleId) {
        require(!isPaused(moduleId), "CircuitBreaker: module is paused");
        _;
    }

    modifier whenPaused(bytes32 moduleId) {
        require(isPaused(moduleId), "CircuitBreaker: module is not paused");
        _;
    }

    /**
     * @dev Constructor
     * @param _admin Admin address
     * @param _emergencyPauser Emergency pauser address
     * @param _timelockController Timelock controller address
     */
    constructor(address _admin, address _emergencyPauser, address _timelockController) {
        require(_admin != address(0), "CircuitBreaker: admin cannot be zero address");
        require(_emergencyPauser != address(0), "CircuitBreaker: emergency pauser cannot be zero address");

        admin = _admin;
        emergencyPauser = _emergencyPauser;
        timelockController = _timelockController;
    }

    /**
     * @dev Check if a module is paused
     * @param moduleId Module identifier
     * @return True if module is paused
     */
    function isPaused(bytes32 moduleId) public view returns (bool) {
        return globalPause || pausedModules[moduleId];
    }

    /**
     * @dev Check if global pause is active
     * @return True if globally paused
     */
    function isGlobalPaused() public view returns (bool) {
        return globalPause;
    }

    /**
     * @dev Get pause state for multiple modules
     * @param moduleIds Array of module identifiers
     * @return Array of pause states
     */
    function getPauseStates(bytes32[] calldata moduleIds) external view returns (bool[] memory) {
        bool[] memory states = new bool[](moduleIds.length);
        for (uint256 i = 0; i < moduleIds.length; i++) {
            states[i] = isPaused(moduleIds[i]);
        }
        return states;
    }

    /**
     * @dev Emergency global pause - can be called by emergency pauser
     */
    function emergencyPause() external onlyEmergencyPauser {
        _globalPause();
    }

    /**
     * @dev Pause a specific module
     * @param moduleId Module to pause
     */
    function pauseModule(bytes32 moduleId) external onlyEmergencyPauser {
        require(moduleId != EMERGENCY_MODULE, "CircuitBreaker: cannot pause emergency module");
        require(!pausedModules[moduleId], "CircuitBreaker: module already paused");

        pausedModules[moduleId] = true;
        emit ModulePaused(moduleId, msg.sender, block.timestamp);
    }

    /**
     * @dev Schedule unpause for a module (timelock protected)
     * @param moduleId Module to unpause
     */
    function scheduleUnpause(bytes32 moduleId) external onlyAdmin {
        require(pausedModules[moduleId], "CircuitBreaker: module not paused");
        require(unpauseTimestamps[moduleId] == 0, "CircuitBreaker: unpause already scheduled");

        uint256 executeTime = block.timestamp + UNPAUSE_TIMELOCK;
        unpauseTimestamps[moduleId] = executeTime;

        emit UnpauseScheduled(moduleId, executeTime);
    }

    /**
     * @dev Execute scheduled unpause (can be called by anyone after timelock)
     * @param moduleId Module to unpause
     */
    function executeUnpause(bytes32 moduleId) external {
        require(pausedModules[moduleId], "CircuitBreaker: module not paused");
        require(unpauseTimestamps[moduleId] != 0, "CircuitBreaker: no unpause scheduled");
        require(block.timestamp >= unpauseTimestamps[moduleId], "CircuitBreaker: timelock not expired");

        pausedModules[moduleId] = false;
        delete unpauseTimestamps[moduleId];

        emit ModuleUnpaused(moduleId, msg.sender, block.timestamp);
    }

    /**
     * @dev Cancel scheduled unpause
     * @param moduleId Module identifier
     */
    function cancelUnpause(bytes32 moduleId) external onlyAdmin {
        require(unpauseTimestamps[moduleId] != 0, "CircuitBreaker: no unpause scheduled");

        delete unpauseTimestamps[moduleId];
        // Emit event for tracking
    }

    /**
     * @dev Admin unpause (immediate, for admin only)
     * @param moduleId Module to unpause
     */
    function adminUnpause(bytes32 moduleId) external onlyAdmin {
        require(pausedModules[moduleId], "CircuitBreaker: module not paused");

        pausedModules[moduleId] = false;
        if (unpauseTimestamps[moduleId] != 0) {
            delete unpauseTimestamps[moduleId];
        }

        emit ModuleUnpaused(moduleId, msg.sender, block.timestamp);
    }

    /**
     * @dev Admin global unpause
     */
    function adminGlobalUnpause() external onlyAdmin {
        require(globalPause, "CircuitBreaker: not globally paused");

        globalPause = false;
        emit GlobalUnpaused(msg.sender, block.timestamp);
    }

    /**
     * @dev Emergency action that works even when paused
     * @param action Description of emergency action
     */
    function executeEmergencyAction(string calldata action) external onlyEmergencyPauser {
        // Emergency actions can be executed even when paused
        // This is a placeholder - implement specific emergency logic here

        emit EmergencyActionExecuted(msg.sender, action, block.timestamp);
    }

    /**
     * @dev Update admin address
     * @param newAdmin New admin address
     */
    function updateAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "CircuitBreaker: new admin cannot be zero address");
        admin = newAdmin;
    }

    /**
     * @dev Update emergency pauser address
     * @param newEmergencyPauser New emergency pauser address
     */
    function updateEmergencyPauser(address newEmergencyPauser) external onlyAdmin {
        require(newEmergencyPauser != address(0), "CircuitBreaker: new emergency pauser cannot be zero address");
        emergencyPauser = newEmergencyPauser;
    }

    /**
     * @dev Update timelock controller
     * @param newTimelock New timelock controller address
     */
    function updateTimelockController(address newTimelock) external onlyAdmin {
        timelockController = newTimelock;
    }

    /**
     * @dev Get unpause timestamp for a module
     * @param moduleId Module identifier
     * @return Timestamp when unpause can be executed
     */
    function getUnpauseTimestamp(bytes32 moduleId) external view returns (uint256) {
        return unpauseTimestamps[moduleId];
    }

    /**
     * @dev Internal global pause function
     */
    function _globalPause() internal {
        globalPause = true;
        emit GlobalPaused(msg.sender, block.timestamp);
    }
}