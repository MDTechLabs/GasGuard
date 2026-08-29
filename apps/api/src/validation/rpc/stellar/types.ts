export type SorobanRpcResponse<T = any> = {
  jsonrpc: string;
  id: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
};

export type ValidateResult<T> = {
  valid: boolean;
  data?: T;
  error?: string;
};
