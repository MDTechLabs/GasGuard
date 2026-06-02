declare module "@nestjs/typeorm" {
  export function getRepositoryToken(entity: any): string;
  export class TypeOrmModule {
    static forFeature(entities: any[]): any;
  }
  export function InjectRepository(entity: any): ParameterDecorator;
}
