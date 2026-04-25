import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  FeeConfiguration,
  FeeUpdateRequest,
  FeeChangeEvent,
  FeeValidationResult,
  FeeConfigurationHistory,
  FeeAnalytics,
  AdminFeeSettings,
  ApprovalRequest,
  ScheduledUpdate,
} from "../interfaces/fee-config.interface";

/**
 * FeeConfigurationService
 * Manages configurable protocol fees with admin controls and audit trails
 */
@Injectable()
export class FeeConfigurationService {
  private readonly logger = new Logger(FeeConfigurationService.name);

  // In-memory storage (in production, this would be a database)
  private configurations: Map<string, FeeConfiguration> = new Map();
  private configurationHistory: FeeConfigurationHistory[] = [];
  private feeEvents: FeeChangeEvent[] = [];
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private scheduledUpdates: Map<string, ScheduledUpdate> = new Map();
  private adminSettings: AdminFeeSettings;

  constructor() {
    this.initializeDefaultConfiguration();
    this.initializeAdminSettings();
  }

  /**
   * Get current fee configuration
   */
  async getCurrentConfiguration(): Promise<FeeConfiguration> {
    const config = this.configurations.get("default");
    if (!config) {
      throw new NotFoundException("No fee configuration found");
    }
    return { ...config }; // Return copy to prevent mutation
  }

  /**
   * Get all fee configurations
   */
  async getAllConfigurations(): Promise<FeeConfiguration[]> {
    return Array.from(this.configurations.values()).map((config) => ({
      ...config,
    }));
  }

  /**
   * Update fee configuration (admin only)
   */
  async updateConfiguration(
    configId: string,
    updateRequest: FeeUpdateRequest,
    adminUserId: string,
  ): Promise<FeeConfiguration> {
    // Validate admin permissions
    if (!this.adminSettings.allowFeeUpdates) {
      throw new BadRequestException("Fee updates are currently disabled");
    }

    // Get current configuration
    const currentConfig = this.configurations.get(configId);
    if (!currentConfig) {
      throw new NotFoundException(`Fee configuration ${configId} not found`);
    }

    // Validate the update request
    const validation = this.validateFeeUpdate(currentConfig, updateRequest);
    if (!validation.isValid) {
      throw new BadRequestException(
        `Invalid fee update: ${validation.errors.join(", ")}`,
      );
    }

    if (this.isMultisigApprovalRequired(currentConfig, updateRequest)) {
      this.logger.warn(
        `Large fee change requires multisig approval: ${updateRequest.reason}`,
      );
      throw new BadRequestException(
        "Large fee changes must be submitted through the multisig approval workflow.",
      );
    }

    const effectiveDate = this.getEffectiveDateWithDelay(updateRequest);
    if (effectiveDate > new Date()) {
      await this.scheduleFeeUpdate(
        configId,
        updateRequest,
        adminUserId,
        effectiveDate,
      );
      return currentConfig;
    }

    return await this.applyFeeUpdate(
      configId,
      currentConfig,
      updateRequest,
      adminUserId,
    );
  }

  /**
   * Create new fee configuration
   */
  async createConfiguration(
    configuration: Omit<
      FeeConfiguration,
      "id" | "createdAt" | "updatedAt" | "version"
    >,
    adminUserId: string,
  ): Promise<FeeConfiguration> {
    // Validate the configuration
    const validation = this.validateNewConfiguration(configuration);
    if (!validation.isValid) {
      throw new BadRequestException(
        `Invalid fee configuration: ${validation.errors.join(", ")}`,
      );
    }

    const newConfig: FeeConfiguration = {
      ...configuration,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
      createdBy: adminUserId,
    };

    // Store configuration
    this.configurations.set(newConfig.id, newConfig);

    // Create creation event
    const changeEvent: FeeChangeEvent = {
      id: this.generateId(),
      configurationId: newConfig.id,
      type: "FEE_CREATED",
      timestamp: new Date(),
      newConfiguration: { ...newConfig },
      changes: [],
      metadata: {
        updatedBy: adminUserId,
        reason: "Initial configuration creation",
        effectiveDate: new Date(),
        notifyUsers: false,
        version: 1,
      },
    };

    // Add to history
    this.configurationHistory.push({
      id: this.generateId(),
      configurationId: newConfig.id,
      version: 1,
      configuration: { ...newConfig },
      changeEvent,
      createdAt: new Date(),
      createdBy: adminUserId,
    });

    // Store event
    this.feeEvents.push(changeEvent);

    // Log the change (removed emit for now)
    this.logger.log(
      `Fee configuration created by ${adminUserId}: ${newConfig.name}`,
    );

    return { ...newConfig };
  }

