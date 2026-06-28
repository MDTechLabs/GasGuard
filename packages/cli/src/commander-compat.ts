import { Command } from "commander";

declare module "commander" {
  interface Command {
    addCommand(command: Command): this;
  }
}

if (typeof (Command.prototype as any).addCommand !== "function") {
  (Command.prototype as any).addCommand = function (command: Command) {
    this.commands = this.commands || [];
    this.commands.push(command);
    return this;
  };
}

export {};
