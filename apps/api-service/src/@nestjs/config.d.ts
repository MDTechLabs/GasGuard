declare module "@nestjs/config" {
  export function ConfigModule(options?: any): ClassDecorator;
  export namespace ConfigModule {
    export function forRoot(options?: any): any;
  }
  export class ConfigService {
    get(key: string, defaultValue?: any): any;
  }
  export interface ConfigModuleOptions {
    isGlobal?: boolean;
    load?: Array<() => any>;
    envFilePath?: string;
  }
}
