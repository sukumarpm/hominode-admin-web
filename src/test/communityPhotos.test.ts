import { beforeEach, expect, it, vi } from 'vitest';
import {
  CommunityPhotoUpload,
  deleteCommunityPhoto,
  validateCommunityPhoto,
} from '../communityPhotos';
import { makeSession } from './fixtures';
import { type Data, type Session } from '../models';
const mock = vi.hoisted(() => ({
  call: vi.fn(),
  authority: vi.fn(),
  upload: vi.fn(),
  uid: 'admin-1',
  failUpload: false,
}));
vi.mock('../actions', () => ({ currentAuthority: mock.authority }));
vi.mock('../firebase', () => ({
  call: mock.call,
  firebase: () => ({
    auth: { currentUser: mock.uid ? { uid: mock.uid } : null },
    app: { options: { storageBucket: 'hominode-prod.firebasestorage.app' } },
    storage: {},
  }),
}));
vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => path,
  uploadBytesResumable: mock.upload,
}));
const id = 'a1111111-1111-4111-8111-111111111111';
function file(type = 'image/png', bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]) {
  const f = new File([new Uint8Array(bytes)], 'garden.png', { type });
  Object.defineProperty(f, 'slice', {
    value: () => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }),
  });
  return f;
}
function asset(state = 'pending'): Data {
  return {
    contractVersion: 2,
    ownershipScope: 'BUILDING',
    buildingId: 'tower-1',
    provider: 'firebase',
    assetId: id,
    communityId: 'community-1',
    ownerId: 'admin-1',
    feature: 'apartment',
    resourceId: 'tower-1',
    bucket: 'hominode-prod.firebasestorage.app',
    storagePath:
      state === 'pending'
        ? `apartment_images/community-1/admin-1/${id}.png`
        : `private_images/community-1/admin-1/apartment/${id}.png`,
    contentType: 'image/png',
    size: 12,
    state,
    expiresAtMs: Date.now() + 300000,
    generation: '7',
  };
}
function job(s = makeSession('admin'), isCurrent = () => true) {
  return new CommunityPhotoUpload(s, 'tower-1', file(), 'Garden', isCurrent);
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.uid = 'admin-1';
  mock.failUpload = false;
  mock.authority.mockImplementation(async (s: Session) => s);
  mock.upload.mockImplementation(() => ({
    cancel: vi.fn(),
    on: (
      _event: string,
      next: (v: unknown) => void,
      error: (v: unknown) => void,
      done: () => void,
    ) => {
      next({ bytesTransferred: 12, totalBytes: 12 });
      if (mock.failUpload) error(Error('upload failed'));
      else done();
    },
  }));
  mock.call.mockImplementation(async (name: string) =>
    name === 'prepareStorageImageUpload'
      ? asset()
      : name === 'completeStorageImageUpload'
        ? asset('ready')
        : name === 'saveApartmentImage'
          ? { imageId: id, revision: 1, contractVersion: 2 }
          : { imageId: id, deleted: true },
  );
});
it('uses the Flutter staging/finalization/attachment contract, without public URLs or direct Firestore writes', async () => {
  const progress = vi.fn();
  await job().run(progress);
  expect(mock.call.mock.calls.map((c) => c[0])).toEqual([
    'prepareStorageImageUpload',
    'completeStorageImageUpload',
    'saveApartmentImage',
  ]);
  expect(mock.call).toHaveBeenCalledWith('prepareStorageImageUpload', {
    feature: 'apartment',
    contractVersion: 2,
    ownershipScope: 'BUILDING',
    resourceId: 'tower-1',
    contentType: 'image/png',
    size: 12,
  });
  expect(mock.upload).toHaveBeenCalledWith(
    `apartment_images/community-1/admin-1/${id}.png`,
    expect.any(File),
    {
      contentType: 'image/png',
      cacheControl: 'private, no-store',
      customMetadata: {
        assetId: id,
        communityId: 'community-1',
        ownerId: 'admin-1',
        feature: 'apartment',
        resourceId: 'tower-1',
      },
    },
  );
  expect(mock.call).toHaveBeenCalledWith(
    'saveApartmentImage',
    expect.objectContaining({
      assetId: id,
      type: 'Common Area',
      title: 'Garden',
      description: '',
      uploadDate: expect.any(String),
      uploadTime: expect.any(String),
    }),
  );
  expect(progress).toHaveBeenCalledWith(100);
});
it.each(['completeStorageImageUpload', 'saveApartmentImage'])(
  'retries a lost %s response with the same asset and no duplicate uploads',
  async (stage) => {
    const handler = mock.call.getMockImplementation()!;
    let failed = false;
    mock.call.mockImplementation(async (name: string, ...args: unknown[]) => {
      if (name === stage && !failed) {
        failed = true;
        throw Error('lost response');
      }
      return handler(name, ...args);
    });
    const upload = job();
    await expect(upload.run()).rejects.toThrow();
    await upload.run();
    await upload.run();
    expect(mock.upload).toHaveBeenCalledTimes(1);
    expect(mock.call.mock.calls.filter((c) => c[0] === 'prepareStorageImageUpload')).toHaveLength(
      1,
    );
    expect(mock.call.mock.calls.filter((c) => c[0] === stage)).toHaveLength(2);
  },
);
it('failed byte upload never attaches broken metadata and can retry', async () => {
  const upload = job();
  mock.failUpload = true;
  await expect(upload.run()).rejects.toThrow();
  expect(mock.call.mock.calls.map((c) => c[0])).toEqual(['prepareStorageImageUpload']);
  mock.failUpload = false;
  await upload.run();
  expect(mock.upload).toHaveBeenCalledTimes(2);
  expect(mock.call.mock.calls.filter((c) => c[0] === 'prepareStorageImageUpload')).toHaveLength(1);
});
it.each([
  { communityId: 'foreign' },
  { ownerId: 'other' },
  { resourceId: 'other-building' },
  { storagePath: 'private/arbitrary' },
  { bucket: 'other-bucket' },
])('rejects mismatched reservation %j', async (patch) => {
  mock.call.mockResolvedValue({ ...asset(), ...patch });
  await expect(job().run()).rejects.toThrow();
  expect(mock.upload).not.toHaveBeenCalled();
});
it('rejects non-admin, revoked authority, logout and changed community before upload', async () => {
  await expect(job(makeSession()).run()).rejects.toThrow();
  await expect(job(makeSession('admin'), () => false).run()).rejects.toThrow();
  mock.authority.mockRejectedValue(Error('access revoked'));
  await expect(job().run()).rejects.toThrow();
  mock.authority.mockImplementation(async (s: Session) => s);
  mock.uid = '';
  await expect(job().run()).rejects.toThrow();
  expect(mock.upload).not.toHaveBeenCalled();
});
it('does not finalize if community switches while uploading', async () => {
  let current = true;
  mock.upload.mockImplementation(() => ({
    cancel: vi.fn(),
    on: (_e: unknown, _n: unknown, _r: unknown, done: () => void) => {
      current = false;
      done();
    },
  }));
  await expect(job(makeSession('admin'), () => current).run()).rejects.toThrow();
  expect(mock.call.mock.calls.map((c) => c[0])).toEqual(['prepareStorageImageUpload']);
});
it('rejects unsupported, mismatched and oversized files before reserving', async () => {
  await expect(validateCommunityPhoto(file('image/svg+xml'))).rejects.toThrow();
  await expect(validateCommunityPhoto(file('image/png', [0, 1, 2]))).rejects.toThrow();
  const big = file();
  Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
  await expect(validateCommunityPhoto(big)).rejects.toThrow();
  expect(mock.call).not.toHaveBeenCalled();
});
it('deletes only a scoped V2 record through revision-checked server deletion', async () => {
  await deleteCommunityPhoto(makeSession('admin'), {
    id,
    data: {
      communityId: 'community-1',
      contractVersion: 2,
      ownershipScope: 'COMMUNITY',
      resourceId: 'community-1',
      status: 'active',
      type: 'Common Area',
      revision: 2,
    },
  });
  expect(mock.call).toHaveBeenCalledExactlyOnceWith('deleteApartmentImage', {
    contractVersion: 2,
    imageId: id,
    expectedRevision: 2,
  });
});
it.each([
  { communityId: 'foreign' },
  { ownershipScope: 'BUILDING' },
  { contractVersion: undefined },
  { status: 'deleted' },
  { revision: -1 },
])('never deletes unrelated media %j', async (patch) => {
  await expect(
    deleteCommunityPhoto(makeSession('admin'), {
      id,
      data: {
        communityId: 'community-1',
        contractVersion: 2,
        ownershipScope: 'COMMUNITY',
        resourceId: 'community-1',
        status: 'active',
        type: 'Common Area',
        ...patch,
      },
    }),
  ).rejects.toThrow();
  expect(mock.call).not.toHaveBeenCalled();
});
it('propagates server deletion failure instead of removing local gallery metadata', async () => {
  mock.call.mockRejectedValue(Error('permission-denied'));
  await expect(
    deleteCommunityPhoto(makeSession('admin'), {
      id,
      data: {
        communityId: 'community-1',
        contractVersion: 2,
        ownershipScope: 'COMMUNITY',
        resourceId: 'community-1',
        status: 'active',
        type: 'Common Area',
        revision: 1,
      },
    }),
  ).rejects.toThrow();
  expect(mock.call).toHaveBeenCalledWith('deleteApartmentImage', {
    contractVersion: 2,
    imageId: id,
    expectedRevision: 1,
  });
});
it('times out a stalled byte upload without attaching a gallery record', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  mock.upload.mockImplementation(() => ({ cancel, on: vi.fn() }));
  try {
    const operation = job().run();
    const rejected = expect(operation).rejects.toThrow('Upload timed out');
    await vi.advanceTimersByTimeAsync(120001);
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mock.call.mock.calls.map((c) => c[0])).toEqual(['prepareStorageImageUpload']);
  } finally {
    vi.useRealTimers();
  }
});

