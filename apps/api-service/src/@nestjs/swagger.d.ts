declare module "@nestjs/swagger" {
  export function ApiTags(...tags: string[]): ClassDecorator;
  export function ApiOperation(options: any): MethodDecorator;
  export function ApiResponse(options: any): MethodDecorator;
  export function ApiProperty(options?: any): PropertyDecorator;
  export function ApiQuery(options: any): ParameterDecorator;
  export function ApiParam(options: any): ParameterDecorator;
  export function ApiBody(options: any): ParameterDecorator;
  export function ApiBearerAuth(name?: string): MethodDecorator;
  export function ApiOAuth2(scopes: string[], name?: string): MethodDecorator;
  export function ApiExcludeEndpoint(): MethodDecorator;
}
