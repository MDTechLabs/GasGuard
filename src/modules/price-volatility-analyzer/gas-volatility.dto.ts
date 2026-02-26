import { IsInt, IsPositive, IsOptional, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetVolatilityQueryDto {
  @ApiProperty({ description: 'EVM chain ID', example: 1 })
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  chainId: number;
}

export class IngestGasDataQueryDto {
  @ApiPropertyOptional({
    description: 'Aggregation interval',
    enum: ['1m', '5m', '1h'],
    default: '1h',
  })
  @IsOptional()
  @IsIn(['1m', '5m', '1h'])
  interval?: '1m' | '5m' | '1h' = '1h';
}

export class VolatilityResponseDto {
  @ApiProperty({ example: 1 })
  chainId: number;

  @ApiProperty({ example: 0.42 })
  currentVolatilityIndex: number;

  @ApiProperty({
    example: 'Moderate',
    enum: ['Low', 'Moderate', 'High', 'Extreme'],
  })
  volatilityLevel: 'Low' | 'Moderate' | 'High' | 'Extreme';

  @ApiProperty({ example: 0.38 })
  rolling7d: number;

  @ApiProperty({
    example:
      'Consider executing transactions during low-volatility windows.',
  })
  recommendation: string;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  computedAt: string;
}

export class ChainComparisonItemDto {
  @ApiProperty({ example: 1 })
  chainId: number;

  @ApiProperty({ example: 0.42 })
  currentVolatilityIndex: number;

  @ApiProperty({ example: 'Moderate' })
  volatilityLevel: string;

  @ApiProperty({ example: 0.38 })
  rolling7d: number;
}

export class ChainComparisonResponseDto {
  @ApiProperty({ type: [ChainComparisonItemDto] })
  chains: ChainComparisonItemDto[];

  @ApiProperty({ description: 'Chain ID with lowest current volatility' })
  lowestVolatilityChain: number;

  @ApiProperty({ example: '2024-01-15T10:30:00.000Z' })
  generatedAt: string;
}

export class HistoricalVolatilityItemDto {
  @ApiProperty()
  timestamp: string;

  @ApiProperty()
  volatilityIndex: number;

  @ApiProperty()
  volatilityLevel: string;
}

export class HistoricalVolatilityResponseDto {
  @ApiProperty()
  chainId: number;

  @ApiProperty({ type: [HistoricalVolatilityItemDto] })
  history: HistoricalVolatilityItemDto[];
}
