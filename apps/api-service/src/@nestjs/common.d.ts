declare module "@nestjs/common" {
  export function Injectable(): ClassDecorator;
  export function Module(options: any): ClassDecorator;
  export function Controller(path?: string): ClassDecorator;
  export function Post(path?: string): MethodDecorator;
  export function Get(path?: string): MethodDecorator;
  export function Put(path?: string): MethodDecorator;
  export function Delete(path?: string): MethodDecorator;
  export function Patch(path?: string): MethodDecorator;
  export function Body(): ParameterDecorator;
  export function Query(name?: string): ParameterDecorator;
  export function Param(param?: string): ParameterDecorator;
  export function Req(): ParameterDecorator;
  export function Res(): ParameterDecorator;
  export function Headers(name?: string): ParameterDecorator;
  export function HttpCode(code: number): MethodDecorator;
  export function UseGuards(...guards: any[]): MethodDecorator;
  export function SetMetadata(key: string, value: any): MethodDecorator;
  export class HttpException extends Error {
    constructor(response: any, status: number);
  }
  export class BadRequestException extends HttpException {
    constructor(message?: string);
  }
  export class NotFoundException extends HttpException {
    constructor(message?: string);
  }
  export class ForbiddenException extends HttpException {
    constructor(message?: string);
  }
  export class UnauthorizedException extends HttpException {
    constructor(message?: string);
  }
  export class Logger {
    constructor(context?: string);
    log(message: string, context?: string): void;
    error(message: string, trace?: string, context?: string): void;
    warn(message: string, context?: string): void;
    debug(message: string, context?: string): void;
  }
  export const HttpStatus: {
    OK: number;
    CREATED: number;
    BAD_REQUEST: number;
    NOT_FOUND: number;
    INTERNAL_SERVER_ERROR: number;
    FORBIDDEN: number;
    UNAUTHORIZED: number;
    [key: string]: number;
  };
  export interface InjectOptions {
    token?: any;
  }
  export function Inject(options?: InjectOptions): ParameterDecorator;
}
