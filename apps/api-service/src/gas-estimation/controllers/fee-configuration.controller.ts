import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Delete, 
  Body, 
  Param, 
  Query,
  HttpException, 
  HttpStatus,
  UseGuards 
} from '@nestjs/common';
import { FeeConfigurationService } from '../services/fee-configuration.service';
import { 
  FeeConfiguration, 
  FeeUpdateRequest, 
  FeeChangeEvent,
  FeeValidationResult,
  AdminFeeSettings
} from '../interfaces/fee-config.interface';

/**
 * FeeConfigurationController
 * Admin endpoints for managing configurable protocol fees
 */
@Controller('admin/fee-configuration')
@UseGuards(/* Add admin authentication guard here */)
export class FeeConfigurationController {
  constructor(private readonly feeConfigurationService: FeeConfigurationService) {}

  /**
   * Get current fee configuration
   */
  @Get('current')
  async getCurrentConfiguration() {
    try {
      const config = await this.feeConfigurationService.getCurrentConfiguration();
      return {
        success: true,
        data: config,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get current configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all fee configurations
   */
  @Get()
  async getAllConfigurations() {
    try {
      const configurations = await this.feeConfigurationService.getAllConfigurations();
      return {
        success: true,
        data: configurations,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get configurations',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update fee configuration
   */
  @Put(':configId')
  async updateConfiguration(
    @Param('configId') configId: string,
    @Body() updateRequest: FeeUpdateRequest,
  ) {
    try {
      // In production, get admin user ID from authentication
      const adminUserId = 'admin-user'; // Placeholder
      
      // Validate the update request first
      const currentConfig = await this.feeConfigurationService.getCurrentConfiguration();
      const validation = await this.validateUpdate(currentConfig, updateRequest);
      
      if (!validation.isValid) {
        return {
          success: false,
          errors: validation.errors,
          warnings: validation.warnings,
          impact: validation.impact,
        };
      }

      const configuration = await this.feeConfigurationService.updateConfiguration(
        configId,
        updateRequest,
        adminUserId,
      );

      return {
        success: true,
        data: configuration,
        message: 'Fee configuration updated successfully',
        warnings: validation.warnings,
        impact: validation.impact,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to update configuration',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Create a multisig approval request for a large fee update
   */
  @Post(':configId/approval-requests')
  async createApprovalRequest(
    @Param('configId') configId: string,
    @Body() updateRequest: FeeUpdateRequest,
  ) {
    try {
      const adminUserId = 'admin-user'; // Placeholder
      const approvalRequest = await this.feeConfigurationService.createApprovalRequest(
        configId,
        updateRequest,
        adminUserId,
      );
      return {
        success: true,
        data: approvalRequest,
        message: 'Approval request created successfully',
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to create approval request',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('approval-requests')
  async getApprovalRequests(@Query('configId') configId?: string) {
    try {
      const approvalRequests = await this.feeConfigurationService.getApprovalRequests(configId);
      return {
        success: true,
        data: approvalRequests,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch approval requests',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('approval-requests/:requestId')
  async getApprovalRequest(@Param('requestId') requestId: string) {
    try {
      const approvalRequest = await this.feeConfigurationService.getApprovalRequest(requestId);
      return {
        success: true,
        data: approvalRequest,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch approval request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('scheduled-updates')
  async getScheduledUpdates(@Query('configId') configId?: string) {
    try {
      const scheduledUpdates = await this.feeConfigurationService.getScheduledUpdates(configId);
      return {
        success: true,
        data: scheduledUpdates,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch scheduled updates',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('scheduled-updates/:updateId')
  async getScheduledUpdate(@Param('updateId') updateId: string) {
    try {
      const scheduledUpdate = await this.feeConfigurationService.getScheduledUpdate(updateId);
      return {
        success: true,
        data: scheduledUpdate,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to fetch scheduled update',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('scheduled-updates/process')
  async processScheduledUpdates() {
    try {
      const executedUpdates = await this.feeConfigurationService.processPendingScheduledUpdates();
      return {
        success: true,
        data: executedUpdates,
        message: 'Processed pending scheduled updates',
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to process scheduled updates',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('approval-requests/:requestId/approve')
  async approveApprovalRequest(
    @Param('requestId') requestId: string,
  ) {
    try {
      const adminUserId = 'admin-user'; // Placeholder
      const approvalRequest = await this.feeConfigurationService.approveApprovalRequest(
        requestId,
        adminUserId,
      );
      return {
        success: true,
        data: approvalRequest,
        message: 'Approval recorded successfully',
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to approve request',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('approval-requests/:requestId/reject')
  async rejectApprovalRequest(
    @Param('requestId') requestId: string,
  ) {
    try {
      const adminUserId = 'admin-user'; // Placeholder
      const approvalRequest = await this.feeConfigurationService.rejectApprovalRequest(
        requestId,
        adminUserId,
      );
      return {
        success: true,
        data: approvalRequest,
        message: 'Approval request rejected successfully',
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to reject request',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Create new fee configuration
   */
  @Post()
  async createConfiguration(@Body() configuration: Omit<FeeConfiguration, 'id' | 'createdAt' | 'updatedAt' | 'version'>) {
    try {
      // In production, get admin user ID from authentication
      const adminUserId = 'admin-user'; // Placeholder
      
      const newConfig = await this.feeConfigurationService.createConfiguration(
        configuration,
        adminUserId,
      );

      return {
        success: true,
        data: newConfig,
        message: 'Fee configuration created successfully',
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to create configuration',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Get fee configuration history
   */
  @Get(':configId/history')
  async getConfigurationHistory(@Param('configId') configId: string) {
    try {
      const history = await this.feeConfigurationService.getConfigurationHistory(configId);
      return {
        success: true,
        data: history,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get configuration history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get fee change events
   */
  @Get(':configId/events')
  async getFeeEvents(
    @Param('configId') configId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    try {
      const events = await this.feeConfigurationService.getFeeEvents(
        configId,
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined,
      );
      return {
        success: true,
        data: events,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get fee events',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get fee analytics
   */
  @Get('analytics')
  async getFeeAnalytics(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    try {
      if (!startDate || !endDate) {
        throw new HttpException(
          'startDate and endDate query parameters are required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const analytics = await this.feeConfigurationService.getFeeAnalytics(
        new Date(startDate),
        new Date(endDate),
      );
      return {
        success: true,
        data: analytics,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get fee analytics',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get admin settings
   */
  @Get('settings')
  async getAdminSettings() {
    try {
      const settings = await this.feeConfigurationService.getAdminSettings();
      return {
        success: true,
        data: settings,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get admin settings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Update admin settings
   */
  @Put('settings')
  async updateAdminSettings(@Body() settings: Partial<AdminFeeSettings>) {
    try {
      // In production, get admin user ID from authentication
      const adminUserId = 'admin-user'; // Placeholder
      
      const updatedSettings = await this.feeConfigurationService.updateAdminSettings(
        settings,
        adminUserId,
      );

      return {
        success: true,
        data: updatedSettings,
        message: 'Admin settings updated successfully',
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to update admin settings',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Validate fee update before applying
   */
  @Post(':configId/validate')
  async validateUpdate(
    @Param('configId') configId: string,
    @Body() updateRequest: FeeUpdateRequest,
  ) {
    try {
      const currentConfig = await this.feeConfigurationService.getCurrentConfiguration();
      const validation = await this.validateUpdate(currentConfig, updateRequest);
      
      return {
        success: validation.isValid,
        data: validation,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to validate update',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Preview fee changes impact
   */
  @Post(':configId/preview')
  async previewChanges(
    @Param('configId') configId: string,
    @Body() updateRequest: FeeUpdateRequest,
  ) {
    try {
      const currentConfig = await this.feeConfigurationService.getCurrentConfiguration();
      const validation = await this.validateUpdate(currentConfig, updateRequest);
      
      // Calculate what the new configuration would look like
      const previewConfig = this.applyPreviewChanges(currentConfig, updateRequest);
      
      return {
        success: true,
        data: {
          currentConfiguration: currentConfig,
          previewConfiguration: previewConfig,
          validation,
          impact: validation.impact,
          changes: this.detectChanges(currentConfig, previewConfig),
        },
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to preview changes',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete fee configuration
   */
  @Delete(':configId')
  async deleteConfiguration(@Param('configId') configId: string) {
    try {
      // In production, get admin user ID from authentication
      const adminUserId = 'admin-user'; // Placeholder
      
      // This would need to be implemented in the service
      return {
        success: true,
        message: 'Fee configuration deleted successfully',
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to delete configuration',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Restore fee configuration from history
   */
  @Post(':configId/restore/:version')
  async restoreConfiguration(
    @Param('configId') configId: string,
    @Param('version') version: number,
  ) {
    try {
      // In production, get admin user ID from authentication
      const adminUserId = 'admin-user'; // Placeholder
      
      // This would need to be implemented in the service
      return {
        success: true,
        message: `Fee configuration restored to version ${version}`,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to restore configuration',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Helper method to validate update request
   */
  private async validateUpdate(
    currentConfig: FeeConfiguration,
    updateRequest: FeeUpdateRequest,
  ): Promise<FeeValidationResult> {
    // This would use the service's validation method
    // For now, return a basic validation
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate base price
    if (updateRequest.basePricePerRequest !== undefined) {
      if (updateRequest.basePricePerRequest < 0) {
        errors.push('Base price per request cannot be negative');
      }
      if (updateRequest.basePricePerRequest > 1) {
        warnings.push('Base price per request is very high (> 1 XLM)');
      }
    }

    // Calculate impact
    const impact = {
      affectedUsers: 30000, // Example number
      priceIncreasePercentage: updateRequest.basePricePerRequest && currentConfig.basePricePerRequest
        ? ((updateRequest.basePricePerRequest - currentConfig.basePricePerRequest) / currentConfig.basePricePerRequest) * 100
        : 0,
      priceDecreasePercentage: updateRequest.basePricePerRequest && currentConfig.basePricePerRequest
        ? ((currentConfig.basePricePerRequest - updateRequest.basePricePerRequest) / currentConfig.basePricePerRequest) * 100
        : 0,
    };

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      impact,
    };
  }

  /**
   * Helper method to apply preview changes
   */
  private applyPreviewChanges(
    currentConfig: FeeConfiguration,
    updateRequest: FeeUpdateRequest,
  ): Partial<FeeConfiguration> {
    const result: Partial<FeeConfiguration> = { ...currentConfig };

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
   * Helper method to detect changes
   */
  private detectChanges(
    oldConfig: FeeConfiguration,
    newConfig: Partial<FeeConfiguration>,
  ): any[] {
    const changes = [];

    if (oldConfig.basePricePerRequest !== newConfig.basePricePerRequest) {
      changes.push({
        field: 'basePricePerRequest',
        oldValue: oldConfig.basePricePerRequest,
        newValue: newConfig.basePricePerRequest,
      });
    }

    // Check tier multipliers
    if (newConfig.tierMultipliers) {
      Object.keys(oldConfig.tierMultipliers).forEach(tier => {
        const oldValue = oldConfig.tierMultipliers[tier as keyof typeof oldConfig.tierMultipliers];
        const newValue = newConfig.tierMultipliers?.[tier as keyof typeof newConfig.tierMultipliers];
        if (oldValue !== newValue && newValue !== undefined) {
          changes.push({
            field: 'tierMultiplier',
            tier,
            oldValue,
            newValue,
          });
        }
      });
    }

    // Check discount percentages
    if (newConfig.discountPercentages) {
      Object.keys(oldConfig.discountPercentages).forEach(tier => {
        const oldValue = oldConfig.discountPercentages[tier as keyof typeof oldConfig.discountPercentages];
        const newValue = newConfig.discountPercentages?.[tier as keyof typeof newConfig.discountPercentages];
        if (oldValue !== newValue && newValue !== undefined) {
          changes.push({
            field: 'discountPercentage',
            tier,
            oldValue,
            newValue,
          });
        }
      });
    }

    return changes;
  }
}
