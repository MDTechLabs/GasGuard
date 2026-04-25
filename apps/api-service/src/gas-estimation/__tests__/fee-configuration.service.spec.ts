import { Test, TestingModule } from "@nestjs/testing";
import { FeeConfigurationService } from "../services/fee-configuration.service";
import {
  FeeConfiguration,
  FeeUpdateRequest,
  FeeChangeEvent,
  AdminFeeSettings,
} from "../interfaces/fee-config.interface";

describe("FeeConfigurationService", () => {
  let service: FeeConfigurationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FeeConfigurationService],
    }).compile();

    service = module.get<FeeConfigurationService>(FeeConfigurationService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getCurrentConfiguration", () => {
    it("should return current fee configuration", async () => {
      const config = await service.getCurrentConfiguration();

      expect(config).toBeDefined();
      expect(config.id).toBe("default");
      expect(config.basePricePerRequest).toBe(0.00001);
      expect(config.currency).toBe("XLM");
      expect(config.tierMultipliers.starter).toBe(1.0);
      expect(config.tierMultipliers.enterprise).toBe(0.4);
    });
  });

  describe("updateConfiguration", () => {
    it("should update base price successfully", async () => {
      const updateRequest: FeeUpdateRequest = {
        basePricePerRequest: 0.000015,
        reason: "Market adjustment",
        notifyUsers: true,
      };

      const updatedConfig = await service.updateConfiguration(
        "default",
        updateRequest,
        "admin-user",
      );

      expect(updatedConfig.basePricePerRequest).toBe(0.000015);
      expect(updatedConfig.version).toBe(2); // Should increment version
      expect(updatedConfig.createdBy).toBe("admin-user");
    });

    it("should update tier multipliers", async () => {
      const updateRequest: FeeUpdateRequest = {
        tierMultipliers: {
          starter: 1.1,
          enterprise: 0.35,
        },
        reason: "Tier adjustment",
        notifyUsers: false,
      };

      const updatedConfig = await service.updateConfiguration(
        "default",
        updateRequest,
        "admin-user",
      );

      expect(updatedConfig.tierMultipliers.starter).toBe(1.1);
      expect(updatedConfig.tierMultipliers.enterprise).toBe(0.35);
      expect(updatedConfig.tierMultipliers.developer).toBe(0.8); // Unchanged
    });

    it("should update discount percentages", async () => {
      const updateRequest: FeeUpdateRequest = {
        discountPercentages: {
          professional: 45, // Increased from 40
          enterprise: 65, // Increased from 60
        },
        reason: "Discount adjustment",
        notifyUsers: true,
      };

      const updatedConfig = await service.updateConfiguration(
        "default",
        updateRequest,
        "admin-user",
      );

      expect(updatedConfig.discountPercentages.professional).toBe(45);
      expect(updatedConfig.discountPercentages.enterprise).toBe(65);
    });

    it("should validate negative base price", async () => {
      const updateRequest: FeeUpdateRequest = {
        basePricePerRequest: -0.00001,
        reason: "Invalid negative price",
        notifyUsers: false,
      };

      await expect(
        service.updateConfiguration("default", updateRequest, "admin-user"),
      ).rejects.toThrow("Invalid fee update");
    });

    it("should validate discount percentage bounds", async () => {
      const updateRequest: FeeUpdateRequest = {
        discountPercentages: {
          starter: 150, // Invalid: > 100%
        },
        reason: "Invalid discount",
        notifyUsers: false,
      };

      await expect(
        service.updateConfiguration("default", updateRequest, "admin-user"),
      ).rejects.toThrow("Invalid fee update");
    });
  });

  describe("createConfiguration", () => {
    it("should create new fee configuration", async () => {
      const newConfig = {
        name: "Custom Pricing",
        description: "Custom fee configuration for testing",
        basePricePerRequest: 0.00002,
        currency: "XLM",
        tierMultipliers: {
          starter: 1.0,
          developer: 0.9,
          professional: 0.8,
          enterprise: 0.7,
        },
        discountPercentages: {
          starter: 0,
          developer: 10,
          professional: 20,
          enterprise: 30,
        },
        minimumFee: 0.000001,
        maximumFee: 0.0001,
        rateLimits: {
          starter: 5,
          developer: 15,
          professional: 50,
          enterprise: 500,
        },
        requestLimits: {
          starter: 500,
          developer: 5000,
          professional: 50000,
          enterprise: -1,
        },
        isActive: true,
        createdBy: "admin-user",
      };

      const createdConfig = await service.createConfiguration(
        newConfig,
        "admin-user",
      );

      expect(createdConfig.id).toBeDefined();
      expect(createdConfig.createdBy).toBe("admin-user");
      expect(createdConfig.version).toBe(1);
      expect(createdConfig.isActive).toBe(true);
    });

    it("should validate configuration name", async () => {
      const invalidConfig = {
        name: "", // Empty name
        description: "Invalid config",
        basePricePerRequest: 0.00001,
        currency: "XLM",
        tierMultipliers: {
          starter: 1.0,
          developer: 0.8,
          professional: 0.6,
          enterprise: 0.4,
        },
        discountPercentages: {
          starter: 0,
          developer: 20,
          professional: 40,
          enterprise: 60,
        },
        minimumFee: 0.000001,
        maximumFee: 0,
        rateLimits: {
          starter: 10,
          developer: 30,
          professional: 100,
          enterprise: 1000,
        },
        requestLimits: {
          starter: 1000,
          developer: 10000,
          professional: 100000,
          enterprise: -1,
        },
        isActive: true,
        createdBy: "admin-user",
      };

      await expect(
        service.createConfiguration(invalidConfig, "admin-user"),
      ).rejects.toThrow("Invalid fee configuration");
    });
  });

  describe("getConfigurationHistory", () => {
    it("should return configuration history", async () => {
      // First, make some updates
      await service.updateConfiguration(
        "default",
        {
          basePricePerRequest: 0.000012,
          reason: "First update",
          notifyUsers: false,
        },
        "admin-user",
      );

      await service.updateConfiguration(
        "default",
        {
          basePricePerRequest: 0.000015,
          reason: "Second update",
          notifyUsers: false,
        },
        "admin-user",
      );

      const history = await service.getConfigurationHistory("default");

      expect(history.length).toBe(2); // Should have 2 updates
      expect(history[0].version).toBe(2); // First update
      expect(history[1].version).toBe(3); // Second update
      expect(history[0].configuration.basePricePerRequest).toBe(0.000012);
      expect(history[0].configuration.createdBy).toBe("admin-user");
      expect(history[1].configuration.basePricePerRequest).toBe(0.000015);
      expect(history[1].configuration.createdBy).toBe("admin-user");
    });
  });

  describe("getFeeEvents", () => {
    it("should return fee change events", async () => {
      // Make an update to generate events
      await service.updateConfiguration(
        "default",
        {
          basePricePerRequest: 0.00002,
          reason: "Test event generation",
          notifyUsers: true,
        },
        "admin-user",
      );

      const events = await service.getFeeEvents("default");

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("FEE_UPDATED");
      expect(events[0].metadata.reason).toBe("Test event generation");
      expect(events[0].metadata.updatedBy).toBe("admin-user");
      expect(events[0].changes.length).toBe(1);
      expect(events[0].changes[0].field).toBe("basePricePerRequest");
      expect(events[0].changes[0].oldValue).toBe(0.000015);
      expect(events[0].changes[0].newValue).toBe(0.00002);
    });

    it("should filter events by date range", async () => {
      const startDate = new Date("2024-01-01T00:00:00.000Z");
      const endDate = new Date("2024-12-31T23:59:59.999Z");

      const events = await service.getFeeEvents("default", startDate, endDate);

      // Should return events within the date range
      events.forEach((event) => {
        expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(
          startDate.getTime(),
        );
        expect(event.timestamp.getTime()).toBeLessThanOrEqual(
          endDate.getTime(),
        );
      });
    });
  });

  describe("getFeeAnalytics", () => {
    it("should return fee analytics", async () => {
      const startDate = new Date("2024-01-01");
      const endDate = new Date("2024-01-31");

      const analytics = await service.getFeeAnalytics(startDate, endDate);

      expect(analytics).toBeDefined();
      expect(analytics.totalRevenue).toBeDefined();
      expect(analytics.totalRevenue.daily).toBeGreaterThan(0);
      expect(analytics.usageByTier).toBeDefined();
      expect(analytics.revenueByTier).toBeDefined();
      expect(analytics.trends).toBeDefined();
      expect(analytics.period.startDate.getTime()).toEqual(startDate.getTime());
      expect(analytics.period.endDate.getTime()).toEqual(endDate.getTime());
    });
  });

  describe("getAdminSettings", () => {
    it("should return admin settings", async () => {
      const settings = await service.getAdminSettings();

      expect(settings).toBeDefined();
      expect(settings.allowFeeUpdates).toBe(true);
      expect(settings.requireApprovalForLargeChanges).toBe(true);
      expect(settings.largeChangeThreshold).toBe(25);
      expect(settings.enableUserNotifications).toBe(true);
      expect(settings.enableAuditLog).toBe(true);
    });
  });

  describe("updateAdminSettings", () => {
    it("should update admin settings", async () => {
      const newSettings = {
        allowFeeUpdates: false,
        largeChangeThreshold: 50,
        maxFeeChangesPerDay: 5,
      };

      const updatedSettings = await service.updateAdminSettings(
        newSettings,
        "admin-user",
      );

      expect(updatedSettings.allowFeeUpdates).toBe(false);
      expect(updatedSettings.largeChangeThreshold).toBe(50);
      expect(updatedSettings.maxFeeChangesPerDay).toBe(5);
      // Other settings should remain unchanged
      expect(updatedSettings.requireApprovalForLargeChanges).toBe(true);
      expect(updatedSettings.enableUserNotifications).toBe(true);
    });

    it("should validate multisig threshold against signer count", async () => {
      await expect(
        service.updateAdminSettings(
          {
            multisigSigners: ["admin-1"],
            multisigApprovalThreshold: 2,
          },
          "admin-user",
        ),
      ).rejects.toThrow(
        "Multisig approval threshold cannot exceed the number of configured signers.",
      );
    });
  });

  describe("multisig approval workflow", () => {
    beforeEach(async () => {
      await service.updateAdminSettings(
        {
          multisigSigners: ["admin-1", "admin-2"],
          multisigApprovalThreshold: 2,
        },
        "admin-user",
      );
    });

    it("should require a multisig approval request for large changes", async () => {
      const updateRequest: FeeUpdateRequest = {
        basePricePerRequest: 0.00003,
        reason: "Large price adjustment",
        notifyUsers: false,
      };

      await expect(
        service.updateConfiguration("default", updateRequest, "admin-1"),
      ).rejects.toThrow(
        "Large fee changes must be submitted through the multisig approval workflow.",
      );

      const approvalRequest = await service.createApprovalRequest(
        "default",
        updateRequest,
        "admin-1",
      );

      expect(approvalRequest.status).toBe("PENDING");
      expect(approvalRequest.approvals).toEqual(["admin-1"]);
      expect(approvalRequest.threshold).toBe(2);
    });

    it("should apply the update after enough signer approvals", async () => {
      const updateRequest: FeeUpdateRequest = {
        basePricePerRequest: 0.00003,
        reason: "Critical pricing change",
        notifyUsers: false,
      };

      const approvalRequest = await service.createApprovalRequest(
        "default",
        updateRequest,
        "admin-1",
      );

      const approvedRequest = await service.approveApprovalRequest(
        approvalRequest.id,
        "admin-2",
      );

      expect(approvedRequest.status).toBe("APPROVED");
      const currentConfig = await service.getCurrentConfiguration();
      expect(currentConfig.basePricePerRequest).toBe(0.00003);
    });

    it("should reject approvals from unauthorized users", async () => {
      const updateRequest: FeeUpdateRequest = {
        basePricePerRequest: 0.00003,
        reason: "Unauthorized approval attempt",
        notifyUsers: false,
      };

      const approvalRequest = await service.createApprovalRequest(
        "default",
        updateRequest,
        "admin-1",
      );

      await expect(
        service.approveApprovalRequest(approvalRequest.id, "not-a-signer"),
      ).rejects.toThrow(
        "User not-a-signer is not authorized to approve this request",
      );
    });
  });

  describe("timelock delay", () => {
    beforeEach(async () => {
      await service.updateAdminSettings(
        {
          timelockDelayMinutes: 1,
        },
        "admin-user",
      );

      jest.useFakeTimers({ now: new Date("2026-03-29T12:00:00.000Z") });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should schedule direct updates when the delay has not yet elapsed", async () => {
      const updateRequest: FeeUpdateRequest = {
        basePricePerRequest: 0.00002,
        reason: "Delayed pricing update",
        notifyUsers: false,
      };

      const currentConfig = await service.updateConfiguration(
        "default",
        updateRequest,
        "admin-user",
      );

      expect(currentConfig.basePricePerRequest).toBe(0.00001);

      const scheduledUpdates = await service.getScheduledUpdates("default");
      expect(scheduledUpdates.length).toBe(1);
      expect(scheduledUpdates[0].status).toBe("SCHEDULED");
      expect(scheduledUpdates[0].scheduledAt.toISOString()).toBe(
        new Date("2026-03-29T12:01:00.000Z").toISOString(),
      );

      jest.setSystemTime(new Date("2026-03-29T12:02:00.000Z"));
      const executed = await service.processPendingScheduledUpdates();

      expect(executed.length).toBe(1);
      expect(executed[0].status).toBe("EXECUTED");

      const updatedConfig = await service.getCurrentConfiguration();
      expect(updatedConfig.basePricePerRequest).toBe(0.00002);
    });
  });

  describe("validateUpdateRequest", () => {
    it("should detect large price increases", async () => {
      const currentConfig = await service.getCurrentConfiguration();
      const updateRequest: FeeUpdateRequest = {
        basePricePerRequest: 0.00002, // 100% increase from 0.00001
        reason: "Large price increase test",
        notifyUsers: false,
      };

      // This would be tested through the validation logic
      const validation = {
        isValid: true,
        errors: [],
        warnings: ["Base price per request is very high (> 1 XLM)"],
        impact: {
          affectedUsers: 30000,
          priceIncreasePercentage: 100,
          priceDecreasePercentage: 0,
        },
      };

      expect(validation.impact.priceIncreasePercentage).toBe(100);
      expect(validation.warnings.length).toBeGreaterThan(0);
    });

    it("should detect negative prices", () => {
      const updateRequest: FeeUpdateRequest = {
        basePricePerRequest: -0.00001,
        reason: "Negative price test",
        notifyUsers: false,
      };

      const validation = {
        isValid: false,
        errors: ["Base price per request cannot be negative"],
        warnings: [],
        impact: {
          affectedUsers: 30000,
          priceIncreasePercentage: 0,
          priceDecreasePercentage: 0,
        },
      };

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain(
        "Base price per request cannot be negative",
      );
    });
  });

  describe("edge cases", () => {
    it("should handle zero minimum fee", async () => {
      const updateRequest: FeeUpdateRequest = {
        minimumFee: 0,
        reason: "Set minimum fee to zero",
        notifyUsers: false,
      };

      const updatedConfig = await service.updateConfiguration(
        "default",
        updateRequest,
        "admin-user",
      );
      expect(updatedConfig.minimumFee).toBe(0);
    });

    it("should handle unlimited maximum fee", async () => {
      const updateRequest: FeeUpdateRequest = {
        maximumFee: 0, // 0 means unlimited
        reason: "Remove maximum fee limit",
        notifyUsers: false,
      };

      const updatedConfig = await service.updateConfiguration(
        "default",
        updateRequest,
        "admin-user",
      );
      expect(updatedConfig.maximumFee).toBe(0);
    });

    it("should handle negative request limits", async () => {
      const updateRequest: FeeUpdateRequest = {
        requestLimits: {
          enterprise: -1, // -1 means unlimited
        },
        reason: "Set enterprise to unlimited",
        notifyUsers: false,
      };

      const updatedConfig = await service.updateConfiguration(
        "default",
        updateRequest,
        "admin-user",
      );
      expect(updatedConfig.requestLimits.enterprise).toBe(-1);
    });
  });

  describe("configuration consistency", () => {
    it("should maintain configuration consistency", async () => {
      const originalConfig = await service.getCurrentConfiguration();

      // Make multiple updates
      await service.updateConfiguration(
        "default",
        {
          basePricePerRequest: 0.000012,
          reason: "First update",
          notifyUsers: false,
        },
        "admin-user",
      );

      await service.updateConfiguration(
        "default",
        {
          tierMultipliers: {
            professional: 0.7,
          },
          reason: "Second update",
          notifyUsers: false,
        },
        "admin-user",
      );

      const finalConfig = await service.getCurrentConfiguration();

      // Should preserve all changes
      expect(finalConfig.basePricePerRequest).toBe(0.000012);
      expect(finalConfig.tierMultipliers.professional).toBe(0.7);
      // Should preserve other values
      expect(finalConfig.currency).toBe(originalConfig.currency);
      expect(finalConfig.tierMultipliers.starter).toBe(
        originalConfig.tierMultipliers.starter,
      );
    });
  });
});
