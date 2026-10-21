import { ref, uploadBytesResumable } from 'firebase/storage';
import { currentAuthority } from './actions';
import { call, firebase } from './firebase';
import { str, type Data, type Row, type Session } from './models';
import { assertScope } from './policy';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export async function validateCommunityPhoto(file: File): Promise<string> {
  if (!file.size || file.size > 10 * 1024 * 1024 || !extensions[file.type])
    throw Error('Choose a JPEG, PNG or WebP image no larger than 10 MB.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const type =
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? 'image/jpeg'
      : [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
        ? 'image/png'
        : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
            String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
          ? 'image/webp'
          : '';
  if (type !== file.type) throw Error('The selected file is not a supported image.');
  return type;
}
function requireAdmin(session: Session) {
  const community = assertScope(session);
  if (session.role !== 'admin' || session.profile.role !== 'admin')
    throw Error('Administrator access is required.');
  return community;
}

/** Retain the reservation across retries, including an interrupted completion or
 * lost attachment response. Only saveApartmentImage attaches Firestore metadata. */
export class CommunityPhotoUpload {
  private asset?: Data;
  private stored = false;
  private ready = false;
  private result?: Data;
  private uploadDate = new Date();
  constructor(
    readonly session: Session,
    readonly buildingId: string,
    readonly file: File,
    readonly title: string,
    readonly isCurrent: () => boolean = () => true,
  ) {}
  private async authorize() {
    requireAdmin(this.session);
    if (!this.isCurrent()) throw Error('Community changed. Select the photos again.');
    const current = await currentAuthority(this.session);
    requireAdmin(current);
    if (
      !this.isCurrent() ||
      current.community?.id !== this.session.community?.id ||
      firebase().auth.currentUser?.uid !== this.session.uid
    )
      throw Error('Community or sign-in changed. Select the photos again.');
  }
  private validateAsset(asset: Data, state: 'pending' | 'ready', type: string) {
    const community = requireAdmin(this.session);
    const id = str(asset.assetId);
    const path =
      state === 'pending'
        ? `apartment_images/${community}/${this.session.uid}/${id}.${extensions[type]}`
        : `private_images/${community}/${this.session.uid}/apartment/${id}.${extensions[type]}`;
    if (
      !uuid.test(id) ||
      (this.asset && id !== this.asset.assetId) ||
      asset.provider !== 'firebase' ||
      asset.ownerId !== this.session.uid ||
      asset.communityId !== community ||
      asset.feature !== 'apartment' ||
      asset.resourceId !== this.buildingId ||
      asset.bucket !== firebase().app.options.storageBucket ||
      asset.storagePath !== path ||
      asset.contentType !== type ||
      asset.size !== this.file.size ||
      asset.state !== state ||
      (state === 'ready' && !/^[0-9]+$/.test(str(asset.generation)))
    )
      throw Error('The image upload response could not be verified.');
  }
  async run(progress: (percent: number) => void = () => {}) {
    const type = await validateCommunityPhoto(this.file);
    if (!this.buildingId || !this.title.trim() || this.title.length > 200)
      throw Error('Choose a building and a photo title.');
    await this.authorize();
    if (this.result) return this.result;
    if (!this.asset) {
      const asset = await call<Data>('prepareStorageImageUpload', {
        feature: 'apartment',
        resourceId: this.buildingId,
        contentType: type,
        size: this.file.size,
      });
      this.validateAsset(asset, 'pending', type);
      this.asset = asset;
    }
    if (!this.stored) {
      await this.authorize();
      if (typeof this.asset.expiresAtMs !== 'number' || this.asset.expiresAtMs <= Date.now())
        throw Error('This upload expired. Remove the selection and choose the photo again.');
      const task = uploadBytesResumable(
        ref(firebase().storage, str(this.asset.storagePath)),
        this.file,
        {
          contentType: type,
          cacheControl: 'private, no-store',
          customMetadata: {
            assetId: str(this.asset.assetId),
            communityId: str(this.asset.communityId),
            ownerId: this.session.uid,
            feature: 'apartment',
            resourceId: this.buildingId,
          },
        },
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          task.cancel();
          reject(Error('Upload timed out. Please retry.'));
        }, 120_000);
        task.on(
          'state_changed',
          (snapshot) => {
            if (!this.isCurrent()) task.cancel();
            else
              progress(
                Math.round((100 * snapshot.bytesTransferred) / Math.max(1, snapshot.totalBytes)),
              );
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
          () => {
            clearTimeout(timer);
            resolve();
          },
        );
      });
      this.stored = true;
    }
    await this.authorize();
    if (!this.ready) {
      const asset = await call<Data>('completeStorageImageUpload', { assetId: this.asset.assetId });
      this.validateAsset(asset, 'ready', type);
      this.asset = asset;
      this.ready = true;
    }
    await this.authorize();
    const result = await call<Data>('saveApartmentImage', {
      assetId: this.asset.assetId,
      title: this.title.trim(),
      description: '',
      type: 'Common Area',
      uploadDate: [
        this.uploadDate.getFullYear(),
        String(this.uploadDate.getMonth() + 1).padStart(2, '0'),
        String(this.uploadDate.getDate()).padStart(2, '0'),
      ].join('-'),
      uploadTime: this.uploadDate.toTimeString().slice(0, 5),
    });
    if (
      result.imageId !== this.asset.assetId ||
      !Number.isSafeInteger(result.revision) ||
      Number(result.revision) < 1
    )
      throw Error('Photo attachment could not be confirmed. Please retry.');
    this.result = result;
    return result;
  }
}

export function canDeleteCommunityPhoto(session: Session, photo: Row) {
  return (
    session.role === 'admin' &&
    session.profile.role === 'admin' &&
    photo.data.communityId === session.community?.id &&
    photo.data.status === 'active' &&
    str(photo.data.type).toLowerCase() === 'common area' &&
    !!str(photo.data.buildingId) &&
    (photo.data.revision === undefined ||
      (Number.isSafeInteger(photo.data.revision) && Number(photo.data.revision) >= 0))
  );
}
export async function deleteCommunityPhoto(session: Session, photo: Row) {
  requireAdmin(session);
  if (!canDeleteCommunityPhoto(session, photo))
    throw Error('This photo cannot be deleted from the community gallery.');
  const current = await currentAuthority(session);
  if (!canDeleteCommunityPhoto(current, photo) || firebase().auth.currentUser?.uid !== session.uid)
    throw Error('Community access changed. Refresh the page.');
  const result = await call<Data>('deleteApartmentImage', {
    imageId: photo.id,
    expectedRevision: photo.data.revision ?? 0,
  });
  if (result.imageId !== photo.id || result.deleted !== true)
    throw Error('Photo deletion could not be confirmed. Refresh the gallery.');
}
