declare global {
  namespace jest {
    interface Matchers<R> {
      toBeCloseTo(expected: number, precision?: number): R;
      toBeLessThan(expected: number): R;
      toBeLessThanOrEqual(expected: number): R;
      toBeGreaterThan(expected: number): R;
      toBeGreaterThanOrEqual(expected: number): R;
      toBe(expected: any): R;
      toEqual(expected: any): R;
      toHaveProperty(propertyName: string, value?: any): R;
      toHaveBeenCalled(): R;
      toHaveBeenCalledWith(...args: any[]): R;
      toHaveBeenCalledOnce(): R;
      toBeNull(): R;
      toBeDefined(): R;
      toContain(expected: any): R;
      toThrow(expected?: string | Error): R;
      toBeInstanceOf(expected: any): R;
      toBeTruthy(): R;
      toBeFalsy(): R;
      rejects: Matchers<void>;
      not: Matchers<void>;
    }
    interface Mock<T = any, U extends any[] = any[]> {
      (...args: U): T;
      mockResolvedValue(value: any): this;
      mockRejectedValue(value: any): this;
    }
    interface SpyInstance<T = any, U extends any[] = any[]> extends Mock<
      T,
      U
    > {}
  }

  function describe(name: string, fn: () => void): void;
  function it(name: string, fn: () => void | Promise<void>): void;
  function beforeEach(fn: () => void | Promise<void>): void;
  function afterEach(fn: () => void | Promise<void>): void;
  function before(fn: () => void | Promise<void>): void;
  function after(fn: () => void | Promise<void>): void;

  function expect<T = any>(actual: T): jest.Matchers<void>;

  const jest: {
    fn<T extends (...args: any[]) => any>(
      implementation?: T,
    ): jest.Mock<ReturnType<T>, Parameters<T>>;
    spyOn<T, P extends PropertyKey>(
      object: T,
      method: P,
      accessType?: "get" | "set",
    ): jest.SpyInstance<any, any>;
    useFakeTimers(): void;
    useRealTimers(): void;
  };
}

export {};
