const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OnChainConfigRegistry", function () {
  let configRegistry;
  let admin, configUpdater, emergencyAdmin, user;
  let ConfigRegistry;

  beforeEach(async function () {
    [admin, configUpdater, emergencyAdmin, user] = await ethers.getSigners();
 // describe('Granular Pause Control Validation', () => {
  //   it('should recognize secure circuit breaker implementations', async () => {
  //     const secureCircuitBreaker = fs.readFileSync(
  //       path.join(__dirname, '../../examples/enhanced_circuit_breaker.sol'),
  //       'utf8'
  //     );
    ConfigRegistry = await ethers.getContractFactory("OnChainConfigRegistry");
    configRegistry = await ConfigRegistry.deploy(admin.address, configUpdater.address, emergencyAdmin.address);
    await configRegistry.deployed();
  });






// git commit -m "feat: GraphQL scan API, rule metadata registry, confidence scoring and cross-language reusability

// - feat(#269): implement GraphQL API for scan results
//   · Create GraphQL schema for scans in src/modules/graphql/
//   · Queries: getScan, listScans, getScanResults with field selection
//   · Filter support: by severity, rule, language, date range, status
//   · GraphQL endpoint functional and registered in apps/api/
//   · Resolvers wired to existing scan result data layer
//   · Schema documented with descriptions on all types and fields

// - feat(#270): implement rule metadata registry
//   · Create queryable rule registry in src/registry/rules/
//   · Store rule descriptions, severity levels and tags per rule
//   · Registry queryable by id, severity, tag, language and category
//   · All existing rules registered with complete metadata entries
//   · Registry serves as single source of truth for rule discoverability
//   · Structured for extension — new rules register via standard interface

// - feat(#271): implement auto-fix confidence scoring
//   · Create confidence scoring engine in src/auto-fix/scoring/
//   · Assign confidence levels: high, medium, low per fix suggestion
//   · Scoring based on: rule certainty, AST match quality, fix complexity
//   · Confidence scores surfaced in scan reports alongside each fix
//   · Users can filter auto-fix suggestions by minimum confidence threshold
//   · Scores displayed clearly in report output for informed decision-making

// - feat(#272): implement cross-language rule reusability
//   · Abstract common gas analysis patterns in libs/analysis-core/
//   · Shared rule logic reusable across Solidity, Rust and Vyper plugins
//   · Language-specific plugins in packages/plugins/ extend core abstractions
//   · Duplicate logic across language analyzers fully eliminated
//   · New language support requires only a thin plugin adapter layer
//   · Existing rules migrated to use shared core pattern abstractions

