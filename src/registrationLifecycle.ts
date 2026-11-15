import type { Data } from './models';

export function canApproveRegistration(data: Data): boolean {
  return (
    data.approvalStatus === 'pending' &&
    data.isActive === false &&
    data.creationSource !== 'admin_direct' &&
    data.status !== 'deleted'
  );
}

/** Admin provisioning used approvalStatus=approved before mandatory identity approval. */
export function canRejectRegistration(data: Data, ownerIdentityRequired: boolean): boolean {
  if (
    data.identityVerified === true ||
    data.identityVerificationStatus === 'verified' ||
    data.registrationCompletedAt != null ||
    ['deleted', 'completed'].includes(String(data.status))
  )
    return false;
  if (data.creationSource !== 'admin_direct') return canApproveRegistration(data);
  const type = data.residentType || data.ownershipType || data.declaredResidentType;
  return (
    ['pending', 'approved'].includes(String(data.approvalStatus)) &&
    typeof data.isActive === 'boolean' &&
    data.identityVerified === false &&
    ['verification_required', 'pending', 'rejected'].includes(
      String(data.identityVerificationStatus),
    ) &&
    !['rejected', 'deleted', 'completed'].includes(String(data.status)) &&
    !['moved_out', 'suspended', 'rejected'].includes(String(data.occupancyStatus)) &&
    (type === 'tenant' || (type === 'owner' && ownerIdentityRequired))
  );
}
