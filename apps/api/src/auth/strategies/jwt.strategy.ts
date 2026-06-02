import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface JwtPayload {
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  roles?: string[];
  permissions?: string[];
  [key: string]: any;
}

export interface JwtUser {
  userId: string;
  roles: string[];
  permissions: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    const secret = configService.get<string>("JWT_SECRET");
    if (!secret) {
      throw new Error("JWT_SECRET environment variable is required");
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      issuer: configService.get<string>("JWT_ISSUER", "gasguard-api"),
      audience: configService.get<string>("JWT_AUDIENCE", "gasguard-client"),
      algorithms: ["HS256"],
    });
  }

  async validate(payload: JwtPayload): Promise<JwtUser> {
    // Validate required claims
    if (!payload.sub) {
      throw new UnauthorizedException("Invalid token: missing subject claim");
    }

    if (!payload.iss) {
      throw new UnauthorizedException("Invalid token: missing issuer claim");
    }

    if (!payload.aud) {
      throw new UnauthorizedException("Invalid token: missing audience claim");
    }

    if (!payload.exp) {
      throw new UnauthorizedException(
        "Invalid token: missing expiration claim",
      );
    }

    // Check token expiration (passport-jwt also does this, but double-check)
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new UnauthorizedException("Token has expired");
    }

    // Return user object that will be attached to request
    return {
      userId: payload.sub,
      roles: payload.roles || [],
      permissions: payload.permissions || [],
    };
  }
}
