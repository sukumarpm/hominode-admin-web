import { useEffect, useRef, useState } from 'react';
import { Modal } from './components';
import type { PhotoScope } from './photoScope';
import { str, type Row, type Session } from './models';
import { ApartmentGallery } from './privateImages';
import {
  canDeleteCommunityPhoto,
  CommunityPhotoUpload,
  deleteCommunityPhoto,
  validateCommunityPhoto,
} from './communityPhotos';

type Selection = {
  file: File;
  preview: string;
  title: string;
  job?: CommunityPhotoUpload;
  done?: boolean;
};
export function CommunityPhotoManager({
  session,
  buildingId,
  buildingName,
}: {
  session: Session;
  buildingId?: string;
  buildingName?: string;
}) {
  const ownershipScope: PhotoScope = buildingId ? 'BUILDING' : 'COMMUNITY';
  const resourceId = buildingId || session.community?.id || '';
  const label = buildingId ? 'Building' : 'Community';
  const targetName = buildingId
    ? buildingName || buildingId
    : session.community?.name || 'Community';
  const [files, setFiles] = useState<Selection[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Row | null>(null);
  const alive = useRef(true);
  const selection = useRef(files);
  const scope = `${session.uid}/${session.community?.id}/${ownershipScope}/${resourceId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      selection.current.forEach((item) => URL.revokeObjectURL(item.preview));
    };
  }, []);
  selection.current = files;
  if (session.role !== 'admin') return <ApartmentGallery session={session} communityOnly />;
  const upload = async () => {
    if (files.some((item) => !item.done && !item.title.trim())) {
      setError('Enter a title for each photo before uploading.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      for (const item of files) {
        if (item.done) continue;
        item.job ??= new CommunityPhotoUpload(
          session,
          resourceId,
          item.file,
          item.title,
          () => alive.current && currentScope.current === scope,
          ownershipScope,
        );
        await item.job.run((percent) => {
          if (alive.current) setMessage(`Uploading photo: ${percent}%`);
        });
        item.done = true;
      }
      if (alive.current) {
        files.forEach((item) => URL.revokeObjectURL(item.preview));
        setFiles([]);
        setMessage('Photos added. The gallery will update automatically.');
      }
    } catch {
      if (alive.current) {
        setError(
          'Photo upload or attachment failed. Check your access and connection, then retry. Completed photos will not be duplicated.',
        );
        setMessage('');
        setFiles([...files]);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section aria-label={`${label} photo management`}>
      <ApartmentGallery
        session={session}
        ownershipScope={ownershipScope}
        buildingId={buildingId}
        title={`${label} photos`}
        actions={(photo) =>
          canDeleteCommunityPhoto(session, photo, ownershipScope, resourceId) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDeleting(photo);
                setError('');
              }}
            >
              Delete Photo
            </button>
          )
        }
      />
      <p>
        Manage {label.toLowerCase()} photos for {targetName}.
      </p>
      {!deleting && error && (
        <p role="alert" className="photo-management-error">
          {error}
        </p>
      )}
      <label className="outline-link">
        Add Photos
        <input
          aria-label="Add Photos"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || !!files.length}
          onChange={async (e) => {
            const chosen = Array.from(e.target.files || []);
            e.target.value = '';
            setError('');
            setMessage('');
            if (chosen.length > 6) {
              setError('Select up to six photos at a time.');
              return;
            }
            try {
              for (const file of chosen) await validateCommunityPhoto(file);
              if (alive.current)
                setFiles(
                  chosen.map((file) => ({
                    file,
                    title: file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Community photo',
                    preview: URL.createObjectURL(file),
                  })),
                );
            } catch (e) {
              if (alive.current)
                setError(e instanceof Error ? e.message : 'Choose a supported image.');
            }
          }}
        />
      </label>
      {!!files.length && (
        <div className="community-photo-selection" aria-label="Pending photo uploads">
          <p>Pending uploads — these previews are not yet in the gallery.</p>
          {files.map((item, index) => (
            <div key={index}>
              <img src={item.preview} alt={`Selected photo ${index + 1}`} />
              <label>
                Photo {index + 1} title
                <input
                  value={item.title}
                  maxLength={200}
                  disabled={busy || !!item.job}
                  onChange={(e) =>
                    setFiles(
                      files.map((entry, i) =>
                        i === index ? { ...entry, title: e.target.value } : entry,
                      ),
                    )
                  }
                />
              </label>
              {item.done && <p>Added</p>}
            </div>
          ))}
          <button type="button" disabled={busy} onClick={upload}>
            {busy
              ? 'Uploading…'
              : files.some((item) => item.job)
                ? 'Retry Upload'
                : 'Upload Photos'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              files.forEach((item) => URL.revokeObjectURL(item.preview));
              setFiles([]);
              setError('');
            }}
          >
            Remove Selection
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {deleting && (
        <Modal
          title={`Delete ${label.toLowerCase()} photo`}
          onClose={() => {
            setDeleting(null);
          }}
        >
          {error && (
            <p role="alert" className="photo-management-error">
              {error}
            </p>
          )}
          <p>
            Delete “{str(deleting.data.title) || 'Untitled photo'}” from {targetName}’s{' '}
            {label.toLowerCase()} photos? This deletes only this scoped photo.
          </p>
          <button type="button" autoFocus disabled={busy} onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await deleteCommunityPhoto(session, deleting, ownershipScope, resourceId);
                if (alive.current) {
                  setDeleting(null);
                  setMessage('Photo deleted.');
                }
              } catch {
                if (alive.current)
                  setError('Photo deletion failed. Check your access and refresh before retrying.');
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            Confirm Delete
          </button>
        </Modal>
      )}
      <ApartmentGallery
        session={session}
        buildingId={buildingId}
        title="Legacy photos (read-only)"
      />
    </section>
  );
}
