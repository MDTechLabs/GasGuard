/**
 * Fee Configuration Interface
 * Defines the structure for configurable protocol fees
 */

import { UsageTier } from "./tiered-pricing.interface";

export interface FeeConfiguration {
  id: string;
  name: string;
  description: string;
  // Base pricing configuration
  basePricePerRequest: number; // in XLM
  currency: string; // XLM, USD, EUR, etc.
  // Tier-specific multipliers
  tierMultipliers: {
    starter: number;
    developer: number;
    professional: number;
    enterprise: number;
  };
  // Discount percentages
  discountPercentages: {
    starter: number;
    developer: number;
    professional: number;
    enterprise: number;
  };
  // Additional fee settings
  minimumFee: number; // Minimum fee per request
  maximumFee: number; // Maximum fee per request (0 = unlimited)
  // Rate limiting
  rateLimits: {
    starter: number; // requests per minute
    developer: number;
    professional: number;
    enterprise: number;
  };
  // Request limits
  requestLimits: {
    starter: number; // requests per month
    developer: number;
    professional: number;
    enterprise: number; // -1 = unlimited
  };
  // Metadata
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string; // Admin user ID
  version: number; // For versioning and rollback
}

export interface FeeUpdateRequest {
  // Fields to update
  basePricePerRequest?: number;
  tierMultipliers?: {
    starter?: number;
    developer?: number;
    professional?: number;
    enterprise?: number;
  };
  discountPercentages?: {
    starter?: number;
    developer?: number;
    professional?: number;
    enterprise?: number;
  };
  minimumFee?: number;
  maximumFee?: number;
  rateLimits?: {
    starter?: number;
    developer?: number;
    professional?: number;
    enterprise?: number;
  };
  requestLimits?: {
    starter?: number;
    developer?: number;
    professional?: number;
    enterprise?: number;
  };
  // Update metadata
  reason: string;
  effectiveDate?: Date; // When changes take effect (default: immediate)
  notifyUsers?: boolean; // Whether to notify users of changes
}

export interface FeeChangeEvent {
  id: string;
  configurationId: string;
  type: "FEE_UPDATED" | "FEE_CREATED" | "FEE_DELETED" | "FEE_RESTORED";
  timestamp: Date;
  oldConfiguration?: Partial<FeeConfiguration>;
  newConfiguration: Partial<FeeConfiguration>;
  changes: FeeChange[];
  metadata: {
    updatedBy: string;
    reason: string;
    effectiveDate: Date;
    notifyUsers: boolean;
    version: number;
  };
}

export interface FeeChange {
  field: string;
  oldValue: any;
  newValue: any;
  tier?: string; // For tier-specific changes
}

export interface FeeValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  impact: {
    affectedUsers: number;
    priceIncreasePercentage: number;
    priceDecreasePercentage: number;
  };
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ApprovalRequest {
  id: string;
  configurationId: string;
  requestedBy: string;
  request: FeeUpdateRequest;
  requiredSigners: string[];
  approvals: string[];
  rejections: string[];
  threshold: number;
  status: ApprovalStatus;
  createdAt: Date;
  updatedAt: Date;
  reason: string;
  effectiveDate: Date;
  notifyUsers: boolean;
}

export type ScheduledUpdateStatus = "SCHEDULED" | "EXECUTED" | "CANCELLED";

export interface ScheduledUpdate {
  id: string;
  configurationId: string;
  request: FeeUpdateRequest;
  createdBy: string;
  scheduledAt: Date;
  status: ScheduledUpdateStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeeConfigurationHistory {
  id: string;
  configurationId: string;
  version: number;
  configuration: FeeConfiguration;
  changeEvent: FeeChangeEvent;
  createdAt: Date;
  createdBy: string;
}

export interface FeeAnalytics {
  // Revenue analytics
  totalRevenue: {
    daily: number;
    weekly: number;
    monthly: number;
    yearly: number;
  };
  // Usage analytics
  usageByTier: {
    starter: number;
    developer: number;
    professional: number;
    enterprise: number;
  };
  // Revenue by tier
  revenueByTier: {
    starter: number;
    developer: number;
    professional: number;
    enterprise: number;
  };
  // Trend analytics
  trends: {
    revenueGrowth: number; // percentage
    usageGrowth: number; // percentage
    averageRevenuePerUser: number;
  };
  // Period
  period: {
    startDate: Date;
    endDate: Date;
  };
}

export interface TierValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  impact: {
    affectedUsers: number;
    priceIncreasePercentage: number;
    priceDecreasePercentage: number;
  };
  currentTier?: UsageTier;
  canProceed?: boolean;
  suggestedAction?: "continue" | "upgrade" | "downgrade" | "contact_support";
  nextAvailableTier?: UsageTier;
  message?: string;
  notificationRequired?: boolean;
}

export interface TierTransition {
  fromTier: UsageTier;
  toTier: UsageTier;
  effectiveDate: Date;
  reason: string;
  prorationRequired: boolean;
  proratedCost?: number;
  contactSupport?: boolean;
  requiresApproval?: boolean;
  gracePeriodDays?: number;
}

export interface AdminFeeSettings {
  // Global admin settings
  allowFeeUpdates: boolean;
  requireApprovalForLargeChanges: boolean;
  largeChangeThreshold: number; // percentage change
  approvalRequiredUsers: string[]; // Legacy list of admin user IDs required for approval
  multisigSigners: string[]; // Authorized multisig signer user IDs
  multisigApprovalThreshold: number; // Number of signers required to approve large changes
  timelockDelayMinutes: number; // Minimum delay before upgrade execution
  defaultGracePeriod: number; // days before fee changes take effect
  enableUserNotifications: boolean;
  notificationChannels: ("email" | "sms" | "in-app" | "webhook")[];
  // Audit settings
  enableAuditLog: boolean;
  auditRetentionDays: number;
  // Rate limiting for admin operations
  maxFeeChangesPerDay: number;
  maxFeeChangesPerHour: number;
}
