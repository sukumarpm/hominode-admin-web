// Every network operation is disabled in this test adapter.
export function firebase(): never {
  throw Error('Live Firebase is forbidden in the offline browser harness.');
}
export async function call<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  if (name === 'resolveResidentCommunity')
    return {
      slug: data.slug,
      name: data.slug === 'sunridge' ? 'Sunridge' : 'Green Valley',
      communityId: data.slug === 'sunridge' ? 'community-2' : 'community-1',
    } as T;
  if (name === 'getSosContext')
    return { communityId: 'community-1', residentUid: 'resident-1' } as T;
  throw Error('Mutations are disabled in the offline browser harness.');
}
