import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../../database/entities/user.entity";
import { UserRole, hasRoleAccess } from "../enums/role.enum";

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
}
