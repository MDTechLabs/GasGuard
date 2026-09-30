import { IsString, IsNotEmpty, IsOptional, MaxLength } from "class-validator";

export const MAX_SCAN_CODE_BYTES = 1MB * 1024 * 1024;

export class ScanRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCAN_CODE_BYTES, {
    message: `code must not exceed ${MAX_SCAN_CODE_BYTES} bytes`,
  })
  code: string;

  @IsString()
  @IsOptional()
  source?: string = "remote-scan";

  @IsString()
  @IsOptional()
  language?: string = "rust";
}
