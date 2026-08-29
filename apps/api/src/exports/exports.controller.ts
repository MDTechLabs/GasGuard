import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from "@nestjs/swagger";
import { ExportsService } from "./exports.service";
import { GasUsageFilterDto } from "./dto/gas-usage-filter.dto";
import { Roles, Role } from "../auth/decorators/roles.decorator";

@ApiTags("Exports")
@ApiBearerAuth()
@Controller("exports")
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  // ─── GET /exports/gas-usage ───────────────────────────────────────────────

  @Get("gas-usage")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER, Role.ADMIN)
  @ApiOperation({
    summary: "Export gas usage data as a CSV file",
    description:
      "Generates a streamed CSV containing per-transaction gas usage records for a " +
      "merchant or wallet, optionally filtered by date range, chain, or transaction type. " +
      "Suitable for direct download by finance teams.",
  })
  @ApiQuery({ name: "merchantId", required: false, description: "Merchant ID" })
  @ApiQuery({
    name: "wallet",
    required: false,
    description: "Wallet address (0x…)",
  })
  @ApiQuery({
    name: "from",
    required: false,
    description: "Start date (ISO 8601). Defaults to 30 days ago.",
    example: "2024-01-01",
  })
  @ApiQuery({
    name: "to",
    required: false,
    description: "End date (ISO 8601). Defaults to now.",
    example: "2024-01-31",
  })
  @ApiQuery({
    name: "chain",
    required: false,
    description:
      'Chain name or numeric chain ID (e.g. "ethereum", "polygon", "1", "137").',
  })
  @ApiQuery({
    name: "txType",
    required: false,
    enum: ["transfer", "swap", "mint", "burn", "all"],
    description: "Transaction type filter.",
  })
  @ApiResponse({
    status: 200,
    description: "text/csv attachment.",
    headers: {
      "Content-Disposition": {
        description: 'attachment; filename="gas-usage_….csv"',
      },
      "X-Total-Records": { description: "Number of rows in the export." },
      "X-Generated-At": { description: "ISO timestamp of report generation." },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Invalid filters or no data found.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async exportGasUsage(
    @Query() filters: GasUsageFilterDto,
    @Res() res: Response,
  ): Promise<void> {
    if (!filters.wallet && !filters.merchantId) {
      throw new BadRequestException(
        'At least one of "wallet" or "merchantId" must be provided.',
      );
    }

    const { stream, metadata } =
      await this.exportsService.generateGasUsageStream(filters);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${this.buildFilename(filters)}"`,
    );
    res.setHeader("X-Total-Records", String(metadata.totalRecords));
    res.setHeader("X-Generated-At", metadata.generatedAt);

    stream.pipe(res);
  }

  // ─── GET /exports/gas-usage/:wallet/download ──────────────────────────────

  @Get("gas-usage/:wallet/download")
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER, Role.ADMIN)
  @ApiOperation({
    summary: "Download gas usage CSV for a specific wallet",
    description:
      "Convenience endpoint that accepts the wallet address as a route parameter. " +
      "All query-level filters (from, to, chain, txType) are still supported.",
  })
  @ApiParam({
    name: "wallet",
    description: "Wallet address (0x…)",
    example: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  })
  @ApiQuery({
    name: "from",
    required: false,
    description: "Start date (ISO 8601). Defaults to 30 days ago.",
    example: "2024-01-01",
  })
  @ApiQuery({
    name: "to",
    required: false,
    description: "End date (ISO 8601). Defaults to now.",
    example: "2024-01-31",
  })
  @ApiQuery({
    name: "chain",
    required: false,
    description: "Chain name or numeric chain ID.",
  })
  @ApiQuery({
    name: "txType",
    required: false,
    enum: ["transfer", "swap", "mint", "burn", "all"],
  })
  @ApiResponse({ status: 200, description: "text/csv attachment." })
  @ApiResponse({
    status: 400,
    description: "Invalid wallet address or no data found.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async downloadWalletGasUsage(
    @Param("wallet") wallet: string,
    @Query() filters: GasUsageFilterDto,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, metadata } =
      await this.exportsService.generateGasUsageStream(filters, wallet);

    const mergedFilters = { ...filters, wallet };

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${this.buildFilename(mergedFilters)}"`,
    );
    res.setHeader("X-Total-Records", String(metadata.totalRecords));
    res.setHeader("X-Generated-At", metadata.generatedAt);

    stream.pipe(res);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildFilename(filters: Partial<GasUsageFilterDto>): string {
    const parts: string[] = ["gas-usage"];
    if (filters.merchantId) parts.push(`merchant-${filters.merchantId}`);
    if (filters.wallet) parts.push(filters.wallet.slice(0, 10));
    if (filters.chain) parts.push(filters.chain.toLowerCase());
    if (filters.from) parts.push(filters.from.slice(0, 10));
    if (filters.to) parts.push(filters.to.slice(0, 10));
    parts.push(new Date().toISOString().slice(0, 10));
    return `${parts.join("_")}.csv`;
  }
}
