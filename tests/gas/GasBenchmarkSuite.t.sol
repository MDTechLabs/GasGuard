// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";

/**
 * @title GasBenchmarkSuite
 * @notice Structured gas benchmarking harness for GasGuard hot paths.
 *
 * Purpose
 * -------
 * Records deployment + runtime gas for a fixed set of "hot path" calls so
 * that optimization PRs can prove savings (or get caught introducing
 * regressions) against a committed `.gas-snapshot` baseline.
 *
 * How it works
 * ------------
 * 1. Each `test_gas_*` function isolates exactly the code path being
 *    measured using `vm.pauseGas()` / `vm.resumeGas()` around any setup
 *    that should NOT count toward the reported number.
 * 2. Deployment gas is measured separately from runtime/invocation gas,
 *    because the two regress independently (bytecode size vs. execution
 *    path cost).
 * 3. `forge snapshot` (using the `--match-contract GasBenchmarkSuite`
 *    flag) writes/compares against `.gas-snapshot` at the repo root.
 *    CI runs `forge snapshot --check` so a PR fails the moment any
 *    labelled gas value increases past tolerance.
 *
 * NOTE: Swap `TargetContract` below for the real contract(s) you want to
 * benchmark (e.g. the config registry, circuit breaker, tiered pricing
 * module, etc). Keeping one suite per logical hot path keeps snapshot
 * diffs readable in PRs.
 */
contract GasBenchmarkSuite is Test {
    // ---------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------

    /// @dev Replace with the real contract under test.
    TargetContract internal target;

    address internal constant USER = address(0xBEEF);
    address internal constant ADMIN = address(0xA11CE);

    function setUp() public {
        vm.pauseGas();
        vm.label(USER, "user");
        vm.label(ADMIN, "admin");
        vm.deal(USER, 10 ether);
        vm.deal(ADMIN, 10 ether);
        vm.resumeGas();
    }

    // ---------------------------------------------------------------
    // 1. Deployment gas
    // ---------------------------------------------------------------

    /// @notice Pure bytecode-deploy cost, isolated from constructor args
    ///         prep or any post-deploy calls.
    function test_gas_deployment() public {
        vm.resumeGas(); // ensure metering is active for the constructor call
        target = new TargetContract(ADMIN);
        vm.pauseGas();

        // Sanity check so a broken deploy doesn't silently report 0 gas.
        assertEq(target.admin(), ADMIN);
    }

    /// @notice Reports raw deployed bytecode size (correlates with, but is
    ///         distinct from, deployment gas — useful for catching bytecode
    ///         bloat that hasn't yet blown the deployment gas budget).
    function test_gas_deployedCodeSize() public {
        vm.pauseGas();
        target = new TargetContract(ADMIN);
        uint256 size = address(target).code.length;
        vm.resumeGas();

        console2.log("deployed bytecode size (bytes):", size);
        vm.pauseGas();
    }

    // ---------------------------------------------------------------
    // 2. Runtime / invocation gas — hot paths
    // ---------------------------------------------------------------

    function _deployFresh() internal {
        vm.pauseGas();
        target = new TargetContract(ADMIN);
        vm.resumeGas();
    }

    /// @notice Cold-storage write path (SSTORE from zero -> non-zero).
    function test_gas_coldWrite() public {
        _deployFresh();

        vm.prank(USER);
        target.setValue(1, 42);

        vm.pauseGas();
    }

    /// @notice Warm-storage overwrite path (SSTORE non-zero -> non-zero).
    function test_gas_warmOverwrite() public {
        _deployFresh();
        vm.prank(USER);
        target.setValue(1, 42);

        vm.resumeGas();
        vm.prank(USER);
        target.setValue(1, 43);
        vm.pauseGas();
    }

    /// @notice Read-heavy hot path.
    function test_gas_read() public {
        _deployFresh();
        vm.prank(USER);
        target.setValue(1, 42);

        vm.resumeGas();
        uint256 v = target.getValue(1);
        vm.pauseGas();

        assertEq(v, 42);
    }

    /// @notice Batch write path — the one most sensitive to loop /
    ///         calldata-decoding optimizations, so it gets its own
    ///         dedicated snapshot line.
    function test_gas_batchWrite_10Items() public {
        _deployFresh();

        uint256[] memory ids = new uint256[](10);
        uint256[] memory values = new uint256[](10);
        for (uint256 i = 0; i < 10; i++) {
            ids[i] = i;
            values[i] = i * 7;
        }

        vm.resumeGas();
        vm.prank(USER);
        target.setValues(ids, values);
        vm.pauseGas();
    }

    /// @notice Access-control gate hot path (modifier overhead).
    function test_gas_adminGatedCall() public {
        _deployFresh();

        vm.resumeGas();
        vm.prank(ADMIN);
        target.adminAction();
        vm.pauseGas();
    }

    // ---------------------------------------------------------------
    // 3. Regression guardrail (optional, non-snapshot assertion)
    // ---------------------------------------------------------------

    /// @notice Hard ceiling as a second line of defense in addition to
    ///         `.gas-snapshot`. Tune GAS_CEILING_COLD_WRITE deliberately;
    ///         it should be looser than the snapshot so the snapshot is
    ///         the primary signal and this only catches egregious blowups.
    uint256 internal constant GAS_CEILING_COLD_WRITE = 60_000;

    function test_gas_coldWrite_withinCeiling() public {
        _deployFresh();

        vm.resumeGas();
        uint256 gasBefore = gasleft();
        vm.prank(USER);
        target.setValue(1, 42);
        uint256 used = gasBefore - gasleft();
        vm.pauseGas();

        assertLt(used, GAS_CEILING_COLD_WRITE, "cold write regressed past ceiling");
    }
}

/**
 * @dev Minimal stand-in target so this suite compiles and runs out of the
 * box. Delete this and point `target` at the real contract(s) you're
 * benchmarking (e.g. ConfigRegistry, CircuitBreaker, TieredPricing).
 */
contract TargetContract {
    address public admin;
    mapping(uint256 => uint256) internal _values;

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    constructor(address _admin) {
        admin = _admin;
    }

    function setValue(uint256 id, uint256 value) external {
        _values[id] = value;
    }

    function getValue(uint256 id) external view returns (uint256) {
        return _values[id];
    }

    function setValues(uint256[] calldata ids, uint256[] calldata values) external {
        require(ids.length == values.length, "length mismatch");
        for (uint256 i = 0; i < ids.length; i++) {
            _values[ids[i]] = values[i];
        }
    }

    function adminAction() external onlyAdmin {
        // no-op, exists purely to measure modifier + call overhead
    }
}
