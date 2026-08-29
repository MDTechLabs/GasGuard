import { NotificationPayload } from "./types";

export class DiscordProvider {
  constructor(private webhookUrl: string) {}

  async send(payload: NotificationPayload) {
    const { scan } = payload;

    const color =
      scan.severity === "critical"
        ? 16711680
        : scan.severity === "warning"
          ? 16753920
          : 3447003;

    const message = {
      embeds: [
        {
          title: `📡 Scan Alert: ${scan.title}`,
          description: scan.message,
          color,
          timestamp: new Date(scan.timestamp).toISOString(),
          footer: {
            text: "GasGuard Scanner",
          },
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