  /**
   * Create a pending approval request for a large fee update
   */
  async createApprovalRequest(
    configId: string,
    updateRequest: FeeUpdateRequest,
    adminUserId: string,
  ): Promise<ApprovalRequest> {
    if (!this.adminSettings.allowFeeUpdates) {
      throw new BadRequestException("Fee updates are currently disabled");
    }

    const currentConfig = this.configurations.get(configId);
    if (!currentConfig) {
      throw new NotFoundException(`Fee configuration ${configId} not found`);
    }

    const validation = this.validateFeeUpdate(currentConfig, updateRequest);
    if (!validation.isValid) {
      throw new BadRequestException(
        `Invalid fee update: ${validation.errors.join(", ")}`,
      );
    }

    if (!this.isMultisigApprovalRequired(currentConfig, updateRequest)) {
      throw new BadRequestException(
        "Approval request is not required for this update. Use updateConfiguration directly.",
      );
    }

    if (
      this.adminSettings.multisigSigners.length <
      this.adminSettings.multisigApprovalThreshold
    ) {
      throw new BadRequestException(
        "Multisig signer configuration is invalid: threshold must be less than or equal to signer count.",
      );
    }

    const isRequesterSigner = this.adminSettings.multisigSigners.includes(
      adminUserId,
    );

    const effectiveDate = this.getEffectiveDateWithDelay(updateRequest);

    const approvalRequest: ApprovalRequest = {
      id: this.generateId(),
      configurationId: configId,
      requestedBy: adminUserId,
      request: { ...updateRequest },
      requiredSigners: [...this.adminSettings.multisigSigners],
      approvals: isRequesterSigner ? [adminUserId] : [],
      rejections: [],
      threshold: this.adminSettings.multisigApprovalThreshold,
      status: isRequesterSigner
        ? this.adminSettings.multisigApprovalThreshold <= 1
          ? "APPROVED"
          : "PENDING"
        : "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
      reason: updateRequest.reason,
      effectiveDate,
      notifyUsers: updateRequest.notifyUsers ?? true,
    };

    this.pendingApprovals.set(approvalRequest.id, approvalRequest);

    if (approvalRequest.approvals.length >= approvalRequest.threshold) {
      approvalRequest.status = "APPROVED";
      approvalRequest.updatedAt = new Date();
      await this.executeApprovalRequest(approvalRequest);
    }

    this.logger.log(
      `Multisig approval request created by ${adminUserId}: ${approvalRequest.id}`,
    );

    return { ...approvalRequest };
  }

  async getApprovalRequests(
    configId?: string,
  ): Promise<ApprovalRequest[]> {
    const requests = Array.from(this.pendingApprovals.values());
    return configId
      ? requests.filter((request) => request.configurationId === configId)
      : requests;
  }

  async getApprovalRequest(approvalRequestId: string): Promise<ApprovalRequest> {
    const approvalRequest = this.pendingApprovals.get(approvalRequestId);
    if (!approvalRequest) {
      throw new NotFoundException(
        `Approval request ${approvalRequestId} not found`,
      );
    }
    return { ...approvalRequest };
  }

