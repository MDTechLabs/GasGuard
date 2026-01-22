import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class AnalyzeRequestDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  source?: string = 'remote-analysis';
}
