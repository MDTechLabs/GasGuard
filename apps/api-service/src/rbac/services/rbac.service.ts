import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../../database/entities/user.entity";
import { UserRole, hasRoleAccess } from "../enums/role.enum";

/**
 * Report access levels for report access controls.
 */
export enum ReportAccessLevel {
  NONE = "none",
  VIEW = "view",
  EXPORT = "export",
  MANAGE = "manage",
}

/**
 * Report access scope describing which reports and actions are allowed.
 */
export interface ReportAccessScope {
  /** Report types the user may access. Empty means all report types. */
  reportTypes?: string[];
  /** Merchant IDs the user may access. Empty means all merchants. */
  merchantIds?: string[];
  /** Maximum access level granted by this scope. */
  level: ReportAccessLevel;
}

/**
 * Persisted report access grant for a user.
 */
export interface ReportAccessGrant {
  id: string;
  userId: string;
  reportTypes: string[];
  merchantIds: string[];
  level: ReportAccessLevel;
  grantedBy: string;
  grantedAt: Date;
  expiresAt?: Date;
}

/**
 * Input for granting report access.
 */
export interface GrantReportAccessDto {
  userId: string;
  reportTypes?: string[];
  merchantIds?: string[];
  level?: ReportAccessLevel;
  grantedBy: string;
  expiresAt?: Date;
}

/**
 * Input for updating report access.
 */
export interface UpdateReportAccessDto {
  reportTypes?: string[];
  merchantIds?: string[];
  level?: ReportAccessLevel;
  expiresAt?: Date | null;
  updatedBy: string;
}

/**
 * Context used when evaluating report access.
 */
export interface ReportAccessContext {
  reportType?: string;
  merchantId?: string;
  requiredLevel?: ReportAccessLevel;
}

/**
 * Default access level granted to a role when no explicit grant exists.
 * Secure defaults: viewers can only view, operators can export, admins manage.
 */
const ROLE_DEFAULT_REPORT_LEVEL: Record<UserRole, ReportAccessLevel> = {
  [UserRole.ADMIN]: ReportAccessLevel.MANAGE,
  [UserRole.OPERATOR]: ReportAccessLevel.EXPORT,
  [UserRole.VIEWER]: ReportAccessLevel.VIEW,
};

const REPORT_LEVEL_RANK: Record<ReportAccessLevel, number> = {
  [ReportAccessLevel.NONE]: 0,
  [ReportAccessLevel.VIEW]: 1,
  [ReportAccessLevel.EXPORT]: 2,
  [ReportAccessLevel.MANAGE]: 3,
};

/**
 * DTO for creating a new user
 */
export interface CreateUserDto {
  email: string;
  firstName?: string;
  lastName?: string;
  passwordHash: string;
  role?: UserRole;
  merchantId?: string;
  createdBy?: string;
  metadata?: Record<string, any>;
}

/**
 * DTO for updating a user
 */
export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  merchantId?: string;
  isActive?: boolean;
  metadata?: Record<string, any>;
}

/**
 * DTO for updating user role
 */
export interface UpdateUserRoleDto {
  role: UserRole;
  updatedBy: string;
}

/**
 * Service for managing RBAC operations
 * Handles user management, role assignments, and permission checks
 */
@Injectable()
export class RbacService {
  /**
   * In-memory report access grants keyed by user ID.
   * This is the authoritative store for explicit grants; role defaults are
   * applied when no grant exists.
   */
  private readonly reportAccessGrants: Map<string, ReportAccessGrant[]> =
    new Map();

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Create a new user
   */
  async createUser(dto: CreateUserDto): Promise<User> {
    // Check if email already exists
    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException(
        `User with email ${dto.email} already exists`,
      );
    }

    const user = this.userRepository.create({
      ...dto,
      role: dto.role || UserRole.VIEWER,
      isActive: true,
      failedLoginAttempts: 0,
    });

