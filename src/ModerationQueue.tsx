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
type View = 'summary' | 'history' | 'reports';
type PageInfo = {
  total: number;
  totalCurrent: number;
  nextCursor: string | null;
  pageCursor: string;
  snapshotAtMs: number;
};
type Selection = { view: View; page: number; cursor?: string; search: string; searchField: string };
const initialSelection: Selection = { view: 'summary', page: 0, search: '', searchField: 'action' };
export function ModerationQueue() {
  const { session } = useAuth();
  const communityId = session?.role === 'admin' ? session.community?.id : undefined;
  if (!communityId) return <p>Select an authorized community to review moderation.</p>;
  return <ModerationConsole key={communityId} communityId={communityId} />;
}
function ModerationConsole({ communityId }: { communityId: string }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const [pages, setPages] = useState<{ reports: PageInfo | null; history: PageInfo | null }>({
    reports: null,
    history: null,
  });
  const [searchDraft, setSearchDraft] = useState('');
  const [searchField, setSearchField] = useState('action');
  const cursors = useRef<(string | undefined)[]>([]);
  const request = useRef(0);
  const inFlight = useRef(false);
  const activeCommunity = useRef<string | undefined>(communityId);
  const [decision, setDecision] = useState<{ report: Report; action: 'dismiss' | 'hide' } | null>(
    null,
  );
  const [reasonCode, setReasonCode] = useState('');
  const [publicExplanation, setPublicExplanation] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const load = useCallback(
    async (next: Selection) => {
      const sequence = ++request.current;
      setSelection(next);
      setLoading(true);
      setQueueLoaded(false);
      setError('');
      try {
        const result = await call<{
          reports: Report[];
          history: History[];
          reportsPage: PageInfo | null;
          historyPage: PageInfo | null;
        }>('listWallModerationReports', {
          communityId,
          view: next.view,
          pageSize: next.view === 'summary' ? 3 : 10,
          ...(next.cursor ? { cursor: next.cursor } : {}),
          ...(next.view === 'history'
            ? { searchField: next.searchField, search: next.search }
            : {}),
        });
        if (request.current === sequence) {
          setQueueLoaded(true);
          setReports(result.reports);
          setHistory(result.history);
          setPages({ reports: result.reportsPage, history: result.historyPage });
          const info = next.view === 'reports' ? result.reportsPage : result.historyPage;
          cursors.current[next.page] = info?.pageCursor;
          cursors.current[next.page + 1] = info?.nextCursor ?? undefined;
        }
      } catch (error) {
        if (request.current === sequence)
          setError(errorMessage(error, 'Moderation queue could not be loaded.'));
      } finally {
        if (request.current === sequence) setLoading(false);
      }
    },
    [communityId],
  );
  const refresh = () => {
    cursors.current = [];
    return load({ ...selection, page: 0, cursor: undefined });
  };
  useEffect(() => {
    activeCommunity.current = communityId;
    void load(initialSelection);
    return () => {
      request.current++;
      activeCommunity.current = undefined;
    };
  }, [communityId, load]);
  function open(view: View) {
    cursors.current = [];
    setSearchDraft('');
    setSearchField('action');
    void load({ ...initialSelection, view });
  }
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
  const { view, page } = selection;
  const pageInfo = view === 'reports' ? pages.reports : pages.history;
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
      {view !== 'summary' && (
        <div className="moderation-toolbar">
          <button
            className="secondary"
            disabled={loading || !!busy}
            onClick={() => open('summary')}
          >
            Back to overview
          </button>
          <h3>{view === 'history' ? 'All moderation history' : 'All open reports'}</h3>
        </div>
      )}
      {view === 'history' && (
        <form
          className="moderation-search"
          onSubmit={(event) => {
            event.preventDefault();
            cursors.current = [];
            void load({ view, page: 0, search: searchDraft.trim(), searchField });
          }}
        >
          <label>
            Search field
            <select value={searchField} onChange={(event) => setSearchField(event.target.value)}>
              <option value="action">Decision action</option>
              <option value="reasonCode">Reason code</option>
              <option value="postId">Post ID</option>
              <option value="reportId">Report ID</option>
            </select>
          </label>
          <label>
            Search history
            <input
              type="search"
              maxLength={128}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              aria-describedby="moderation-search-help"
              placeholder={searchField === 'action' ? 'hide or dismiss' : 'Enter exact value'}
            />
          </label>
          <button className="primary" disabled={loading || !!busy}>
            Search
          </button>
          <button
            type="button"
            className="secondary"
            disabled={loading || !!busy}
            onClick={() => {
              setSearchDraft('');
              cursors.current = [];
              void load({ ...selection, page: 0, cursor: undefined, search: '' });
            }}
          >
            Clear
          </button>
          <p id="moderation-search-help">
            Exact, case-sensitive matches only. Actions: hide or dismiss. Reason codes include spam,
            harassment and no_violation. Content, names and internal notes are not searched.
          </p>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading moderation queue…</p>
      ) : !queueLoaded ? (
        <button onClick={() => void load(selection)}>Retry</button>
      ) : (
        <>
          {view !== 'history' && (
            <>
              <div className="moderation-section-heading">
                <h3>Open reports</h3>
                <span>{pages.reports?.total ?? reports.length} open</span>
                {view === 'summary' && (
                  <button className="secondary" onClick={() => open('reports')} disabled={!!busy}>
                    View all reports
                  </button>
                )}
              </div>
              {reports.length === 0 && <p className="moderation-empty">No open reports.</p>}
              <div className="moderation-grid">
                {reports.map((r) => (
                  <ModerationCard
                    key={r.id}
                    item={r}
                    busy={!!busy}
                    decide={(action) => choose(r, action)}
                  />
                ))}
              </div>
            </>
          )}
          {view !== 'reports' && (
            <>
              <div className="moderation-section-heading">
                <h3>Moderation history</h3>
                <span>
                  {pages.history?.total ?? history.length} decisions
                  {selection.search ? ' matching search' : ''}
                </span>
                {view === 'summary' && (
                  <button className="secondary" onClick={() => open('history')} disabled={!!busy}>
                    View all history
                  </button>
                )}
              </div>
              {history.length === 0 ? (
                <p className="moderation-empty">
                  {selection.search
                    ? 'No decisions match this search.'
                    : 'No moderation actions yet.'}
                </p>
              ) : (
                <div className="moderation-grid">
                  {history.map((h) => (
                    <ModerationCard key={h.id} item={h} history />
                  ))}
                </div>
              )}
            </>
          )}
          {view !== 'summary' && (
            <nav className="moderation-pagination" aria-label="Moderation pagination">
              <button
                className="secondary"
                disabled={page === 0 || !!busy}
                onClick={() =>
                  void load({ ...selection, page: page - 1, cursor: cursors.current[page - 1] })
                }
              >
                Previous
              </button>
              <span>
                Page {page + 1} · {view === 'reports' ? reports.length : history.length} shown ·{' '}
                {pageInfo?.total ?? 0} available
              </span>
              <button
                className="secondary"
                disabled={!pageInfo?.nextCursor || !!busy}
                onClick={() =>
                  void load({
                    ...selection,
                    page: page + 1,
                    cursor: pageInfo?.nextCursor ?? undefined,
                  })
                }
              >
                Next
              </button>
            </nav>
          )}
          {view !== 'summary' && (
            <p className="moderation-meta">
              Newest first. New records appear after Refresh. Open report availability may change as
              other Admins work.
            </p>
          )}
          {[pages.reports, pages.history].some(
            (info) => info && info.totalCurrent > info.total,
          ) && (
            <p role="status">
              Newer or undated records are outside this dated view. Refresh to include new records.
              Earlier undated records remain available in the legacy Admin client.
            </p>
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
