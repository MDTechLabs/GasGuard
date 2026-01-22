import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ScanRequestDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  source?: string = 'remote-scan';

  @IsString()
  @IsOptional()
  language?: string = 'rust';
}