  async approveApprovalRequest(
    approvalRequestId: string,
    adminUserId: string,
  ): Promise<ApprovalRequest> {
    const approvalRequest = this.pendingApprovals.get(approvalRequestId);
    if (!approvalRequest) {
      throw new NotFoundException(
        `Approval request ${approvalRequestId} not found`,
      );
    }

    if (approvalRequest.status !== "PENDING") {
      throw new BadRequestException(
        `Approval request ${approvalRequestId} is already ${approvalRequest.status}`,
      );
    }

    if (!this.adminSettings.multisigSigners.includes(adminUserId)) {
      throw new BadRequestException(
        `User ${adminUserId} is not authorized to approve this request`,
      );
    }

    if (approvalRequest.approvals.includes(adminUserId)) {
      throw new BadRequestException(
        `User ${adminUserId} has already approved this request`,
      );
    }

    approvalRequest.approvals.push(adminUserId);
    approvalRequest.updatedAt = new Date();

    if (approvalRequest.approvals.length >= approvalRequest.threshold) {
      await this.executeApprovalRequest(approvalRequest);
      approvalRequest.status = "APPROVED";
      approvalRequest.updatedAt = new Date();
    }

    this.pendingApprovals.set(approvalRequest.id, approvalRequest);

    return { ...approvalRequest };
  }

  async rejectApprovalRequest(
    approvalRequestId: string,
    adminUserId: string,
  ): Promise<ApprovalRequest> {
    const approvalRequest = this.pendingApprovals.get(approvalRequestId);
    if (!approvalRequest) {
      throw new NotFoundException(
        `Approval request ${approvalRequestId} not found`,
      );
    }

    if (approvalRequest.status !== "PENDING") {
      throw new BadRequestException(
        `Approval request ${approvalRequestId} is already ${approvalRequest.status}`,
      );
    }

    if (!this.adminSettings.multisigSigners.includes(adminUserId)) {
      throw new BadRequestException(
        `User ${adminUserId} is not authorized to reject this request`,
      );
    }

    if (approvalRequest.rejections.includes(adminUserId)) {
      throw new BadRequestException(
        `User ${adminUserId} has already rejected this request`,
      );
    }

    approvalRequest.rejections.push(adminUserId);
    approvalRequest.updatedAt = new Date();

    if (
      approvalRequest.rejections.length >=
      approvalRequest.requiredSigners.length - approvalRequest.threshold + 1
    ) {
      approvalRequest.status = "REJECTED";
      approvalRequest.updatedAt = new Date();
    }

    this.pendingApprovals.set(approvalRequest.id, approvalRequest);

    return { ...approvalRequest };
  }

  private async executeApprovalRequest(
    approvalRequest: ApprovalRequest,
  ): Promise<void> {
    const currentConfig = this.configurations.get(
      approvalRequest.configurationId,
    );
    if (!currentConfig) {
      throw new NotFoundException(
        `Fee configuration ${approvalRequest.configurationId} not found`,
      );
    }

    if (approvalRequest.effectiveDate > new Date()) {
      await this.scheduleFeeUpdate(
        approvalRequest.configurationId,
        approvalRequest.request,
        approvalRequest.requestedBy,
        approvalRequest.effectiveDate,
      );
      return;
    }

    await this.applyFeeUpdate(
      approvalRequest.configurationId,
      currentConfig,
      approvalRequest.request,
      approvalRequest.requestedBy,
    );
  }

  async getScheduledUpdates(
    configId?: string,
  ): Promise<ScheduledUpdate[]> {
    const updates = Array.from(this.scheduledUpdates.values());
    return configId
      ? updates.filter((update) => update.configurationId === configId)
      : updates;
  }

  async getScheduledUpdate(
    scheduledUpdateId: string,
  ): Promise<ScheduledUpdate> {
    const scheduledUpdate = this.scheduledUpdates.get(scheduledUpdateId);
    if (!scheduledUpdate) {
      throw new NotFoundException(
        `Scheduled update ${scheduledUpdateId} not found`,
      );
    }
    return { ...scheduledUpdate };
  }

