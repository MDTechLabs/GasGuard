// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title OnChainConfigRegistry
 * @dev Decentralized configuration registry for storing and managing protocol parameters
 *
 * Features:
 * - Structured key-value storage with type safety
 * - Role-based access control for configuration updates
 * - Event emission for all configuration changes
 * - Versioning support for configuration history
 * - Batch operations for efficient updates
 * - Emergency pause functionality integration
 */
contract OnChainConfigRegistry {
    // Configuration value types
    enum ConfigType {
        UINT256,
        ADDRESS,
        BOOL,
        BYTES32,
        STRING
    }

    // Configuration entry structure
    struct ConfigEntry {
        ConfigType configType;
        uint256 uintValue;
        address addressValue;
        bool boolValue;
        bytes32 bytes32Value;
        string stringValue;
        uint256 version;
        uint256 lastUpdated;
        address updatedBy;
        bool exists;
    }

    // State variables
    mapping(bytes32 => ConfigEntry) private configEntries;
    bytes32[] private configKeys;

    // Access control
    address public admin;
    address public configUpdater;
    address public emergencyAdmin;

    // Versioning
    uint256 public currentVersion;
    mapping(uint256 => bytes32[]) private versionSnapshots;

    // Constants for common config keys
    bytes32 public constant FEE_NUMERATOR = keccak256("FEE_NUMERATOR");
    bytes32 public constant FEE_DENOMINATOR = keccak256("FEE_DENOMINATOR");
    bytes32 public constant MAX_TRANSACTION_LIMIT = keccak256("MAX_TRANSACTION_LIMIT");
    bytes32 public constant MIN_TRANSACTION_LIMIT = keccak256("MIN_TRANSACTION_LIMIT");
    bytes32 public constant TREASURY_ADDRESS = keccak256("TREASURY_ADDRESS");
    bytes32 public constant EMERGENCY_PAUSE_ENABLED = keccak256("EMERGENCY_PAUSE_ENABLED");
    bytes32 public constant MAINTENANCE_MODE = keccak256("MAINTENANCE_MODE");

    // Events
    event ConfigUpdated(
        bytes32 indexed key,
        ConfigType configType,
        uint256 version,
        address indexed updatedBy,
        uint256 timestamp
    );

    event ConfigBatchUpdated(
        bytes32[] keys,
        uint256 newVersion,
        address indexed updatedBy,
        uint256 timestamp
    );

    event ConfigDeleted(
        bytes32 indexed key,
        address indexed deletedBy,
        uint256 timestamp
    );

    event VersionCreated(
        uint256 indexed version,
        uint256 configCount,
        address indexed createdBy,
        uint256 timestamp
    );

    // Modifiers
    modifier onlyAdmin() {
        require(msg.sender == admin, "ConfigRegistry: caller is not admin");
        _;
    }

    modifier onlyConfigUpdater() {
        require(
            msg.sender == configUpdater || msg.sender == admin || msg.sender == emergencyAdmin,
            "ConfigRegistry: caller is not authorized to update config"
        );
        _;
    }

    modifier configExists(bytes32 key) {
        require(configEntries[key].exists, "ConfigRegistry: configuration key does not exist");
        _;
    }

    modifier validConfigType(ConfigType configType) {
        require(uint256(configType) <= uint256(ConfigType.STRING), "ConfigRegistry: invalid config type");
        _;
    }

    /**
     * @dev Constructor
     * @param _admin Admin address
     * @param _configUpdater Config updater address
     * @param _emergencyAdmin Emergency admin address
     */
    constructor(address _admin, address _configUpdater, address _emergencyAdmin) {
        require(_admin != address(0), "ConfigRegistry: admin cannot be zero address");
        require(_configUpdater != address(0), "ConfigRegistry: config updater cannot be zero address");

        admin = _admin;
        configUpdater = _configUpdater;
        emergencyAdmin = _emergencyAdmin;

        // Initialize version 1
        currentVersion = 1;
    }

    /**
     * @dev Set a uint256 configuration value
     * @param key Configuration key
     * @param value Configuration value
     */
    function setUint256(bytes32 key, uint256 value) external onlyConfigUpdater {
        _setConfig(key, ConfigType.UINT256, value, address(0), false, bytes32(0), "");
    }

    /**
     * @dev Set an address configuration value
     * @param key Configuration key
     * @param value Configuration value
     */
    function setAddress(bytes32 key, address value) external onlyConfigUpdater {
        require(value != address(0), "ConfigRegistry: address cannot be zero");
        _setConfig(key, ConfigType.ADDRESS, 0, value, false, bytes32(0), "");
    }

    /**
     * @dev Set a boolean configuration value
     * @param key Configuration key
     * @param value Configuration value
     */
    function setBool(bytes32 key, bool value) external onlyConfigUpdater {
        _setConfig(key, ConfigType.BOOL, 0, address(0), value, bytes32(0), "");
    }

    /**
     * @dev Set a bytes32 configuration value
     * @param key Configuration key
     * @param value Configuration value
     */
    function setBytes32(bytes32 key, bytes32 value) external onlyConfigUpdater {
        _setConfig(key, ConfigType.BYTES32, 0, address(0), false, value, "");
    }

    /**
     * @dev Set a string configuration value
     * @param key Configuration key
     * @param value Configuration value
     */
    function setString(bytes32 key, string calldata value) external onlyConfigUpdater {
        _setConfig(key, ConfigType.STRING, 0, address(0), false, bytes32(0), value);
    }

    /**
     * @dev Batch update multiple configurations
     * @param updates Array of configuration updates
     */
    function batchUpdate(ConfigUpdate[] calldata updates) external onlyConfigUpdater {
        require(updates.length > 0, "ConfigRegistry: no updates provided");
        require(updates.length <= 50, "ConfigRegistry: too many updates in batch");

        bytes32[] memory updatedKeys = new bytes32[](updates.length);
        currentVersion++;

        for (uint256 i = 0; i < updates.length; i++) {
            ConfigUpdate memory update = updates[i];
            updatedKeys[i] = update.key;

            _setConfig(
                update.key,
                update.configType,
                update.uintValue,
                update.addressValue,
                update.boolValue,
                update.bytes32Value,
                update.stringValue
            );

            // Update version for this entry
            configEntries[update.key].version = currentVersion;
        }

        // Create version snapshot
        versionSnapshots[currentVersion] = updatedKeys;

        emit ConfigBatchUpdated(updatedKeys, currentVersion, msg.sender, block.timestamp);
        emit VersionCreated(currentVersion, updatedKeys.length, msg.sender, block.timestamp);
    }

    /**
     * @dev Delete a configuration entry
     * @param key Configuration key to delete
     */
    function deleteConfig(bytes32 key) external onlyAdmin configExists(key) {
        delete configEntries[key];

        // Remove from keys array (simplified - in production would need more efficient implementation)
        for (uint256 i = 0; i < configKeys.length; i++) {
            if (configKeys[i] == key) {
                configKeys[i] = configKeys[configKeys.length - 1];
                configKeys.pop();
                break;
            }
        }

        emit ConfigDeleted(key, msg.sender, block.timestamp);
    }

    /**
     * @dev Get uint256 configuration value
     * @param key Configuration key
     * @return Configuration value
     */
    function getUint256(bytes32 key) external view configExists(key) returns (uint256) {
        require(configEntries[key].configType == ConfigType.UINT256, "ConfigRegistry: wrong config type");
        return configEntries[key].uintValue;
    }

    /**
     * @dev Get address configuration value
     * @param key Configuration key
     * @return Configuration value
     */
    function getAddress(bytes32 key) external view configExists(key) returns (address) {
        require(configEntries[key].configType == ConfigType.ADDRESS, "ConfigRegistry: wrong config type");
        return configEntries[key].addressValue;
    }

    /**
     * @dev Get boolean configuration value
     * @param key Configuration key
     * @return Configuration value
     */
    function getBool(bytes32 key) external view configExists(key) returns (bool) {
        require(configEntries[key].configType == ConfigType.BOOL, "ConfigRegistry: wrong config type");
        return configEntries[key].boolValue;
    }

    /**
     * @dev Get bytes32 configuration value
     * @param key Configuration key
     * @return Configuration value
     */
    function getBytes32(bytes32 key) external view configExists(key) returns (bytes32) {
        require(configEntries[key].configType == ConfigType.BYTES32, "ConfigRegistry: wrong config type");
        return configEntries[key].bytes32Value;
    }

    /**
     * @dev Get string configuration value
     * @param key Configuration key
     * @return Configuration value
     */
    function getString(bytes32 key) external view configExists(key) returns (string memory) {
        require(configEntries[key].configType == ConfigType.STRING, "ConfigRegistry: wrong config type");
        return configEntries[key].stringValue;
    }

    /**
     * @dev Get configuration entry details
     * @param key Configuration key
     * @return Complete configuration entry
     */
    function getConfigEntry(bytes32 key) external view configExists(key) returns (ConfigEntry memory) {
        return configEntries[key];
    }

    /**
     * @dev Get all configuration keys
     * @return Array of all configuration keys
     */
    function getAllKeys() external view returns (bytes32[] memory) {
        return configKeys;
    }

    /**
     * @dev Get configuration keys for a specific version
     * @param version Version number
     * @return Array of configuration keys for that version
     */
    function getVersionKeys(uint256 version) external view returns (bytes32[] memory) {
        require(version > 0 && version <= currentVersion, "ConfigRegistry: invalid version");
        return versionSnapshots[version];
    }

    /**
     * @dev Check if configuration key exists
     * @param key Configuration key
     * @return True if key exists
     */
    function configExists(bytes32 key) external view returns (bool) {
        return configEntries[key].exists;
    }

    /**
     * @dev Get configuration count
     * @return Number of configurations
     */
    function getConfigCount() external view returns (uint256) {
        return configKeys.length;
    }

    /**
     * @dev Update admin address
     * @param newAdmin New admin address
     */
    function updateAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "ConfigRegistry: new admin cannot be zero address");
        admin = newAdmin;
    }

    /**
     * @dev Update config updater address
     * @param newUpdater New config updater address
     */
    function updateConfigUpdater(address newUpdater) external onlyAdmin {
        require(newUpdater != address(0), "ConfigRegistry: new updater cannot be zero address");
        configUpdater = newUpdater;
    }

    /**
     * @dev Update emergency admin address
     * @param newEmergencyAdmin New emergency admin address
     */
    function updateEmergencyAdmin(address newEmergencyAdmin) external onlyAdmin {
        emergencyAdmin = newEmergencyAdmin;
    }

    /**
     * @dev Internal function to set configuration
     */
    function _setConfig(
        bytes32 key,
        ConfigType configType,
        uint256 uintValue,
        address addressValue,
        bool boolValue,
        bytes32 bytes32Value,
        string memory stringValue
    ) internal validConfigType(configType) {
        bool isNew = !configEntries[key].exists;

        if (isNew) {
            configKeys.push(key);
        }

        ConfigEntry storage entry = configEntries[key];
        entry.configType = configType;
        entry.uintValue = uintValue;
        entry.addressValue = addressValue;
        entry.boolValue = boolValue;
        entry.bytes32Value = bytes32Value;
        entry.stringValue = stringValue;
        entry.version = currentVersion;
        entry.lastUpdated = block.timestamp;
        entry.updatedBy = msg.sender;
        entry.exists = true;

        emit ConfigUpdated(key, configType, currentVersion, msg.sender, block.timestamp);
    }

    // Struct for batch updates
    struct ConfigUpdate {
        bytes32 key;
        ConfigType configType;
        uint256 uintValue;
        address addressValue;
        bool boolValue;
        bytes32 bytes32Value;
        string stringValue;
    }
}