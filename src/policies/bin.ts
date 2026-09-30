import { runPolicyValidateCli } from "./cli";

export function main(argv: string[] = process.argv.slice(2)): void {
  const code = runPolicyValidateCli(argv);
  process.exit(code);
}

if (require.main === module) {
  main();
}
