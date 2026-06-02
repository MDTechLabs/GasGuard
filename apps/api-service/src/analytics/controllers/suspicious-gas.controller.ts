import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SuspiciousGasPatternRepository } from "../repositories/suspicious-gas-pattern.repository";
import {
  QuerySuspiciousGasDto,
  ReviewPatternDto,
  ClearPatternDto,
  ConfirmAbuseDto,
  SuspiciousGasPatternListResponseDto,
  SuspiciousGasStatsResponseDto,
} from "../dto/suspicious-gas.dto";
import { PatternStatus } from "../entities/suspicious-gas-pattern.entity";

@Controller("analytics/suspicious-gas")
export class SuspiciousGasController {
  constructor(
    private readonly patternRepository: SuspiciousGasPatternRepository,
  ) {}

  @Get()
  async findAll(@Query() query: QuerySuspiciousGasDto) {
    const { data, total } = await this.patternRepository.findWithFilters({
      chainId: query.chainId,
      severity: query.severity,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      data,
      total,
      limit: query.limit || 50,
      offset: query.offset || 0,
    };
  }

  @Get("stats")
  async getStats(): Promise<SuspiciousGasStatsResponseDto> {
    const stats = await this.patternRepository.getFlaggedAccountsStats();
    const byChain = await this.patternRepository.getPatternsByChain();

    return {
      ...stats,
      byChain,
    };
  }

  @Get(":account")
  async findByAccount(@Param("account") account: string) {
    const patterns = await this.patternRepository.find({
      where: { accountAddress: account },
      order: { lastDetectedAt: "DESC" },
    });

    return {
      success: true,
      data: patterns,
    };
  }

  @Post(":id/review")
  @HttpCode(HttpStatus.OK)
  async reviewPattern(@Param("id") id: string, @Body() dto: ReviewPatternDto) {
    const pattern = await this.patternRepository.findOne({ where: { id } });
    if (!pattern) {
      return { success: false, message: "Pattern not found" };
    }

    pattern.status = PatternStatus.REVIEWED;
    pattern.reviewedBy = dto.reviewerId;
    pattern.reviewedAt = new Date();
    pattern.reviewNotes = dto.notes || "";

    await this.patternRepository.save(pattern);

    return {
      success: true,
      message: "Pattern marked as under review",
    };
  }

  @Post(":id/clear")
  @HttpCode(HttpStatus.OK)
  async clearPattern(@Param("id") id: string, @Body() dto: ClearPatternDto) {
    const pattern = await this.patternRepository.findOne({ where: { id } });
    if (!pattern) {
      return { success: false, message: "Pattern not found" };
    }

    pattern.status = PatternStatus.CLEARED;
    pattern.reviewedBy = dto.reviewerId;
    pattern.reviewedAt = new Date();
    pattern.reviewNotes = `Cleared: ${dto.reason}`;

    await this.patternRepository.save(pattern);

    return {
      success: true,
      message: "Pattern cleared as false positive",
    };
  }

  @Post(":id/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmAbuse(@Param("id") id: string, @Body() dto: ConfirmAbuseDto) {
    const pattern = await this.patternRepository.findOne({ where: { id } });
    if (!pattern) {
      return { success: false, message: "Pattern not found" };
    }

    pattern.status = PatternStatus.CONFIRMED_ABUSE;
    pattern.reviewedBy = dto.reviewerId;
    pattern.reviewedAt = new Date();
    pattern.reviewNotes = `Confirmed abuse. Action: ${dto.action || "none"}. ${dto.notes || ""}`;

    await this.patternRepository.save(pattern);

    return {
      success: true,
      message: "Abuse confirmed and restrictions applied",
    };
  }
}
