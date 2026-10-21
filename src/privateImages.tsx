import { useEffect, useState, type ReactNode } from 'react';
import { call, firebase } from './firebase';
import { type Data, type Session, str, dateOf } from './models';
import { assertScope } from './policy';
import { useAuth } from './session';
import { safeUrl, useApartmentImages } from './data';

const prefix = 'hominode-image:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maximumBytes = 10 * 1024 * 1024;
const lifetime = 60_000;

/** Managed fields take precedence. A rejected private image never falls back to an old URL. */
export function profileImageReference(data: Data): string {
  if (Array.isArray(data.managedImageAssets) && data.managedImageAssets.length) {
    const asset = data.managedImageAssets[0] as Data | null;
    return asset?.feature === 'profile' && uuid.test(str(asset.assetId))
      ? prefix + asset.assetId
      : prefix + 'invalid';
  }
  return str(data.profileImage ?? data.profileImageUrl ?? data.photoURL ?? data.photoUrl);
}
export function apartmentImageReference(data: Data): string {
  if (data.imageAsset !== undefined && data.imageAsset !== null) {
    const asset = data.imageAsset as Data;
    return asset.feature === 'apartment' &&
      asset.state === 'ready' &&
      asset.communityId === data.communityId &&
      asset.resourceId === data.buildingId &&
      uuid.test(str(asset.assetId))
      ? prefix + asset.assetId
      : prefix + 'invalid';
  }
  return str(data.imageUrl);
}

/** Only the authenticated callable can turn an opaque reference into image bytes.
 * No permanent URLs, Storage path reads, disk cache, or logging of response data.
 */
export async function readPrivateImage(reference: string, session: Session): Promise<Blob> {
  const community = assertScope(session);
  const assetId = reference.slice(prefix.length);
  if (!reference.startsWith(prefix) || !uuid.test(assetId)) throw Error('Image unavailable.');
  if (firebase().auth.currentUser?.uid !== session.uid) throw Error('Image unavailable.');
  const response = await call<Data>('readStorageImage', { assetId });
  if (firebase().auth.currentUser?.uid !== session.uid) throw Error('Image unavailable.');
  const asset = response.asset as Data | undefined;
  const size = response.size;
  const type = response.contentType;
  const encoded = response.base64;
  if (
    !asset ||
    asset.provider !== 'firebase' ||
    asset.state !== 'ready' ||
    asset.communityId !== community ||
    !uuid.test(str(asset.assetId)) ||
    (asset.assetId !== assetId &&
      (asset.feature !== 'profile' || response.redirectedFrom !== assetId)) ||
    response.assetId !== asset.assetId ||
    response.generation !== asset.generation ||
    !/^[0-9]+$/.test(str(response.generation)) ||
    asset.size !== size ||
    asset.contentType !== type ||
    !['apartment', 'profile'].includes(str(asset.feature)) ||
    ![
      'image/jpeg',
      'image/png',
      'image/webp',
      ...(asset.feature === 'profile' ? ['image/gif'] : []),
    ].includes(str(type)) ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > maximumBytes ||
    typeof encoded !== 'string' ||
    encoded.length !== 4 * Math.ceil(size / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw Error('Image unavailable.');
  const binary = atob(encoded);
  if (binary.length !== size) throw Error('Image unavailable.');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: str(type) });
}

/** One bounded image buffer per mounted viewer; only the selected gallery image
 * is mounted. URLs are revoked on refresh, failure, scope change and disposal.
 * SessionProvider invalidates its session on auth/profile/tenant changes.
 */