    return this.userRepository.save(user);
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
    });
  }

  /**
   * Find user by email with password hash (for authentication)
   */
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder("user")
      .addSelect("user.passwordHash")
      .where("user.email = :email", { email })
      .getOne();
  }

  /**
   * Update user information
   */
  async updateUser(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);

    Object.assign(user, dto);
    return this.userRepository.save(user);
  }

  /**
   * Update user role
   */
  async updateUserRole(id: string, dto: UpdateUserRoleDto): Promise<User> {
    const user = await this.findById(id);

    // Prevent changing own role (security measure)
    if (id === dto.updatedBy) {
      throw new BadRequestException("Cannot change your own role");
    }

    user.role = dto.role;
    return this.userRepository.save(user);
  }

  /**
   * Delete a user
   */
  async deleteUser(id: string, deletedBy: string): Promise<void> {
    const user = await this.findById(id);

    // Prevent self-deletion
    if (id === deletedBy) {
      throw new BadRequestException("Cannot delete your own account");
    }

    await this.userRepository.remove(user);
    this.reportAccessGrants.delete(id);
  }

  /**
   * Get all users with optional filtering
   */
  async findAll(options?: {
    merchantId?: string;
    role?: UserRole;
    isActive?: boolean;
    skip?: number;
    take?: number;
  }): Promise<{ users: User[]; total: number }> {
    const queryBuilder = this.userRepository.createQueryBuilder("user");

    if (options?.merchantId) {
      queryBuilder.andWhere("user.merchantId = :merchantId", {
        merchantId: options.merchantId,
      });
    }

    if (options?.role) {
      queryBuilder.andWhere("user.role = :role", { role: options.role });
    }

    if (options?.isActive !== undefined) {
      queryBuilder.andWhere("user.isActive = :isActive", {
        isActive: options.isActive,
      });
    }

    const skip = options?.skip || 0;
    const take = options?.take || 50;

    queryBuilder.skip(skip).take(take);

    const [users, total] = await queryBuilder.getManyAndCount();

    return { users, total };
  }

  /**
   * Get users by merchant ID
   */
  async findByMerchant(merchantId: string): Promise<User[]> {
    return this.userRepository.find({
      where: { merchantId },
    });
  }

  /**
   * Check if user has required role
   */
  async hasRole(userId: string, requiredRole: UserRole): Promise<boolean> {
    const user = await this.findById(userId);
    return hasRoleAccess(user.role, requiredRole);
  }

  /**
   * Record successful login
   */
  async recordLogin(userId: string, ipAddress?: string): Promise<void> {
    await this.userRepository.update(userId, {
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress,
      failedLoginAttempts: 0,
      lockedUntil: null as unknown as undefined,
    });
  }

  /**
   * Record failed login attempt
   */
  async recordFailedLogin(userId: string): Promise<void> {
    const user = await this.findById(userId);

    user.failedLoginAttempts += 1;

    // Lock account after 5 failed attempts for 30 minutes
    if (user.failedLoginAttempts >= 5) {
      const lockUntil = new Date();
      lockUntil.setMinutes(lockUntil.getMinutes() + 30);
      user.lockedUntil = lockUntil;
    }

    await this.userRepository.save(user);
  }

  /**
   * Unlock user account
   */
  async unlockUser(id: string): Promise<User> {
    const user = await this.findById(id);

    user.lockedUntil = undefined;
    user.failedLoginAttempts = 0;

    return this.userRepository.save(user);
  }

  /**
   * Activate/Deactivate user account
   */
  async setUserActiveStatus(id: string, isActive: boolean): Promise<User> {
    const user = await this.findById(id);

    user.isActive = isActive;

    return this.userRepository.save(user);
  }

  /**
   * Get user statistics
   */
  async getUserStats(): Promise<{
    total: number;
    byRole: Record<UserRole, number>;
    active: number;
    inactive: number;
    locked: number;
  }> {
    const total = await this.userRepository.count();
    const active = await this.userRepository.count({
      where: { isActive: true },
    });
    const inactive = await this.userRepository.count({
      where: { isActive: false },
    });

    const byRole: Record<UserRole, number> = {
      [UserRole.ADMIN]: await this.userRepository.count({
        where: { role: UserRole.ADMIN },
      }),
      [UserRole.OPERATOR]: await this.userRepository.count({
        where: { role: UserRole.OPERATOR },
      }),
      [UserRole.VIEWER]: await this.userRepository.count({
        where: { role: UserRole.VIEWER },
      }),
    };

    // Count locked users (where lockedUntil is in the future)
    const lockedResult = await this.userRepository
      .createQueryBuilder("user")
      .where("user.lockedUntil > NOW()")
      .getCount();

    return {
      total,
      byRole,
      active,
      inactive,
      locked: lockedResult,
    };
  }

  // -----------------------------------------------------------------------
  // Report access controls
  // -----------------------------------------------------------------------

  /**
   * Grant report access to a user. Existing grants for the same user are
   * replaced to keep a single authoritative grant per user.
   */
  async grantReportAccess(dto: GrantReportAccessDto): Promise<ReportAccessGrant> {
    await this.findById(dto.userId);

    const level = dto.level ?? ReportAccessLevel.VIEW;

    if (!dto.grantedBy) {
      throw new BadRequestException("grantedBy is required");
    }

    if (dto.expiresAt && dto.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("expiresAt must be in the future");
    }

    const grant: ReportAccessGrant = {
      id: this.buildGrantId(dto.userId),
      userId: dto.userId,
      reportTypes: this.normalizeList(dto.reportTypes),
      merchantIds: this.normalizeList(dto.merchantIds),
      level,
      grantedBy: dto.grantedBy,
      grantedAt: new Date(),
      expiresAt: dto.expiresAt,
    };

    this.reportAccessGrants.set(dto.userId, [grant]);
    return grant;
  }

  /**
   * Update an existing report access grant.
   */
  async updateReportAccess(
    userId: string,
    dto: UpdateReportAccessDto,
  ): Promise<ReportAccessGrant> {
    await this.findById(userId);

    const existing = this.reportAccessGrants.get(userId)?.[0];
    if (!existing) {
      throw new NotFoundException(
        `No report access grant found for user ${userId}`,
      );
    }

    if (dto.expiresAt && dto.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("expiresAt must be in the future");
    }

    const updated: ReportAccessGrant = {
      ...existing,
      reportTypes:
        dto.reportTypes !== undefined
          ? this.normalizeList(dto.reportTypes)
          : existing.reportTypes,
      merchantIds:
        dto.merchantIds !== undefined
          ? this.normalizeList(dto.merchantIds)
          : existing.merchantIds,
      level: dto.level ?? existing.level,
      grantedBy: dto.updatedBy,
      grantedAt: new Date(),
      expiresAt:
        dto.expiresAt === null ? undefined : dto.expiresAt ?? existing.expiresAt,
    };

    this.reportAccessGrants.set(userId, [updated]);
    return updated;
  }

  /**
   * Revoke report access for a user.
   */
  async revokeReportAccess(userId: string): Promise<void> {
    await this.findById(userId);
    this.reportAccessGrants.delete(userId);
  }

  /**
   * Get the effective report access grant for a user, falling back to the
   * role-based default when no explicit grant is present or the grant has
   * expired.
   */
  async getReportAccess(userId: string): Promise<ReportAccessGrant> {
    const user = await this.findById(userId);
    const grant = this.reportAccessGrants.get(userId)?.[0];

    if (grant && !this.isGrantExpired(grant)) {
      return grant;
    }

    return {
      id: this.buildGrantId(userId),
      userId,
      reportTypes: [],
      merchantIds: [],
      level: ROLE_DEFAULT_REPORT_LEVEL[user.role] ?? ReportAccessLevel.NONE,
      grantedBy: "system",
      grantedAt: new Date(),
    };
  }

  /**
   * Check whether a user may access a report given the provided context.
   * Secure defaults: denies access when the user is inactive, the grant
   * is expired, the report type/merchant is out of scope, or the requested
   * level exceeds the granted level.
   */
  async canAccessReport(
    userId: string,
    context: ReportAccessContext = {},
  ): Promise<boolean> {
    const user = await this.findById(userId);

    if (!user.isActive) {
      return false;
    }

    const grant = await this.getReportAccess(userId);

    if (this.isGrantExpired(grant)) {
      return false;
    }

    const requiredLevel = context.requiredLevel ?? ReportAccessLevel.VIEW;
    if (REPORT_LEVEL_RANK[grant.level] < REPORT_LEVEL_RANK[requiredLevel]) {
      return false;
    }

    if (
      context.reportType &&
      grant.reportTypes.length > 0 &&
      !grant.reportTypes.includes(context.reportType)
    ) {
      return false;
    }

    if (
      context.merchantId &&
      grant.merchantIds.length > 0 &&
      !grant.merchantIds.includes(context.merchantId)
    ) {
      return false;
    }

    return true;
  }

  /**
   * Enforce report access, raising a ForbiddenException when denied.
   */
  async ensureReportAccess(
    userId: string,
    context: ReportAccessContext = {},
  ): Promise<void> {
    const allowed = await this.canAccessReport(userId, context);
    if (!allowed) {
      throw new ForbiddenException(
        `Report access denied for user ${userId}`,
      );
    }
  }

  /**
   * List all report access grants. Optionally filter by user.
   */
  async listReportAccessGrants(userId?: string): Promise<ReportAccessGrant[]> {
    if (userId) {
      const grants = this.reportAccessGrants.get(userId) ?? [];
      return grants.filter((grant) => !this.isGrantExpired(grant));
    }

    const all: ReportAccessGrant[] = [];
    for (const grants of this.reportAccessGrants.values()) {
      for (const grant of grants) {
        if (!this.isGrantExpired(grant)) {
          all.push(grant);
        }
      }
    }
    return all;
  }

  /**
   * Return true when the grant has an expiration in the past.
   */
  private isGrantExpired(grant: ReportAccessGrant): boolean {
    return !!grant.expiresAt && grant.expiresAt.getTime() <= Date.now();
  }

  /**
   * Normalize a list of strings: trim, deduplicate, and drop empty entries.
   */
  private normalizeList(values?: string[]): string[] {
    if (!values) {
      return [];
    }
    const seen = new Set<string>();
    for (const value of values) {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          seen.add(trimmed);
        }
      }
    }
    return Array.from(seen);
  }

  /**
   * Build a deterministic grant ID for a user.
   */
  private buildGrantId(userId: string): string {
    return `report-access:${userId}`;
  }
}
