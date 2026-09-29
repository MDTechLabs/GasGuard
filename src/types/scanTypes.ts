export interface ScanResult {
  id: string;
  status: 'success' | 'partial' | 'failed';
  data: any;
  timestamp: Date;
}

export interface ScanFailure {
  id: string;
  error: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}