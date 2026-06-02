export type ScanSeverity = "info" | "warning" | "critical";

export type ScanResult = {
  id: string;
  title: string;
  message: string;
  severity: ScanSeverity;
  timestamp: number;
};

export type NotificationPayload = {
  scan: ScanResult;
  source?: string;
};
