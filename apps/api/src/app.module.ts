import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';

@Module({
    imports: [
        // Configure rate limiting: 10 requests per 60 seconds per IP
        ThrottlerModule.forRoot([
            {
                name: 'default',
                ttl: 60000,  // 60 seconds in milliseconds
                limit: 10,   // 10 requests per TTL window
            },
        ]),
    ],
    controllers: [AppController],
    providers: [
        // Apply ThrottlerGuard globally to all routes
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
})
export class AppModule { }
