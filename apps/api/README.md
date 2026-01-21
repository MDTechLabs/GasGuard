# GasGuard API

NestJS backend API for GasGuard with versioned endpoints.

## API Versioning

All endpoints require the `/v1/` prefix. Unversioned requests return `404 Not Found`.

### Example

```bash
# ✅ Correct
curl http://localhost:3000/v1/example

# ❌ Returns 404
curl http://localhost:3000/example
```

## Setup

```bash
# Install dependencies
npm install

# Development
npm run start:dev

# Production build
npm run build
npm run start:prod
```

## Creating Controllers

All controllers must use the `@Version('1')` decorator:

```typescript
import { Controller, Get, Version } from '@nestjs/common';

@Controller('your-resource')
@Version('1')
export class YourController {
  @Get()
  findAll() {
    // Accessible at GET /v1/your-resource
  }
}
```

## Project Structure

```
apps/api/
├── src/
│   ├── main.ts              # Application bootstrap with versioning
│   ├── app.module.ts        # Root module
│   └── example/             # Example controller
│       └── example.controller.ts
├── package.json
├── tsconfig.json
└── nest-cli.json
```

## Versioning Configuration

Versioning is configured in `src/main.ts`:

- **Type:** URI-based (`VersioningType.URI`)
- **Default Version:** None (unversioned requests return 404)
- **Current Version:** `v1`

This ensures all API consumers must explicitly specify the version, making the API future-proof.
