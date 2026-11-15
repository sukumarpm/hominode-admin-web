import { str, type Data } from './models';

/** Existing allocation contract: only vacant units without links or reservations. */
export function isResidentUnitAvailable(data: Data): boolean {
  const present = (value: unknown) =>
    value != null && (typeof value !== 'string' || value.trim() !== '');
  return (
    data.status === 'vacant' &&
    data.isActive !== false &&
    !['residentUserId', 'residentUid', 'residentId', 'reservedOnboardingId'].some((field) =>
      present(data[field]),
    ) &&
    (data.residentIds == null || (Array.isArray(data.residentIds) && data.residentIds.length === 0))
  );
}

export function residentUnitLabel(data: Data, id: string): string {
  return (
    str(data.flatLabel) ||
    str(data.flatId) ||
    str(data.unitId) ||
    str(data.unitLabel) ||
    str(data.flatNumber) ||
    id
  );
}
