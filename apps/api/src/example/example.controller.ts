import { Controller, Get } from '@nestjs/common';

/**
 * Example controller demonstrating API versioning
 * 
 * This controller is accessible at:
 * - GET /v1/example
 * 
 * Unversioned requests (e.g., /example) will return 404
 */
@Controller({ path: 'example', version: '1' })
export class ExampleController {
  @Get()
  getExample() {
    return {
      message: 'This is a versioned endpoint',
      version: '1',
      path: '/v1/example',
    };
  }
}
