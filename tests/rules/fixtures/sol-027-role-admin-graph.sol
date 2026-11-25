// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract AccessControlBase {
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    mapping(bytes32 => bytes32) internal _roleAdmins;

    modifier onlyRole(bytes32 role) {
        _checkRole(role);
        _;
    }

    function _checkRole(bytes32 role) internal view virtual {}
    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal virtual {
        _roleAdmins[role] = adminRole;
    }
    function _grantRole(bytes32 role, address account) internal virtual {}
}

// 1. Positive: direct escalation + cycle + unprotected mutation
contract VulnerableGovernance is AccessControlBase {
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        // Operator (tier 1) administers Upgrader (tier 3) -> privilege-escalation-edge
        _setRoleAdmin(UPGRADER_ROLE, OPERATOR_ROLE);
        // Self-administering non-root role -> role-admin-cycle
        _setRoleAdmin(MINTER_ROLE, MINTER_ROLE);
    }

    // Unprotected external role-admin mutation
    function rewireAdmin(bytes32 role, bytes32 newAdmin) external {
        _setRoleAdmin(role, newAdmin);
    }
}

// 2. Positive: transitive escalation across inheritance + library helper
library RoleWiringLib {
    function wireManagerAndUpgrader(
        function(bytes32, bytes32) internal setAdminFn,
        bytes32 operatorRole,
        bytes32 managerRole,
        bytes32 upgraderRole
    ) internal {
        setAdminFn(managerRole, operatorRole);
        setAdminFn(upgraderRole, managerRole);
    }
}

contract InheritedBase is AccessControlBase {
    function _wireHierarchy() internal {
        _setRoleAdmin(MANAGER_ROLE, OPERATOR_ROLE);
    }
}

contract TransitiveEscalationVault is InheritedBase {
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _wireHierarchy();
        // Transitive: OPERATOR_ROLE -> MANAGER_ROLE -> UPGRADER_ROLE
        _setRoleAdmin(UPGRADER_ROLE, MANAGER_ROLE);
    }
}

// 3. Positive: unprotected proxy initializer granting UPGRADER_ROLE
contract UnprotectedProxyAdmin is AccessControlBase {
    function initialize(address attacker) external {
        _grantRole(UPGRADER_ROLE, attacker);
    }
}

// 4. Negative: properly hierarchical role-admin graph and guarded initializer
contract SafeUpgradeableProtocol is AccessControlBase {
    modifier initializer() {
        _;
    }

    modifier onlyGovernance() {
        _checkRole(DEFAULT_ADMIN_ROLE);
        _;
    }

    function initialize(address admin, address manager) external initializer {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, manager);
        // Strictly downward: DEFAULT_ADMIN_ROLE -> MANAGER_ROLE -> OPERATOR_ROLE
        _setRoleAdmin(MANAGER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(OPERATOR_ROLE, MANAGER_ROLE);
        _setRoleAdmin(PAUSER_ROLE, MANAGER_ROLE);
    }

    function setPauserAdmin(bytes32 newAdmin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRoleAdmin(PAUSER_ROLE, newAdmin);
    }

    function updateOperatorAdmin() external onlyGovernance {
        _setRoleAdmin(OPERATOR_ROLE, DEFAULT_ADMIN_ROLE);
    }
}
