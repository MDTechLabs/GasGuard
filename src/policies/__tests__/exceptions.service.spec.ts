import { PolicyExceptionService } from '../exceptions.service';

describe('Policy Exceptions Service (#1062)', () => {
  it('creates a pending exception request', () => {
    const exception = PolicyExceptionService.requestException(
      'POL_GAS_LIMIT_MAX',
      'G_TEST_USER_123',
      'High compute deployment requirement'
    );

    expect(exception.status).toBe('PENDING');
    expect(exception.policyId).toBe('POL_GAS_LIMIT_MAX');
    expect(exception.id).toBeDefined();
  });

  it('approves an exception and verifies active status', () => {
    const exception = PolicyExceptionService.requestException(
      'POL_GAS_LIMIT_MAX',
      'G_TEST_USER_456',
      'Emergency migration'
    );

    const reviewed = PolicyExceptionService.reviewException(
      exception.id,
      'G_ADMIN_789',
      'APPROVED'
    );

    expect(reviewed.status).toBe('APPROVED');
    expect(reviewed.approvedBy).toBe('G_ADMIN_789');

    const isActive = PolicyExceptionService.hasActiveException('POL_GAS_LIMIT_MAX', 'G_TEST_USER_456');
    expect(isActive).toBe(true);
  });

  it('rejects expired exceptions', () => {
    // Request with 0ms TTL (already expired)
    const exception = PolicyExceptionService.requestException(
      'POL_TIMEOUT_CHECK',
      'G_TEST_USER_999',
      'Test expiry',
      -1000
    );

    PolicyExceptionService.reviewException(exception.id, 'G_ADMIN_789', 'APPROVED');

    const isActive = PolicyExceptionService.hasActiveException('POL_TIMEOUT_CHECK', 'G_TEST_USER_999');
    expect(isActive).toBe(false);
  });
});