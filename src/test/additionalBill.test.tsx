import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  additionalBillStorageKey,
  createAdditionalBill,
  occupiedBillUnits,
  parseAdditionalAmount,
  validateAdditionalBillRequest,
  type AdditionalBillRequest,
  type AdditionalBillResult,
} from '../additionalBill';
import { CreateAdditionalBillModal } from '../components/CreateAdditionalBillModal';
import { useRows } from '../data';
import { makeSession, residentData } from './fixtures';

vi.mock('../firebase', () => ({
  call: vi.fn(),
  firebase: vi.fn(() => {
    throw Error('No live Firebase in tests');
  }),
}));
vi.mock('../data', () => ({ useRows: vi.fn() }));

const buildings = [
  { id: 'tower-1', data: { communityId: 'community-1', buildingName: 'Tower A' } },
];
const units = [
  {
    id: 'unit-1',
    data: {
      communityId: 'community-1',
      buildingId: 'tower-1',
      status: 'occupied',
      residentUserId: 'resident-1',
      flatLabel: '1203',
    },
  },
];
const residents = [{ id: 'resident-1', data: residentData }];
const session = makeSession('admin');
session.community = {
  ...session.community!,
  data: { ...session.community!.data, timeZone: 'Asia/Manila' },
};
const success: AdditionalBillResult = {
  success: true,
  created: true,
  existing: false,
  billId: `additional_${'a'.repeat(64)}`,
};
const request = (overrides = {}): AdditionalBillRequest => ({
  communityId: 'community-1',
  flatId: 'unit-1',
  billingPeriod: '2026-11',
  dueDate: '2099-11-30',
  reason: 'Lift repair',
  idempotencyKey: 'additional_test_key',
  chargeLines: [{ lineId: 'line-1', code: 'other', label: 'Other', amountMinor: 10050 }],
  ...overrides,
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(useRows).mockImplementation((_s, module) => ({
    rows: module === 'buildings' ? buildings : module === 'units' ? units : residents,
    loading: false,
    error: '',
    refresh: vi.fn(),
  }));
});

function fillForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Tower A · 1203 · Test Resident' }));
  fireEvent.change(screen.getByLabelText('Billing month'), { target: { value: '2026-11' } });
  fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2099-11-30' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Lift repair' } });
  fireEvent.change(screen.getByLabelText('Amount (INR)'), { target: { value: '100.50' } });
}

