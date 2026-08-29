import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { AuthService, JwtPayload } from "../services/auth.service";
import { User } from "../../database/entities/user.entity";

/**
 * JWT Strategy for Passport
 * Validates JWT tokens and attaches user to request
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        "JWT_SECRET",
        "your-secret-key-change-in-production",
      ),
    });
  }

  /**
   * Validate JWT payload and return user
   * This method is called after the token is verified
   */
  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.authService.validatePayload(payload);

    if (!user) {
      throw new UnauthorizedException("Invalid token or user not found");
    }

    return user;
  }
}
