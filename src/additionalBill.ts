import { currentAuthority, parseRecurringAmountInrToMinorUnits } from './actions';
import { call } from './firebase';
import { str, type Row, type Session } from './models';

export const additionalChargeLabels = {
  maintenance: 'Maintenance',
  water: 'Water',
  parking: 'Parking',
  service: 'Service',
  electricity: 'Electricity',
  security: 'Security',
  other: 'Other',
} as const;
export type AdditionalChargeCode = keyof typeof additionalChargeLabels | 'custom';
export interface AdditionalBillRequest {
  communityId: string;
  flatId: string;
  billingPeriod: string;
  dueDate: string;
  reason: string;
  idempotencyKey: string;
  chargeLines: { lineId: string; code: AdditionalChargeCode; label: string; amountMinor: number }[];
}
export interface AdditionalBillResult {
  success: true;
  created: boolean;
  existing: boolean;
  billId: string;
}
const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value === value.trim() &&
  new TextEncoder().encode(value).length <= 128 &&
  !value.includes('/') &&
  !['.', '..'].includes(value) &&
  !/^__.*__$/.test(value);

export function parseAdditionalAmount(value: string): number | null {
  // The shared parser uses BigInt, so no floating point rounding enters the payload.
  if (/^0+(?:\.0{1,2})?$/.test(value.trim())) return 0;
  const amount = parseRecurringAmountInrToMinorUnits(value);
  return amount !== null && amount <= 10000000000 ? amount : null;
}

export function validateAdditionalBillRequest(input: unknown): AdditionalBillRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Invalid additional bill request.');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'communityId',
          'flatId',
          'billingPeriod',
          'dueDate',
          'reason',
          'idempotencyKey',
          'chargeLines',
        ].includes(key),
    )
  )
    throw Error('Invalid additional bill request fields.');
  if (
    !validId(value.communityId) ||
    !validId(value.flatId) ||
    typeof value.idempotencyKey !== 'string' ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(value.idempotencyKey)
  )
    throw Error('Invalid bill scope or request identifier.');
  if (
    typeof value.billingPeriod !== 'string' ||
    !/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value.billingPeriod)
  )
    throw Error('Select a valid billing month.');
  if (
    typeof value.dueDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate) ||
    !Number.isFinite(Date.parse(value.dueDate)) ||
    new Date(value.dueDate).toISOString().slice(0, 10) !== value.dueDate
  )
    throw Error('Enter a valid due date.');
  if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.trim().length > 500)
    throw Error('Enter a reason of 1–500 characters.');
  if (
    !Array.isArray(value.chargeLines) ||
    !value.chargeLines.length ||
    value.chargeLines.length > 20
  )
    throw Error('Provide 1 to 20 charge lines.');
  const ids = new Set<string>(),
    labels = new Set<string>();
  let total = 0n;
  const chargeLines = value.chargeLines
    .map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw Error('Invalid charge line.');
      const line = raw as Record<string, unknown>;
      if (
        Object.keys(line).some(
          (key) => !['lineId', 'code', 'label', 'amountMinor'].includes(key),
        ) ||
        !validId(line.lineId) ||
        ids.has(line.lineId)
      )
        throw Error('Each charge needs a unique stable line ID.');
      ids.add(line.lineId);
      const code = line.code;
      if (
        typeof code !== 'string' ||
        (code !== 'custom' && !Object.hasOwn(additionalChargeLabels, code))
      )
        throw Error('Select a valid charge type.');
      const standard = additionalChargeLabels[code as keyof typeof additionalChargeLabels];
      const label = code === 'custom' ? str(line.label).replace(/\s+/g, ' ').trim() : standard;
      if (
        !label ||
        label.length > 80 ||
        (code === 'custom' &&
          Object.values(additionalChargeLabels).some(
            (name) => name.toLowerCase() === label.toLowerCase(),
          ))
      )
        throw Error(
          'Enter a custom charge label of 1–80 characters, distinct from standard charges.',
        );
      if (
        code !== 'custom' &&
        line.label != null &&
        str(line.label).trim().toLowerCase() !== label.toLowerCase()
      )
        throw Error('Standard charge label must match its type.');
      if (labels.has(label.toLowerCase())) throw Error('Duplicate charge labels are not allowed.');
      labels.add(label.toLowerCase());
      if (
        typeof line.amountMinor !== 'number' ||
        !Number.isSafeInteger(line.amountMinor) ||
        line.amountMinor < 0
      )
        throw Error('Enter valid amounts with at most two decimal places.');
      total += BigInt(line.amountMinor);
      return {
        lineId: line.lineId,
        code: code as AdditionalChargeCode,
        label,
        amountMinor: line.amountMinor,
      };
    })
    .sort((a, b) => a.lineId.localeCompare(b.lineId));
  if (total <= 0n || total > 10000000000n)
    throw Error('Total must be greater than zero and at most ₹10,00,00,000.');
  return {
    communityId: value.communityId,
    flatId: value.flatId,
    billingPeriod: value.billingPeriod,
    dueDate: value.dueDate,
    reason: value.reason.trim(),
    idempotencyKey: value.idempotencyKey,
    chargeLines,
  };
}

