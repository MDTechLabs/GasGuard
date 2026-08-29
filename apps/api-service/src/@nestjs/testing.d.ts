declare module "@nestjs/testing" {
  export class Test {
    static createTestingModule(metadata: any): {
      compile(): Promise<TestingModule>;
    };
  }

  export interface TestingModule {
    get<T>(type: any): T;
  }
}
