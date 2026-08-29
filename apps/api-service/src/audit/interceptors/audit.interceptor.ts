import { Injectable } from "@nestjs/common";
import { AuditLogService } from "../services/audit-log.service";

@Injectable()
export class AuditInterceptor {
  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: any, next: any): any {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const startTime = Date.now();
    const { method, url, ip, headers } = request;
    const apiKey = this.extractApiKey(request);

    // Skip audit logging for health check endpoints
    if (this.shouldSkipAudit(url)) {
      return next.handle();
    }

    // Emit audit event after request handling
    try {
      const result = next.handle();
      const duration = Date.now() - startTime;
      const statusCode = response.statusCode || 200;

      this.auditLogService.emitApiRequest(
        apiKey || "anonymous",
        url,
        method,
        statusCode,
        ip,
        duration,
      );

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const statusCode = error.status || 500;

      this.auditLogService.emitApiRequest(
        apiKey || "anonymous",
        url,
        method,
        statusCode,
        ip,
        duration,
        error.message,
      );

      throw error;
    }
  }

  private extractApiKey(request: any): string | null {
    // Check Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7);
    }

    // Check X-API-Key header
    if (request.headers["x-api-key"]) {
      return request.headers["x-api-key"];
    }

    // Check query parameters
    if (request.query && request.query.apiKey) {
      return request.query.apiKey;
    }

    return null;
  }

  private shouldSkipAudit(url: string): boolean {
    const excludePatterns = [
      "/health",
      "/health/ready",
      "/health/live",
      "/metrics",
      "/swagger",
      "/api-docs",
    ];

    return excludePatterns.some((pattern) => url.includes(pattern));
  }
}