export function occupiedBillUnits(
  communityId: string,
  units: Row[],
  residents: Row[],
  buildings: Row[],
) {
  return units
    .flatMap((unit) => {
      const data = unit.data;
      // Match createAdditionalBillCore and resolveFlatOccupant, rather than inferring
      // occupancy from a resident profile or the legacy flat.residentId alias.
      if (
        data.communityId !== communityId ||
        data.status !== 'occupied' ||
        !validId(unit.id) ||
        !validId(data.buildingId)
      )
        return [];
      const pointers: string[] = [];
      for (const field of ['residentUserId', 'residentUid']) {
        if (data[field] == null || data[field] === '') continue;
        if (!str(data[field]).trim()) return [];
        pointers.push(str(data[field]).trim());
      }
      if (data.residentIds != null) {
        if (!Array.isArray(data.residentIds) || data.residentIds.length > 1) return [];
        if (data.residentIds.length) {
          if (!str(data.residentIds[0]).trim()) return [];
          pointers.push(str(data.residentIds[0]).trim());
        }
      }
      if (!pointers.length || new Set(pointers).size !== 1) return [];
      if (!validId(pointers[0])) return [];
      // useRows retains the document ID. The callable reads users/{occupantUid}
      // and separately verifies its uid field; neither identity can substitute for the other.
      const resident = residents.find((row) => row.id === pointers[0])?.data;
      const building = buildings.find(
        (row) => row.id === data.buildingId && row.data.communityId === communityId,
      );
      if (
        !building ||
        !resident ||
        resident.uid !== pointers[0] ||
        resident.role !== 'resident' ||
        resident.communityId !== communityId ||
        resident.flatId !== unit.id ||
        resident.buildingId !== building.id ||
        resident.isActive !== true ||
        resident.approvalStatus !== 'approved' ||
        (resident.status != null && resident.status !== 'active')
      )
        return [];
      return [
        {
          id: unit.id,
          label:
            str(data.flatLabel) ||
            str(data.unitLabel) ||
            str(data.unitNumber) ||
            str(data.flatNumber) ||
            unit.id,
          buildingName: str(building.data.buildingName) || str(building.data.name) || building.id,
          residentName: str(resident.name) || str(resident.fullName) || 'Resident name unavailable',
        },
      ];
    })
    .sort((a, b) =>
      `${a.buildingName} ${a.label}`.localeCompare(`${b.buildingName} ${b.label}`, undefined, {
        numeric: true,
      }),
    );
}

export const additionalBillStorageKey = (uid: string, communityId: string) =>
  `hominode.billingV2.additional.unresolved:${encodeURIComponent(uid)}:${encodeURIComponent(communityId)}`;

export async function createAdditionalBill(
  session: Session,
  request: AdditionalBillRequest,
  dependencies = { resolveAuthority: currentAuthority, invokeCall: call<unknown> },
): Promise<AdditionalBillResult> {
  if (
    session.role !== 'admin' ||
    session.profile.role !== 'admin' ||
    !session.community ||
    session.community.id !== request.communityId
  )
    throw Error('An administrator in the selected community is required.');
  const payload = validateAdditionalBillRequest(request);
  const authority = await dependencies.resolveAuthority(session);
  if (authority.role !== 'admin' || authority.community.id !== payload.communityId)
    throw Error('Your community changed. Reopen Billing.');
  const result = await dependencies.invokeCall('createAdditionalBill', { ...payload });
  if (!result || typeof result !== 'object')
    throw Error('Additional bill response could not be validated. Retry the saved request.');
  const data = result as Record<string, unknown>;
  if (
    data.success !== true ||
    typeof data.created !== 'boolean' ||
    typeof data.existing !== 'boolean' ||
    data.created === data.existing ||
    typeof data.billId !== 'string' ||
    !/^additional_[0-9a-f]{64}$/.test(data.billId)
  )
    throw Error('Additional bill response could not be validated. Retry the saved request.');
  return data as unknown as AdditionalBillResult;
}
