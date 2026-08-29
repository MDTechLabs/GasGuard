import { RpcClient } from '@rpc/index';

export interface StellarEvent {
  id: string;
  type: 'contract_call' | 'event_emit' | 'ledger_close' | 'transaction';
  contractId?: string;
  transactionId?: string;
  ledgerSequence?: number;
  timestamp: number;
  data: Record<string, any>;
  topics?: string[];
}

export interface EventStreamOptions {
  contractId?: string;
  topic?: string;
  startLedger?: number;
  endLedger?: number;
  pollIntervalMs?: number;
}

export interface Subscription {
  id: string;
  unsubscribe: () => void;
}

export class StellarEventStream {
  private subscriptions: Map<string, NodeJS.Timeout> = new Map();
  private eventCallbacks: Map<string, (event: StellarEvent) => void> = new Map();

  constructor(private rpcClient: RpcClient) {}

  subscribe(
    options: EventStreamOptions,
    callback: (event: StellarEvent) => void
  ): Subscription {
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    this.eventCallbacks.set(subscriptionId, callback);

    this.startPolling(subscriptionId, options);

    return {
      id: subscriptionId,
      unsubscribe: () => this.unsubscribe(subscriptionId),
    };
  }

  private startPolling(subscriptionId: string, options: EventStreamOptions): void {
    const pollInterval = options.pollIntervalMs || 5000;
    let currentLedger = options.startLedger || 0;

    const poll = async () => {
      const callback = this.eventCallbacks.get(subscriptionId);
      if (!callback) {
        this.subscriptions.delete(subscriptionId);
        return;
      }

      try {
        const events = await this.fetchEvents({
          ...options,
          startLedger: currentLedger,
        });

        for (const event of events) {
          callback(event);
          if (event.ledgerSequence) {
            currentLedger = Math.max(currentLedger, event.ledgerSequence + 1);
          }
        }
      } catch (error) {
        console.error(`[EventStream] Error fetching events:`, error);
      }
    };

    poll();
    const timer = setInterval(poll, pollInterval);
    this.subscriptions.set(subscriptionId, timer);
  }

  private async fetchEvents(options: EventStreamOptions): Promise<StellarEvent[]> {
    try {
      const response = await this.rpcClient.call('getEvents', [
        {
          startLedger: options.startLedger,
          filters: options.contractId
            ? [{ contractId: options.contractId }]
            : undefined,
          topics: options.topic ? [[options.topic]] : undefined,
        },
      ]);

      return response.events?.map(this.normalizeEvent.bind(this)) || [];
    } catch (error) {
      throw error;
    }
  }

  private normalizeEvent(rawEvent: any): StellarEvent {
    return {
      id: rawEvent.id || `event_${Date.now()}`,
      type: this.determineEventType(rawEvent),
      contractId: rawEvent.contractId,
      transactionId: rawEvent.transactionId,
      ledgerSequence: rawEvent.ledgerSequence,
      timestamp: rawEvent.timestamp || Date.now(),
      data: rawEvent.value || rawEvent.data || {},
      topics: rawEvent.topic || rawEvent.topics || [],
    };
  }

  private determineEventType(rawEvent: any): StellarEvent['type'] {
    if (rawEvent.type === 'InvokeContract') return 'contract_call';
    if (rawEvent.type === 'ContractEvent') return 'event_emit';
    if (rawEvent.topic) return 'event_emit';
    if (rawEvent.ledgerSequence) return 'ledger_close';
    return 'transaction';
  }

  private unsubscribe(subscriptionId: string): void {
    const timer = this.subscriptions.get(subscriptionId);
    if (timer) {
      clearInterval(timer);
      this.subscriptions.delete(subscriptionId);
    }
    this.eventCallbacks.delete(subscriptionId);
  }

  dispose(): void {
    for (const subscriptionId of this.subscriptions.keys()) {
      this.unsubscribe(subscriptionId);
    }
  }
}