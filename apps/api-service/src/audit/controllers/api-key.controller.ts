import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiKeyService } from "../services/api-key.service";
import {
  CreateApiKeyDto,
  ListApiKeysQueryDto,
  RevokeApiKeyDto,
  RotateApiKeyDto,
} from "../dto/api-key.dto";

/**
 * API Key Management Controller
 * Handles creation, rotation, and revocation of API keys
 * Note: JWT Auth Guard should be applied at route level or globally
 */
@Controller("api-keys")
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  /**
   * Create a new API key
   * POST /api-keys
   */
  @Post()
  async createApiKey(@Body() createDto: CreateApiKeyDto, req: any) {
    // Get merchantId from authenticated user
    const merchantId = req.user?.merchantId || req.user?.sub;

    const result = await this.apiKeyService.createApiKey(merchantId, createDto);

    return {
      success: true,
      data: result,
      message:
        "API key created successfully. Store the key securely - it will not be shown again.",
    };
  }

  /**
   * List all API keys for the authenticated merchant
   * GET /api-keys
   */
  @Get()
  async listApiKeys(@Query() query: ListApiKeysQueryDto, req: any) {
    const merchantId = req.user?.merchantId || req.user?.sub;

    const result = await this.apiKeyService.listApiKeys(
      merchantId,
      query.limit,
      query.offset,
      query.status,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Get API key status
   * GET /api-keys/:id/status
   */
  @Get(":id/status")
  async getApiKeyStatus(@Param("id") keyId: string, req: any) {
    const merchantId = req.user?.merchantId || req.user?.sub;

    const result = await this.apiKeyService.getApiKeyStatus(keyId, merchantId);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Rotate an API key
   * POST /api-keys/:id/rotate
   */
  @Post(":id/rotate")
  async rotateApiKey(
    @Param("id") keyId: string,
    @Body() rotateDto: RotateApiKeyDto,
    req: any,
  ) {
    const merchantId = req.user?.merchantId || req.user?.sub;

    const result = await this.apiKeyService.rotateApiKey(
      keyId,
      merchantId,
      rotateDto.reason,
    );

    return {
      success: true,
      data: result,
      message:
        "API key rotated successfully. The old key will remain valid for 24 hours.",
    };
  }

  /**
   * Revoke an API key
   * POST /api-keys/:id/revoke
   */
  @Post(":id/revoke")
  @HttpCode(HttpStatus.OK)
  async revokeApiKey(
    @Param("id") keyId: string,
    @Body() revokeDto: RevokeApiKeyDto,
    req: any,
  ) {
    const merchantId = req.user?.merchantId || req.user?.sub;

    await this.apiKeyService.revokeApiKey(keyId, merchantId, revokeDto.reason);

    return {
      success: true,
      message: "API key revoked successfully.",
    };
  }

  /**
   * Delete (revoke) an API key
   * DELETE /api-keys/:id
   */
  @Delete(":id")
  async deleteApiKey(@Param("id") keyId: string, req: any) {
    const merchantId = req.user?.merchantId || req.user?.sub;

    await this.apiKeyService.revokeApiKey(keyId, merchantId, "deleted-via-api");

    return {
      success: true,
      message: "API key deleted successfully.",
    };
  }
}
