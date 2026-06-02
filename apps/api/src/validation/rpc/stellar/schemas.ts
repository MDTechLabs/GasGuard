export function isObject(val: any): val is Record<string, any> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

export function validateBaseRpcShape(payload: any): string | null {
  if (!isObject(payload)) return "RPC response must be an object";

  if (payload.jsonrpc !== "2.0") {
    return "Invalid jsonrpc version (expected '2.0')";
  }

  if (payload.id === undefined) {
    return "Missing RPC id";
  }

  const hasResult = "result" in payload;
  const hasError = "error" in payload;

  if (!hasResult && !hasError) {
    return "RPC response must contain either result or error";
  }

  if (hasResult && hasError) {
    return "RPC response cannot contain both result and error";
  }

  if (hasError) {
    const err = payload.error;
    if (!isObject(err)) return "Invalid error object";

    if (typeof err.code !== "number") return "Error code must be a number";
    if (typeof err.message !== "string")
      return "Error message must be a string";
  }

  return null;
}
