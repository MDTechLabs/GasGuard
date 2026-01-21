import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable API versioning with URI-based strategy
  // All routes must include /v1/ prefix, unversioned requests return 404
  app.enableVersioning({
    type: VersioningType.URI,
    // No defaultVersion - unversioned requests will return 404
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`API versioning enabled - all endpoints require /v1/ prefix`);
}

bootstrap();
