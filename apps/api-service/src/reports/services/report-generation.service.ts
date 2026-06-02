import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import * as csv from "fast-csv";

@Injectable()
export class ReportGenerationService {
  private readonly logger = new Logger(ReportGenerationService.name);

  /**
   * Generate CSV report from aggregated data
   */
  async generateCsvReport(data: any, filename: string): Promise<string> {
    try {
      // Create reports directory if it doesn't exist
      const reportsDir = path.join(process.cwd(), "reports");
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const filePath = path.join(reportsDir, filename);

      // Prepare CSV data
      const csvData = [];

      // Add header row
      csvData.push([
        "Merchant ID",
        "Merchant Name",
        "Chain ID",
        "Chain Name",
        "Total Gas Used",
        "Total Cost (USD)",
        "Transaction Count",
        "Success Rate (%)",
        "Start Date",
        "End Date",
      ]);

      // Add data rows
      if (data.chainBreakdown) {
        for (const chain of data.chainBreakdown) {
          csvData.push([
            data.merchantDetails.id,
            data.merchantDetails.name,
            chain.chainId,
            chain.chainName,
            chain.totalGas,
            chain.totalCostUsd,
            chain.transactionCount,
            chain.successRate.toFixed(2),
            data.startDate,
            data.endDate,
          ]);
        }
      }

      // Write CSV to file
      const ws = fs.createWriteStream(filePath);
      return new Promise((resolve, reject) => {
        csv
          .write(csvData, { headers: false })
          .pipe(ws)
          .on("finish", () => {
            this.logger.log(`CSV report generated: ${filePath}`);
            resolve(filePath);
          })
          .on("error", reject);
      });
    } catch (error) {
      this.logger.error("Failed to generate CSV report", error);
      throw error;
    }
  }

  /**
   * Generate HTML report from aggregated data
   */
  async generateHtmlReport(data: any, filename: string): Promise<string> {
    try {
      // Create reports directory if it doesn't exist
      const reportsDir = path.join(process.cwd(), "reports");
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const filePath = path.join(reportsDir, filename);

      // Generate HTML content
      const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gas Usage Report - ${data.merchantDetails.name}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        .summary { background-color: #e7f3ff; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .anomaly { background-color: #ffebee; padding: 10px; border-left: 4px solid #f44336; margin: 10px 0; }
    </style>
</head>
<body>
    <h1>Gas Usage Report</h1>
    <div class="summary">
        <h2>Merchant: ${data.merchantDetails.name}</h2>
        <p><strong>Reporting Period:</strong> ${data.startDate} to ${data.endDate}</p>
        <p><strong>Total Gas Consumed:</strong> ${data.totalGasConsumed.toLocaleString()}</p>
        <p><strong>Total Cost (USD):</strong> $${data.totalGasCostUsd.toFixed(2)}</p>
        <p><strong>Total Transactions:</strong> ${data.transactionCount}</p>
        <p><strong>Success Rate:</strong> ${data.successMetrics.successRate.toFixed(2)}%</p>
    </div>

    <h3>Chain Breakdown</h3>
    <table>
        <thead>
            <tr>
                <th>Chain ID</th>
                <th>Chain Name</th>
                <th>Total Gas</th>
                <th>Cost (USD)</th>
                <th>Transaction Count</th>
                <th>Success Rate (%)</th>
            </tr>
        </thead>
        <tbody>
            ${data.chainBreakdown
              .map(
                (chain: any) => `
            <tr>
                <td>${chain.chainId}</td>
                <td>${chain.chainName}</td>
                <td>${chain.totalGas.toLocaleString()}</td>
                <td>$${chain.totalCostUsd.toFixed(2)}</td>
                <td>${chain.transactionCount}</td>
                <td>${chain.successRate.toFixed(2)}%</td>
            </tr>
            `,
              )
              .join("")}
        </tbody>
    </table>

    ${
      data.anomalies && data.anomalies.length > 0
        ? `
    <h3>Anomalies Detected</h3>
    ${data.anomalies
      .map(
        (anomaly: any) => `
        <div class="anomaly">
            <strong>${anomaly.type}:</strong> ${anomaly.message}
        </div>
    `,
      )
      .join("")}
    `
        : ""
    }
</body>
</html>`;

      // Write HTML to file
      fs.writeFileSync(filePath, htmlContent);
      this.logger.log(`HTML report generated: ${filePath}`);
      return filePath;
    } catch (error) {
      this.logger.error("Failed to generate HTML report", error);
      throw error;
    }
  }

  /**
   * Generate simple text summary report
   */
  async generateTextReport(data: any, filename: string): Promise<string> {
    try {
      // Create reports directory if it doesn't exist
      const reportsDir = path.join(process.cwd(), "reports");
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const filePath = path.join(reportsDir, filename);

      // Generate text content
      let textContent = `GAS USAGE REPORT\n`;
      textContent += `===============\n\n`;
      textContent += `Merchant: ${data.merchantDetails.name}\n`;
      textContent += `Reporting Period: ${data.startDate} to ${data.endDate}\n`;
      textContent += `Total Gas Consumed: ${data.totalGasConsumed.toLocaleString()}\n`;
      textContent += `Total Cost (USD): $${data.totalGasCostUsd.toFixed(2)}\n`;
      textContent += `Total Transactions: ${data.transactionCount}\n`;
      textContent += `Success Rate: ${data.successMetrics.successRate.toFixed(2)}%\n\n`;

      textContent += `CHAIN BREAKDOWN\n`;
      textContent += `-------------\n`;
      for (const chain of data.chainBreakdown) {
        textContent += `${chain.chainName} (${chain.chainId}):\n`;
        textContent += `  Total Gas: ${chain.totalGas.toLocaleString()}\n`;
        textContent += `  Cost (USD): $${chain.totalCostUsd.toFixed(2)}\n`;
        textContent += `  Transaction Count: ${chain.transactionCount}\n`;
        textContent += `  Success Rate: ${chain.successRate.toFixed(2)}%\n\n`;
      }

      if (data.anomalies && data.anomalies.length > 0) {
        textContent += `DETECTED ANOMALIES\n`;
        textContent += `-----------------\n`;
        for (const anomaly of data.anomalies) {
          textContent += `- ${anomaly.type}: ${anomaly.message}\n`;
        }
      }

      // Write text to file
      fs.writeFileSync(filePath, textContent);
      this.logger.log(`Text report generated: ${filePath}`);
      return filePath;
    } catch (error) {
      this.logger.error("Failed to generate text report", error);
      throw error;
    }
  }
}