  async processPendingScheduledUpdates(): Promise<ScheduledUpdate[]> {
    const now = new Date();
    const executed: ScheduledUpdate[] = [];

    for (const scheduledUpdate of this.scheduledUpdates.values()) {
      if (
        scheduledUpdate.status === "SCHEDULED" &&
        scheduledUpdate.scheduledAt <= now
      ) {
        const currentConfig = this.configurations.get(
          scheduledUpdate.configurationId,
        );
        if (currentConfig) {
          await this.applyFeeUpdate(
            scheduledUpdate.configurationId,
            currentConfig,
            scheduledUpdate.request,
            scheduledUpdate.createdBy,
          );
          scheduledUpdate.status = "EXECUTED";
          scheduledUpdate.updatedAt = new Date();
          this.scheduledUpdates.set(scheduledUpdate.id, scheduledUpdate);
          executed.push({ ...scheduledUpdate });
        }
      }
    }

    return executed;
  }

  private async scheduleFeeUpdate(
    configId: string,
    updateRequest: FeeUpdateRequest,
    adminUserId: string,
    scheduledAt: Date,
  ): Promise<ScheduledUpdate> {
    const scheduledUpdate: ScheduledUpdate = {
      id: this.generateId(),
      configurationId: configId,
      request: { ...updateRequest },
      createdBy: adminUserId,
      scheduledAt,
      status: "SCHEDULED",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.scheduledUpdates.set(scheduledUpdate.id, scheduledUpdate);
    this.logger.log(
      `Scheduled fee update ${scheduledUpdate.id} for ${scheduledAt.toISOString()}`,
    );
    return { ...scheduledUpdate };
  }

  private getEffectiveDateWithDelay(
    updateRequest: FeeUpdateRequest,
  ): Date {
    const now = new Date();
    const delayMs = this.adminSettings.timelockDelayMinutes * 60 * 1000;
    const minimumEffectiveDate = new Date(now.getTime() + delayMs);
    const requestedDate = updateRequest.effectiveDate ?? minimumEffectiveDate;

    return requestedDate < minimumEffectiveDate
      ? minimumEffectiveDate
      : requestedDate;
  }

  private isMultisigEnabled(): boolean {
    return (
      this.adminSettings.requireApprovalForLargeChanges &&
      this.adminSettings.multisigSigners.length > 0 &&
      this.adminSettings.multisigApprovalThreshold > 1
    );
  }

  private isMultisigApprovalRequired(
    currentConfig: FeeConfiguration,
    updateRequest: FeeUpdateRequest,
  ): boolean {
    return (
      this.isMultisigEnabled() &&
      this.checkIfApprovalRequired(currentConfig, updateRequest)
    );
  }

  private async applyFeeUpdate(
    configId: string,
    currentConfig: FeeConfiguration,
    updateRequest: FeeUpdateRequest,
    adminUserId: string,
  ): Promise<FeeConfiguration> {
    const newConfiguration: FeeConfiguration = {
      ...currentConfig,
      ...this.applyUpdateRequest(currentConfig, updateRequest),
      updatedAt: new Date(),
      version: currentConfig.version + 1,
    };

    const changes = this.detectChanges(currentConfig, newConfiguration);

    const changeEvent: FeeChangeEvent = {
      id: this.generateId(),
      configurationId: configId,
      type: "FEE_UPDATED",
      timestamp: new Date(),
      oldConfiguration: { ...currentConfig },
      newConfiguration: { ...newConfiguration },
      changes,
      metadata: {
        updatedBy: adminUserId,
        reason: updateRequest.reason,
        effectiveDate: updateRequest.effectiveDate || new Date(),
        notifyUsers: updateRequest.notifyUsers ?? true,
        version: newConfiguration.version,
      },
    };

    this.configurations.set(configId, newConfiguration);

    this.configurationHistory.push({
      id: this.generateId(),
      configurationId: configId,
      version: newConfiguration.version,
      configuration: { ...newConfiguration },
      changeEvent,
      createdAt: new Date(),
      createdBy: adminUserId,
    });

    this.feeEvents.push(changeEvent);

    this.logger.log(
      `Fee configuration updated by ${adminUserId}: ${updateRequest.reason}`,
    );

    if (updateRequest.notifyUsers) {
      await this.notifyUsersOfFeeChange(changeEvent);
    }

    return { ...newConfiguration };
  }

  /**
   * Get fee configuration history
   */
  async getConfigurationHistory(
    configId?: string,
  ): Promise<FeeConfigurationHistory[]> {
    let history = this.configurationHistory;

    if (configId) {
      history = history.filter((h) => h.configurationId === configId);
    }

    return history.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /**
   * Get fee change events
   */
  async getFeeEvents(
    configId?: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<FeeChangeEvent[]> {
    let events = this.feeEvents;

    if (configId) {
      events = events.filter((e) => e.configurationId === configId);
    }

    if (startDate) {
      events = events.filter((e) => e.timestamp >= startDate);
    }

    if (endDate) {
      events = events.filter((e) => e.timestamp <= endDate);
    }

    return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get fee analytics
   */
  async getFeeAnalytics(startDate: Date, endDate: Date): Promise<FeeAnalytics> {
    // This is a simplified implementation
    // In production, this would query actual usage data
    const totalRevenue = {
      daily: 1000 * 0.00001, // Example calculation
      weekly: 7000 * 0.00001,
      monthly: 30000 * 0.00001,
      yearly: 365000 * 0.00001,
    };

    const usageByTier = {
      starter: 1000,
      developer: 5000,
      professional: 15000,
      enterprise: 9000,
    };

    const currentConfig = await this.getCurrentConfiguration();
    const revenueByTier = {
      starter:
        usageByTier.starter *
        currentConfig.basePricePerRequest *
        currentConfig.tierMultipliers.starter,
      developer:
        usageByTier.developer *
        currentConfig.basePricePerRequest *
        currentConfig.tierMultipliers.developer,
      professional:
        usageByTier.professional *
        currentConfig.basePricePerRequest *
        currentConfig.tierMultipliers.professional,
      enterprise:
        usageByTier.enterprise *
        currentConfig.basePricePerRequest *
        currentConfig.tierMultipliers.enterprise,
    };

    return {
      totalRevenue,
      usageByTier,
      revenueByTier,
      trends: {
        revenueGrowth: 15.5, // Example percentage
        usageGrowth: 8.2,
        averageRevenuePerUser:
          Object.values(revenueByTier).reduce((a, b) => a + b, 0) /
          Object.values(usageByTier).reduce((a, b) => a + b, 0),
      },
      period: {
        startDate,
        endDate,
      },
    };
  }

  /**
   * Get admin settings
   */
  async getAdminSettings(): Promise<AdminFeeSettings> {
    return { ...this.adminSettings };
  }

  /**
   * Update admin settings
   */
  async updateAdminSettings(
    settings: Partial<AdminFeeSettings>,
    adminUserId: string,
  ): Promise<AdminFeeSettings> {
    const updatedSettings = {
      ...this.adminSettings,
      ...settings,
    };

    if (
      updatedSettings.multisigApprovalThreshold > 0 &&
      updatedSettings.multisigApprovalThreshold >
        (updatedSettings.multisigSigners?.length ?? 0)
    ) {
      throw new BadRequestException(
        "Multisig approval threshold cannot exceed the number of configured signers.",
      );
    }

    if (
      updatedSettings.timelockDelayMinutes !== undefined &&
      updatedSettings.timelockDelayMinutes < 0
    ) {
      throw new BadRequestException(
        "Timelock delay must be zero or a positive number of minutes.",
      );
    }

    this.adminSettings = updatedSettings;

    this.logger.log(`Admin settings updated by ${adminUserId}`);
    return { ...this.adminSettings };
  }

  /**
   * Validate fee update request
   */
  private validateFeeUpdate(
    currentConfig: FeeConfiguration,
    updateRequest: FeeUpdateRequest,
  ): FeeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate base price
    if (updateRequest.basePricePerRequest !== undefined) {
      if (updateRequest.basePricePerRequest < 0) {
        errors.push("Base price per request cannot be negative");
      }
      if (updateRequest.basePricePerRequest > 1) {
        warnings.push("Base price per request is very high (> 1 XLM)");
      }
    }

    // Validate tier multipliers
    if (updateRequest.tierMultipliers) {
      Object.entries(updateRequest.tierMultipliers).forEach(
        ([tier, multiplier]) => {
          if (multiplier < 0) {
            errors.push(`Tier multiplier for ${tier} cannot be negative`);
          }
          if (multiplier > 10) {
            warnings.push(`Tier multiplier for ${tier} is very high (> 10x)`);
          }
        },
      );
    }

    // Validate discount percentages
    if (updateRequest.discountPercentages) {
      Object.entries(updateRequest.discountPercentages).forEach(
        ([tier, discount]) => {
          if (discount < 0 || discount > 100) {
            errors.push(
              `Discount percentage for ${tier} must be between 0 and 100`,
            );
          }
        },
      );
    }

    // Calculate impact
    const newConfig = {
      ...currentConfig,
      ...this.applyUpdateRequest(currentConfig, updateRequest),
    };
    const impact = this.calculateImpact(currentConfig, newConfig);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      impact,
    };
  }

  /**
   * Validate new configuration
   */
  private validateNewConfiguration(
    configuration: Omit<
      FeeConfiguration,
      "id" | "createdAt" | "updatedAt" | "version"
    >,
  ): FeeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!configuration.name || configuration.name.trim() === "") {
      errors.push("Configuration name is required");
    }

    if (configuration.basePricePerRequest < 0) {
      errors.push("Base price per request cannot be negative");
    }

    if (configuration.minimumFee < 0) {
      errors.push("Minimum fee cannot be negative");
    }

    if (configuration.maximumFee < 0) {
      errors.push("Maximum fee cannot be negative");
    }

    if (
      configuration.maximumFee > 0 &&
      configuration.minimumFee > configuration.maximumFee
    ) {
      errors.push("Minimum fee cannot be greater than maximum fee");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      impact: {
        affectedUsers: 0,
        priceIncreasePercentage: 0,
        priceDecreasePercentage: 0,
      },
    };
  }

