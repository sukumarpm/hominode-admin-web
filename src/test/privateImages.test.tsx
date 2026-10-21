import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type ReactNode } from 'react';
import { AuthContext } from '../session';
import { type Data, type Session } from '../models';
import { type Resource } from '../data';
import { makeSession } from './fixtures';
import {
  ApartmentGallery,
  ProfilePhoto,
  StorageImage,
  apartmentImageReference,
  profileImageReference,
  readPrivateImage,
} from '../privateImages';

const mock = vi.hoisted(() => ({
  call: vi.fn(),
  uid: 'resident-1',
  resource: { rows: [], loading: false, error: '' } as Resource,
}));
vi.mock('../firebase', () => ({
  call: mock.call,
  firebase: () => ({ auth: { currentUser: mock.uid ? { uid: mock.uid } : null } }),
}));
vi.mock('../data', async () => ({
  ...(await vi.importActual<typeof import('../data')>('../data')),
  useApartmentImages: () => mock.resource,
}));
const id = 'a1111111-1111-4111-8111-111111111111';
const otherId = 'a1111111-1111-4111-8111-111111111112';
const reference = 'hominode-image:' + id;
const encoded =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DwH4QZYAwAR8oH+WdZbrcAAAAASUVORK5CYII=';
const asset = {
  assetId: id,
  provider: 'firebase',
  communityId: 'community-1',
  resourceId: 'tower-1',
  ownerId: 'admin-1',
  feature: 'apartment',
  state: 'ready',
  generation: '7',
  size: atob(encoded).length,
  contentType: 'image/png',
};
function response(): Data {
  return {
    asset: { ...asset },
    assetId: id,
    generation: '7',
    size: asset.size,
    contentType: 'image/png',
    base64: encoded,
  };
}
function wrap(children: ReactNode, session: Session | null = makeSession()) {
  return (
    <AuthContext
      value={{
        session,
        loading: false,
        error: '',
        authenticated: !!session,
        signOut: vi.fn(),
        switchCommunity: vi.fn(),
      }}
    >
      {children}
    </AuthContext>
  );
}
beforeEach(() => {
  mock.call.mockReset().mockResolvedValue(response());
  mock.uid = 'resident-1';
  mock.resource = { rows: [], loading: false, error: '' };
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:authorized-image');
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['resident', 'admin'] as const)(
  'reads authorized %s images through the existing callable only',
  async (role) => {
    const session = makeSession(role);
    mock.uid = session.uid;
    const blob = await readPrivateImage(reference, session);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(asset.size);
    expect(mock.call).toHaveBeenCalledExactlyOnceWith('readStorageImage', { assetId: id });
  },
);
it('renders a local blob, deduplicates normal rebuilds and revokes on disposal', async () => {
  const session = makeSession();
  const tree = () => wrap(<StorageImage reference={reference} alt="Apartment" />, session);
  const view = render(tree());
  expect(screen.getByText('Loading image…')).toBeInTheDocument();
  expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:authorized-image');
  expect(document.body.innerHTML).not.toContain('private_images/');
  expect(document.body.innerHTML).not.toContain(reference);
  view.rerender(tree());
  expect(mock.call).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authorized-image');
});
it.each([
  { asset: { ...asset, communityId: 'foreign' } },
  { assetId: otherId },
  { generation: '8' },
  { contentType: 'image/svg+xml' },
  { size: 10 * 1024 * 1024 + 1 },
  { base64: 'malformed' },
  { notModified: true, base64: undefined },
])('rejects mismatched or unbounded private payload %j', async (patch) => {
  mock.call.mockResolvedValue({ ...response(), ...patch });
  await expect(readPrivateImage(reference, makeSession())).rejects.toThrow();
});
it('accepts only explicit profile redirects', async () => {
  mock.call.mockResolvedValue({
    ...response(),
    assetId: otherId,
    redirectedFrom: id,
    asset: { ...asset, assetId: otherId, feature: 'profile' },
  });
  expect((await readPrivateImage(reference, makeSession())).size).toBe(asset.size);
  mock.call.mockResolvedValue({
    ...response(),
    assetId: otherId,
    redirectedFrom: id,
    asset: { ...asset, assetId: otherId },
  });
  await expect(readPrivateImage(reference, makeSession())).rejects.toThrow();
});
it('denial shows fallback without exposing backend errors or using a legacy private fallback', async () => {
  mock.call.mockRejectedValue(Error('permission-denied private_images/secret-path'));
  render(
    wrap(
      <ProfilePhoto
        name="Resident"
        data={{
          managedImageAssets: [{ ...asset, feature: 'profile' }],
          photoURL: 'https://example.invalid/obsolete.jpg',
        }}
      />,
    ),
  );
  await waitFor(() => expect(screen.queryByText('Loading image…')).not.toBeInTheDocument());
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText('RE')).toBeVisible();
  expect(document.body.innerHTML).not.toContain('secret-path');
  expect(document.body.innerHTML).not.toContain('obsolete');
});
it.each([
  'https://res.cloudinary.com/example/image/upload/old.jpg',
  'https://firebasestorage.googleapis.com/v0/b/example/o/event.jpg?alt=media&token=synthetic',
])('keeps legacy URL read compatibility %s', async (url) => {
  render(wrap(<StorageImage reference={url} alt="Legacy image" />));
  expect(await screen.findByRole('img')).toHaveAttribute('src', url);
  expect(mock.call).not.toHaveBeenCalled();
  fireEvent.error(screen.getByRole('img'));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText('Image unavailable')).toBeVisible();
});
it('missing/malformed references do not initiate any network read', async () => {
  const view = render(wrap(<StorageImage reference="" alt="Missing" />));
  expect(screen.getByText('Image unavailable')).toBeVisible();
  view.rerender(wrap(<StorageImage reference="hominode-image:bad" alt="Invalid" />));
  await waitFor(() => expect(screen.queryByText('Loading image…')).not.toBeInTheDocument());
  expect(mock.call).not.toHaveBeenCalled();
});
it('clears displayed bytes on logout, tenant change and rejects late responses', async () => {
  const session = makeSession('admin');
  mock.uid = session.uid;
  const view = render(wrap(<StorageImage reference={reference} alt="Apartment" />, session));
  await screen.findByRole('img');
  mock.call.mockImplementation(() => new Promise(() => {}));
  view.rerender(
    wrap(<StorageImage reference={reference} alt="Apartment" />, {
      ...session,
      community: session.communities[1],
    }),
  );
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authorized-image');
  view.rerender(wrap(<StorageImage reference={reference} alt="Apartment" />, null));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  let resolve!: (value: Data) => void;
  mock.call.mockImplementation(
    () =>
      new Promise<Data>((r) => {
        resolve = r;
      }),
  );
  view.rerender(wrap(<StorageImage reference={reference} alt="Apartment" />, session));
  view.rerender(wrap(<StorageImage reference={reference} alt="Apartment" />, null));
  await act(async () => resolve(response()));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});
