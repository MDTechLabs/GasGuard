import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AuditInterceptor } from "./audit/interceptors";
import { AuditLogService } from "./audit/services";

import { PrivilegeBoundaryService } from "./security/privilege-boundary.service";

/**
 * Privilege boundary documentation and enforcement.
 *
 * This service is the central authority for documenting and validating
 * the privilege boundaries of the GasGuard API service. It exposes the
 * boundary model at runtime (for auditing and operational visibility) and
 * fails fast on misconfiguration so that elevated privileges cannot be
 * accidentally granted in production.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Add global audit interceptor
  const auditLogService = app.get(AuditLogService);
  app.useGlobalInterceptors(new AuditInterceptor(auditLogService));

  // Document and enforce the privilege boundaries at bootstrap time.
  // This logs the effective boundary model and throws if the running
  // process holds privileges outside the documented boundary.
  const privilegeBoundaryService = app.get(PrivilegeBoundaryService);
  privilegeBoundaryService.assertWithinBoundary();
  privilegeBoundaryService.logBoundarySummary();

  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(
    `GasGuard API Service is running on: http://localhost:${port}`,
  );
  console.log(`Health check available at: http://localhost:${port}/health`);
}

bootstrap();