describe('Additional Bill contract', () => {
  it.each([
    ['0', 0],
    ['0.01', 1],
    ['0.29', 29],
    ['100.50', 10050],
    ['100000000', 10000000000],
  ])('converts %s exactly to paise', (input, expected) => {
    expect(parseAdditionalAmount(input)).toBe(expected);
  });
  it.each(['', '-1', '1e2', '1.234', '1,000', '100000000.01', '90071992547409.92'])(
    'rejects invalid amount %s',
    (input) => {
      expect(parseAdditionalAmount(input)).toBeNull();
    },
  );
  it('validates total, labels, calendar date, request fields and stable line IDs', () => {
    expect(validateAdditionalBillRequest(request({ reason: ' Repair ' })).reason).toBe('Repair');
    expect(() => validateAdditionalBillRequest(request({ dueDate: '2026-02-30' }))).toThrow(
      'valid due date',
    );
    expect(() => validateAdditionalBillRequest(request({ residentId: 'spoofed' }))).toThrow(
      'fields',
    );
    expect(() =>
      validateAdditionalBillRequest(
        request({ chargeLines: [{ ...request().chargeLines[0], amountMinor: 0 }] }),
      ),
    ).toThrow('Total');
    expect(() =>
      validateAdditionalBillRequest(
        request({
          chargeLines: [
            { ...request().chargeLines[0], amountMinor: 10000000000 },
            { lineId: 'line-2', code: 'water', label: 'Water', amountMinor: 1 },
          ],
        }),
      ),
    ).toThrow('Total');
    expect(() =>
      validateAdditionalBillRequest(
        request({ chargeLines: [request().chargeLines[0], request().chargeLines[0]] }),
      ),
    ).toThrow('unique');
    expect(() =>
      validateAdditionalBillRequest(
        request({
          chargeLines: [
            request().chargeLines[0],
            { lineId: 'line-2', code: 'custom', label: 'Other', amountMinor: 1 },
          ],
        }),
      ),
    ).toThrow('distinct');
  });
  it('uses the existing callable with verified authority and validates success', async () => {
    const invokeCall = vi.fn().mockResolvedValue(success);
    const resolveAuthority = vi.fn().mockResolvedValue(session);
    expect(
      await createAdditionalBill(session, request(), { invokeCall, resolveAuthority }),
    ).toEqual(success);
    expect(invokeCall).toHaveBeenCalledWith('createAdditionalBill', request());
    invokeCall.mockResolvedValue({ ...success, created: false });
    await expect(
      createAdditionalBill(session, request(), { invokeCall, resolveAuthority }),
    ).rejects.toThrow('response');
    expect(resolveAuthority).toHaveBeenCalledTimes(2);
  });
  it('rejects cross-community and resident issuance before invoking Firebase', async () => {
    const invokeCall = vi.fn(),
      resolveAuthority = vi.fn();
    await expect(
      createAdditionalBill(session, request({ communityId: 'other' }), {
        invokeCall,
        resolveAuthority,
      }),
    ).rejects.toThrow('administrator');
    await expect(
      createAdditionalBill(makeSession(), request(), { invokeCall, resolveAuthority }),
    ).rejects.toThrow('administrator');
    expect(invokeCall).not.toHaveBeenCalled();
    expect(resolveAuthority).not.toHaveBeenCalled();
  });
  it('excludes vacant, conflicting, inactive and out-of-community assignments', () => {
    expect(occupiedBillUnits('community-1', units, residents, buildings)).toHaveLength(1);
    for (const patch of [
      { status: 'vacant' },
      { residentUid: 'different' },
      { residentIds: ['resident-1', 'resident-2'] },
      { communityId: 'community-2' },
    ]) {
      expect(
        occupiedBillUnits(
          'community-1',
          [{ ...units[0], data: { ...units[0].data, ...patch } }],
          residents,
          buildings,
        ),
      ).toEqual([]);
    }
    expect(
      occupiedBillUnits(
        'community-1',
        units,
        [{ ...residents[0], data: { ...residentData, isActive: false } }],
        buildings,
      ),
    ).toEqual([]);
  });

  // Contract references: data.ts preserves snapshot IDs; resident_identity.js
  // resolves flat pointers; billing_additional.js reads users/{uid} and checks eligibility.
  it.each([
    { residentUserId: 'resident-1' },
    { residentUid: 'resident-1' },
    { residentIds: ['resident-1'] },
    { residentUserId: 'resident-1', residentUid: 'resident-1', residentIds: ['resident-1'] },
    { residentUserId: ' resident-1 ', residentIds: [] },
  ])('accepts backend-supported occupant references %j', (pointers) => {
    const unitData = { ...units[0].data, residentUserId: undefined };
    const options = occupiedBillUnits(
      'community-1',
      [{ ...units[0], data: { ...unitData, ...pointers } }],
      residents,
      buildings,
    );
    expect(options).toEqual([
      { id: 'unit-1', label: '1203', buildingName: 'Tower A', residentName: 'Test Resident' },
    ]);
  });

  it.each([
    { residentId: 'resident-1' },
    { residentUserId: ' ' },
    { residentUserId: 123 },
    { residentUserId: 'resident-1', residentUid: 'someone-else' },
    { residentUserId: 'resident-1', residentIds: 'resident-1' },
    { residentUserId: 'resident-1', residentIds: ['resident-1', 'resident-1'] },
    { residentUserId: 'resident-1', residentIds: [null] },
    { residentUserId: 'resident-1', residentIds: ['someone-else'] },
  ])('rejects missing, malformed or ambiguous occupant references %j', (pointers) => {
    const unitData = { ...units[0].data, residentUserId: undefined, ...pointers };
    expect(
      occupiedBillUnits('community-1', [{ ...units[0], data: unitData }], residents, buildings),
    ).toEqual([]);
  });

  it('requires both the resident document ID and stored UID to match the occupant pointer', () => {
    expect(
      occupiedBillUnits(
        'community-1',
        units,
        [{ id: 'legacy-profile-id', data: { ...residentData } }],
        buildings,
      ),
    ).toEqual([]);
    expect(
      occupiedBillUnits(
        'community-1',
        units,
        [{ id: 'resident-1', data: { ...residentData, uid: 'someone-else' } }],
        buildings,
      ),
    ).toEqual([]);
    const withoutUid = { ...residentData, uid: undefined };
    expect(
      occupiedBillUnits('community-1', units, [{ id: 'resident-1', data: withoutUid }], buildings),
    ).toEqual([]);
  });

  it.each([
    { approvalStatus: undefined },
    { approvalStatus: 'pending' },
    { approvalStatus: 'rejected' },
    { isActive: undefined },
    { isActive: false },
    { status: 'inactive' },
    { role: 'admin' },
    { communityId: 'other' },
    { buildingId: 'other' },
    { flatId: 'other' },
  ])('rejects residents outside the callable eligibility contract %j', (patch) => {
    expect(
      occupiedBillUnits(
        'community-1',
        units,
        [{ ...residents[0], data: { ...residentData, ...patch } }],
        buildings,
      ),
    ).toEqual([]);
  });

  it.each([undefined, null, 'active'])(
    'accepts the backend-supported resident status %s',
    (status) => {
      expect(
        occupiedBillUnits(
          'community-1',
          units,
          [{ ...residents[0], data: { ...residentData, status } }],
          buildings,
        ),
      ).toHaveLength(1);
    },
  );

  it('requires occupied status and a building document in the selected community', () => {
    for (const status of [undefined, 'active', 'vacant', 'Occupied']) {
      expect(
        occupiedBillUnits(
          'community-1',
          [{ ...units[0], data: { ...units[0].data, status } }],
          residents,
          buildings,
        ),
      ).toEqual([]);
    }
    expect(occupiedBillUnits('community-1', units, residents, [])).toEqual([]);
    expect(
      occupiedBillUnits('community-1', units, residents, [
        { ...buildings[0], data: { ...buildings[0].data, communityId: 'other' } },
      ]),
    ).toEqual([]);
  });

  it.each(['__reserved__', '.', '..', 'bad/id', 'u'.repeat(129)])(
    'rejects identifiers the callable rejects: %s',
    (id) => {
      expect(
        occupiedBillUnits(
          'community-1',
          [{ ...units[0], id }],
          [{ ...residents[0], data: { ...residentData, flatId: id } }],
          buildings,
        ),
      ).toEqual([]);
      expect(
        occupiedBillUnits(
          'community-1',
          [{ ...units[0], data: { ...units[0].data, residentUserId: id } }],
          [{ id, data: { ...residentData, uid: id } }],
          buildings,
        ),
      ).toEqual([]);
      expect(
        occupiedBillUnits(
          'community-1',
          [{ ...units[0], data: { ...units[0].data, buildingId: id } }],
          [{ ...residents[0], data: { ...residentData, buildingId: id } }],
          [{ ...buildings[0], id }],
        ),
      ).toEqual([]);
    },
  );
});

