import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { OptimizationEngineService } from "../services/optimization-engine.service";

@ApiTags("Cost Optimization")
@Controller("merchant")
export class CostOptimizationController {
  private readonly logger = new Logger(CostOptimizationController.name);

  constructor(
    private readonly optimizationEngineService: OptimizationEngineService,
  ) {}

  @Get(":merchantId/cost-optimization")
  @ApiOperation({ summary: "Get cost optimization suggestions for a merchant" })
  @ApiParam({
    name: "merchantId",
    description: "ID of the merchant to get suggestions for",
    required: true,
  })
  @ApiQuery({
    name: "days",
    description: "Number of days back to analyze (default: 30)",
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: "status",
    description: "Filter suggestions by status (pending, applied, rejected)",
    required: false,
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: "Cost optimization suggestions retrieved successfully",
    schema: {
      type: "object",
      properties: {
        merchantId: { type: "string" },
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              description: { type: "string" },
              estimatedSavingsUSD: { type: "number" },
              priority: { type: "number" },
              category: { type: "string" },
              metadata: { type: "object" },
            },
          },
        },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async getCostOptimizationSuggestions(
    @Param("merchantId") merchantId: string,
    @Query("days") days?: number,
    @Query("status") status?: string,
  ): Promise<{
    merchantId: string;
    suggestions: Array<{
      type: string;
      description: string;
      estimatedSavingsUSD?: number;
      priority: number;
      category?: string;
      metadata?: Record<string, any>;
    }>;
    summary: {
      totalPotentialSavingsUSD: number;
      totalSuggestions: number;
      highPrioritySuggestions: number;
      appliedSuggestions: number;
    };
  }> {
    try {
      this.logger.log(
        `Request to get cost optimization suggestions for merchant ${merchantId}`,
      );

      // Parse days parameter or use default
      const daysBack = days ? parseInt(days.toString(), 10) : 30;

      // Generate suggestions
      const suggestions =
        await this.optimizationEngineService.generateOptimizationSuggestions(
          merchantId,
          daysBack,
        );

      // Save suggestions to database
      await this.optimizationEngineService.saveOptimizationSuggestions(
        merchantId,
        suggestions,
      );

      // Get all suggestions for this merchant (with optional status filter)
      const allSuggestions =
        await this.optimizationEngineService.getOptimizationSuggestions(
          merchantId,
          status,
        );

      // Get summary
      const summary =
        await this.optimizationEngineService.getOptimizationSummary(merchantId);

      return {
        merchantId,
        suggestions: allSuggestions.map((s) => ({
          type: s.type,
          description: s.description,
          estimatedSavingsUSD: s.estimatedSavingsUSD,
          priority: s.priority,
          category: s.category,
          metadata: s.metadata,
        })),
        summary,
      };
    } catch (error) {
      this.logger.error(
        `Error getting cost optimization suggestions for merchant ${merchantId}`,
        error,
      );
      throw error;
    }
  }

  @Get(":merchantId/cost-optimization/summary")
  @ApiOperation({ summary: "Get cost optimization summary for a merchant" })
  @ApiParam({
    name: "merchantId",
    description: "ID of the merchant to get summary for",
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: "Cost optimization summary retrieved successfully",
    schema: {
      type: "object",
      properties: {
        totalPotentialSavingsUSD: { type: "number" },
        totalSuggestions: { type: "number" },
        highPrioritySuggestions: { type: "number" },
        appliedSuggestions: { type: "number" },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async getCostOptimizationSummary(
    @Param("merchantId") merchantId: string,
  ): Promise<{
    totalPotentialSavingsUSD: number;
    totalSuggestions: number;
    highPrioritySuggestions: number;
    appliedSuggestions: number;
  }> {
    try {
      this.logger.log(
        `Request to get cost optimization summary for merchant ${merchantId}`,
      );

      return await this.optimizationEngineService.getOptimizationSummary(
        merchantId,
      );
    } catch (error) {
      this.logger.error(
        `Error getting cost optimization summary for merchant ${merchantId}`,
        error,
      );
      throw error;
    }
  }

  @Get(":merchantId/cost-optimization/history")
  @ApiOperation({
    summary: "Get cost optimization suggestions history for a merchant",
  })
  @ApiParam({
    name: "merchantId",
    description: "ID of the merchant to get history for",
    required: true,
  })
  @ApiQuery({
    name: "status",
    description:
      "Filter suggestions by status (pending, applied, rejected, archived)",
    required: false,
    type: String,
  })
  @ApiQuery({
    name: "limit",
    description: "Maximum number of suggestions to return (default: 10)",
    required: false,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: "Cost optimization suggestions history retrieved successfully",
    schema: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string" },
              description: { type: "string" },
              estimatedSavingsUSD: { type: "number" },
              priority: { type: "number" },
              status: { type: "string" },
              createdAt: { type: "string" },
              appliedAt: { type: "string" },
              metadata: { type: "object" },
            },
          },
        },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async getCostOptimizationHistory(
    @Param("merchantId") merchantId: string,
    @Query("status") status?: string,
    @Query("limit") limit?: number,
  ): Promise<{
    suggestions: Array<{
      id: string;
      type: string;
      description: string;
      estimatedSavingsUSD?: number;
      priority: number;
      status: string;
      createdAt: Date;
      appliedAt?: Date;
      metadata?: Record<string, any>;
    }>;
  }> {
    try {
      this.logger.log(
        `Request to get cost optimization history for merchant ${merchantId}`,
      );

      // Get suggestions with optional filters
      let suggestions =
        await this.optimizationEngineService.getOptimizationSuggestions(
          merchantId,
          status,
        );

      // Apply limit if specified
      if (limit) {
        suggestions = suggestions.slice(0, parseInt(limit.toString(), 10));
      }

      return {
        suggestions: suggestions.map((s) => ({
          id: s.id,
          type: s.type,
          description: s.description,
          estimatedSavingsUSD: s.estimatedSavingsUSD,
          priority: s.priority,
          status: s.status,
          createdAt: s.createdAt,
          appliedAt: s.appliedAt,
          metadata: s.metadata,
        })),
      };
    } catch (error) {
      this.logger.error(
        `Error getting cost optimization history for merchant ${merchantId}`,
        error,
      );
      throw error;
    }
  }
}
