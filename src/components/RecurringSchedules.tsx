import { useRef, useState } from 'react';
import {
  pauseRecurringBillingScheduleV2,
  resumeRecurringBillingScheduleV2,
  stopRecurringBillingScheduleV2,
  type RecurringLifecycleStatusV2,
} from '../actions';
import { Card, Modal, Pill } from '../components';
import {
  formatInrMinorUnits,
  hasValidV2RecurringSchedule,
  nextRecurringBillingPeriod,
  recurringScheduleTotalMinor,
  str,
  type Data,
  type Row,
  type Session,
} from '../models';
import { type Resource } from '../data';

const scopeLabels = {
  community: 'Entire Community',
  building: 'Building',
  unit: 'Individual Unit',
  units: 'Selected Units',
} as const;
const statusLabels = { active: 'Active', paused: 'Paused', stopped: 'Stopped' } as const;
const lifecycleActionLabels = {
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
} as const;
const lifecycleBusyLabels = {
  pause: 'Pausing…',
  resume: 'Resuming…',
  stop: 'Stopping…',
} as const;

type LifecycleAction = 'pause' | 'resume' | 'stop';

type PendingLifecycle = {
  action: LifecycleAction;
  scheduleId: string;
  scheduleName: string;
  status: RecurringLifecycleStatusV2;
};

function displayedBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function ScheduleDetails({
  row,
  canManage,
  onRequestAction,
}: {
  row: Row;
  canManage: boolean;
  onRequestAction: (action: LifecycleAction, row: Row) => void;
}) {
  const data = row.data;
  if (!hasValidV2RecurringSchedule(data, row.id)) {
    return <p role="status">Recurring schedule details unavailable.</p>;
  }

  const scope = data.scope as keyof typeof scopeLabels;
  const status = data.status as keyof typeof statusLabels;
  const nextPeriod = nextRecurringBillingPeriod(data);
  const totalMinor = recurringScheduleTotalMinor(data);
  const stalePeriod = !!nextPeriod && nextPeriod < displayedBillingPeriod();
  const scopeDetail =
    scope === 'building'
      ? str(data.buildingId)
      : scope === 'unit'
        ? `${str(data.buildingId)} · ${str(data.flatId)}`
        : scope === 'units'
          ? (data.flatIds as string[]).join(', ')
          : '';

  return (
    <article className="v2-bill-summary">
      <div className="card-heading">
        <h3>{str(data.name) || `Recurring schedule ${row.id}`}</h3>
        <Pill value={statusLabels[status]} />
      </div>
      <p>
        {scopeLabels[scope]}
        {scopeDetail ? ` · ${scopeDetail}` : ''}
      </p>
      <dl className="v2-bill-balances">
        <div>
          <dt>Generation day</dt>
          <dd>{data.generationDay as number}</dd>
        </div>
        <div>
          <dt>Due day</dt>
          <dd>{data.dueDay as number}</dd>
        </div>
        <div>
          <dt>Start billing period</dt>
          <dd>{data.startBillingPeriod as string}</dd>
        </div>
        <div>
          <dt>End billing period</dt>
          <dd>{data.endBillingPeriod == null ? 'Open-ended' : (data.endBillingPeriod as string)}</dd>
        </div>
        <div>
          <dt>Current revision</dt>
          <dd>{data.revisionNo as number}</dd>
        </div>
        <div>
          <dt>Generated through</dt>
          <dd>{data.generatedThroughBillingPeriod == null ? '—' : String(data.generatedThroughBillingPeriod)}</dd>
        </div>
        <div>
          <dt>Next expected period</dt>
          <dd>{nextPeriod}</dd>
        </div>
        <div>
          <dt>Total per period</dt>
          <dd>{totalMinor == null ? '—' : formatInrMinorUnits(totalMinor)}</dd>
        </div>
      </dl>
      <div className="v2-bill-charge-lines">
        <strong>Charge lines</strong>
        {(data.chargeLines as Data[]).map((line, index) => (
          <p key={`${String(line.label)}-${index}`}>
            <span>{str(line.label)}</span>
            <span>{formatInrMinorUnits(line.amountMinor)}</span>
          </p>
        ))}
      </div>
      {data.generationInProgressBillingPeriod != null && (
        <p role="status">
          Generation in progress: {String(data.generationInProgressBillingPeriod)}
        </p>
      )}
      {stalePeriod && <p role="status">Previous billing period requires attention.</p>}
      {canManage && (
        <div className="button-row">
          {status === 'active' && (
            <>
              <button type="button" onClick={() => onRequestAction('pause', row)}>
                Pause
              </button>
              <button type="button" onClick={() => onRequestAction('stop', row)}>
                Stop
              </button>
            </>
          )}
          {status === 'paused' && (
            <>
              <button type="button" onClick={() => onRequestAction('resume', row)}>
                Resume
              </button>
              <button type="button" onClick={() => onRequestAction('stop', row)}>
                Stop
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export function RecurringSchedulesPanel({
  resource,
  session,
  onRefresh,
}: {
  resource: Resource;
  session: Session;
  onRefresh: () => void;
}) {
  const [pendingLifecycle, setPendingLifecycle] = useState<PendingLifecycle | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitInFlight = useRef(false);
  const canManage =
    session.role === 'admin' &&
    session.profile.role === 'admin' &&
    !!session.community;

  function requestAction(action: LifecycleAction, row: Row) {
    const data = row.data;
    if (!hasValidV2RecurringSchedule(data, row.id)) return;
    setReason('');
    setPendingLifecycle({
      action,
      scheduleId: row.id,
      scheduleName: str(data.name) || `Recurring schedule ${row.id}`,
      status: data.status as RecurringLifecycleStatusV2,
    });
  }

  async function confirmAction() {
    if (!pendingLifecycle || submitInFlight.current) return;
    submitInFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const input = {
        communityId: session.community!.id,
        scheduleId: pendingLifecycle.scheduleId,
        reason,
      };
      if (pendingLifecycle.action === 'pause') {
        await pauseRecurringBillingScheduleV2(session, input);
      } else if (pendingLifecycle.action === 'resume') {
        await resumeRecurringBillingScheduleV2(session, input);
      } else {
        await stopRecurringBillingScheduleV2(session, input);
      }
      setPendingLifecycle(null);
      setReason('');
      setMessage(`${lifecycleActionLabels[pendingLifecycle.action]} request completed successfully.`);
      onRefresh();
    } catch {
      setPendingLifecycle(null);
      setReason('');
      onRefresh();
      setMessage(
        'Lifecycle change could not be confirmed. Recurring schedules were refreshed. Confirm the current status before trying another action.',
      );
    } finally {
      submitInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Card title="Recurring Billing">
      {message && <p role="status">{message}</p>}
      {resource.loading ? (
        <p role="status">Loading recurring schedules…</p>
      ) : resource.error ? (
        <p role="alert">Recurring billing schedules could not be loaded.</p>
      ) : resource.rows.length === 0 ? (
        <p>No recurring billing schedules yet.</p>
      ) : (
        <div>
          {resource.rows.map((row) => (
            <ScheduleDetails
              key={row.id}
              row={row}
              canManage={canManage}
              onRequestAction={requestAction}
            />
          ))}
        </div>
      )}
      {pendingLifecycle && (
        <Modal
          title={`${lifecycleActionLabels[pendingLifecycle.action]} Recurring Schedule`}
          onClose={() => {
            if (busy) return;
            setPendingLifecycle(null);
            setReason('');
          }}
        >
          <fieldset disabled={busy}>
            <p>
              <strong>Schedule</strong>: {pendingLifecycle.scheduleName}
            </p>
            <p>
              <strong>Schedule ID</strong>: {pendingLifecycle.scheduleId}
            </p>
            <p>
              <strong>Current status</strong>: {statusLabels[pendingLifecycle.status]}
            </p>
            <p>
              <strong>Requested action</strong>: {lifecycleActionLabels[pendingLifecycle.action]}
            </p>
            {pendingLifecycle.action === 'stop' && (
              <p role="alert">
                Stop is final for the current backend lifecycle. Confirm before proceeding.
              </p>
            )}
            <label>
              Reason (optional)
              <textarea
                rows={3}
                maxLength={300}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <div className="button-row">
              <button
                type="button"
                onClick={() => {
                  setPendingLifecycle(null);
                  setReason('');
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="button" className="primary" disabled={busy} onClick={() => void confirmAction()}>
                {busy ? lifecycleBusyLabels[pendingLifecycle.action] : lifecycleActionLabels[pendingLifecycle.action]}
              </button>
            </div>
          </fieldset>
        </Modal>
      )}
    </Card>
  );
}
