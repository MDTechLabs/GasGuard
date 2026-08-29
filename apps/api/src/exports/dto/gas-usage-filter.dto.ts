import {
  IsOptional,
  IsString,
  IsDateString,
  IsEthereumAddress,
  IsIn,
  IsUrl,
} from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class GasUsageFilterDto {
  @ApiPropertyOptional({
    description: "Merchant ID to filter by.",
    example: "merchant-42",
  })
  @IsOptional()
  @IsString()
  merchantId?: string;

  @ApiPropertyOptional({
    description: "Wallet address to filter by.",
    example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  })
  @IsOptional()
  @IsEthereumAddress()
  wallet?: string;

  @ApiPropertyOptional({
    description: "Start of date range (ISO 8601). Defaults to 30 days ago.",
    example: "2024-01-01",
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: "End of date range (ISO 8601). Defaults to now.",
    example: "2024-01-31",
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description:
      'Chain name or numeric chain ID (e.g. "ethereum", "polygon", "1", "137").',
    example: "ethereum",
  })
  @IsOptional()
  @IsString()
  chain?: string;

  @ApiPropertyOptional({
    description: "Transaction type filter.",
    enum: ["transfer", "swap", "mint", "burn", "all"],
    example: "all",
  })
  @IsOptional()
  @IsIn(["transfer", "swap", "mint", "burn", "all"])
  txType?: string;

  @ApiPropertyOptional({
    description:
      "Custom JSON-RPC URL. Falls back to RPC_URL env var if omitted.",
    example: "https://mainnet.infura.io/v3/YOUR_KEY",
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  rpcUrl?: string;
}