  /**
   * Apply update request to configuration
   */
  private applyUpdateRequest(
    currentConfig: FeeConfiguration,
    updateRequest: FeeUpdateRequest,
  ): Partial<FeeConfiguration> {
    const result: Partial<FeeConfiguration> = {};

    if (updateRequest.basePricePerRequest !== undefined) {
      result.basePricePerRequest = updateRequest.basePricePerRequest;
    }

    if (updateRequest.tierMultipliers) {
      result.tierMultipliers = {
        ...currentConfig.tierMultipliers,
        ...updateRequest.tierMultipliers,
      };
    }

    if (updateRequest.discountPercentages) {
      result.discountPercentages = {
        ...currentConfig.discountPercentages,
        ...updateRequest.discountPercentages,
      };
    }

    if (updateRequest.minimumFee !== undefined) {
      result.minimumFee = updateRequest.minimumFee;
    }

    if (updateRequest.maximumFee !== undefined) {
      result.maximumFee = updateRequest.maximumFee;
    }

    if (updateRequest.rateLimits) {
      result.rateLimits = {
        ...currentConfig.rateLimits,
        ...updateRequest.rateLimits,
      };
    }

    if (updateRequest.requestLimits) {
      result.requestLimits = {
        ...currentConfig.requestLimits,
        ...updateRequest.requestLimits,
      };
    }

    return result;
  }

