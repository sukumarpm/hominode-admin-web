import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './firebase';
import { useAuth } from './session';
import { Modal } from './components';

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? `${fallback} ${error.message}` : fallback;

type Report = {
  id: string;
  postId?: string;
  targetType?: string;
  contentSnapshot?: string;
  reason?: string;
  status?: string;
  authorName?: string;
  createdAtMs?: number | null;
};
type History = Report & {
  reportId?: string;
  action: string;
  actorName?: string;
  publicReason?: string;
  internalNote?: string;
  reportReason?: string;
};
const reasons = {
  dismiss: {
    no_violation: 'No community guideline violation',
    insufficient_context: 'Insufficient context',
    duplicate_report: 'Duplicate report',
    resolved: 'Issue already resolved',
  },
  hide: {
    inappropriate_content: 'Inappropriate content',
    harassment: 'Harassment or bullying',
    spam: 'Spam',
    privacy: 'Privacy or personal information',
    other_violation: 'Other community guideline violation',
  },
};
const localDate = (value?: number | null) =>
  value ? new Date(value).toLocaleString() : 'Date unavailable';
function ModerationCard({
  item,
  history = false,
  busy = false,
  decide,
}: {
  item: Report | History;
  history?: boolean;
  busy?: boolean;
  decide?: (action: 'dismiss' | 'hide') => void;
}) {
  const entry = item as History;
  const status = history ? (entry.action === 'hide' ? 'Hidden' : 'Dismissed') : 'Open';
  return (
    <article className="financial-report-card moderation-card">
      <div className="moderation-card-heading">
        <h4>
          {history
            ? entry.action === 'hide'
              ? 'Content hidden'
              : 'Report dismissed'
            : `Reported ${item.targetType || 'content'}`}
        </h4>
        <span className={`moderation-status ${status.toLowerCase()}`}>{status}</span>
      </div>
      <p className="moderation-meta">
        Author: {item.authorName || 'Resident'} · {item.targetType || 'Content'} ·{' '}
        {localDate(item.createdAtMs)}
      </p>
      <blockquote>{item.contentSnapshot || 'Content preview unavailable'}</blockquote>
      <p>
        <strong>Report reason:</strong>{' '}
        {history ? entry.reportReason || 'Not recorded' : item.reason || 'Not recorded'}
      </p>
      {history ? (
        <>
          <p>
            <strong>Public decision reason:</strong>{' '}
            {entry.publicReason || 'Reason not recorded for this earlier decision.'}
          </p>
          <p className="moderation-meta">
            Moderator: {entry.actorName || 'Community Admin'} · {localDate(entry.createdAtMs)}
          </p>
          {entry.internalNote && (
            <details>
              <summary>Internal note · Admin only</summary>
              <p>{entry.internalNote}</p>
            </details>
          )}
        </>
      ) : (
        <div className="financial-report-actions">
          <button className="secondary" disabled={busy} onClick={() => decide?.('dismiss')}>
            Dismiss report
          </button>
          <button className="primary" disabled={busy} onClick={() => decide?.('hide')}>
            Hide content
          </button>
        </div>
      )}
    </article>
  );
}
export function ModerationQueue() {
  const { session } = useAuth();
  const communityId = session?.role === 'admin' ? session.community?.id : undefined;
  const [reports, setReports] = useState<Report[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [truncated, setTruncated] = useState({ reports: false, history: false });
  const [historyOffset, setHistoryOffset] = useState(0);
  const request = useRef(0);
  const inFlight = useRef(false);
  const activeCommunity = useRef(communityId);
  activeCommunity.current = communityId;
  const [decision, setDecision] = useState<{ report: Report; action: 'dismiss' | 'hide' } | null>(
    null,
  );
  const [reasonCode, setReasonCode] = useState('');
  const [publicExplanation, setPublicExplanation] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const invalidateRequests = useCallback(() => {
    request.current++;
  }, []);
  const refresh = useCallback(async () => {
    if (!communityId) return;
    const sequence = ++request.current;
    setLoading(true);
    setQueueLoaded(false);
    setError('');
    try {
      const result = await call<{
        reports: Report[];
        history: History[];
        reportsTruncated?: boolean;
        historyTruncated?: boolean;
      }>('listWallModerationReports', { communityId });
      if (request.current === sequence) {
        setQueueLoaded(true);
        setReports(result.reports);
        setHistory(result.history);
        setHistoryOffset(result.history.length);
        setTruncated({
          reports: result.reportsTruncated === true,
          history: result.historyTruncated === true,
        });
      }
    } catch (error) {
      if (request.current === sequence)
        setError(errorMessage(error, 'Moderation queue could not be loaded.'));
    } finally {
      if (request.current === sequence) setLoading(false);
    }
  }, [communityId]);
  useEffect(() => {
    activeCommunity.current = communityId;
    setReports([]);
    setHistory([]);
    setBusy('');
    setDecision(null);
    void refresh();
    return () => {
      invalidateRequests();
      activeCommunity.current = undefined;
    };
  }, [refresh, invalidateRequests, communityId]);
  function choose(report: Report, action: 'dismiss' | 'hide') {
    if (busy || inFlight.current) return;
    setReasonCode('');
    setPublicExplanation('');
    setInternalNote('');
    setDecisionError('');
    setDecision({ report, action });
  }
  async function resolve() {
    if (!communityId || !decision || inFlight.current) return;
    if (!reasonCode) {
      setDecisionError('Select a public decision reason.');
      return;
    }
    inFlight.current = true;
    setBusy(decision.report.id);
    setDecisionError('');
    try {
      const result = await call<{ success?: boolean }>('resolveWallModerationReport', {
        communityId,
        reportId: decision.report.id,
        action: decision.action,
        reasonCode,
        publicExplanation: publicExplanation.trim(),
        internalNote: internalNote.trim(),
      });
      if (activeCommunity.current !== communityId) return;
      if (result.success !== true) throw Error('Decision was not confirmed.');
      setDecision(null);
      await refresh();
    } catch (error) {
      if (activeCommunity.current === communityId)
        setDecisionError(
          errorMessage(error, 'Moderation decision could not be saved. Please retry.'),
        );
    } finally {
      inFlight.current = false;
      if (activeCommunity.current === communityId) setBusy('');
    }
  }
  async function loadMoreHistory() {
    if (!communityId || busy) return;
    const sequence = request.current;
    setBusy('history');
    setError('');
    try {
      const result = await call<{ history: History[]; historyTruncated?: boolean }>(
        'listWallModerationReports',
        { communityId, historyOffset },
      );
      if (request.current === sequence) {
        setHistory((previous) => [...previous, ...result.history]);
        setHistoryOffset((previous) => previous + result.history.length);
        setTruncated((previous) => ({ ...previous, history: result.historyTruncated === true }));
      }
    } catch (error) {
      if (request.current === sequence)
        setError(errorMessage(error, 'Moderation history could not be loaded.'));
    } finally {
      if (request.current === sequence) setBusy('');
    }
  }
  if (!communityId) return <p>Select an authorized community to review moderation.</p>;
  return (
    <section className="financial-report moderation-console" aria-labelledby="moderation-title">
      <header className="financial-report-header">
        <div>
          <h2 id="moderation-title">Content moderation</h2>
          <p>Review reported content and keep a clear record of community decisions.</p>
        </div>
        <button className="secondary" onClick={() => void refresh()} disabled={loading || !!busy}>
          Refresh
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading moderation queue…</p>
      ) : !queueLoaded ? (
        <button onClick={() => void refresh()}>Retry</button>
      ) : (
        <>
          <div className="moderation-section-heading">
            <h3>Open reports</h3>
            <span>{reports.length} open</span>
          </div>
          {truncated.reports && (
            <p>Showing the first 500 open reports. Resolve reports and refresh to see more.</p>
          )}
          {reports.length === 0 && <p className="moderation-empty">No open reports.</p>}
          <div className="moderation-grid">
            {reports
              .filter((r) => r.status === 'open')
              .map((r) => (
                <ModerationCard
                  key={r.id}
                  item={r}
                  busy={!!busy}
                  decide={(action) => choose(r, action)}
                />
              ))}
          </div>
          <div className="moderation-section-heading">
            <h3>Moderation history</h3>
            <span>{history.length} decisions</span>
          </div>
          {history.length === 0 ? (
            <p className="moderation-empty">No moderation actions yet.</p>
          ) : (
            <div className="moderation-grid">
              {history.map((h) => (
                <ModerationCard key={h.id} item={h} history />
              ))}
            </div>
          )}
          {truncated.history && (
            <button className="secondary" disabled={!!busy} onClick={() => void loadMoreHistory()}>
              Load more history
            </button>
          )}
        </>
      )}
      {decision && (
        <Modal
          dismissible={!busy}
          title={decision.action === 'hide' ? 'Hide content' : 'Dismiss report'}
          onClose={() => {
            if (!inFlight.current) setDecision(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void resolve();
            }}
          >
            <fieldset disabled={!!busy}>
              <p>
                This public reason is shared with the resident. Do not include the reporter’s
                identity.
              </p>
              <label>
                Public decision reason
                <select
                  value={reasonCode}
                  required
                  onChange={(event) => setReasonCode(event.target.value)}
                >
                  <option value="">Select a reason</option>
                  {Object.entries(reasons[decision.action]).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Public explanation (optional)
                <textarea
                  maxLength={300}
                  value={publicExplanation}
                  onChange={(event) => setPublicExplanation(event.target.value)}
                />
              </label>
              <label>
                Internal note (Admin only, optional)
                <textarea
                  maxLength={1000}
                  value={internalNote}
                  onChange={(event) => setInternalNote(event.target.value)}
                />
              </label>
              <p>Internal notes are never included in resident notifications.</p>
              {decisionError && <p role="alert">{decisionError}</p>}
              <div className="button-row">
                <button type="button" onClick={() => setDecision(null)}>
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={!reasonCode || !!busy}>
                  {busy ? 'Saving decision…' : 'Confirm decision'}
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
    </section>
  );
}
