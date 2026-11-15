import { useEffect, useRef, useState } from 'react';
import { call } from './firebase';
import { useRows } from './data';
import { str, type Session } from './models';

export type AssistedRequest = {
  requestId: string;
  communityId?: string | null;
  sourceApp?: string;
  status?: string;
  verificationStatus?: string;
  intakeDigest?: string;
  assistedIntake?: {
    supportCaseReference?: string;
    verificationMethod?: string;
    verificationEvidenceReference?: string;
    verificationNotes?: string;
    consentAttested?: boolean;
  };
};
export const assistedMethods: Record<string, string> = {
  in_person_with_community_records: 'In person with community records',
  live_video_with_community_records: 'Live video with community records',
  document_and_community_records: 'Document and community records',
};
export function assistedError(error: unknown): string {
  const code = String((error as { code?: string })?.code || '').replace('functions/', '');
  switch (code) {
    case 'unauthenticated':
      return 'Sign in again using your Admin phone verification, then retry.';
    case 'permission-denied':
      return 'Access denied. Use an authorized Community Admin phone session and the approved Admin app.';
    case 'failed-precondition':
      return 'Reauthenticate with your Admin phone and refresh this request. If it still fails, the Resident, community or existing request requires reconciliation.';
    case 'already-exists':
      return 'An intake already exists with different evidence. Refresh the queue; saved evidence cannot be overwritten.';
    case 'invalid-argument':
      return 'Check all required fields, protected references, verification method and explicit consent. Document links and image data are not accepted.';
    case 'not-found':
      return 'The Resident or request is no longer available. Refresh the queue.';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'The service could not confirm the result. Refresh before retrying; repeated requests are safe.';
    default:
      return 'The request could not be confirmed. Refresh and retry. If the problem continues, contact support.';
  }
}
export function canVerifyAssisted(request: AssistedRequest, communityId: string) {
  return (
    request.communityId === communityId &&
    request.sourceApp === 'admin_assisted' &&
    request.status === 'pending_assisted_verification' &&
    request.verificationStatus === 'pending' &&
    /^[a-f0-9]{64}$/.test(request.intakeDigest || '')
  );
}
export function AssistedDetails({ request }: { request: AssistedRequest }) {
  if (request.sourceApp !== 'admin_assisted') return null;
  return (
    <div className="assisted-details">
      <p>
        <strong>Assisted verification:</strong>{' '}
        {request.verificationStatus === 'verified'
          ? 'Identity and consent verified'
          : 'Pending identity verification'}
      </p>
      {request.verificationStatus !== 'verified' && (
        <p>Account deletion has not started. A case reference alone does not verify identity.</p>
      )}
      <p>
        <strong>Support case:</strong>{' '}
        {request.assistedIntake?.supportCaseReference || 'Not provided'}
      </p>
      <p>
        <strong>Verification method:</strong>{' '}
        {assistedMethods[request.assistedIntake?.verificationMethod || ''] || 'Not provided'}
      </p>
      <p>
        <strong>Protected evidence reference:</strong>{' '}
        {request.assistedIntake?.verificationEvidenceReference || 'Not provided'}
      </p>
      <p>
        <strong>Admin verification notes:</strong>{' '}
        {request.assistedIntake?.verificationNotes || 'Not provided'}
      </p>
      <p>
        <strong>Consent attestation recorded:</strong>{' '}
        {request.assistedIntake?.consentAttested === true ? 'Yes' : 'No'}
      </p>
    </div>
  );
}

