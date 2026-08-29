import { StellarEventStream, StellarEvent, EventStreamOptions } from './event-stream';
import { RpcClient } from '@rpc/index';

describe('StellarEventStream', () => {
  let eventStream: StellarEventStream;
  let mockRpcClient: jest.Mocked<RpcClient>;

  beforeEach(() => {
    mockRpcClient = {
      call: jest.fn(),
    } as any;

    eventStream = new StellarEventStream(mockRpcClient as RpcClient);
  });

  afterEach(() => {
    eventStream.dispose();
  });

  describe('subscribe', () => {
    it('should subscribe to events and return a subscription', async () => {
      mockRpcClient.call.mockResolvedValue({ events: [] });

      const subscription = eventStream.subscribe(
        { contractId: 'test_contract' },
        jest.fn()
      );

      expect(subscription.id).toBeDefined();
      expect(subscription.unsubscribe).toBeInstanceOf(Function);
    });

    it('should call callback with normalized events', async () => {
      const mockEvent = {
        type: 'ContractEvent',
        contractId: 'test_contract',
        topic: ['topic1'],
        value: { data: 'test' },
        ledgerSequence: 100,
      };

      mockRpcClient.call.mockResolvedValue({ events: [mockEvent] });

      const callback = jest.fn();
      const subscription = eventStream.subscribe({}, callback);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRpcClient.call).toHaveBeenCalledWith('getEvents', expect.any(Object));
      subscription.unsubscribe();
    });

    it('should support filtering by contractId', async () => {
      mockRpcClient.call.mockResolvedValue({ events: [] });

      eventStream.subscribe({ contractId: 'specific_contract' }, jest.fn());

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRpcClient.call).toHaveBeenCalledWith(
        'getEvents',
        expect.objectContaining({
          filters: [{ contractId: 'specific_contract' }],
        })
      );

      eventStream.dispose();
    });

    it('should support filtering by topic', async () => {
      mockRpcClient.call.mockResolvedValue({ events: [] });

      eventStream.subscribe({ topic: 'transfer' }, jest.fn());

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRpcClient.call).toHaveBeenCalledWith(
        'getEvents',
        expect.objectContaining({
          topics: [['transfer']],
        })
      );

      eventStream.dispose();
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscription when unsubscribed', () => {
      mockRpcClient.call.mockResolvedValue({ events: [] });

      const subscription = eventStream.subscribe({}, jest.fn());
      subscription.unsubscribe();

      eventStream.dispose();

      expect(subscription.id).toBeDefined();
    });
  });

  describe('dispose', () => {
    it('should clear all subscriptions', () => {
      mockRpcClient.call.mockResolvedValue({ events: [] });

      eventStream.subscribe({ contractId: 'contract1' }, jest.fn());
      eventStream.subscribe({ contractId: 'contract2' }, jest.fn());

      eventStream.dispose();
    });
  });
});