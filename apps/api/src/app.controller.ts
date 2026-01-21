import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
    /**
     * Health check endpoint
     * Returns a simple status to verify the API is running
     */
    @Get('health')
    getHealth(): { status: string } {
        return { status: 'ok' };
    }
}
