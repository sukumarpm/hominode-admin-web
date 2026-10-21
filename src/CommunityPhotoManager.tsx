import { useEffect, useRef, useState } from 'react';
import { useRows } from './data';
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
export function CommunityPhotoManager({ session }: { session: Session }) {
  const buildings = useRows(session, 'buildings');
  const options = buildings.rows.filter(
    (row) =>
      row.data.communityId === session.community?.id &&
      row.data.isActive !== false &&
      row.data.status !== 'deleted',
  );
  const [building, setBuilding] = useState('');
  const [files, setFiles] = useState<Selection[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Row | null>(null);
  const alive = useRef(true);
  const selection = useRef(files);
  const scope = `${session.uid}/${session.community?.id}`;
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
  const buildingId = building || (options.length === 1 ? options[0].id : '');
  const upload = async () => {
    if (!options.some((row) => row.id === buildingId)) {
      setError('Select an available building first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      for (const item of files) {
        if (item.done) continue;
        item.job ??= new CommunityPhotoUpload(
          session,
          buildingId,
          item.file,
          item.title,
          () => alive.current && currentScope.current === scope,
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
    <section aria-label="Community photo management">
      <ApartmentGallery
        session={session}
        communityOnly
        actions={(photo) =>
          canDeleteCommunityPhoto(session, photo) && (
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
      <label>
        Photo building
        <select
          aria-label="Photo building"
          value={buildingId}
          disabled={busy || files.some((item) => !!item.job)}
          onChange={(e) => setBuilding(e.target.value)}
        >
          <option value="">Select a building</option>
          {options.map((row) => (
            <option key={row.id} value={row.id}>
              {str(row.data.name) || 'Building'}
            </option>
          ))}
        </select>
      </label>
      {buildings.loading && <p role="status">Loading buildings…</p>}
      {buildings.error && (
        <p role="alert">Building access could not be verified. Refresh before adding photos.</p>
      )}
      <label className="outline-link">
        Add Photos
        <input
          aria-label="Add Photos"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || !!files.length || !!buildings.error || buildings.loading}
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
        <div className="community-photo-selection">
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
      {error && <p role="alert">{error}</p>}
      {deleting && (
        <div role="dialog" aria-modal="true" aria-label="Delete community photo">
          <p>
            Delete this community photo? This removes it from the community and building galleries.
          </p>
          <button type="button" disabled={busy} onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await deleteCommunityPhoto(session, deleting);
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
        </div>
      )}
    </section>
  );
}
