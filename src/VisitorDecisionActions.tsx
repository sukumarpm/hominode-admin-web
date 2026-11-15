import { useEffect, useRef, useState } from 'react';
import type { Row, Session } from './models';
import {
  authorizationLabel,
  visitorDecisionActions,
  type VisitorDecision,
  visitorTime,
  visitorPhysicalLabel,
} from './visitorPolicy';
import {
  decideVisitor, visitorError, loadVisitorDecisionContext, watchVisitorDecisionContext,
} from './visitorPolicyService';

export function VisitorDecisionActions({
  session,
  row,
  onSaved = () => {},
  decide = decideVisitor,
  loadContext = loadVisitorDecisionContext,
  watchContext = watchVisitorDecisionContext,
}: {
  session: Session;
  row: Row;
  onSaved?: () => void;
  decide?: typeof decideVisitor;
  loadContext?: typeof loadVisitorDecisionContext;
  watchContext?: typeof watchVisitorDecisionContext;
}) {
  const [confirm, setConfirm] = useState<'approve' | 'reject' | 'reapprove' | 'revoke' | null>(null);
  const [context, setContext] = useState<Awaited<ReturnType<typeof loadContext>> | null>(null);
  const authorized = session.role === 'admin' && row.data.communityId === session.community?.id;
  const needsContext = authorized && visitorDecisionActions(row.data).includes('revoke');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [stale, setStale] = useState(false);
  const lock = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setConfirm(null);
    setStale(false);
    setMessage('');
  }, [row.id, row.data.authorizationRevision, row.data.status]);
  useEffect(() => {
    setContext(null);
    if (!needsContext) return;
    let active = true, generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const ticket = ++generation;
      clearTimeout(timer);
      setContext(null);
      void loadContext(session, row).then(value => {
        if (!active || ticket !== generation) return;
        setContext(value);
        const { config } = value;
        const deadlines = [config.pendingSchedule?.effectiveAt,
          config.policy.emergency?.startAt, config.policy.emergency?.endAt]
          .filter((at): at is number => at != null && at > config.serverTime);
        if (deadlines.length)
          timer = setTimeout(refresh, Math.min(Math.min(...deadlines) - config.serverTime, 2147483647));
      }).catch(error => {
        if (active && ticket === generation) setMessage(visitorError(error));
      });
    };
    refresh();
    const failed = (error: Error) => {
      ++generation;
      clearTimeout(timer);
      setContext(null);
      setMessage(visitorError(error));
    };
    let stop = () => {};
    try { stop = watchContext(session, row, refresh, failed); } catch (e) { failed(e as Error); }
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      clearTimeout(timer);
      stop();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [session, row, needsContext, loadContext, watchContext]);
  async function submit() {
    if (!confirm || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const action: VisitorDecision = confirm === 'reapprove' ? 'approve' : confirm;
      await decide(session, row, action);
      if (mounted.current) {
        setMessage('Decision confirmed by the server.');
        setStale(true);
        setConfirm(null);
        onSaved();
      }
    } catch (error) {
      if (mounted.current) {
        setMessage(visitorError(error));
        setConfirm(null);
        setStale(true);
        onSaved();
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const actions = visitorDecisionActions(row.data, context?.config.policy,
    context?.config.serverTime, context?.residentType);
  const labels = { approve: 'Approve', reject: 'Reject', reapprove: 'Reapprove', revoke: 'Revoke' };
  return (
    <section className="visitor-decision" aria-label="Visitor authorization">
      <p>
        <strong>Authorization:</strong> {authorizationLabel(row.data)}
      </p>
      <p>
        <strong>Physical visit:</strong> {visitorPhysicalLabel(row.data)}
      </p>
      <p>
        <strong>Host:</strong> {String(row.data.hostName ?? row.data.residentName ?? 'Resident')} ·{' '}
        {String(row.data.flatLabel ?? row.data.flatId ?? '')}
      </p>
      <p>
        <strong>Expected:</strong> {visitorTime(row.data, session.community?.data.timeZone)}
      </p>
      {message && <p role="status">{message}</p>}
      {authorized && actions.length > 0 && !stale && (
        <>
          {confirm ? (
            <div role="group" aria-label="Confirm visitor decision">
              <p>
                {labels[confirm]}{' '}
                {String(row.data.visitorName ?? 'this visitor')}? This records authorization only.
                Security still verifies entry.
              </p>
              <div className="button-row">
                <button className="primary" disabled={busy} onClick={() => void submit()}>
                  {busy ? 'Submitting…' : 'Confirm ' + confirm}
                </button>
                <button disabled={busy} onClick={() => setConfirm(null)}>
                  Cancel decision
                </button>
              </div>
            </div>
          ) : (
            <div className="button-row">
              {actions.map(action => (
                <button key={action} className={action === 'approve' || action === 'reapprove' ? 'primary' : undefined}
                  onClick={() => setConfirm(action)}>{labels[action]} visitor</button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