// Closes #269, Closes #270, Closes #271, Closes #272"





  describe("Initialization", function () {
    it("Should initialize with correct addresses", async function () {
      expect(await configRegistry.admin()).to.equal(admin.address);
      expect(await configRegistry.configUpdater()).to.equal(configUpdater.address);
      expect(await configRegistry.emergencyAdmin()).to.equal(emergencyAdmin.address);
      expect(await configRegistry.currentVersion()).to.equal(1);
    });
  });

  describe("Configuration Management", function () {
    describe("setUint256", function () {
      it("Should allow config updater to set uint256 values", async function () {
        const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TEST_UINT"));
        const value = 12345;

        await expect(configRegistry.connect(configUpdater).setUint256(key, value))
          .to.emit(configRegistry, "ConfigUpdated");

        expect(await configRegistry.getUint256(key)).to.equal(value);
      });

      it("Should allow admin to set uint256 values", async function () {
        const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TEST_UINT"));
        const value = 67890;

        await expect(configRegistry.connect(admin).setUint256(key, value))
          .to.emit(configRegistry, "ConfigUpdated");

        expect(await configRegistry.getUint256(key)).to.equal(value);
      });

      it("Should allow emergency admin to set uint256 values", async function () {
        const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TEST_UINT"));
        const value = 11111;

        await expect(configRegistry.connect(emergencyAdmin).setUint256(key, value))
          .to.emit(configRegistry, "ConfigUpdated");

        expect(await configRegistry.getUint256(key)).to.equal(value);
      });

      it("Should reject non-authorized users", async function () {
        const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TEST_UINT"));
        const value = 12345;

        await expect(configRegistry.connect(user).setUint256(key, value))
          .to.be.revertedWith("ConfigRegistry: caller is not authorized to update config");
      });
    });

    describe("setAddress", function () {
      it("Should set address values correctly", async function () {
        const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TEST_ADDRESS"));
        const value = user.address;

        await configRegistry.connect(configUpdater).setAddress(key, value);
        expect(await configRegistry.getAddress(key)).to.equal(value);
      });

      it("Should reject zero address", async function () {
        const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TEST_ADDRESS"));

        await expect(configRegistry.connect(configUpdater).setAddress(key, ethers.constants.AddressZero))
          .to.be.revertedWith("ConfigRegistry: address cannot be zero");
      });
    });

    describe("setBool", function () {
      it("Should set boolean values correctly", async function () {
        const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TEST_BOOL"));

        await configRegistry.connect(configUpdater).setBool(key, true);
        expect(await configRegistry.getBool(key)).to.equal(true);

        await configRegistry.connect(configUpdater).setBool(key, false);
        expect(await configRegistry.getBool(key)).to.equal(false);
      });
    });

    describe("setBytes32", function () {
      it("Should set bytes32 values correctly", async function () {
        const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TEST_BYTES32"));
        const value = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test value"));

        await configRegistry.connect(configUpdater).setBytes32(key, value);
        expect(await configRegistry.getBytes32(key)).to.equal(value);
      });
    });

    describe("setString", function () {
      it("Should set string values correctly", async function () {
        const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TEST_STRING"));
        const value = "Hello, World!";

        await configRegistry.connect(configUpdater).setString(key, value);
        expect(await configRegistry.getString(key)).to.equal(value);
      });
    });
  });

  describe("Batch Operations", function () {
    it("Should handle batch updates correctly", async function () {
      const updates = [
        {
          key: ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BATCH_UINT")),
          configType: 0, // UINT256
          uintValue: 1000,
          addressValue: ethers.constants.AddressZero,
          boolValue: false,
          bytes32Value: ethers.constants.HashZero,
          stringValue: ""
        },
        {
          key: ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BATCH_BOOL")),
          configType: 2, // BOOL
          uintValue: 0,
          addressValue: ethers.constants.AddressZero,
          boolValue: true,
          bytes32Value: ethers.constants.HashZero,
          stringValue: ""
        }
      ];

      const initialVersion = await configRegistry.currentVersion();
      await expect(configRegistry.connect(configUpdater).batchUpdate(updates))
        .to.emit(configRegistry, "ConfigBatchUpdated")
        .to.emit(configRegistry, "VersionCreated");

      expect(await configRegistry.currentVersion()).to.equal(initialVersion + 1);
      expect(await configRegistry.getUint256(updates[0].key)).to.equal(1000);
      expect(await configRegistry.getBool(updates[1].key)).to.equal(true);
    });

    it("Should reject empty batch updates", async function () {
      await expect(configRegistry.connect(configUpdater).batchUpdate([]))
        .to.be.revertedWith("ConfigRegistry: no updates provided");
    });

    it("Should reject batch updates that are too large", async function () {
      const updates = Array(51).fill().map((_, i) => ({
        key: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`BATCH_${i}`)),
        configType: 0,
        uintValue: i,
        addressValue: ethers.constants.AddressZero,
        boolValue: false,
        bytes32Value: ethers.constants.HashZero,
        stringValue: ""
      }));

      await expect(configRegistry.connect(configUpdater).batchUpdate(updates))
        .to.be.revertedWith("ConfigRegistry: too many updates in batch");
    });
  });

  describe("Configuration Retrieval", function () {
    beforeEach(async function () {
      const uintKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UINT_KEY"));
      const addressKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADDRESS_KEY"));
      const boolKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BOOL_KEY"));

      await configRegistry.connect(configUpdater).setUint256(uintKey, 42);
      await configRegistry.connect(configUpdater).setAddress(addressKey, user.address);
      await configRegistry.connect(configUpdater).setBool(boolKey, true);
    });

    it("Should return correct values for existing configurations", async function () {
      const uintKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UINT_KEY"));
      const addressKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADDRESS_KEY"));
      const boolKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BOOL_KEY"));

      expect(await configRegistry.getUint256(uintKey)).to.equal(42);
      expect(await configRegistry.getAddress(addressKey)).to.equal(user.address);
      expect(await configRegistry.getBool(boolKey)).to.equal(true);
    });

    it("Should reject access with wrong type", async function () {
      const uintKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("UINT_KEY"));
      const boolKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BOOL_KEY"));

      await expect(configRegistry.getBool(uintKey))
        .to.be.revertedWith("ConfigRegistry: wrong config type");

      await expect(configRegistry.getUint256(boolKey))
        .to.be.revertedWith("ConfigRegistry: wrong config type");
    });

    it("Should reject access to non-existent configurations", async function () {
      const nonExistentKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("NON_EXISTENT"));

      await expect(configRegistry.getUint256(nonExistentKey))
        .to.be.revertedWith("ConfigRegistry: configuration key does not exist");
    });
  });

  describe("Configuration Deletion", function () {
    it("Should allow admin to delete configurations", async function () {
      const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TO_DELETE"));
      await configRegistry.connect(configUpdater).setUint256(key, 123);

      expect(await configRegistry.configExists(key)).to.equal(true);

      await expect(configRegistry.connect(admin).deleteConfig(key))
        .to.emit(configRegistry, "ConfigDeleted");

      expect(await configRegistry.configExists(key)).to.equal(false);
    });

    it("Should reject deletion by non-admin", async function () {
      const key = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("TO_DELETE"));
      await configRegistry.connect(configUpdater).setUint256(key, 123);

      await expect(configRegistry.connect(configUpdater).deleteConfig(key))
        .to.be.revertedWith("ConfigRegistry: caller is not admin");
    });

    it("Should reject deletion of non-existent configurations", async function () {
      const nonExistentKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("NON_EXISTENT"));

      await expect(configRegistry.connect(admin).deleteConfig(nonExistentKey))
        .to.be.revertedWith("ConfigRegistry: configuration key does not exist");
    });
  });

  describe("Access Control Updates", function () {
    it("Should allow admin to update admin address", async function () {
      await configRegistry.connect(admin).updateAdmin(user.address);
      expect(await configRegistry.admin()).to.equal(user.address);
    });

    it("Should allow admin to update config updater address", async function () {
      await configRegistry.connect(admin).updateConfigUpdater(user.address);
      expect(await configRegistry.configUpdater()).to.equal(user.address);
    });

    it("Should allow admin to update emergency admin address", async function () {
      await configRegistry.connect(admin).updateEmergencyAdmin(user.address);
      expect(await configRegistry.emergencyAdmin()).to.equal(user.address);
    });

    it("Should reject access control updates by non-admin", async function () {
      await expect(configRegistry.connect(configUpdater).updateAdmin(user.address))
        .to.be.revertedWith("ConfigRegistry: caller is not admin");
    });
  });

  describe("Utility Functions", function () {
    beforeEach(async function () {
      await configRegistry.connect(configUpdater).setUint256(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("KEY1")), 1
      );
      await configRegistry.connect(configUpdater).setUint256(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("KEY2")), 2
      );
    });

    it("Should return correct configuration count", async function () {
      expect(await configRegistry.getConfigCount()).to.equal(2);
    });

    it("Should return all keys", async function () {
      const keys = await configRegistry.getAllKeys();
      expect(keys.length).to.equal(2);
    });

    it("Should check configuration existence correctly", async function () {
      const existingKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("KEY1"));
      const nonExistentKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("NON_EXISTENT"));

      expect(await configRegistry.configExists(existingKey)).to.equal(true);
      expect(await configRegistry.configExists(nonExistentKey)).to.equal(false);
    });
  });
});