export function StorageImage({
  reference,
  alt,
  className,
  fallback,
}: {
  reference: string;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const { session } = useAuth();
  const [state, setState] = useState<{
    session: Session | null;
    reference: string;
    url: string;
    loading: boolean;
  }>({
    session: null,
    reference: '',
    url: '',
    loading: false,
  });
  useEffect(() => {
    if (!session || !reference) return;
    let active = true;
    let url = '';
    let refresh: ReturnType<typeof setTimeout>;
    let deadline: ReturnType<typeof setTimeout>;
    const revoke = () => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      url = '';
    };
    const publish = (loading: boolean) => {
      if (active) setState({ session, reference, url, loading });
    };
    const load = async () => {
      revoke();
      publish(true);
      let requestActive = true;
      deadline = setTimeout(() => {
        requestActive = false;
        publish(false);
      }, 30_000);
      try {
        if (reference.startsWith(prefix)) {
          const blob = await readPrivateImage(reference, session);
          if (!active || !requestActive) return;
          url = URL.createObjectURL(blob);
        } else {
          assertScope(session);
          url = safeUrl(reference) || '';
        }
        if (!active || !requestActive) return;
        publish(false);
        if (reference.startsWith(prefix)) refresh = setTimeout(() => void load(), lifetime);
      } catch {
        revoke();
        publish(false);
      } finally {
        clearTimeout(deadline);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(refresh);
      clearTimeout(deadline);
      revoke();
    };
  }, [session, reference]);
  const current = state.session === session && state.reference === reference;
  if (!session || !reference || !current || !state.url) {
    return (
      <span className={className} role="status">
        {current && state.loading ? 'Loading image…' : (fallback ?? 'Image unavailable')}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={state.url}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => {
        if (state.url.startsWith('blob:')) URL.revokeObjectURL(state.url);
        setState({ ...state, url: '', loading: false });
      }}
    />
  );
}

export function ProfilePhoto({
  data,
  name,
  large = false,
}: {
  data: Data;
  name: string;
  large?: boolean;
}) {
  return (
    <StorageImage
      reference={profileImageReference(data)}
      alt={`${name} profile photo`}
      className={'avatar' + (large ? ' large' : '')}
      fallback={name.slice(0, 2).toUpperCase()}
    />
  );
}

export function ApartmentGallery({
  session,
  buildingId,
  title = 'Community photos',
}: {
  session: Session;
  buildingId?: string;
  title?: string;
}) {
  const resource = useApartmentImages(session);
  const photos = resource.rows
    .filter(
      ({ data }) =>
        data.communityId === session.community?.id &&
        data.status === 'active' &&
        (!buildingId || data.buildingId === buildingId),
    )
    .sort(
      (a, b) =>
        (dateOf(b.data.createdAt)?.getTime() || 0) - (dateOf(a.data.createdAt)?.getTime() || 0),
    );
  const [selection, setSelection] = useState({ scope: '', id: '' });
  const scope = `${session.uid}/${session.community?.id}/${buildingId || ''}`;
  const selected =
    selection.scope === scope ? photos.findIndex((photo) => photo.id === selection.id) : 0;
  const index = Math.max(0, selected);
  const photo = photos[index];
  if (resource.loading) return <p role="status">Loading photos…</p>;
  if (resource.error) return <p role="status">Photos are unavailable.</p>;
  if (!photo) return <p>No photos available.</p>;
  const change = (delta: number) =>
    setSelection({ scope, id: photos[(index + delta + photos.length) % photos.length].id });
  return (
    <section aria-label={title} className="private-image-gallery">
      <h3>{title}</h3>
      <StorageImage
        key={`${scope}/${photo.id}`}
        reference={apartmentImageReference(photo.data)}
        alt={str(photo.data.title) || title}
      />
      {str(photo.data.description) && <p>{str(photo.data.description)}</p>}
      {photos.length > 1 && (
        <div className="toolbar-actions">
          <button
            type="button"
            onClick={() => change(-1)}
            aria-label={`Previous ${title.toLowerCase()}`}
          >
            Previous
          </button>
          <span aria-live="polite">
            {index + 1} / {photos.length}
          </span>
          <button
            type="button"
            onClick={() => change(1)}
            aria-label={`Next ${title.toLowerCase()}`}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
