import { Injectable, Logger, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { createTransport, Transporter } from "nodemailer";
import { SentMessageInfo } from "nodemailer";

@Injectable()
export class EmailNotificationService {
  private readonly logger = new Logger(EmailNotificationService.name);
  private transporter: Transporter;

  constructor(private configService: ConfigService) {
    // Initialize nodemailer transporter with SMTP configuration
    const smtpHost = this.configService.get<string>("SMTP_HOST");
    const smtpPort = parseInt(
      this.configService.get<string>("SMTP_PORT") || "587",
    );
    const smtpUser = this.configService.get<string>("SMTP_USER");
    const smtpPassword = this.configService.get<string>("SMTP_PASSWORD");
    const smtpSecure = this.configService.get<boolean>("SMTP_SECURE") || false;

    if (!smtpHost || !smtpUser || !smtpPassword) {
      this.logger.warn(
        "Email service not configured. Missing SMTP configuration.",
      );
      return;
    }

    this.transporter = createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
    });
  }

  /**
   * Send gas report email to merchant
   */
  async sendGasReportEmail(
    recipientEmail: string,
    merchantName: string,
    reportType: "weekly" | "monthly" | "adhoc",
    reportFilePath?: string,
    reportData?: any,
  ): Promise<boolean> {
    if (!this.transporter) {
      this.logger.error(
        "Email transporter not initialized. Check SMTP configuration.",
      );
      return false;
    }

    try {
      // Define email subject based on report type
      const reportLabel =
        reportType.charAt(0).toUpperCase() + reportType.slice(1);
      const subject = `GasGuard ${reportLabel} Gas Usage Report for ${merchantName}`;

      // Generate email content
      const htmlContent = this.generateEmailContent(
        merchantName,
        reportType,
        reportData,
      );

      // Prepare mail options
      const mailOptions = {
        from:
          this.configService.get<string>("SMTP_FROM_EMAIL") ||
          "noreply@gasguard.com",
        to: recipientEmail,
        subject: subject,
        html: htmlContent,
        attachments: reportFilePath
          ? [
              {
                filename: `gas-report-${reportType}-${new Date().toISOString().split("T")[0]}.csv`,
                path: reportFilePath,
              },
            ]
          : [],
      };

      // Send email
      const info: SentMessageInfo =
        await this.transporter.sendMail(mailOptions);
      this.logger.log(
        `Gas report email sent successfully to ${recipientEmail}. Message ID: ${info.messageId}`,
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send gas report email to ${recipientEmail}`,
        error,
      );
      return false;
    }
  }

  /**
   * Generate HTML content for the email
   */
  private generateEmailContent(
    merchantName: string,
    reportType: string,
    reportData?: any,
  ): string {
    const reportLabel =
      reportType.charAt(0).toUpperCase() + reportType.slice(1);

    let content = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">GasGuard ${reportLabel} Gas Usage Report</h2>
        <p>Hello <strong>${merchantName}</strong>,</p>
        <p>Your ${reportType} gas usage report is ready. Here's a summary of your gas consumption:</p>
    `;

    if (reportData) {
      content += `
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;">
          <h3>Report Summary</h3>
          <ul>
            <li><strong>Total Gas Consumed:</strong> ${reportData.totalGasConsumed?.toLocaleString() || "N/A"}</li>
            <li><strong>Total Cost (USD):</strong> $${reportData.totalGasCostUsd?.toFixed(2) || "N/A"}</li>
            <li><strong>Transaction Count:</strong> ${reportData.transactionCount || "N/A"}</li>
            <li><strong>Success Rate:</strong> ${reportData.successMetrics?.successRate?.toFixed(2) || "N/A"}%</li>
          </ul>
        </div>
      `;
    }

    content += `
        <p>Please find the attached detailed report for your records.</p>
        <p>Best regards,<br>The GasGuard Team</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
        <small>This is an automated message from GasGuard. Please do not reply to this email.</small>
      </div>
    `;

    return content;
  }

  /**
   * Send notification about report generation failure
   */
  async sendFailureNotification(
    recipientEmail: string,
    merchantName: string,
    error: string,
  ): Promise<boolean> {
    if (!this.transporter) {
      this.logger.error(
        "Email transporter not initialized. Check SMTP configuration.",
      );
      return false;
    }

    try {
      const subject = `GasGuard Report Generation Failed for ${merchantName}`;
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #d32f2f;">Gas Report Generation Failed</h2>
          <p>Hello <strong>${merchantName}</strong>,</p>
          <p>We encountered an issue while generating your gas usage report:</p>
          <div style="background-color: #ffebee; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <strong>Error:</strong> ${error}
          </div>
          <p>Please contact our support team if the issue persists.</p>
          <p>Best regards,<br>The GasGuard Team</p>
        </div>
      `;

      const mailOptions = {
        from:
          this.configService.get<string>("SMTP_FROM_EMAIL") ||
          "noreply@gasguard.com",
        to: recipientEmail,
        subject: subject,
        html: htmlContent,
      };

      const info: SentMessageInfo =
        await this.transporter.sendMail(mailOptions);
      this.logger.log(
        `Failure notification email sent to ${recipientEmail}. Message ID: ${info.messageId}`,
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send failure notification email to ${recipientEmail}`,
        error,
      );
      return false;
    }
  }

  /**
   * Test email connectivity
   */
  async testConnection(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      this.logger.log("Email transporter verified successfully");
      return true;
    } catch (error) {
      this.logger.error("Email transporter verification failed", error);
      return false;
    }
  }
}
