import type { Data } from './models';
export type PhotoScope = 'COMMUNITY' | 'BUILDING';
export function matchesPhotoScope(
  data: Data,
  communityId: string,
  scope: PhotoScope,
  resourceId: string,
): boolean {
  return (
    (scope === 'COMMUNITY' || scope === 'BUILDING') &&
    !!resourceId &&
    data.contractVersion === 2 &&
    data.ownershipScope === scope &&
    data.communityId === communityId &&
    data.resourceId === resourceId &&
    data.unitId === undefined &&
    (scope === 'COMMUNITY'
      ? resourceId === communityId && data.buildingId === undefined
      : data.buildingId === resourceId)
  );
}
