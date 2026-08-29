declare module "typeorm" {
  export class Repository<T> {
    create(plainObject?: any): T;
    save(entity: any): Promise<any>;
    find(options?: any): Promise<T[]>;
    findOne(options?: any): Promise<T | null>;
    delete(criteria: any): Promise<DeleteResult>;
    createQueryBuilder(alias?: string): QueryBuilder<T>;
    count(options?: any): Promise<number>;
  }

  export class QueryBuilder<T> {
    where(condition: string, parameters?: any): this;
    andWhere(condition: string, parameters?: any): this;
    orWhere(condition: string, parameters?: any): this;
    orderBy(sort: string, order?: "ASC" | "DESC"): this;
    take(limit: number): this;
    skip(offset: number): this;
    groupBy(groupBy: string): this;
    addGroupBy(column: string): this;
    select(columns: string | string[], ...selection: string[]): this;
    addSelect(column: string, ...selection: string[]): this;
    innerJoin(
      table: string,
      alias: string,
      condition?: string,
      parameters?: any,
    ): this;
    leftJoin(
      table: string,
      alias: string,
      condition?: string,
      parameters?: this,
    ): this;
    limit(limit: number): this;
    offset(offset: number): this;
    getQuery(): string;
    getRawMany(): Promise<any[]>;
    getRawOne(): Promise<any>;
    getMany(): Promise<T[]>;
    getOne(): Promise<T | null>;
    delete(): DeleteQueryBuilder<T>;
  }

  export class DeleteQueryBuilder<T> {
    where(condition: string, parameters?: any): this;
    andWhere(condition: string, parameters?: any): this;
    execute(): Promise<DeleteResult>;
  }

  export class TypeOrmModule {
    static forRoot(options?: any): any;
    static forRootAsync(options?: any): any;
    static forFeature(entities: any[]): any;
  }

  export function Entity(name?: string): ClassDecorator;
  export function PrimaryGeneratedColumn(
    type?: "uuid" | "increment",
  ): PropertyDecorator;
  export function Column(options?: any): PropertyDecorator;
  export function CreateDateColumn(options?: any): PropertyDecorator;
  export function Index(
    columns?: string | string[],
    options?: any,
  ): ClassDecorator & PropertyDecorator;
  export function PrimaryColumn(options?: any): PropertyDecorator;
  export function EntityRepository(name?: string): ClassDecorator;
  export function EntityRepository(
    entityClass?: new (...args: any[]) => any,
  ): ClassDecorator;

  export interface DeleteResult {
    raw: any;
    affected?: number;
  }

  export class DataSource {
    getRepository<T>(target: any): Repository<T>;
  }
}