describe('Additional Bill form', () => {
  it('searches units, collapses selection, displays resident and permits reselection', () => {
    render(<CreateAdditionalBillModal s={session} onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search occupied units'), {
      target: { value: 'absent' },
    });
    expect(screen.getByText('No matching eligible occupied units.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search occupied units'), {
      target: { value: 'Test Resident' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tower A · 1203 · Test Resident' }));
    expect(screen.queryByLabelText('Search occupied units')).toBeNull();
    expect(screen.getByText('Resident: Test Resident')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change unit' }));
    expect(screen.getByLabelText('Search occupied units')).toBeTruthy();
  });
  it('persists before submission and prevents double submit', async () => {
    let resolve!: (result: AdditionalBillResult) => void;
    const key = additionalBillStorageKey(session.uid, 'community-1');
    const submitBill = vi.fn((_s, payload) => {
      expect(JSON.parse(localStorage.getItem(key)!)).toEqual(payload);
      return new Promise<AdditionalBillResult>((done) => {
        resolve = done;
      });
    });
    const onCreated = vi.fn();
    render(
      <CreateAdditionalBillModal
        s={session}
        onClose={vi.fn()}
        onCreated={onCreated}
        submitBill={submitBill}
      />,
    );
    fillForm();
    expect(screen.getByText('Review total: ₹100.50')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create Additional Bill' }));
    fireEvent.submit(screen.getByRole('button', { name: 'Submitting…' }).closest('form')!);
    expect(submitBill).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    resolve(success);
    expect(await screen.findByText('Additional Bill created successfully.')).toBeTruthy();
    expect(localStorage.getItem(key)).toBeNull();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
  it('retains exact payload/key through timeout and close/reopen', async () => {
    const key = additionalBillStorageKey(session.uid, 'community-1');
    const submitBill = vi
      .fn()
      .mockRejectedValueOnce(Error('network timeout'))
      .mockResolvedValueOnce({ ...success, created: false, existing: true });
    const first = render(
      <CreateAdditionalBillModal
        s={session}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        submitBill={submitBill}
      />,
    );
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create Additional Bill' }));
    await screen.findByText('network timeout');
    const saved = JSON.parse(localStorage.getItem(key)!);
    first.unmount();
    render(
      <CreateAdditionalBillModal
        s={session}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        submitBill={submitBill}
      />,
    );
    expect(screen.queryByLabelText('Reason')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Saved Request' }));
    await screen.findByText(/already created/);
    expect(submitBill.mock.calls[0][1]).toEqual(saved);
    expect(submitBill.mock.calls[1][1]).toEqual(saved);
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('blocks issuance when storage is unavailable or saved data is corrupt', async () => {
    const submitBill = vi.fn();
    const view = render(
      <CreateAdditionalBillModal
        s={session}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        submitBill={submitBill}
      />,
    );
    fillForm();
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('Storage full');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Additional Bill' }));
    await screen.findByText('Storage full');
    expect(submitBill).not.toHaveBeenCalled();
    view.unmount();
    storageSpy.mockRestore();
    localStorage.setItem(additionalBillStorageKey(session.uid, 'community-1'), '{bad');
    render(
      <CreateAdditionalBillModal
        s={session}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        submitBill={submitBill}
      />,
    );
    expect(screen.getByText(/could not be read/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Additional Bill' })).toBeDisabled();
  });
  it('keeps uncertain requests saved even when a later retry is explicitly rejected', async () => {
    const key = additionalBillStorageKey(session.uid, 'community-1');
    localStorage.setItem(key, JSON.stringify(request()));
    const submitBill = vi
      .fn()
      .mockRejectedValueOnce(Error('Response could not be validated'))
      .mockRejectedValueOnce(
        Object.assign(Error('Unit no longer occupied'), { code: 'functions/failed-precondition' }),
      );
    render(
      <CreateAdditionalBillModal
        s={session}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        submitBill={submitBill}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry Saved Request' }));
    await screen.findByText('Response could not be validated');
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(request());
    fireEvent.click(screen.getByRole('button', { name: 'Retry Saved Request' }));
    await screen.findByText('Unit no longer occupied');
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(request());
    expect(screen.queryByLabelText('Reason')).toBeNull();
  });
  it('allows correction after a fresh request is explicitly rejected', async () => {
    const submitBill = vi
      .fn()
      .mockRejectedValue(
        Object.assign(Error('Unit no longer occupied'), { code: 'functions/failed-precondition' }),
      );
    render(
      <CreateAdditionalBillModal
        s={session}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        submitBill={submitBill}
      />,
    );
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create Additional Bill' }));
    await screen.findByText('Unit no longer occupied');
    expect(localStorage.getItem(additionalBillStorageKey(session.uid, 'community-1'))).toBeNull();
    expect(screen.getByLabelText('Reason')).toBeTruthy();
  });
  it('blocks invalid decimals and zero total without a callable', async () => {
    const submitBill = vi.fn();
    render(
      <CreateAdditionalBillModal
        s={session}
        onClose={vi.fn()}
        onCreated={vi.fn()}
        submitBill={submitBill}
      />,
    );
    fillForm();
    fireEvent.change(screen.getByLabelText('Amount (INR)'), { target: { value: '1.234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Additional Bill' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('valid amounts'));
    fireEvent.change(screen.getByLabelText('Amount (INR)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Additional Bill' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Total'));
    expect(submitBill).not.toHaveBeenCalled();
  });
  it('scopes unresolved attempts by administrator and community', () => {
    expect(additionalBillStorageKey('a', 'one')).not.toBe(additionalBillStorageKey('a', 'two'));
    expect(additionalBillStorageKey('a', 'one')).not.toBe(additionalBillStorageKey('b', 'one'));
  });
});