it('COMMUNITY upload sends no building field and accepts the building-free V2 asset', async () => {
  const buildingAsset = asset();
  const response = (state: string) => {
    const value = {
      ...buildingAsset,
      state,
      ownershipScope: 'COMMUNITY',
      resourceId: 'community-1',
      ...(state === 'ready'
        ? {
            storagePath: `private_images/community-1/admin-1/${id}.png`.replace(
              '/admin-1/',
              '/admin-1/apartment/',
            ),
          }
        : {}),
    };
    delete (value as Data).buildingId;
    return value;
  };
  mock.call.mockImplementation(async (name: string) =>
    name === 'prepareStorageImageUpload'
      ? response('pending')
      : name === 'completeStorageImageUpload'
        ? response('ready')
        : { contractVersion: 2, imageId: id, revision: 1 },
  );
  await new CommunityPhotoUpload(
    makeSession('admin'),
    'community-1',
    file(),
    'Garden',
    () => true,
    'COMMUNITY',
  ).run();
  expect(mock.call).toHaveBeenCalledWith('prepareStorageImageUpload', {
    feature: 'apartment',
    contractVersion: 2,
    ownershipScope: 'COMMUNITY',
    resourceId: 'community-1',
    contentType: 'image/png',
    size: 12,
  });
  expect(mock.upload).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(File),
    expect.objectContaining({
      customMetadata: expect.objectContaining({ resourceId: 'community-1' }),
    }),
  );
});
