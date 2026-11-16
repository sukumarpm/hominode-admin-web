import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from './models';
import { Card } from './components';
import {
  approvalDescriptions,
  approvalOptions,
  futureSchedule,
  localSchedule,
  periodStatus,
  policyInput,
  schedulePeriod,
  visitorTimeZoneError,
  type ApprovalMode,
  type PetMode,
  type VisitorPolicyInput,
  type VisitorPolicyResponse,
} from './visitorPolicy';
import {
  loadVisitorPolicy,
  saveVisitorPolicy,
  visitorError,
  watchVisitorPolicy,
  visitorPolicyRequest,
  visitorPolicySaveTimeoutMs,
} from './visitorPolicyService';
import './visitorPolicy.css';

interface Props {
  session: Session;
  load?: typeof loadVisitorPolicy;
  save?: typeof saveVisitorPolicy;
  watch?: typeof watchVisitorPolicy;
}
export function VisitorPolicySettings(props: Props) {
  if (props.session.role !== 'admin' || !props.session.community) return null;
  return <PolicyEditor key={props.session.uid + ':' + props.session.community.id} {...props} />;
}
function PolicyEditor({
  session,
  load = loadVisitorPolicy,
  save = saveVisitorPolicy,
  watch = watchVisitorPolicy,
}: Props) {
  const [config, setConfig] = useState<VisitorPolicyResponse | null>(null);
  const [draft, setDraft] = useState<VisitorPolicyInput | null>(null);
  const [emergency, setEmergency] = useState(false),
    [emStart, setEmStart] = useState(''),
    [emEnd, setEmEnd] = useState('');
  const [petStart, setPetStart] = useState(''),
    [petEnd, setPetEnd] = useState('');
  const [scheduled, setScheduled] = useState(false),
    [effectiveTime, setEffectiveTime] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [conflict, setConflict] = useState(false);
  const mounted = useRef(true),
    dirty = useRef(false),
    locked = useRef(false),
    fetching = useRef(false),
    refreshQueued = useRef(false),
    generation = useRef(0),
    latest = useRef<VisitorPolicyResponse | null>(null),
    receivedAt = useRef(0),
    refreshRef = useRef(() => {}),
    recoveryRequired = useRef(false),
    requests = useRef(new Set<AbortController>());
  useEffect(() => {
    mounted.current = true;
    const pending = requests.current;
    return () => {
      mounted.current = false;
      pending.forEach(controller => controller.abort());
      pending.clear();
    };
  }, []);
  const read = useCallback(() => {
    const controller = new AbortController();
    requests.current.add(controller);
    return visitorPolicyRequest(signal => load(session, signal), { signal: controller.signal })
      .finally(() => requests.current.delete(controller));
  }, [session, load]);
  const record = useCallback(
    (value: VisitorPolicyResponse) => {
      if (value.communityId !== session.community?.id)
        throw Error('Policy is outside your community.');
      latest.current = value;
      receivedAt.current = performance.now();
      setConfig(value);
    },
    [session.community?.id],
  );
  const apply = useCallback(
    (value: VisitorPolicyResponse) => {
      record(value);
      const input = {
        ...policyInput(value.pendingSchedule?.policy ?? value.policy),
        timeZone: value.timeZone,
      };
      setDraft(input);
      setScheduled(value.pendingSchedule != null);
      setEffectiveTime(localSchedule(value.pendingSchedule?.effectiveAt, value.timeZone));
      setEmergency(input.emergency != null);
      setEmStart(localSchedule(input.emergency?.startAt, input.timeZone));
      setEmEnd(localSchedule(input.emergency?.endAt, input.timeZone));
      setPetStart(localSchedule(input.pets.restriction?.startAt, input.timeZone));
      setPetEnd(localSchedule(input.pets.restriction?.endAt, input.timeZone));
      dirty.current = false;
      recoveryRequired.current = false;
      setConflict(false);
    },
    [record],
  );
  const reload = useCallback(async () => {
    // Community snapshots can replace the Session while its own write is in
    // flight. Queue that refresh without invalidating the active Save ticket.
    if (locked.current) { refreshQueued.current = true; return; }
    const ticket = ++generation.current;
    fetching.current = true;
    setLoading(true);
    try {
      const value = await read();
      if (mounted.current && ticket === generation.current) {
        apply(value);
        setMessage('');
      }
    } catch (error) {
      if (mounted.current && ticket === generation.current) setMessage(visitorError(error));
    } finally {
      if (mounted.current && ticket === generation.current) {
        fetching.current = false;
        setLoading(false);
        if (refreshQueued.current) {
          refreshQueued.current = false;
          refreshRef.current();
        }
      }
    }
  }, [read, apply]);
  useEffect(() => {
    if (!recoveryRequired.current) void reload();
    const refresh = () => {
      // An uncertain write or a confirmed write with a failed reload needs an
      // explicit read, never an automatic resubmission or silent reset.
      if (recoveryRequired.current) return;
      if (locked.current || fetching.current) {
        refreshQueued.current = true;
        return;
      }
      if (dirty.current) {
        const ticket = ++generation.current;
        void read()
          .then((value) => {
            if (!mounted.current || ticket !== generation.current) return;
            if (value.communityId !== session.community?.id)
              throw Error('Policy is outside your community.');
            if (
              value.writeRevision !== latest.current?.writeRevision ||
              value.policy.revision !== latest.current?.policy.revision ||
              value.timeZone !== latest.current?.timeZone ||
              value.pendingSchedule?.effectiveAt !== latest.current?.pendingSchedule?.effectiveAt
            ) {
              setConflict(true);
              setMessage('Policy changed on another device. Reload before saving.');
            }
            record(value);
          })
          .catch((error) => {
            if (mounted.current && ticket === generation.current) {
              setMessage(visitorError(error));
              setConflict(true);
            }
          });
      } else void reload();
    };
    refreshRef.current = refresh;
    let stop = () => {};
    try {
      stop = watch(session, refresh, (error) => {
        if (mounted.current)
          setMessage('Live updates unavailable. Reload to refresh. ' + visitorError(error));
      });
    } catch {
      setMessage('Live updates unavailable. Use Reload policy to refresh.');
    }
    window.addEventListener('focus', refresh);
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      stop();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [reload, session, watch, read, record]);
  useEffect(() => {
    if (!config?.pendingSchedule) return;
    const serverNow = config.serverTime + Math.max(0, performance.now() - receivedAt.current);
    const delay = Math.max(0, config.pendingSchedule.effectiveAt - serverNow);
    const timer = window.setTimeout(() => refreshRef.current(), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [config]);
  function edit(next: VisitorPolicyInput) {
    dirty.current = true;
    setDraft(next);
    if (!recoveryRequired.current) setMessage('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      locked.current ||
      !draft ||
      !config ||
      conflict ||
      (draft.enabled && !config.rolloutReady) ||
      visitorTimeZoneError(config.timeZone)
    )
      return;
    const ticket = ++generation.current;
    let controller: AbortController | undefined;
    try {
      const serverNow = config.serverTime + Math.max(0, performance.now() - receivedAt.current);
      const effectiveAt = scheduled
        ? futureSchedule(
            effectiveTime,
            config.timeZone,
            serverNow,
            config.pendingSchedule?.effectiveAt,
          )
        : undefined;
      const input = {
        ...policyInput(draft),
        emergency: emergency ? schedulePeriod(emStart, emEnd, draft.timeZone) : null,
        pets: {
          ...draft.pets,
          restriction:
            draft.pets.mode === 'temporarily_restricted'
              ? schedulePeriod(petStart, petEnd, draft.timeZone)
              : null,
        },
      };
      locked.current = true;
      setBusy(true);
      setMessage('');
      controller = new AbortController();
      requests.current.add(controller);
      const value = await visitorPolicyRequest(
        signal => save(session, input, config.writeRevision, effectiveAt, signal),
        { signal: controller.signal, timeoutMs: visitorPolicySaveTimeoutMs,
          timeoutMessage: 'The save result could not be confirmed. The policy may have been saved. Use Reload policy before saving again; do not resubmit the save.' },
      );
      if (mounted.current && ticket === generation.current) {
        apply(value);
        setMessage(
          value.pendingSchedule
            ? `Visitor settings saved and reloaded. ${value.pendingSchedule.policy.enabled ? 'Enforcement' : 'Enforcement deactivation'} scheduled for ${localSchedule(value.pendingSchedule.effectiveAt, value.timeZone).replace('T', ' ')} (${value.timeZone}).`
            : `Visitor settings saved and reloaded. Enforcement is ${value.policy.enabled ? 'active' : 'off'}.`,
        );
      }
    } catch (error) {
      if (mounted.current && ticket === generation.current) {
        setMessage(visitorError(error));
        if (controller) {
          recoveryRequired.current = true;
          setConflict(true);
        }
      }
    } finally {
      if (controller) {
        controller.abort();
        requests.current.delete(controller);
      }
      locked.current = false;
      // Read generations must never prevent the Save control from unlocking.
      if (mounted.current) {
        setBusy(false);
        if (refreshQueued.current) {
          refreshQueued.current = false;
          if (!recoveryRequired.current) refreshRef.current();
        }
      }
    }
  }
  const zoneError = config ? visitorTimeZoneError(config.timeZone) : null;
  const blocked = busy || (draft?.enabled === true && !config?.rolloutReady) || zoneError != null;
  return (
    <Card title="Visitor Approval Settings">
      <div className="visitor-policy" aria-busy={loading || busy}>
        <p>Save applies the selected ON/OFF state immediately or at the scheduled community time.</p>
        <button type="button" disabled={busy || loading} onClick={() => void reload()}>
          Reload policy
        </button>
        {message && <p role="status">{message}</p>}
        {loading ? (
          <p role="status">Loading visitor policy…</p>
        ) : (
          draft &&
          config && (
            <form onSubmit={(event) => void submit(event)}>
              <p>
                Community time zone: <strong>{config.timeZone || 'Not configured'}</strong>. Status
                as of server time:{' '}
                {localSchedule(config.serverTime, config.timeZone).replace('T', ' ')}.
              </p>
              {!config.rolloutReady && (
                <p role="alert">
                  Enabling is blocked until visitor policy rollout is ready for this community. Disabling is allowed.
                </p>
              )}
              {zoneError && <p role="alert">{zoneError}</p>}
              <label>
                <input type="checkbox" aria-label="Visitor-policy enforcement"
                  checked={draft.enabled} disabled={busy}
                  onChange={(event) => edit({...draft, enabled: event.target.checked})} />
                Visitor-policy enforcement · {draft.enabled ? 'ON' : 'OFF'}
              </label>
              <section className="visitor-policy-summary" aria-label="Current effective policy">
                <h3>Current effective policy</h3>
                <PolicySummary
                  policy={config.policy}
                  zone={config.timeZone}
                  serverTime={config.serverTime}
                />
              </section>
              {config.pendingSchedule && (
                <section className="visitor-policy-summary" aria-label="Scheduled policy">
                  <h3>Scheduled policy</h3>
                  <p>
                    Effective from:{' '}
                    <time dateTime={new Date(config.pendingSchedule.effectiveAt).toISOString()}>
                      {localSchedule(config.pendingSchedule.effectiveAt, config.timeZone).replace(
                        'T',
                        ' ',
                      )}
                    </time>{' '}
                    ({config.timeZone})
                  </p>
                  <PolicySummary
                    policy={config.pendingSchedule.policy}
                    zone={config.timeZone}
                    serverTime={config.serverTime}
                    pending
                  />
                  <p>
                    Saving replaces this pending schedule. Choose Immediately to apply the edited
                    policy now.
                  </p>
                </section>
              )}
              <fieldset disabled={blocked}>
                <legend>Apply changes</legend>
                <label>
                  Apply policy
                  <select
                    value={scheduled ? 'scheduled' : 'immediate'}
                    onChange={(event) => {
                      dirty.current = true;
                      setScheduled(event.target.value === 'scheduled');
                    }}
                  >
                    <option value="immediate">Immediately</option>
                    <option value="scheduled">At a scheduled time</option>
                  </select>
                </label>
                {scheduled && (
                  <>
                    <label>
                      Policy effective time
                      <input
                        type="datetime-local"
                        value={effectiveTime}
                        onChange={(event) => {
                          dirty.current = true;
                          setEffectiveTime(event.target.value);
                        }}
                      />
                    </label>
                    <p>
                      Choose a future date and time in {config.timeZone}. Skipped or repeated
                      daylight-saving times cannot be used.
                    </p>
                  </>
                )}
              </fieldset>
              <fieldset disabled={blocked}>
                <legend>Normal approval policy</legend>
                <label>
                  Approval policy
                  <select
                    value={draft.approvalMode}
                    onChange={(e) =>
                      edit({ ...draft, approvalMode: e.target.value as ApprovalMode })
                    }
                  >
                    {Object.entries(approvalOptions).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <p>{approvalDescriptions[draft.approvalMode]}</p>
              </fieldset>
              <fieldset disabled={blocked}>
                <legend>Temporary emergency approval</legend>
                <p>
                  Owner and tenant invitations not yet checked in are rechecked at entry and may
                  require Admin approval. Visitors already inside are unaffected. After expiry,
                  invitations follow the current normal approval policy. Emergency response and
                  evacuation use existing operational procedures.
                </p>
                <p>
                  Saved override:{' '}
                  <strong>
                    {config.policy.enabled
                      ? periodStatus(config.policy.emergency, config.serverTime)
                      : 'Off'}
                  </strong>
                  .
                </p>
                <label className="visitor-check">
                  <input
                    type="checkbox"
                    checked={emergency}
                    onChange={(e) => {
                      dirty.current = true;
                      setEmergency(e.target.checked);
                    }}
                  />
                  Configure emergency approval period
                </label>
                {emergency && (
                  <div className="visitor-policy-dates">
                    <label>
                      Emergency start
                      <input
                        type="datetime-local"
                        value={emStart}
                        onChange={(e) => {
                          dirty.current = true;
                          setEmStart(e.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Emergency end
                      <input
                        type="datetime-local"
                        value={emEnd}
                        onChange={(e) => {
                          dirty.current = true;
                          setEmEnd(e.target.value);
                        }}
                      />
                    </label>
                  </div>
                )}
                <p>Normal policy after expiry: {approvalOptions[draft.approvalMode]}.</p>
                {config.policy.emergency && (
                  <p>
                    Saved period:{' '}
                    {localSchedule(config.policy.emergency.startAt, draft.timeZone).replace(
                      'T',
                      ' ',
                    )}{' '}
                    →{' '}
                    {localSchedule(config.policy.emergency.endAt, draft.timeZone).replace('T', ' ')}{' '}
                    ({draft.timeZone}). Uncheck the period and save to cancel it.
                  </p>
                )}
              </fieldset>
              <fieldset disabled={blocked}>
                <legend>Pet Entry Policy</legend>
                <label>
                  Pet entry
                  <select
                    value={draft.pets.mode}
                    onChange={(e) => {
                      const mode = e.target.value as PetMode;
                      edit({
                        ...draft,
                        pets: {
                          mode,
                          normalMode:
                            mode === 'temporarily_restricted' ? draft.pets.normalMode : mode,
                          restriction: null,
                        },
                      });
                    }}
                  >
                    <option value="allowed">Pets allowed</option>
                    <option value="not_allowed">Pets not allowed</option>
                    <option value="temporarily_restricted">Temporarily restricted</option>
                  </select>
                </label>
                {draft.pets.mode === 'temporarily_restricted' && (
                  <>
                    <label>
                      Normal pet policy after restriction
                      <select
                        value={draft.pets.normalMode}
                        onChange={(e) =>
                          edit({
                            ...draft,
                            pets: {
                              ...draft.pets,
                              normalMode: e.target.value as 'allowed' | 'not_allowed',
                            },
                          })
                        }
                      >
                        <option value="allowed">Pets allowed</option>
                        <option value="not_allowed">Pets not allowed</option>
                      </select>
                    </label>
                    <div className="visitor-policy-dates">
                      <label>
                        Pet restriction start
                        <input
                          type="datetime-local"
                          value={petStart}
                          onChange={(e) => {
                            dirty.current = true;
                            setPetStart(e.target.value);
                          }}
                        />
                      </label>
                      <label>
                        Pet restriction end
                        <input
                          type="datetime-local"
                          value={petEnd}
                          onChange={(e) => {
                            dirty.current = true;
                            setPetEnd(e.target.value);
                          }}
                        />
                      </label>
                    </div>
                  </>
                )}
                <p>
                  Saved restriction:{' '}
                  {config.policy.enabled
                    ? periodStatus(config.policy.pets.restriction, config.serverTime)
                    : 'Off'}
                  . Restrictions cover the visit’s full arrival ±24-hour credential window and can
                  affect existing declared-pet passes. Missing declarations count as no pet; actual
                  animals require gate enforcement.
                </p>
              </fieldset>
              <button className="primary" type="submit" disabled={blocked || conflict}>
                {busy ? 'Saving…' : 'Save visitor settings'}
              </button>
            </form>
          )
        )}
      </div>
    </Card>
  );
}

function PolicySummary({
  policy,
  zone,
  serverTime,
  pending = false,
}: {
  policy: VisitorPolicyInput;
  zone: string | null;
  serverTime: number;
  pending?: boolean;
}) {
  const period = (value: VisitorPolicyInput['emergency']) => {
    if (!policy.enabled || !value) return 'Off';
    if (visitorTimeZoneError(zone)) return 'Community time zone unavailable';
    return `${localSchedule(value.startAt, zone).replace('T', ' ')} – ${localSchedule(value.endAt, zone).replace('T', ' ')} (${periodStatus(value, serverTime)})`;
  };
  const petLabels = {
    allowed: 'Pets allowed',
    not_allowed: 'Pets not allowed',
    temporarily_restricted: 'Temporarily restricted',
  };
  return (
    <dl>
      <div>
        <dt>Enforcement</dt>
        <dd>{policy.enabled ? (pending ? 'Scheduled' : 'Active') : 'Off'}</dd>
      </div>
      <div>
        <dt>Approval</dt>
        <dd>{approvalOptions[policy.enabled ? policy.approvalMode : 'resident_authorized']}</dd>
      </div>
      <div>
        <dt>Emergency period</dt>
        <dd>{period(policy.emergency)}</dd>
      </div>
      <div>
        <dt>Pets</dt>
        <dd>{policy.enabled ? petLabels[policy.pets.mode] : 'Pets allowed'}</dd>
      </div>
      {policy.enabled && policy.pets.mode === 'temporarily_restricted' && (
        <>
          <div>
            <dt>Pet restriction</dt>
            <dd>{period(policy.pets.restriction)}</dd>
          </div>
          <div>
            <dt>Outside restriction</dt>
            <dd>{petLabels[policy.pets.normalMode]}</dd>
          </div>
        </>
      )}
    </dl>
  );
}
