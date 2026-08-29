import { runScan } from "../packages/cli/src/commands/scan";

async function main() {
  const file = process.argv[2];

  if (!file) {
    console.error("Missing file path for pre-commit scan.");
    process.exit(1);
  }

  await runScan(file, {
    format: "text",
    summary: false,
    confidence: "0.7",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
