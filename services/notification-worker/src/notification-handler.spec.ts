import { handleOrderPaid } from './notification-handler';
import { OrderPaidJobData } from './queue';

const data: OrderPaidJobData = {
  orderId: '3f1c2a4b-5d6e-4f70-8a91-b2c3d4e5f607',
  userId: '11111111-2222-4333-8444-555555555555',
  totalAmount: 30000,
  currency: 'KRW',
  paidAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
};

describe('handleOrderPaid', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs a processed record containing the order id', () => {
    const line = handleOrderPaid(data, { forceFail: false, jobId: 'order-paid-x', attempt: 1 });
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.event).toBe('order_notification_processed');
    expect(parsed.orderId).toBe(data.orderId);
    expect(parsed.userId).toBe(data.userId);
    expect(parsed.totalAmount).toBe(30000);
    expect(parsed.currency).toBe('KRW');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain(data.orderId);
  });

  it('throws when forceFail is true and does not log success', () => {
    expect(() => handleOrderPaid(data, { forceFail: true })).toThrow(
      'Forced notification failure',
    );
    const successLogged = logSpy.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes('order_notification_processed'),
    );
    expect(successLogged).toBe(false);
  });
});