  /**
   * Detect changes between configurations
   */
  private detectChanges(
    oldConfig: FeeConfiguration,
    newConfig: FeeConfiguration,
  ): any[] {
    const changes = [];

    // Check top-level fields
    if (oldConfig.basePricePerRequest !== newConfig.basePricePerRequest) {
      changes.push({
        field: "basePricePerRequest",
        oldValue: oldConfig.basePricePerRequest,
        newValue: newConfig.basePricePerRequest,
      });
    }

    // Check tier multipliers
    Object.keys(oldConfig.tierMultipliers).forEach((tier) => {
      const oldValue =
        oldConfig.tierMultipliers[
          tier as keyof typeof oldConfig.tierMultipliers
        ];
      const newValue =
        newConfig.tierMultipliers[
          tier as keyof typeof newConfig.tierMultipliers
        ];
      if (oldValue !== newValue) {
        changes.push({
          field: "tierMultiplier",
          tier,
          oldValue,
          newValue,
        });
      }
    });

    // Check discount percentages
    Object.keys(oldConfig.discountPercentages).forEach((tier) => {
      const oldValue =
        oldConfig.discountPercentages[
          tier as keyof typeof oldConfig.discountPercentages
        ];
      const newValue =
        newConfig.discountPercentages[
          tier as keyof typeof newConfig.discountPercentages
        ];
      if (oldValue !== newValue) {
        changes.push({
          field: "discountPercentage",
          tier,
          oldValue,
          newValue,
        });
      }
    });

    return changes;
  }

