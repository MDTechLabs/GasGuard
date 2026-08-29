declare module "class-validator" {
  export function IsString(validationOptions?: any): PropertyDecorator;
  export function IsNumber(
    args?: any,
    validationOptions?: any,
  ): PropertyDecorator;
  export function IsDate(validationOptions?: any): PropertyDecorator;
  export function IsEnum(
    entity: any,
    validationOptions?: any,
  ): PropertyDecorator;
  export function IsOptional(validationOptions?: any): PropertyDecorator;
  export function Min(min: number, validationOptions?: any): PropertyDecorator;
  export function Max(max: number, validationOptions?: any): PropertyDecorator;
  export function IsIn(
    values: any[],
    validationOptions?: any,
  ): PropertyDecorator;
}