it('expired authentication and hung reads stop showing protected images', async () => {
  mock.uid = '';
  await expect(readPrivateImage(reference, makeSession())).rejects.toThrow();
  expect(mock.call).not.toHaveBeenCalled();
  mock.uid = 'resident-1';
  vi.useFakeTimers();
  mock.call.mockImplementation(() => new Promise(() => {}));
  render(wrap(<StorageImage reference={reference} alt="Apartment" />));
  await act(async () => vi.advanceTimersByTime(30_001));
  expect(screen.queryByText('Loading image…')).not.toBeInTheDocument();
  expect(screen.getByText('Image unavailable')).toBeVisible();
});
it('reauthorizes visible images and erases them after permission denial', async () => {
  vi.useFakeTimers();
  await act(async () => {
    render(wrap(<StorageImage reference={reference} alt="Apartment" />));
  });
  expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:authorized-image');
  mock.call.mockRejectedValue(Error('permission-denied'));
  await act(async () => vi.advanceTimersByTime(60_001));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authorized-image');
  expect(mock.call).toHaveBeenCalledTimes(2);
});
it('canonical fields outrank historical URLs and malformed assets fail closed', () => {
  expect(
    apartmentImageReference({
      imageAsset: asset,
      communityId: 'community-1',
      buildingId: 'tower-1',
      imageUrl: 'https://example.invalid/old.jpg',
    }),
  ).toBe(reference);
  expect(
    apartmentImageReference({
      imageAsset: { ...asset, communityId: 'foreign' },
      communityId: 'community-1',
      buildingId: 'tower-1',
      imageUrl: 'https://example.invalid/old.jpg',
    }),
  ).toBe('hominode-image:invalid');
  expect(profileImageReference({ profileImage: reference })).toBe(reference);
  expect(
    profileImageReference({
      managedImageAssets: [{}],
      photoURL: 'https://example.invalid/old.jpg',
    }),
  ).toBe('hominode-image:invalid');
});
it('gallery filters tenant, status and building, preserves date ordering and mounts one selected image', async () => {
  mock.resource.rows = [
    {
      id: 'older',
      data: {
        communityId: 'community-1',
        buildingId: 'tower-1',
        status: 'active',
        title: 'Older',
        imageUrl: 'https://example.invalid/older.jpg',
        createdAt: new Date('2025-01-01'),
      },
    },
    {
      id: 'newer',
      data: {
        communityId: 'community-1',
        buildingId: 'tower-1',
        status: 'active',
        title: 'Newer',
        imageAsset: asset,
        createdAt: new Date('2026-01-01'),
      },
    },
    {
      id: 'foreign',
      data: { communityId: 'community-2', buildingId: 'tower-1', status: 'active' },
    },
    {
      id: 'deleted',
      data: { communityId: 'community-1', buildingId: 'tower-1', status: 'deleted' },
    },
    {
      id: 'other-building',
      data: { communityId: 'community-1', buildingId: 'tower-2', status: 'active' },
    },
  ];
  render(wrap(<ApartmentGallery session={makeSession()} buildingId="tower-1" />));
  expect(await screen.findByRole('img')).toHaveAttribute('alt', 'Newer');
  expect(screen.getByText('1 / 2')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Next community photos' }));
  expect(await screen.findByRole('img')).toHaveAttribute(
    'src',
    'https://example.invalid/older.jpg',
  );
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.getByText('2 / 2')).toBeVisible();
});
it('gallery handles loading, error and empty data without a broken image', () => {
  mock.resource.loading = true;
  const view = render(wrap(<ApartmentGallery session={makeSession()} />));
  expect(screen.getByText('Loading photos…')).toBeVisible();
  mock.resource = { rows: [], loading: false, error: 'permission-denied secret' };
  view.rerender(wrap(<ApartmentGallery session={makeSession()} />));
  expect(screen.getByText('Photos are unavailable.')).toBeVisible();
  mock.resource.error = '';
  view.rerender(wrap(<ApartmentGallery session={makeSession()} />));
  expect(screen.getByText('No photos available.')).toBeVisible();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
