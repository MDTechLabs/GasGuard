import { Request, Response, NextFunction } from "express";
import { BaseValidator, ValidationError } from "./base.validator";

export class CrossChainGasValidator extends BaseValidator {
  /**
   * Validates the transaction type query parameter
   */
  static validateTransactionType(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const { txType } = req.query;
    const errors: ValidationError[] = [];

    if (!txType) {
      errors.push({
        field: "txType",
        message: "Transaction type is required",
        constraint: "required",
      });
    } else if (
      typeof txType !== "string" ||
      !this.isValidTransactionType(txType)
    ) {
      errors.push({
        field: "txType",
        message:
          "Invalid transaction type. Must be one of: transfer, contract-call, swap",
        value: txType,
        constraint: "enum",
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
   * Validates chain ID parameter in URL
   */
  static validateChainIdParam(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const { chainId } = req.params;
    const errors: ValidationError[] = [];

    if (!chainId) {
      errors.push({
        field: "chainId",
        message: "Chain ID parameter is required",
        constraint: "required",
      });
    } else {
      const chainIdNum = parseInt(chainId, 10);
      if (isNaN(chainIdNum) || !this.isValidChainId(chainIdNum)) {
        errors.push({
          field: "chainId",
          message: `Invalid chain ID: ${chainId}. Supported chains: ${this.SUPPORTED_CHAINS.join(", ")}`,
          value: chainId,
          constraint: "chainId",
        });
      }
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
   * Validates date range query parameters
   */
  static validateDateRange(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const { startDate, endDate } = req.query;
    const errors: ValidationError[] = [];

    if (startDate && typeof startDate === "string") {
      if (!this.isValidTimestamp(startDate)) {
        errors.push({
          field: "startDate",
          message: "Invalid start date format. Must be ISO 8601 format",
          value: startDate,
          constraint: "timestamp",
        });
      }
    }

    if (endDate && typeof endDate === "string") {
      if (!this.isValidTimestamp(endDate)) {
        errors.push({
          field: "endDate",
          message: "Invalid end date format. Must be ISO 8601 format",
          value: endDate,
          constraint: "timestamp",
        });
      }
    }

    if (
      startDate &&
      endDate &&
      typeof startDate === "string" &&
      typeof endDate === "string"
    ) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (start >= end) {
        errors.push({
          field: "dateRange",
          message: "Start date must be before end date",
          constraint: "dateOrder",
        });
      }
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
