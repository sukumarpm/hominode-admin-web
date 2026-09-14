import { useEffect, useState } from 'react';
import { Phone, ShieldAlert, RefreshCw } from 'lucide-react';
import { useAuth } from './session';
import { useRows } from './data';
import { call } from './firebase';
import { currentAuthority } from './actions';
import { type Session, dateLabel, str } from './models';
import { Card, State, Pill, Modal } from './components';
interface SosContext {
  communityId: string;
  residentUid: string;
  activeAlertId?: string;
  securityPhone?: string;
  emergencyPhone?: string;
}
export function SosPage() {
  const { session } = useAuth();
  return session ? <SosContent key={session.uid + session.community?.id} s={session} /> : null;
}
function SosContent({ s }: { s: Session }) {
  const resource = useRows(s, 'sos');
  const [context, setContext] = useState<SosContext | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [refresh, setRefresh] = useState(0),
    [note, setNote] = useState('');
  const resident = s.role === 'resident';
  useEffect(() => {
    let active = true;
    if (!resident) return;
    setContext(null);
    setError('');
    void call<SosContext>('getSosContext')
      .then((c) => {
        if (c.communityId !== s.community?.id || c.residentUid !== s.uid)
          throw Error('Emergency community could not be verified.');
        if (active) setContext(c);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Emergency context is unavailable.');
      });
    return () => {
      active = false;
    };
  }, [resident, s.community?.id, s.uid, refresh]);
  async function trigger() {
    setBusy(true);
    setError('');
    const key = 'hominode_sos_request_' + s.uid;
    let requestId = sessionStorage.getItem(key);
    if (!requestId) {
      requestId = crypto.randomUUID().replaceAll('-', '');
      sessionStorage.setItem(key, requestId);
    }
    try {
      await currentAuthority(s);
      const result = await call<{ alertId: string }>('triggerSos', { requestId });
      if (!result.alertId)
        throw Error('Alert could not be confirmed. Retry with the same request or call Security.');
      setConfirm(false);
      sessionStorage.removeItem(key);
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Your alert was not confirmed. Retry or call Security.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function transition(alertId: string, action: string) {
    setBusy(true);
    setError('');
    try {
      await currentAuthority(s);
      await call('transitionSos', {
        communityId: s.community!.id,
        alertId,
        action,
        ...(action === 'resolve' ? { resolutionNote: note.trim() } : {}),
      });
      setNote('');
      setRefresh((x) => x + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Emergency action could not be confirmed.');
    } finally {
      setBusy(false);
    }
  }
  const activeAlerts = resource.rows.filter((r) =>
    ['triggered', 'acknowledged', 'responding'].includes(str(r.data.status)),
  );
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Community safety</p>
          <h1>Emergency SOS</h1>
          <p>
            {resident
              ? 'Reach your community’s emergency response team.'
              : 'Monitor and respond to community emergencies.'}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh emergency context"
          onClick={() => setRefresh((x) => x + 1)}
        >
          <RefreshCw />
        </button>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {resident && (
        <Card className="sos-intro">
          <ShieldAlert size={40} />
          <h2>Need urgent assistance?</h2>
          <p>
            Your alert will be sent to your community’s responders. Keep this page open for updates.
          </p>
          <button
            className="danger"
            disabled={busy || !context || !!activeAlerts.length || !!context.activeAlertId}
            onClick={() => setConfirm(true)}
          >
            Request emergency assistance
          </button>
          <div className="emergency-phones">
            {(
              [
                ['Call Security', context?.securityPhone],
                ['Emergency phone', context?.emergencyPhone],
              ] as const
            ).map(([label, phone]) =>
              phone && /^[+0-9][0-9 ()-]{2,30}$/.test(phone) ? (
                <a key={label} href={'tel:' + phone.replace(/[ ()-]/g, '')}>
                  <Phone size={18} />
                  {label}: {phone}
                </a>
              ) : null,
            )}
          </div>
        </Card>
      )}
      <Card title="Emergency Alerts">
        <State resource={resource} empty="No emergency alerts.">
          <div className="sos-list">
            {resource.rows.map((row) => (
              <article key={row.id}>
                <header>
                  <ShieldAlert />
                  <div>
                    <h3>{str(row.data.residentName) || 'Emergency assistance'}</h3>
                    <p>{str(row.data.unitLabel) || str(row.data.flatLabel)}</p>
                  </div>
                  <Pill value={str(row.data.status)} />
                </header>
                <p>Triggered {dateLabel(row.data.triggeredAt)}</p>
                {str(row.data.resolutionNote) && <p>{str(row.data.resolutionNote)}</p>}
                <div className="button-row">
                  {resident && row.data.status === 'triggered' && (
                    <button disabled={busy} onClick={() => void transition(row.id, 'cancel')}>
                      Cancel alert
                    </button>
                  )}
                  {!resident && row.data.status === 'triggered' && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void transition(row.id, 'acknowledge')}
                    >
                      Acknowledge
                    </button>
                  )}
                  {!resident && row.data.status === 'acknowledged' && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void transition(row.id, 'respond')}
                    >
                      Mark responding
                    </button>
                  )}
                </div>
                {!resident && ['acknowledged', 'responding'].includes(str(row.data.status)) && (
                  <div>
                    <label>
                      Resolution note
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={500}
                      />
                    </label>
                    <button
                      disabled={busy || !note.trim()}
                      onClick={() => void transition(row.id, 'resolve')}
                    >
                      Resolve emergency
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </State>
      </Card>
      {confirm && (
        <Modal
          title="Send an emergency alert?"
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>This sends an SOS to your community’s responders for your registered home.</p>
          <button className="danger" disabled={busy} onClick={() => void trigger()}>
            {busy ? 'Sending…' : 'Send SOS now'}
          </button>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </>
  );
}
