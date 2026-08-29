import { SlackProvider } from "./slack.provider";
import { DiscordProvider } from "./discord.provider";
import { NotificationPayload, ScanResult } from "./types";

export class NotifierService {
  private slack?: SlackProvider;
  private discord?: DiscordProvider;

  constructor() {
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    const discordUrl = process.env.DISCORD_WEBHOOK_URL;

    if (slackUrl) this.slack = new SlackProvider(slackUrl);
    if (discordUrl) this.discord = new DiscordProvider(discordUrl);
  }

  async notify(scan: ScanResult, source?: string) {
    const payload: NotificationPayload = {
      scan,
      source,
    };

    const tasks: Promise<any>[] = [];

    if (this.slack) {
      tasks.push(this.slack.send(payload));
    }

    if (this.discord) {
      tasks.push(this.discord.send(payload));
    }

    await Promise.allSettled(tasks);
  }
}
