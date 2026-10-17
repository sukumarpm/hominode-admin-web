export function adminVisitorApprovalPatch(adminUid: string, approvedAt: unknown) {
  return {
    status: 'approved',
    isApproved: true,
    approvedBy: adminUid,
    approvedAt,
  };
}

export function adminVisitorRejectionPatch(adminUid: string, rejectedAt: unknown) {
  return {
    status: 'rejected',
    isApproved: false,
    rejectedBy: adminUid,
    rejectedAt,
  };
}
