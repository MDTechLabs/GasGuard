export class RpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcValidationError";
  }
}
