import {
  IsString, IsNumber, IsEnum, IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TxStatus, TxType } from '../transaction.entity';

export class RecordTransactionDto {
  @IsString()
  txHash: string;

  @IsString()
  merchantId: string;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  chainId: number;

  @IsEnum(TxStatus)
  status: TxStatus;

  @IsEnum(TxType)
  type: TxType;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  gasUsed: number;

  @IsOptional()
  @IsString()
  gasPrice?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  timestamp?: string;
}