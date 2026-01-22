import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScanModule } from './scan/scan.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScanModule,
  ],
})
export class AppModule {}
