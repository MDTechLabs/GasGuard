import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiResponse } from "@nestjs/swagger";
import {
  GasSubsidyService,
  SubsidyUsageRecord,
  CreateCapDto,
} from "../services/gas-subsidy.service";
import { SubsidyCapType, SubsidyStatus } from "../entities/gas-subsidy.entity";
import {
  AdminOnly,
  OperatorAndAbove,
  ViewerAndAbove,
} from "../../rbac/decorators";
import { RolesGuard } from "../../rbac/guards";

interface CheckSubsidyDto {
  amount: number;
}

interface AcknowledgeAlertDto {
  acknowledgedBy: string;
}

@ApiTags("Gas Subsidy Management")
@Controller("api/subsidy")
@UseGuards(RolesGuard)
export class GasSubsidyController {
  constructor(private readonly gasSubsidyService: GasSubsidyService) {}

  @Get("health")
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  health() {
    return { status: "ok", service: "gas-subsidy" };
  }

  @Post("caps")
  @AdminOnly()
  @HttpCode(HttpStatus.CREATED)
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createCap(@Body() dto: CreateCapDto) {
    const cap = await this.gasSubsidyService.createCap(dto);
    return { success: true, cap };
  }

  @Get("caps/:walletAddress")
  @OperatorAndAbove()
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires operator or admin role",
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getCap(
    @Param("walletAddress") walletAddress: string,
    @Query("capType") capType?: SubsidyCapType,
  ) {
    return this.gasSubsidyService.getCap(walletAddress, capType);
  }

  @Get("caps")
  @OperatorAndAbove()
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires operator or admin role",
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getAllCaps(@Query("status") status?: SubsidyStatus) {
    return this.gasSubsidyService.getAllCaps(status);
  }

  @Post("check/:walletAddress")
  @OperatorAndAbove()
  @HttpCode(HttpStatus.OK)
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires operator or admin role",
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async checkSubsidy(
    @Param("walletAddress") walletAddress: string,
    @Body() dto: CheckSubsidyDto,
  ) {
    return this.gasSubsidyService.checkSubsidy(walletAddress, dto.amount);
  }

  @Post("usage")
  @OperatorAndAbove()
  @HttpCode(HttpStatus.CREATED)
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires operator or admin role",
  })
  async recordUsage(@Body() record: SubsidyUsageRecord) {
    const log = await this.gasSubsidyService.recordUsage(record);
    return { success: true, log };
  }

  @Get("usage/:walletAddress")
  @OperatorAndAbove()
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires operator or admin role",
  })
  async getUsageLogs(
    @Param("walletAddress") walletAddress: string,
    @Query("limit") limit?: number,
  ) {
    return this.gasSubsidyService.getUsageLogs(walletAddress, limit || 100);
  }

  @Get("alerts")
  @OperatorAndAbove()
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires operator or admin role",
  })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getAlerts(@Query("walletAddress") walletAddress?: string) {
    return this.gasSubsidyService.getActiveAlerts(walletAddress);
  }

  @Put("alerts/:alertId/acknowledge")
  @OperatorAndAbove()
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires operator or admin role",
  })
  async acknowledgeAlert(
    @Param("alertId") alertId: string,
    @Body() dto: AcknowledgeAlertDto,
  ) {
    const alert = await this.gasSubsidyService.acknowledgeAlert(
      alertId,
      dto.acknowledgedBy,
    );
    return { success: true, alert };
  }

  @Get("flags")
  @AdminOnly()
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getSuspiciousFlags(@Query("walletAddress") walletAddress?: string) {
    return this.gasSubsidyService.getSuspiciousFlags(walletAddress);
  }

  @Put("flags/:flagId/clear")
  @AdminOnly()
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  async clearFlag(@Param("flagId") flagId: string) {
    const flag = await this.gasSubsidyService.clearSuspiciousFlag(flagId);
    return { success: true, flag };
  }

  @Get("realtime")
  @ViewerAndAbove()
  @ApiResponse({
    status: 403,
    description: "Forbidden - requires authentication",
  })
  async getRealtimeSummary() {
    return this.gasSubsidyService.getRealtimeSummary();
  }
}