  /**
   * Calculate impact of fee changes
   */
  private calculateImpact(
    oldConfig: FeeConfiguration,
    newConfig: FeeConfiguration,
  ): FeeValidationResult["impact"] {
    // This is a simplified calculation
    // In production, this would use actual user data
    const oldAveragePrice = oldConfig.basePricePerRequest;
    const newAveragePrice = newConfig.basePricePerRequest;

    const priceIncreasePercentage =
      newAveragePrice > oldAveragePrice
        ? ((newAveragePrice - oldAveragePrice) / oldAveragePrice) * 100
        : 0;

    const priceDecreasePercentage =
      newAveragePrice < oldAveragePrice
        ? ((oldAveragePrice - newAveragePrice) / oldAveragePrice) * 100
        : 0;

    return {
      affectedUsers: 30000, // Example number
      priceIncreasePercentage,
      priceDecreasePercentage,
    };
  }

  /**
   * Check if approval is required for fee changes
   */
  private checkIfApprovalRequired(
    currentConfig: FeeConfiguration,
    updateRequest: FeeUpdateRequest,
  ): boolean {
    if (!this.adminSettings.requireApprovalForLargeChanges) {
      return false;
    }

    const threshold = this.adminSettings.largeChangeThreshold / 100;

    // Check base price change
    if (updateRequest.basePricePerRequest !== undefined) {
      const changePercentage = Math.abs(
        (updateRequest.basePricePerRequest -
          currentConfig.basePricePerRequest) /
          currentConfig.basePricePerRequest,
      );
      return changePercentage > threshold;
    }

    return false;
  }

  /**
   * Notify users of fee changes
   */
  private async notifyUsersOfFeeChange(
    changeEvent: FeeChangeEvent,
  ): Promise<void> {
    // In production, this would send actual notifications
    this.logger.log(
      `User notifications sent for fee change: ${changeEvent.id}`,
    );

    // Log notification (removed emit for now)
    this.logger.log(
      `User notifications sent for fee change: ${changeEvent.id}`,
    );
  }

  /**
   * Initialize default configuration
   */
  private initializeDefaultConfiguration(): void {
    const defaultConfig: FeeConfiguration = {
      id: "default",
      name: "Default GasGuard Pricing",
      description: "Default fee configuration for GasGuard services",
      basePricePerRequest: 0.00001,
      currency: "XLM",
      tierMultipliers: {
        starter: 1.0,
        developer: 0.8, // 20% discount
        professional: 0.6, // 40% discount
        enterprise: 0.4, // 60% discount
      },
      discountPercentages: {
        starter: 0,
        developer: 20,
        professional: 40,
        enterprise: 60,
      },
      minimumFee: 0.000001,
      maximumFee: 0, // Unlimited
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
        enterprise: -1, // Unlimited
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "system",
      version: 1,
    };

    this.configurations.set("default", defaultConfig);
  }

  /**
   * Initialize admin settings
   */
  private initializeAdminSettings(): void {
    this.adminSettings = {
      allowFeeUpdates: true,
      requireApprovalForLargeChanges: true,
      largeChangeThreshold: 25, // 25% change requires approval
      approvalRequiredUsers: [],
      multisigSigners: [],
      multisigApprovalThreshold: 2,
      timelockDelayMinutes: 60,
      defaultGracePeriod: 7, // 7 days
      enableUserNotifications: true,
      notificationChannels: ["email", "in-app"],
      enableAuditLog: true,
      auditRetentionDays: 365,
      maxFeeChangesPerDay: 10,
      maxFeeChangesPerHour: 2,
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }
}
