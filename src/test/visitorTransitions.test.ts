import { describe, expect, it } from 'vitest';
import { adminVisitorApprovalPatch, adminVisitorRejectionPatch } from '../visitorTransitions';

describe('Admin visitor request transitions', () => {
  it('approves a request with the canonical approval fields and no gate check-in fields', () => {
    const approvedAt = new Date('2026-10-10T10:00:00.000Z');
    const patch = adminVisitorApprovalPatch('admin-1', approvedAt);

    expect(patch).toEqual({
      status: 'approved',
      isApproved: true,
      approvedBy: 'admin-1',
      approvedAt,
    });
    expect(patch).not.toHaveProperty('actualArrival');
    expect(patch).not.toHaveProperty('checkedInBy');
    expect(patch.status).not.toBe('inside');
  });

  it('keeps the canonical rejection transition', () => {
    const rejectedAt = new Date('2026-10-10T10:00:00.000Z');
    expect(adminVisitorRejectionPatch('admin-1', rejectedAt)).toEqual({
      status: 'rejected',
      isApproved: false,
      rejectedBy: 'admin-1',
      rejectedAt,
    });
  });
});
