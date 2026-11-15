import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './firebase';
import { useAuth } from './session';
import {
  AssistedDeletionDialog,
  AssistedDetails,
  canVerifyAssisted,
  type AssistedRequest,
} from './AssistedDeletionDialog';

type DeletionRequest = AssistedRequest & {
  requestId: string;
  financialReviewStatus?: string;
  financialEvidence?: {
    digest?: string;
    recordCount?: number;
    outstandingMinor?: number;
    currency?: string;
  } | null;
  reviewStatus?: string;
  createdAt?: unknown;
  reviewDueAt?: unknown;
  completedAt?: unknown;
  financialReviewRequired?: boolean;
  status?: string;
  resident?: {
    displayName?: string | null;
    phoneNumber?: string | null;
    unit?: string | null;
    residentType?: string | null;
  } | null;
  communityId?: string | null;
  communityName?: string | null;
  residentProfileStatus?: string;
  reviewFinding?: string | null;
  reviewNote?: string | null;
  reviewedAt?: unknown;
  unresolvedDependencies?: string[];
};

function dateLabel(value: unknown) {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string'
        ? new Date(value)
        : value &&
            typeof value === 'object' &&
            'toDate' in value &&
            typeof value.toDate === 'function'
          ? value.toDate()
          : value && typeof value === 'object'
            ? (() => {
                const timestamp = value as Record<string, unknown>;
                const seconds = timestamp.seconds ?? timestamp._seconds;
                const nanoseconds = timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0;
                return typeof seconds === 'number' && typeof nanoseconds === 'number'
                  ? new Date(seconds * 1000 + nanoseconds / 1_000_000)
                  : null;
              })()
            : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Not provided';
}

function financialLabel(request: DeletionRequest) {
  if (request.status === 'pending_assisted_verification')
    return 'Not started: identity verification pending';
  if (request.financialReviewStatus === 'VERIFIED_HANDOVER') return 'Financial handover verified';
  if (request.status === 'completed') return 'Deletion completed';
  const outstanding = request.financialEvidence?.outstandingMinor;
  if (typeof outstanding !== 'number' || !Number.isSafeInteger(outstanding)) {
    return 'Unknown: requires reconciliation';
  }
  if (outstanding > 0) return 'Outstanding dues: awaiting settlement';
  return request.financialReviewRequired
    ? 'Zero dues: eligible for financial verification'
    : 'Zero dues: automatic processing';
}

function residentRoleLabel(value?: string | null) {
  if (value?.toLowerCase() === 'owner') return 'Owner';
  if (value?.toLowerCase() === 'tenant') return 'Tenant';
  return value || '';
}

function financialVerificationLabel(value?: string, completed = false) {
  if (completed && value !== 'VERIFIED_HANDOVER')
    return value === 'NOT_REQUIRED' ? 'Not required' : 'Not recorded';
  switch (value) {
    case 'VERIFIED_HANDOVER':
      return 'Financial handover verified';
    case 'NOT_REQUIRED':
      return 'Not required';
    case 'UNKNOWN_REQUIRES_REVIEW':
      return 'Unknown — requires review';
    default:
      return value || 'Not recorded';
  }
}

function deletionStatusLabel(value?: string) {
  switch (value) {
    case 'completed':
      return 'Account Deleted';
    case 'pending_assisted_verification':
      return 'Pending identity verification';
    case 'pending_verification':
      return 'Verification pending';
    case 'pending_review':
      return 'Pending review';
    case 'eligibility_blocked':
      return 'Eligibility check blocked';
    case 'deletion_in_progress':
      return 'Deletion in progress';
    case 'reconciliation_required':
      return 'Reconciliation required';
    case 'failed':
      return 'Processing failed';
    default:
      return value || 'Unknown';
  }
}

function canVerifyHandover(request: DeletionRequest) {
  return (
    request.status === 'pending_review' &&
    request.financialReviewStatus !== 'VERIFIED_HANDOVER' &&
    request.financialReviewRequired === true &&
    request.financialEvidence?.outstandingMinor === 0 &&
    /^[a-f0-9]{64}$/.test(request.financialEvidence?.digest || '')
  );
}

const REASSESSABLE_STATUSES = new Set([
  'pending_review',
  'eligibility_blocked',
  'deletion_in_progress',
  'reconciliation_required',
  'failed',
]);

