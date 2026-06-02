import { validateBaseRpcShape } from "./schemas";
import { RpcValidationError } from "./errors";
import { SorobanRpcResponse, ValidateResult } from "./types";

export class SorobanRpcValidator {
  /**
   * Strict validation (throws on failure)
   */
  static validateOrThrow<T = any>(payload: any): SorobanRpcResponse<T> {
    const error = validateBaseRpcShape(payload);

    if (error) {
      throw new RpcValidationError(error);
    }

    return payload;
  }

  /**
   * Safe validation (returns structured result)
   */
  static validate<T = any>(payload: any): ValidateResult<T> {
    const error = validateBaseRpcShape(payload);

    if (error) {
      return {
        valid: false,
        error,
      };
    }

    return {
      valid: true,
      data: payload,
    };
  }

  /**
   * Validates only successful RPC responses
   */
  static validateResult<T = any>(payload: any): T {
    const validated = this.validateOrThrow<SorobanRpcResponse<T>>(payload);

    if (validated.error) {
      throw new RpcValidationError(validated.error.message);
    }

    return validated.result as T;
  }
}
