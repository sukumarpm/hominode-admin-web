import { useMemo, useRef, useState } from 'react';
import {
  createRecurringScheduleIdempotencyKeyV2,
  normalizeReviseRecurringBillingScheduleV2Request,
  parseRecurringAmountInrToMinorUnits,
  pauseRecurringBillingScheduleV2,
  resumeRecurringBillingScheduleV2,
  reviseRecurringBillingScheduleV2,
  stopRecurringBillingScheduleV2,
  type RecurringChargeCodeV2,
  type RecurringLifecycleStatusV2,
  type ReviseRecurringBillingScheduleV2Request,
} from '../actions';
import { Card, Modal, Pill } from '../components';
import { useRows, type Resource } from '../data';
import {
  formatInrMinorUnits,
  hasRevisionCompatibleV2RecurringSchedule,
  hasValidV2RecurringSchedule,
  nextRecurringBillingPeriod,
  recurringScheduleTotalMinor,
  str,
  type Data,
  type Row,
  type Session,
} from '../models';

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
const reviseStorageKeyPrefix = 'hominode.billingV2.reviseRecurringSchedule.unresolved';
const maxChargeLines = 20;
const standardChargeOptions: { code: Exclude<RecurringChargeCodeV2, 'custom'>; label: string }[] = [
  { code: 'maintenance', label: 'Maintenance' },
  { code: 'water', label: 'Water' },
  { code: 'parking', label: 'Parking' },
  { code: 'service', label: 'Service' },
  { code: 'electricity', label: 'Electricity' },
  { code: 'security', label: 'Security' },
  { code: 'other', label: 'Other' },
];
const standardChargeLabelsByCode = new Map(standardChargeOptions.map((option) => [option.code, option.label]));

type LifecycleAction = 'pause' | 'resume' | 'stop';

type PendingLifecycle = {
  action: LifecycleAction;
  scheduleId: string;
  scheduleName: string;
  status: RecurringLifecycleStatusV2;
};

type RevisionDraftLine = {
  lineId: string;
  code: RecurringChargeCodeV2;
  customLabel: string;
  amountInr: string;
};

type RevisionDraft = {
  scheduleId: string;
  scheduleName: string;
  expectedRevisionId: string;
  currentRevisionNo: number;
  scope: 'community' | 'building' | 'unit' | 'units';
  buildingId: string;
  flatId: string;
  flatIds: string[];
  generationDay: string;
  dueDay: string;
  startBillingPeriod: string;
  endBillingPeriod: string;
  reason: string;
  chargeLines: RevisionDraftLine[];
};

type UnreadableSavedRevisionAttempt = {
  storageKey: string;
  scheduleId: string;
};

function minorUnitsToInrInput(minor: number): string {
  const digits = String(minor).padStart(3, '0');
  const rupees = digits.slice(0, -2);
  const paise = digits.slice(-2);
  return paise === '00' ? String(Number(rupees || '0')) : `${String(Number(rupees || '0'))}.${paise}`;
}

export function recurringScheduleRevisionAttemptStorageKey(
  uid: string,
  communityId: string,
  scheduleId: string,
): string {
  return `${reviseStorageKeyPrefix}:${uid}:${communityId}:${scheduleId}`;
}

