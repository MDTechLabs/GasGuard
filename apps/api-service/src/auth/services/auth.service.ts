import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User } from "../../database/entities/user.entity";
import { UserRole } from "../../rbac/enums/role.enum";

/**
 * DTO for login request
 */
export interface LoginDto {
  email: string;
  password: string;
}

/**
 * DTO for login response
 */
export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    role: UserRole;
    merchantId?: string;
  };
}

/**
 * JWT payload interface
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  merchantId?: string;
}

/**
 * Authentication Service
 * Handles user authentication and JWT token generation
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Validate user credentials
   */
  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepository
      .createQueryBuilder("user")
      .addSelect("user.passwordHash")
      .where("user.email = :email", { email })
      .getOne();

    if (!user) {
      return null;
    }

    // Check if user can authenticate
    if (!user.canAuthenticate()) {
      throw new UnauthorizedException("Account is not active or is locked");
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      // Record failed login attempt
      await this.recordFailedLogin(user.id);
      return null;
    }

    return user;
  }

  /**
   * Login user and generate JWT token
   */
  async login(dto: LoginDto, ipAddress?: string): Promise<LoginResponse> {
    const user = await this.validateUser(dto.email, dto.password);

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // Record successful login
    await this.recordSuccessfulLogin(user.id, ipAddress);

    // Generate JWT payload
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      merchantId: user.merchantId,
    };

    // Generate access token
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        merchantId: user.merchantId,
      },
    };
  }

  /**
   * Validate JWT payload and return user
   */
  async validatePayload(payload: JwtPayload): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive || user.isLocked()) {
      return null;
    }

    return user;
  }

  /**
   * Hash password
   */
  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify password
   */
  async verifyPassword(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  /**
   * Record successful login
   */
  private async recordSuccessfulLogin(
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.userRepository.update(userId, {
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress,
      failedLoginAttempts: 0,
      lockedUntil: undefined,
    });
  }

  /**
   * Record failed login attempt
   */
  private async recordFailedLogin(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) return;

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
   * Generate password reset token
   */
  generatePasswordResetToken(userId: string): string {
    return this.jwtService.sign(
      { sub: userId, type: "password_reset" },
      { expiresIn: "1h" },
    );
  }

  /**
   * Verify password reset token
   */
  verifyPasswordResetToken(token: string): { sub: string; type: string } {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      throw new BadRequestException("Invalid or expired token");
    }
  }
}