export function AssistedDeletionDialog({
  session,
  request,
  onClose,
  onSuccess,
}: {
  session: Session;
  request?: AssistedRequest;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const busyRef = useRef(false),
    alive = useRef(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [identity, setIdentity] = useState(false),
    [consent, setConsent] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  async function verify() {
    if (
      busyRef.current ||
      !request ||
      !identity ||
      !consent ||
      !canVerifyAssisted(request, session.community?.id || '')
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await call<{ verificationStatus?: string }>(
        'verifyAdminAssistedDeletionRequest',
        {
          requestId: request.requestId,
          intakeDigest: request.intakeDigest,
          identityConfirmed: true,
          consentConfirmed: true,
        },
      );
      if (result.verificationStatus !== 'verified') throw Error('Unconfirmed verification');
      if (alive.current)
        onSuccess(
          'Identity and consent verified. Existing financial eligibility checks and deletion processing continue; verification does not mean deletion is complete.',
        );
    } catch (e) {
      if (alive.current) setError(assistedError(e));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="account-deletion-overlay">
      <section
        className="account-deletion-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assisted-title"
      >
        <h2 id="assisted-title">
          {request ? 'Verify assisted identity and consent' : 'Assisted Account Deletion'}
        </h2>
        {request ? (
          <>
            <AssistedDetails request={request} />
            <p>
              Confirm only after reviewing the saved evidence and independently checking the
              Resident’s identity and personal deletion consent. Verification queues the existing
              financial and deletion process.
            </p>
            <label className="assisted-check">
              <input
                type="checkbox"
                checked={identity}
                disabled={busy}
                onChange={(e) => setIdentity(e.target.checked)}
              />
              I independently verified the Resident’s identity.
            </label>
            <label className="assisted-check">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              The Resident personally consented to account deletion.
            </label>
            {error && (
              <p role="alert" className="error-state">
                {error}
              </p>
            )}
            {busy && <p role="status">Verifying identity and consent…</p>}
            <div className="account-deletion-actions">
              <button className="secondary" disabled={busy} onClick={onClose}>
                Close
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !identity ||
                  !consent ||
                  !canVerifyAssisted(request, session.community?.id || '')
                }
                onClick={() => void verify()}
              >
                {busy ? 'Verifying…' : 'Confirm identity and consent'}
              </button>
            </div>
          </>
        ) : (
          <IntakeForm
            session={session}
            onClose={onClose}
            onSuccess={onSuccess}
            onBusy={(value) => {
              busyRef.current = value;
            }}
          />
        )}
      </section>
    </div>
  );
}
function IntakeForm({
  session,
  onClose,
  onSuccess,
  onBusy,
}: {
  session: Session;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [revision, setRevision] = useState(0);
  const residents = useRows(session, 'residents', revision),
    buildings = useRows(session, 'buildings', revision),
    units = useRows(session, 'units', revision);
  const [search, setSearch] = useState(''),
    [uid, setUid] = useState(''),
    [caseRef, setCaseRef] = useState(''),
    [method, setMethod] = useState(''),
    [evidence, setEvidence] = useState(''),
    [notes, setNotes] = useState(''),
    [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const communityId = session.community?.id || '';
  const scopeRows = residents.rows.filter(
    (r) =>
      r.data.uid === r.id &&
      r.data.role === 'resident' &&
      r.data.communityId === communityId &&
      !['deleted', 'completed'].includes(str(r.data.status)) &&
      (r.data.communityIds == null ||
        (Array.isArray(r.data.communityIds) &&
          r.data.communityIds.every((c) => c === communityId))),
  );
  const options = scopeRows
    .map((r) => {
      const unit = units.rows.find(
        (u) => u.id === r.data.flatId && u.data.communityId === communityId,
      );
      const building = buildings.rows.find(
        (b) =>
          b.id === (r.data.buildingId || unit?.data.buildingId) &&
          b.data.communityId === communityId,
      );
      const name = str(r.data.fullName) || str(r.data.name) || 'Name not provided';
      const buildingName =
        str(building?.data.name) ||
        str(building?.data.buildingName) ||
        str(r.data.buildingName) ||
        'Building not provided';
      const unitName =
        str(r.data.flatLabel) ||
        str(unit?.data.flatLabel) ||
        str(unit?.data.unitLabel) ||
        str(unit?.data.flatNumber) ||
        str(unit?.data.unitId) ||
        'Unit not provided';
      return { uid: r.id, label: `${name} · ${buildingName} · ${unitName}` };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const selected = options.find((r) => r.uid === uid);
  const reference = (v: string, max: number) =>
    /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/.test(v) && v.length <= max;
  const loading = residents.loading || buildings.loading || units.loading;
  const loadError = residents.error || buildings.error || units.error;
  const valid =
    selected &&
    reference(caseRef.trim(), 80) &&
    reference(evidence.trim(), 160) &&
    caseRef.trim() !== evidence.trim() &&
    method in assistedMethods &&
    notes.trim().length >= 20 &&
    notes.length <= 600 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]|data:|base64|<img|https?:\/\/|gs:\/\/|[A-Za-z0-9+/]{160,}={0,2}/i.test(
      notes,
    ) &&
    consent;
  async function submit() {
    if (lock.current || !valid || loading || loadError || session.role !== 'admin') return;
    lock.current = true;
    onBusy(true);
    setBusy(true);
    setError('');
    try {
      const result = await call<{
        requestId?: string;
        sourceApp?: string;
        status?: string;
        intakeDigest?: string;
        existingVerifiedRequest?: boolean;
      }>('createAdminAssistedDeletionRequest', {
        residentUid: selected!.uid,
        communityId,
        supportCaseReference: caseRef.trim(),
        verificationMethod: method,
        verificationEvidenceReference: evidence.trim(),
        verificationNotes: notes.trim(),
        consentAttested: true,
      });
      if (
        !result.requestId ||
        (result.sourceApp === 'admin_assisted' && !/^[a-f0-9]{64}$/.test(result.intakeDigest || ''))
      )
        throw Error('Invalid intake response');
      const message =
        result.status === 'pending_assisted_verification' && result.sourceApp === 'admin_assisted'
          ? 'Pending identity verification. Intake saved; account deletion has not started. Review the saved request separately to verify identity and consent.'
          : 'An existing deletion request was returned. Refresh and review its current verification and deletion status; no additional intake was created.';
      if (alive.current) onSuccess(message);
    } catch (e) {
      if (alive.current) setError(assistedError(e));
    } finally {
      lock.current = false;
      if (alive.current) {
        onBusy(false);
        setBusy(false);
      }
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p>
        For Residents unable to access their accounts. Independently verify identity and explicit
        deletion consent using protected support evidence. Email or a case reference alone is
        insufficient.
      </p>
      <p>
        Saving intake does not start deletion and does not mark identity as verified. Reauthenticate
        using your Admin phone within five minutes before each submission.
      </p>
      {loading ? (
        <p role="status">Loading community Residents…</p>
      ) : loadError ? (
        <>
          <p role="alert">
            Resident records could not be loaded. Check community access and retry.
          </p>
          <button type="button" onClick={() => setRevision((r) => r + 1)}>
            Retry Resident list
          </button>
        </>
      ) : (
        <>
          <label>
            Search by Resident name, building or unit
            <input value={search} disabled={busy} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            Resident
            <select value={uid} disabled={busy} required onChange={(e) => setUid(e.target.value)}>
              <option value="">Select a Resident</option>
              {options
                .filter(
                  (r) => r.uid === uid || r.label.toLowerCase().includes(search.toLowerCase()),
                )
                .map((r) => (
                  <option key={r.uid} value={r.uid}>
                    {r.label}
                  </option>
                ))}
            </select>
          </label>
          {!options.length && <p>No eligible Resident records in this community.</p>}
          {options.length > 0 &&
            !options.some((r) => r.label.toLowerCase().includes(search.toLowerCase())) && (
              <p>No matching Residents.</p>
            )}
          {selected && <p>Selected Resident: {selected.label}</p>}
        </>
      )}
      <label>
        Support-case reference
        <input
          required
          maxLength={80}
          value={caseRef}
          disabled={busy}
          onChange={(e) => setCaseRef(e.target.value)}
        />
      </label>
      <label>
        Identity-verification method
        <select value={method} required disabled={busy} onChange={(e) => setMethod(e.target.value)}>
          <option value="">Select independent verification method</option>
          {Object.entries(assistedMethods).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Protected evidence reference
        <input
          required
          maxLength={160}
          value={evidence}
          disabled={busy}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      <p>
        Use separate opaque references (letters, digits, period, underscore, colon or hyphen), at
        least 3 characters. No uploads, document URLs, images or sensitive document contents.
      </p>
      <label>
        Verification notes (20–600 characters)
        <textarea
          required
          minLength={20}
          maxLength={600}
          rows={4}
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <label className="assisted-check">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(e) => setConsent(e.target.checked)}
        />
        I attest that the Resident explicitly requested and consented to deletion; protected
        evidence is recorded.
      </label>
      {error && (
        <p role="alert" className="error-state">
          {error}
        </p>
      )}
      {busy && <p role="status">Saving assisted intake…</p>}
      <div className="account-deletion-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>
          Close
        </button>
        <button
          className="primary"
          type="submit"
          disabled={busy || !valid || loading || Boolean(loadError)}
        >
          {busy ? 'Saving intake…' : 'Save pending intake'}
        </button>
      </div>
    </form>
  );
}
