import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AuditInterceptor } from "./audit/interceptors";
import { AuditLogService } from "./audit/services";

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

  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(
    `🚀 GasGuard API Service is running on: http://localhost:${port}`,
  );
  console.log(`📊 Health check available at: http://localhost:${port}/health`);
}

bootstrap();