function canReassess(request: DeletionRequest) {
  return REASSESSABLE_STATUSES.has(request.status || '');
}

export function AccountDeletionRequests() {
  const { session } = useAuth();
  if (
    session?.role !== 'admin' ||
    !session.community ||
    !session.profile.authorizedCommunityIds.includes(session.community.id)
  )
    return <p role="alert">Select an authorized Community Admin session.</p>;
  return <CommunityDeletionRequests key={`${session.uid}:${session.community.id}`} />;
}

function CommunityDeletionRequests() {
  const { session } = useAuth();
  const communityId = session?.role === 'admin' ? session.community?.id || '' : '';
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actionError, setActionError] = useState('');
  const [selected, setSelected] = useState<DeletionRequest | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [reassessingId, setReassessingId] = useState('');
  const [assisted, setAssisted] = useState<DeletionRequest | 'intake' | null>(null);
  const alive = useRef(true);
  const loadVersion = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      loadVersion.current++;
    };
  }, []);

  const refresh = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError('');
    if (!communityId) {
      setRequests([]);
      setError('Select an authorized community to view its requests.');
      setLoading(false);
      return;
    }
    try {
      const result = await call<{ requests: DeletionRequest[] }>(
        'listCommunityAccountDeletionRequests',
        { communityId },
      );
      if (!alive.current || version !== loadVersion.current) return;
      setRequests(
        Array.isArray(result.requests)
          ? result.requests.filter((r) => !r.communityId || r.communityId === communityId)
          : [],
      );
    } catch {
      if (!alive.current || version !== loadVersion.current) return;
      setError('Requests could not be loaded. Check access and retry.');
    } finally {
      if (alive.current && version === loadVersion.current) setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveFinding() {
    if (savingRef.current || !selected || note.trim().length < 10 || !canVerifyHandover(selected))
      return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setSuccess('');
    setActionError('');
    try {
      await call('recordAccountDeletionFinancialReview', {
        requestId: selected.requestId,
        finding: 'verified_handover',
        note: note.trim(),
        evidenceDigest: selected.financialEvidence?.digest,
        retainFinancialRecords: true,
      });
      setSuccess('Financial handover verified. Deletion processing.');
      setSelected(null);
      setNote('');
      void refresh();
    } catch {
      setActionError('Financial verification could not be saved. Please retry.');
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  async function reassess(request: DeletionRequest) {
    if (!canReassess(request) || reassessingId) return;
    setReassessingId(request.requestId);
    setActionError('');
    setSuccess('');
    try {
      const result = await call<{ status?: string; completed?: boolean }>(
        'reassessAccountDeletionRequest',
        { requestId: request.requestId },
      );
      setSuccess(
        result.completed || result.status === 'completed'
          ? 'Account deletion completed.'
          : `Deletion reassessment finished. Current status: ${result.status || 'updated'}.`,
      );
      await refresh();
    } catch {
      setActionError('Deletion could not be rechecked. Refresh the request and retry.');
    } finally {
      setReassessingId('');
    }
  }

  return (
    <section className="account-deletion-page">
      <header className="account-deletion-heading">
        <div>
          <p className="eyebrow">{session?.community?.name || 'Community'}</p>
          <h1>Account deletion requests</h1>
          <p>
            Zero dues are processed automatically. For unpaid or unknown balances, review settlement
            and verify handover after the balance is zero. This screen cannot reject or cancel a
            request.
          </p>
        </div>
        <div className="account-deletion-actions">
          <button
            className="primary"
            disabled={saving || Boolean(reassessingId)}
            onClick={() => {
              setSuccess('');
              setAssisted('intake');
            }}
          >
            Assisted Account Deletion
          </button>
          <button
            className="secondary"
            onClick={() => void refresh()}
            disabled={loading || saving || Boolean(reassessingId)}
          >
            Refresh
          </button>
        </div>
      </header>
      {success && (
        <p role="status" className="success-state">
          {success}
        </p>
      )}
      {error && (
        <p role="alert" className="error-state">
          {error}
        </p>
      )}
      {actionError && !selected && (
        <p role="alert" className="error-state">
          {actionError}
        </p>
      )}
      {loading ? (
        <p role="status">Loading requests…</p>
      ) : error ? (
        <button className="secondary" onClick={() => void refresh()}>
          Retry
        </button>
      ) : requests.length === 0 ? (
        <p className="empty-state">No account deletion requests for this community.</p>
      ) : (
        <div className="account-deletion-list">
          {requests.map((request) => (
            <article className="account-deletion-card" key={request.requestId}>
              <div>
                <h2>
                  {request.sourceApp === 'admin_assisted'
                    ? 'Assisted deletion request'
                    : 'Resident deletion request'}
                </h2>
                <p>
                  {request.residentProfileStatus === 'verified' ||
                  request.residentProfileStatus === 'retained_after_deletion'
                    ? request.resident?.displayName || 'Name not provided'
                    : 'Identity verification required'}
                </p>
                <p>Unit / apartment: {request.resident?.unit || 'Not provided'}</p>
                <p>Community: {request.communityName || request.communityId || 'Not provided'}</p>
                {request.resident?.residentType && (
                  <p>Resident role: {residentRoleLabel(request.resident.residentType)}</p>
                )}
                <AssistedDetails request={request} />
                <dl>
                  <div>
                    <dt>Current deletion status</dt>
                    <dd>{deletionStatusLabel(request.status)}</dd>
                  </div>
                  {Boolean(request.completedAt) && (
                    <div>
                      <dt>Deletion completion date and time</dt>
                      <dd>{dateLabel(request.completedAt)}</dd>
                    </div>
                  )}
                  {Boolean(request.resident?.phoneNumber) && (
                    <div>
                      <dt>Phone</dt>
                      <dd>{request.resident?.phoneNumber}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Request date and time</dt>
                    <dd>{dateLabel(request.createdAt)}</dd>
                  </div>
                  {request.status !== 'completed' && (
                    <div>
                      <dt>Review queue status</dt>
                      <dd>{request.reviewStatus || 'Unknown'}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Outstanding dues / settlement</dt>
                    <dd>{financialLabel(request)}</dd>
                  </div>
                  {(request.financialReviewRequired ||
                    request.financialReviewStatus !== 'NOT_REQUIRED') && (
                    <div>
                      <dt>Financial verification status</dt>
                      <dd>
                        {financialVerificationLabel(
                          request.financialReviewStatus,
                          request.status === 'completed',
                        )}
                      </dd>
                    </div>
                  )}
                  {request.status !== 'completed' && (
                    <div>
                      <dt>Review due</dt>
                      <dd>{dateLabel(request.reviewDueAt)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Previous Admin finding</dt>
                    <dd>{request.reviewFinding || 'None recorded'}</dd>
                  </div>
                  <div>
                    <dt>Previous review note</dt>
                    <dd>{request.reviewNote || 'None recorded'}</dd>
                  </div>
                  <div>
                    <dt>Previous review timestamp</dt>
                    <dd>{dateLabel(request.reviewedAt)}</dd>
                  </div>
                </dl>
                {request.unresolvedDependencies?.map((dependency) => (
                  <p className="muted" key={dependency}>
                    Unresolved dependency: {dependency}
                  </p>
                ))}
              </div>
              <div className="account-deletion-actions">
                {canVerifyAssisted(request, communityId) && (
                  <button
                    className="primary"
                    disabled={saving || Boolean(reassessingId)}
                    onClick={() => setAssisted(request)}
                  >
                    Verify identity and consent
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => {
                    setReviewing(false);
                    setSelected(request);
                  }}
                >
                  Open details
                </button>
                {canVerifyHandover(request) && (
                  <button
                    className="primary"
                    onClick={() => {
                      setActionError('');
                      setReviewing(true);
                      setSelected(request);
                      setNote('');
                    }}
                  >
                    Verify financial handover
                  </button>
                )}
                {canReassess(request) && (
                  <button
                    className="secondary"
                    onClick={() => void reassess(request)}
                    disabled={Boolean(reassessingId) || saving}
                  >
                    {reassessingId === request.requestId ? 'Rechecking…' : 'Recheck deletion'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {assisted && session && (
        <AssistedDeletionDialog
          session={session}
          request={assisted === 'intake' ? undefined : assisted}
          onClose={() => setAssisted(null)}
          onSuccess={(message) => {
            setAssisted(null);
            setSuccess(message);
            void refresh();
          }}
        />
      )}
      {selected && (
        <div className="account-deletion-overlay" role="presentation">
          <section
            className="account-deletion-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deletion-review-title"
          >
            <h2 id="deletion-review-title">
              {reviewing ? 'Record review finding' : 'Request details'}
            </h2>
            <p>
              <strong>Request ID:</strong> {selected.requestId}
            </p>
            <p>
              <strong>Request date:</strong> {dateLabel(selected.createdAt)}
            </p>
            <p>
              <strong>Resident:</strong>{' '}
              {selected.residentProfileStatus === 'verified' ||
              selected.residentProfileStatus === 'retained_after_deletion'
                ? selected.resident?.displayName || 'Name not provided'
                : 'Identity verification required'}
            </p>
            {Boolean(selected.resident?.phoneNumber) && (
              <p>
                <strong>Phone:</strong> {selected.resident?.phoneNumber}
              </p>
            )}
            <p>
              <strong>Unit / apartment:</strong> {selected.resident?.unit || 'Not provided'}
            </p>
            <p>
              <strong>Community:</strong>{' '}
              {selected.communityName || selected.communityId || 'Not provided'}
            </p>
            {selected.resident?.residentType && (
              <p>
                <strong>Resident role:</strong> {residentRoleLabel(selected.resident.residentType)}
              </p>
            )}
            <p>
              <strong>Current deletion status:</strong> {deletionStatusLabel(selected.status)}
            </p>
            {Boolean(selected.completedAt) && (
              <p>
                <strong>Deletion completion date and time:</strong>{' '}
                {dateLabel(selected.completedAt)}
              </p>
            )}
            <p>
              <strong>Request date and time:</strong> {dateLabel(selected.createdAt)}
            </p>
            {selected.status !== 'completed' && (
              <p>
                <strong>Review queue status:</strong> {selected.reviewStatus || 'Unknown'}
              </p>
            )}
            <p>
              <strong>Outstanding dues / settlement:</strong> {financialLabel(selected)}
            </p>
            {(selected.financialReviewRequired ||
              selected.financialReviewStatus !== 'NOT_REQUIRED') && (
              <p>
                <strong>Financial verification status:</strong>{' '}
                {financialVerificationLabel(
                  selected.financialReviewStatus,
                  selected.status === 'completed',
                )}
              </p>
            )}
            <p>
              <strong>Previous Admin finding:</strong> {selected.reviewFinding || 'None recorded'}
            </p>
            <p>
              <strong>Previous review note:</strong> {selected.reviewNote || 'None recorded'}
            </p>
            <p>
              <strong>Previous review timestamp:</strong> {dateLabel(selected.reviewedAt)}
            </p>
            <p>
              <strong>Unresolved dependencies:</strong>{' '}
              {selected.unresolvedDependencies?.length
                ? selected.unresolvedDependencies.join(' · ')
                : 'None returned'}
            </p>
            <AssistedDetails request={selected} />
            {reviewing && (
              <>
                <label>Financial handover note</label>
                {canVerifyHandover(selected) && (
                  <p>
                    <strong>Zero dues confirmed.</strong> Verification is tied to the current
                    financial records; any change requires a refreshed review.
                  </p>
                )}
                {selected.financialEvidence?.outstandingMinor !== undefined &&
                  selected.financialEvidence.outstandingMinor > 0 && (
                    <p>
                      <strong>Outstanding dues:</strong> settle them before financial verification.
                      This review cannot reject or cancel deletion.
                    </p>
                  )}
                <label>
                  Financial handover note (at least 10 characters)
                  <textarea
                    value={note}
                    disabled={saving}
                    onChange={(event) => setNote(event.target.value)}
                    rows={4}
                  />
                </label>
                {actionError && <p role="alert">{actionError}</p>}
              </>
            )}
            <div className="account-deletion-actions">
              <button className="secondary" onClick={() => setSelected(null)} disabled={saving}>
                Close
              </button>
              {reviewing && (
                <button
                  className="primary"
                  onClick={() => void saveFinding()}
                  disabled={saving || note.trim().length < 10 || !canVerifyHandover(selected)}
                >
                  {saving ? 'Verifying...' : 'Verify handover'}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
