import { Request, Response, NextFunction } from "express";
import { BaseValidator, ValidationError } from "./base.validator";
import { TransactionAnalysisRequest } from "../schemas/failed-transaction.schema";

export class FailedTransactionValidator extends BaseValidator {
  /**
   * Validates the transaction analysis request
   */
  static validateTransactionAnalysis(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const body = req.body as TransactionAnalysisRequest;
    const errors: ValidationError[] = [];

    try {
      // Validate wallet address
      if (!body.wallet) {
        errors.push({
          field: "wallet",
          message: "Wallet address is required",
          constraint: "required",
        });
      } else if (!this.isValidAddress(body.wallet)) {
        errors.push({
          field: "wallet",
          message: "Invalid wallet address format",
          value: body.wallet,
          constraint: "addressFormat",
        });
      }

      // Validate chain IDs
      if (body.chainIds) {
        if (!Array.isArray(body.chainIds)) {
          errors.push({
            field: "chainIds",
            message: "Chain IDs must be an array",
            value: body.chainIds,
            constraint: "array",
          });
        } else {
          body.chainIds.forEach((chainId, index) => {
            if (typeof chainId !== "number" || !this.isValidChainId(chainId)) {
              errors.push({
                field: `chainIds[${index}]`,
                message: `Invalid chain ID: ${chainId}. Supported chains: ${this.SUPPORTED_CHAINS.join(", ")}`,
                value: chainId,
                constraint: "chainId",
              });
            }
          });
        }
      }

      // Validate timeframe
      if (body.timeframe) {
        if (
          body.timeframe.start &&
          !this.isValidTimestamp(body.timeframe.start)
        ) {
          errors.push({
            field: "timeframe.start",
            message: "Invalid start timestamp format. Must be ISO 8601 format",
            value: body.timeframe.start,
            constraint: "timestamp",
          });
        }

        if (body.timeframe.end && !this.isValidTimestamp(body.timeframe.end)) {
          errors.push({
            field: "timeframe.end",
            message: "Invalid end timestamp format. Must be ISO 8601 format",
            value: body.timeframe.end,
            constraint: "timestamp",
          });
        }

        if (body.timeframe.start && body.timeframe.end) {
          const startDate = new Date(body.timeframe.start);
          const endDate = new Date(body.timeframe.end);
          if (startDate >= endDate) {
            errors.push({
              field: "timeframe",
              message: "Start timestamp must be before end timestamp",
              constraint: "timeframeOrder",
            });
          }
        }
      }

      // Validate includeRecommendations
      if (
        body.includeRecommendations !== undefined &&
        typeof body.includeRecommendations !== "boolean"
      ) {
        errors.push({
          field: "includeRecommendations",
          message: "includeRecommendations must be a boolean",
          value: body.includeRecommendations,
          constraint: "boolean",
        });
      }

      if (errors.length > 0) {
        this.sendValidationError(
          res,
          errors,
          req.headers["x-request-id"] as string,
        );
        return;
      }

      next();
    } catch (error) {
      this.sendServerError(res, error, req.headers["x-request-id"] as string);
    }
  }

  /**
   * Validates wallet address parameter in URL
   */
  static validateWalletParam(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const { wallet } = req.params;
    const errors: ValidationError[] = [];

    if (!wallet) {
      errors.push({
        field: "wallet",
        message: "Wallet address parameter is required",
        constraint: "required",
      });
    } else if (!this.isValidAddress(wallet)) {
      errors.push({
        field: "wallet",
        message: "Invalid wallet address format",
        value: wallet,
        constraint: "addressFormat",
      });
    }

    if (errors.length > 0) {
      this.sendValidationError(
        res,
        errors,
        req.headers["x-request-id"] as string,
      );
      return;
    }

    next();
  }

  /**
   * Validates chain IDs query parameter
   */
  static validateChainIdsQuery(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const { chainIds } = req.query;
    const errors: ValidationError[] = [];

    if (chainIds) {
      const chainIdArray = (chainIds as string)
        .split(",")
        .map((id) => parseInt(id.trim()));

      chainIdArray.forEach((chainId, index) => {
        if (isNaN(chainId) || !this.isValidChainId(chainId)) {
          errors.push({
            field: `chainIds[${index}]`,
            message: `Invalid chain ID: ${chainId}. Supported chains: ${this.SUPPORTED_CHAINS.join(", ")}`,
            value: chainId,
            constraint: "chainId",
          });
        }
      });
    }

    if (errors.length > 0) {
      this.sendValidationError(
        res,
        errors,
        req.headers["x-request-id"] as string,
      );
      return;
    }

    next();
  }
}
