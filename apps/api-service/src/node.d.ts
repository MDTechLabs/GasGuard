declare module "node" {
  export interface Global {
    [key: string]: any;
  }
}

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: "development" | "production" | "test";
    [key: string]: string | undefined;
  }
  interface Process {
    env: ProcessEnv;
  }
}

declare const process: NodeJS.Process;
declare const global: NodeJS.Global;
