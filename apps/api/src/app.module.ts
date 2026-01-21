import { Module } from '@nestjs/common';
import { ExampleController } from './example/example.controller';

@Module({
  imports: [],
  controllers: [
    ExampleController,
    // Add your controllers here - remember to add @Version('1') decorator
  ],
  providers: [],
})
export class AppModule {}