function buildRevisionDraftFromRow(row: Row): RevisionDraft | null {
  const data = row.data;
  if (!hasRevisionCompatibleV2RecurringSchedule(data, row.id)) return null;
  const scope = data.scope as 'community' | 'building' | 'unit' | 'units';
  const chargeLines = (data.chargeLines as Data[]).map((line) => {
    const code = line.code as RecurringChargeCodeV2;
    const standardLabel = standardChargeLabelsByCode.get(code as Exclude<RecurringChargeCodeV2, 'custom'>) || '';
    return {
      lineId: str(line.lineId),
      code,
      customLabel: code === 'custom' ? str(line.label) : '',
      amountInr: minorUnitsToInrInput(line.amountMinor as number),
      effectiveLabel: code === 'custom' ? str(line.label) : standardLabel,
    };
  });
  if (chargeLines.some((line) => !line.lineId || !line.amountInr || !line.effectiveLabel)) return null;

  return {
    scheduleId: row.id,
    scheduleName: str(data.name) || `Recurring schedule ${row.id}`,
    expectedRevisionId: str(data.currentRevisionId),
    currentRevisionNo: data.revisionNo as number,
    scope,
    buildingId: str(data.buildingId),
    flatId: str(data.flatId),
    flatIds: Array.isArray(data.flatIds)
      ? data.flatIds.filter((id): id is string => typeof id === 'string' && !!id.trim())
      : [],
    generationDay: String(data.generationDay as number),
    dueDay: String(data.dueDay as number),
    startBillingPeriod: str(data.startBillingPeriod),
    endBillingPeriod: data.endBillingPeriod == null ? '' : str(data.endBillingPeriod),
    reason: '',
    chargeLines: chargeLines.map(({ lineId, code, customLabel, amountInr }) => ({
      lineId,
      code,
      customLabel,
      amountInr,
    })),
  };
}

function displayedBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function ScheduleDetails({
  row,
  canManage,
  canRevise,
  onRequestAction,
  onRequestRevise,
}: {
  row: Row;
  canManage: boolean;
  canRevise: boolean;
  onRequestAction: (action: LifecycleAction, row: Row) => void;
  onRequestRevise: (row: Row) => void;
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
          {canRevise && (
            <button type="button" onClick={() => onRequestRevise(row)}>
              Revise
            </button>
          )}
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
  const [revisionDraft, setRevisionDraft] = useState<RevisionDraft | null>(null);
  const [savedRevisionAttempt, setSavedRevisionAttempt] =
    useState<ReviseRecurringBillingScheduleV2Request | null>(null);
  const [unreadableSavedRevisionAttempt, setUnreadableSavedRevisionAttempt] =
    useState<UnreadableSavedRevisionAttempt | null>(null);
  const [showDiscardWarning, setShowDiscardWarning] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [revisionMode, setRevisionMode] = useState<'new' | 'retry' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitInFlight = useRef(false);
  const revisionSubmitInFlight = useRef(false);
  const lineIdRef = useRef(1);
  const canManage =
    session.role === 'admin' &&
    session.profile.role === 'admin' &&
    !!session.community;
  const buildings = useRows(session, 'buildings');
  const units = useRows(session, 'units');

  const buildingOptions = useMemo(() => {
    return buildings.rows
      .map((row) => {
        const data = row.data as Record<string, unknown>;
        return {
          id: row.id,
          label: str(data.buildingName) || str(data.name) || row.id,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }, [buildings.rows]);

  const buildingLabelById = useMemo(
    () => new Map(buildingOptions.map((building) => [building.id, building.label])),
    [buildingOptions],
  );

  const unitOptions = useMemo(() => {
    return units.rows
      .map((row) => {
        const data = row.data as Record<string, unknown>;
        const buildingId = str(data.buildingId);
        const buildingLabel = buildingLabelById.get(buildingId) || buildingId || 'Unknown building';
        const unitLabel =
          str(data.flatLabel) ||
          str(data.unitLabel) ||
          str(data.flatNumber) ||
          str(data.unitNumber) ||
          str(data.name) ||
          row.id;
        return { id: row.id, buildingId, label: `${buildingLabel} · ${unitLabel}` };
      })
      .filter((unit) => !!unit.buildingId)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
  }, [buildingLabelById, units.rows]);

  function nextLineId(existing: Set<string>): string {
    let candidate = '';
    do {
      lineIdRef.current += 1;
      candidate = `line-${lineIdRef.current}`;
    } while (existing.has(candidate));
    return candidate;
  }

  function clearRevisionUi() {
    setRevisionDraft(null);
    setSavedRevisionAttempt(null);
    setUnreadableSavedRevisionAttempt(null);
    setShowDiscardWarning(false);
    setRevisionMode(null);
    setRevisionBusy(false);
  }

  function loadSavedRevisionAttempt(storageKey: string): ReviseRecurringBillingScheduleV2Request | null {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw Error('Saved recurring revision request is unreadable.');
    }
    return normalizeReviseRecurringBillingScheduleV2Request(parsed);
  }

  function saveRevisionAttempt(storageKey: string, request: ReviseRecurringBillingScheduleV2Request) {
    localStorage.setItem(storageKey, JSON.stringify(request));
  }

  function clearRevisionAttempt(storageKey: string) {
    localStorage.removeItem(storageKey);
  }

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

  function requestRevise(row: Row) {
    if (!canManage || !session.community) return;
    const draft = buildRevisionDraftFromRow(row);
    if (!draft) return;
    const storageKey = recurringScheduleRevisionAttemptStorageKey(
      session.uid,
      session.community.id,
      row.id,
    );
    try {
      const saved = loadSavedRevisionAttempt(storageKey);
      setSavedRevisionAttempt(saved);
      setUnreadableSavedRevisionAttempt(null);
      setRevisionDraft(draft);
      setShowDiscardWarning(false);
      setMessage('');
    } catch (failure) {
      void failure;
      setSavedRevisionAttempt(null);
      setUnreadableSavedRevisionAttempt({ storageKey, scheduleId: row.id });
      setRevisionDraft(draft);
      setShowDiscardWarning(false);
      setMessage('');
    }
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

  function buildRevisionRequestWithNewKey(draft: RevisionDraft): ReviseRecurringBillingScheduleV2Request {
    const normalizedLines = draft.chargeLines.map((line, index) => {
      const label =
        line.code === 'custom'
          ? line.customLabel.replace(/\s+/g, ' ').trim()
          : standardChargeLabelsByCode.get(line.code as Exclude<RecurringChargeCodeV2, 'custom'>) ||
          '';
      const amountMinor = parseRecurringAmountInrToMinorUnits(line.amountInr);
      if (!line.lineId) throw Error(`Charge line ${index + 1} ID is required.`);
      if (!label) throw Error(`Charge line ${index + 1} label is required.`);
      if (amountMinor == null) {
        throw Error(
          `Charge line ${index + 1} must be a positive INR amount with up to 2 decimals.`,
        );
      }
      return { lineId: line.lineId, code: line.code, label, amountMinor };
    });

    const base: Record<string, unknown> = {
      communityId: session.community!.id,
      scheduleId: draft.scheduleId,
      expectedRevisionId: draft.expectedRevisionId,
      idempotencyKey: createRecurringScheduleIdempotencyKeyV2(),
      scope: draft.scope,
      generationDay: Number(draft.generationDay),
      dueDay: Number(draft.dueDay),
      startBillingPeriod: draft.startBillingPeriod.trim(),
      endBillingPeriod: draft.endBillingPeriod.trim() ? draft.endBillingPeriod.trim() : null,
      chargeLines: normalizedLines,
      reason: draft.reason,
    };
    if (draft.scope === 'building') {
      base.buildingId = draft.buildingId;
    } else if (draft.scope === 'unit') {
      base.buildingId = draft.buildingId;
      base.flatId = draft.flatId;
    } else if (draft.scope === 'units') {
      base.flatIds = draft.flatIds;
    }
    return normalizeReviseRecurringBillingScheduleV2Request(base);
  }

  async function submitRevisionRequest(
    request: ReviseRecurringBillingScheduleV2Request,
    mode: 'new' | 'retry',
  ) {
    if (!session.community || revisionSubmitInFlight.current) return;
    revisionSubmitInFlight.current = true;
    setRevisionBusy(true);
    setRevisionMode(mode);
    try {
      const result = await reviseRecurringBillingScheduleV2(session, request);
      const storageKey = recurringScheduleRevisionAttemptStorageKey(
        session.uid,
        session.community.id,
        request.scheduleId,
      );
      clearRevisionAttempt(storageKey);
      clearRevisionUi();
      setMessage(
        result.alreadyCompleted
          ? 'Recurring revision was already completed. Recovery succeeded.'
          : 'Recurring revision submitted successfully.',
      );
      onRefresh();
    } catch {
      clearRevisionUi();
      onRefresh();
      setMessage(
        'Recurring revision result could not be confirmed. The saved revision request was preserved. Refresh complete; verify the current schedule status and revision before retrying.',
      );
    } finally {
      revisionSubmitInFlight.current = false;
      setRevisionBusy(false);
      setRevisionMode(null);
    }
  }

  async function submitNewRevision() {
    if (!revisionDraft || !session.community) return;
    let request: ReviseRecurringBillingScheduleV2Request;
    try {
      request = buildRevisionRequestWithNewKey(revisionDraft);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Recurring revision input is invalid.');
      return;
    }

    const storageKey = recurringScheduleRevisionAttemptStorageKey(
      session.uid,
      session.community.id,
      request.scheduleId,
    );
    const existingRaw = localStorage.getItem(storageKey);
    if (existingRaw) {
      try {
        setSavedRevisionAttempt(loadSavedRevisionAttempt(storageKey));
        setUnreadableSavedRevisionAttempt(null);
        setMessage(
          'An unresolved saved revision already exists for this schedule. Retry or discard it explicitly before creating a new revision.',
        );
      } catch {
        setSavedRevisionAttempt(null);
        setUnreadableSavedRevisionAttempt({ storageKey, scheduleId: request.scheduleId });
        setMessage(
          'Saved revision request is unreadable for this schedule. Discard it explicitly before creating a new revision.',
        );
      }
      return;
    }

    try {
      saveRevisionAttempt(storageKey, request);
    } catch {
      setSavedRevisionAttempt(null);
      setUnreadableSavedRevisionAttempt(null);
      setMessage(
        'Revision could not be submitted because its recovery request could not be saved. No revision request was sent.',
      );
      return;
    }
    setSavedRevisionAttempt(request);
    setUnreadableSavedRevisionAttempt(null);
    await submitRevisionRequest(request, 'new');
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
              canRevise={canManage && hasRevisionCompatibleV2RecurringSchedule(row.data, row.id)}
              onRequestAction={requestAction}
              onRequestRevise={requestRevise}
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
      {revisionDraft &&
        !unreadableSavedRevisionAttempt &&
        (!savedRevisionAttempt || (revisionBusy && revisionMode === 'new')) && (
          <Modal
            title="Revise Recurring Schedule"
            onClose={() => {
              if (revisionBusy) return;
              clearRevisionUi();
            }}
          >
            <fieldset disabled={revisionBusy}>
              <p>
                <strong>Schedule</strong>: {revisionDraft.scheduleName}
              </p>
              <p>
                <strong>Schedule ID</strong>: {revisionDraft.scheduleId}
              </p>
              <p>
                <strong>Current revision</strong>: {revisionDraft.currentRevisionNo}
              </p>
              <p>
                <strong>Current revision ID</strong>: {revisionDraft.expectedRevisionId}
              </p>
              <p>Submitting creates a new immutable revision. Existing revisions are never edited in place.</p>
              <p>
                The backend may apply revised terms from a later safe billing period if earlier periods are
                already generated or reserved.
              </p>

              <label>
                Scope
                <select
                  value={revisionDraft.scope}
                  onChange={(event) =>
                    setRevisionDraft((current) =>
                      current
                        ? {
                          ...current,
                          scope: event.target.value as RevisionDraft['scope'],
                          buildingId: '',
                          flatId: '',
                          flatIds: [],
                        }
                        : current,
                    )
                  }
                >
                  <option value="community">Entire Community</option>
                  <option value="building">Building</option>
                  <option value="unit">Individual Unit</option>
                  <option value="units">Selected Units</option>
                </select>
              </label>

              {(revisionDraft.scope === 'building' || revisionDraft.scope === 'unit') && (
                <label>
                  Building
                  <select
                    value={revisionDraft.buildingId}
                    onChange={(event) =>
                      setRevisionDraft((current) =>
                        current
                          ? { ...current, buildingId: event.target.value, flatId: '' }
                          : current,
                      )
                    }
                  >
                    <option value="">Select building</option>
                    {buildingOptions.map((building) => (
                      <option key={building.id} value={building.id}>
                        {building.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {revisionDraft.scope === 'unit' && (
                <label>
                  Unit
                  <select
                    value={revisionDraft.flatId}
                    onChange={(event) =>
                      setRevisionDraft((current) =>
                        current ? { ...current, flatId: event.target.value } : current,
                      )
                    }
                  >
                    <option value="">Select unit</option>
                    {unitOptions
                      .filter((unit) => unit.buildingId === revisionDraft.buildingId)
                      .map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label}
                        </option>
                      ))}
                  </select>
                </label>
              )}

              {revisionDraft.scope === 'units' && (
                <fieldset>
                  <legend>Selected Units</legend>
                  <div>
                    {unitOptions.map((unit) => (
                      <label key={unit.id}>
                        <input
                          type="checkbox"
                          checked={revisionDraft.flatIds.includes(unit.id)}
                          onChange={(event) =>
                            setRevisionDraft((current) => {
                              if (!current) return current;
                              const next = event.target.checked
                                ? [...current.flatIds, unit.id]
                                : current.flatIds.filter((id) => id !== unit.id);
                              return { ...current, flatIds: [...new Set(next)] };
                            })
                          }
                        />
                        <span>{unit.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <label>
                Generation day
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={revisionDraft.generationDay}
                  onChange={(event) =>
                    setRevisionDraft((current) =>
                      current ? { ...current, generationDay: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label>
                Due day
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={revisionDraft.dueDay}
                  onChange={(event) =>
                    setRevisionDraft((current) =>
                      current ? { ...current, dueDay: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label>
                Start billing period
                <input
                  type="month"
                  value={revisionDraft.startBillingPeriod}
                  onChange={(event) =>
                    setRevisionDraft((current) =>
                      current ? { ...current, startBillingPeriod: event.target.value } : current,
                    )
                  }
                />
              </label>
              <label>
                End billing period (optional)
                <input
                  type="month"
                  value={revisionDraft.endBillingPeriod}
                  onChange={(event) =>
                    setRevisionDraft((current) =>
                      current ? { ...current, endBillingPeriod: event.target.value } : current,
                    )
                  }
                />
              </label>

              <fieldset>
                <legend>Charge lines</legend>
                {revisionDraft.chargeLines.map((line, index) => (
                  <div key={line.lineId}>
                    <label>
                      Charge type
                      <select
                        value={line.code}
                        onChange={(event) =>
                          setRevisionDraft((current) =>
                            current
                              ? {
                                ...current,
                                chargeLines: current.chargeLines.map((item) =>
                                  item.lineId === line.lineId
                                    ? { ...item, code: event.target.value as RecurringChargeCodeV2 }
                                    : item,
                                ),
                              }
                              : current,
                          )
                        }
                      >
                        {standardChargeOptions.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                        <option value="custom">Custom</option>
                      </select>
                    </label>
                    {line.code === 'custom' && (
                      <label>
                        Custom label
                        <input
                          maxLength={80}
                          value={line.customLabel}
                          onChange={(event) =>
                            setRevisionDraft((current) =>
                              current
                                ? {
                                  ...current,
                                  chargeLines: current.chargeLines.map((item) =>
                                    item.lineId === line.lineId
                                      ? { ...item, customLabel: event.target.value }
                                      : item,
                                  ),
                                }
                                : current,
                            )
                          }
                        />
                      </label>
                    )}
                    <label>
                      Amount (INR)
                      <input
                        inputMode="decimal"
                        value={line.amountInr}
                        onChange={(event) =>
                          setRevisionDraft((current) =>
                            current
                              ? {
                                ...current,
                                chargeLines: current.chargeLines.map((item) =>
                                  item.lineId === line.lineId
                                    ? { ...item, amountInr: event.target.value }
                                    : item,
                                ),
                              }
                              : current,
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      disabled={revisionDraft.chargeLines.length === 1}
                      onClick={() =>
                        setRevisionDraft((current) =>
                          current
                            ? {
                              ...current,
                              chargeLines:
                                current.chargeLines.length === 1
                                  ? current.chargeLines
                                  : current.chargeLines.filter((item) => item.lineId !== line.lineId),
                            }
                            : current,
                        )
                      }
                    >
                      Remove line {index + 1}
                    </button>
                  </div>
                ))}

                {revisionDraft.chargeLines.length < maxChargeLines && (
                  <button
                    type="button"
                    onClick={() =>
                      setRevisionDraft((current) => {
                        if (!current) return current;
                        const existing = new Set(current.chargeLines.map((line) => line.lineId));
                        const lineId = nextLineId(existing);
                        return {
                          ...current,
                          chargeLines: [
                            ...current.chargeLines,
                            { lineId, code: 'maintenance', customLabel: '', amountInr: '' },
                          ],
                        };
                      })
                    }
                  >
                    Add line
                  </button>
                )}
              </fieldset>

              <label>
                Revision reason (optional)
                <textarea
                  maxLength={300}
                  rows={3}
                  value={revisionDraft.reason}
                  onChange={(event) =>
                    setRevisionDraft((current) =>
                      current ? { ...current, reason: event.target.value } : current,
                    )
                  }
                />
              </label>

              <div className="button-row">
                <button type="button" disabled={revisionBusy} onClick={() => clearRevisionUi()}>
                  Cancel
                </button>
                <button type="button" className="primary" disabled={revisionBusy} onClick={() => void submitNewRevision()}>
                  {revisionBusy ? 'Submitting revision…' : 'Revise'}
                </button>
              </div>
            </fieldset>
          </Modal>
        )}

      {revisionDraft && (savedRevisionAttempt || unreadableSavedRevisionAttempt) && !(revisionBusy && revisionMode === 'new') && (
        <Modal
          title="Unresolved Saved Revision"
          onClose={() => {
            if (revisionBusy) return;
            clearRevisionUi();
          }}
        >
          {savedRevisionAttempt ? (
            <p>
              An unresolved saved revision exists for this schedule. Retry the exact saved request or
              discard it only after checking the refreshed schedule status and revision.
            </p>
          ) : (
            <p>
              Saved revision request data for this schedule is unreadable. No retry or new revision
              request can be sent until this saved request is explicitly discarded.
            </p>
          )}
          <dl>
            <div>
              <dt>Schedule ID</dt>
              <dd>{savedRevisionAttempt?.scheduleId || unreadableSavedRevisionAttempt!.scheduleId}</dd>
            </div>
            {savedRevisionAttempt && (
              <>
                <div>
                  <dt>Expected revision ID</dt>
                  <dd>{savedRevisionAttempt.expectedRevisionId}</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>{savedRevisionAttempt.scope}</dd>
                </div>
                <div>
                  <dt>Charge lines</dt>
                  <dd>{savedRevisionAttempt.chargeLines.length}</dd>
                </div>
              </>
            )}
          </dl>

          {showDiscardWarning && (
            <p role="alert">
              Discarding removes the saved idempotent retry request. Do this only after confirming
              the refreshed schedule status and revision.
            </p>
          )}
          <div className="button-row">
            {savedRevisionAttempt && (
              <button
                type="button"
                className="primary"
                disabled={revisionBusy}
                onClick={() => void submitRevisionRequest(savedRevisionAttempt, 'retry')}
              >
                {revisionBusy ? 'Retrying revision…' : 'Retry Saved Revision'}
              </button>
            )}
            <button type="button" disabled={revisionBusy} onClick={() => setShowDiscardWarning(true)}>
              Discard Saved Revision
            </button>
            <button type="button" disabled={revisionBusy} onClick={() => clearRevisionUi()}>
              Close
            </button>
          </div>
          {showDiscardWarning && (
            <button
              type="button"
              disabled={revisionBusy}
              onClick={() => {
                if (!session.community) return;
                const storageKey =
                  unreadableSavedRevisionAttempt?.storageKey ||
                  recurringScheduleRevisionAttemptStorageKey(
                    session.uid,
                    session.community.id,
                    savedRevisionAttempt!.scheduleId,
                  );
                clearRevisionAttempt(storageKey);
                clearRevisionUi();
                onRefresh();
                setMessage(
                  'Saved revision request discarded. Confirm refreshed schedule status and revision, then reopen a fresh revision from current authoritative schedule data.',
                );
              }}
            >
              Confirm Discard
            </button>
          )}
        </Modal>
      )}
    </Card>
  );
}
