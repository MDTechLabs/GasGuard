import { NotificationPayload } from "./types";

export class SlackProvider {
  constructor(private webhookUrl: string) {}

  async send(payload: NotificationPayload) {
    const { scan } = payload;

    const color =
      scan.severity === "critical"
        ? "#ff0000"
        : scan.severity === "warning"
          ? "#ffa500"
          : "#36a64f";

    const message = {
      attachments: [
        {
          color,
          title: `📡 Scan Alert: ${scan.title}`,
          text: scan.message,
          footer: "GasGuard Scanner",
          ts: Math.floor(scan.timestamp / 1000),
        },
      ],
    };

    await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  }
}
