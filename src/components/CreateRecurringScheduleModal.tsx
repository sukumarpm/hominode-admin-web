import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createRecurringBillingScheduleV2,
  createRecurringScheduleIdempotencyKeyV2,
  normalizeRecurringBillingScheduleRequest,
  parseRecurringAmountInrToMinorUnits,
  type CreateRecurringBillingScheduleV2Request,
  type CreateRecurringBillingScheduleV2Result,
  type RecurringChargeCodeV2,
  type RecurringScheduleScopeV2,
} from '../actions';
import { Modal } from '../components';
import { useRows } from '../data';
import { str, type Session } from '../models';

const STORAGE_KEY_PREFIX = 'hominode.billingV2.createRecurringSchedule.unresolved';
const MAX_CHARGE_LINES = 20;

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

type ChargeLineDraft = {
  lineId: string;
  code: RecurringChargeCodeV2;
  customLabel: string;
  amountInr: string;
};

type LoadSavedAttempt = (storageKey: string) => CreateRecurringBillingScheduleV2Request | null;
type SaveAttempt = (storageKey: string, attempt: CreateRecurringBillingScheduleV2Request) => void;
type ClearAttempt = (storageKey: string) => void;

type UnitOption = {
  id: string;
  label: string;
  buildingId: string;
  buildingLabel: string;
};

function monthToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function buildUnitLabel(data: Record<string, unknown>, fallback: string): string {
  return (
    str(data.flatLabel) ||
    str(data.unitLabel) ||
    str(data.flatNumber) ||
    str(data.unitNumber) ||
    str(data.name) ||
    fallback
  );
}

export function recurringScheduleAttemptStorageKey(uid: string, communityId: string): string {
  return `${STORAGE_KEY_PREFIX}:${uid}:${communityId}`;
}

function loadSavedRecurringAttempt(storageKey: string): CreateRecurringBillingScheduleV2Request | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Error('Saved recurring schedule request is unreadable.');
  }
  return normalizeRecurringBillingScheduleRequest(parsed);
}

function saveRecurringAttempt(storageKey: string, attempt: CreateRecurringBillingScheduleV2Request): void {
  localStorage.setItem(storageKey, JSON.stringify(attempt));
}

function clearRecurringAttempt(storageKey: string): void {
  localStorage.removeItem(storageKey);
}

export function CreateRecurringScheduleModal({
  s,
  onClose,
  onCreated,
  submitSchedule = createRecurringBillingScheduleV2,
  createIdempotencyKey = createRecurringScheduleIdempotencyKeyV2,
  loadAttempt = loadSavedRecurringAttempt,
  saveAttempt = saveRecurringAttempt,
  clearAttempt = clearRecurringAttempt,
}: {
  s: Session;
  onClose: () => void;
  onCreated: () => void;
  submitSchedule?: (
    session: Session,
    input: unknown,
  ) => Promise<CreateRecurringBillingScheduleV2Result>;
  createIdempotencyKey?: () => string;
  loadAttempt?: LoadSavedAttempt;
  saveAttempt?: SaveAttempt;
  clearAttempt?: ClearAttempt;
}) {
  const communityId = s.community?.id || '';
  const storageKey = recurringScheduleAttemptStorageKey(s.uid, communityId);
  const buildings = useRows(s, 'buildings');
  const units = useRows(s, 'units');

  const [scope, setScope] = useState<RecurringScheduleScopeV2>('community');
  const [buildingId, setBuildingId] = useState('');
  const [flatId, setFlatId] = useState('');
  const [selectedFlatIds, setSelectedFlatIds] = useState<string[]>([]);
  const [generationDay, setGenerationDay] = useState('1');
  const [dueDay, setDueDay] = useState('1');
  const [startBillingPeriod, setStartBillingPeriod] = useState(monthToday());
  const [endBillingPeriod, setEndBillingPeriod] = useState('');
  const [chargeLines, setChargeLines] = useState<ChargeLineDraft[]>([
    { lineId: 'line-1', code: 'maintenance', customLabel: '', amountInr: '' },
  ]);
  const [savedAttempt, setSavedAttempt] = useState<CreateRecurringBillingScheduleV2Request | null>(null);
  const [loadingSavedAttempt, setLoadingSavedAttempt] = useState(true);
  const [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submissionMode, setSubmissionMode] = useState<'new' | 'retry' | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const lineIdRef = useRef(1);
  const submitInFlight = useRef(false);

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

  const buildingLabelById = useMemo(() => {
    return new Map(buildingOptions.map((building) => [building.id, building.label]));
  }, [buildingOptions]);

  const unitOptions = useMemo<UnitOption[]>(() => {
    return units.rows
      .map((row) => {
        const data = row.data as Record<string, unknown>;
        const id = row.id;
        const unitBuildingId = str(data.buildingId);
        const buildingLabel = buildingLabelById.get(unitBuildingId) || unitBuildingId || 'Unknown building';
        const unitLabel = buildUnitLabel(data, id);
        return {
          id,
          label: `${buildingLabel} · ${unitLabel}`,
          buildingId: unitBuildingId,
          buildingLabel,
        };
      })
      .filter((unit) => !!unit.buildingId)
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );
  }, [buildingLabelById, units.rows]);

  const unitsForSelectedBuilding = useMemo(() => {
    return unitOptions.filter((unit) => unit.buildingId === buildingId);
  }, [buildingId, unitOptions]);

  useEffect(() => {
    try {
      setSavedAttempt(loadAttempt(storageKey));
      setStorageError('');
    } catch (failure) {
      setSavedAttempt(null);
      setStorageError(
        failure instanceof Error
          ? failure.message
          : 'Saved recurring schedule request could not be read.',
      );
    } finally {
      setLoadingSavedAttempt(false);
    }
  }, [loadAttempt, storageKey]);

  function nextLineId(): string {
    lineIdRef.current += 1;
    return `line-${lineIdRef.current}`;
  }

  function resetScopedSelection(nextScope: RecurringScheduleScopeV2) {
    setScope(nextScope);
    setBuildingId('');
    setFlatId('');
    setSelectedFlatIds([]);
    setError('');
  }

  function toggleSelectedUnit(unitId: string, checked: boolean) {
    setSelectedFlatIds((current) => {
      if (checked) {
        if (current.includes(unitId)) return current;
        return [...current, unitId];
      }
      return current.filter((id) => id !== unitId);
    });
  }

  function buildPayloadWithNewKey(): CreateRecurringBillingScheduleV2Request {
    const generationDayInt = Number(generationDay);
    const dueDayInt = Number(dueDay);
    const trimmedStartPeriod = startBillingPeriod.trim();
    const trimmedEndPeriod = endBillingPeriod.trim();

    if (!Number.isInteger(generationDayInt) || generationDayInt < 1 || generationDayInt > 28) {
      throw Error('Generation day must be an integer from 1 to 28.');
    }
    if (!Number.isInteger(dueDayInt) || dueDayInt < 1 || dueDayInt > 28) {
      throw Error('Due day must be an integer from 1 to 28.');
    }
    if (dueDayInt < generationDayInt) {
      throw Error('Due day must be the same as or after generation day.');
    }

    if (chargeLines.length === 0) throw Error('At least one recurring charge line is required.');
    if (chargeLines.length > MAX_CHARGE_LINES) {
      throw Error(`Recurring schedules can include at most ${MAX_CHARGE_LINES} charge lines.`);
    }

    const parsedChargeLines = chargeLines.map((line, index) => {
      const label =
        line.code === 'custom'
          ? line.customLabel.replace(/\s+/g, ' ').trim()
          : standardChargeLabelsByCode.get(line.code as Exclude<RecurringChargeCodeV2, 'custom'>) ||
            '';
      if (!line.lineId) throw Error(`Charge line ${index + 1} ID is required.`);
      if (!label) throw Error(`Charge line ${index + 1} label is required.`);
      const amountMinor = parseRecurringAmountInrToMinorUnits(line.amountInr);
      if (amountMinor == null) {
        throw Error(
          `Charge line ${index + 1} must be a positive INR amount with up to 2 decimals.`,
        );
      }
      return {
        lineId: line.lineId,
        code: line.code,
        label,
        amountMinor,
      };
    });

    const basePayload: Record<string, unknown> = {
      schemaVersion: 2,
      communityId,
      currency: 'INR',
      frequency: 'monthly',
      idempotencyKey: createIdempotencyKey(),
      generationDay: generationDayInt,
      dueDay: dueDayInt,
      startBillingPeriod: trimmedStartPeriod,
      endBillingPeriod: trimmedEndPeriod || null,
      chargeLines: parsedChargeLines,
    };

    const scopedPayload: Record<string, unknown> =
      scope === 'community'
        ? { ...basePayload, scope }
        : scope === 'building'
          ? (() => {
              if (!buildingId) throw Error('Select a building.');
              return { ...basePayload, scope, buildingId };
            })()
          : scope === 'unit'
            ? (() => {
                if (!buildingId) throw Error('Select a building.');
                if (!flatId) throw Error('Select a unit.');
                return { ...basePayload, scope, buildingId, flatId };
              })()
            : (() => {
                const flatIds = [...new Set(selectedFlatIds)];
                if (flatIds.length === 0) throw Error('Select at least one unit.');
                if (flatIds.length > 5000) throw Error('Selected units cannot exceed 5000.');
                return { ...basePayload, scope, flatIds };
              })();

    const payload = normalizeRecurringBillingScheduleRequest(scopedPayload);

    return payload;
  }

  async function submitSaved(
    attempt: CreateRecurringBillingScheduleV2Request,
    mode: 'new' | 'retry',
  ) {
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setBusy(true);
    setSubmissionMode(mode);
    setError('');
    try {
      const result = await submitSchedule(s, attempt);
      clearAttempt(storageKey);
      setSavedAttempt(null);
      setSuccess(
        result.alreadyCompleted
          ? 'Recurring schedule request was already completed. Recovery succeeded.'
          : 'Recurring schedule created successfully.',
      );
      onCreated();
    } catch {
      setError(
        'Recurring schedule result is unresolved. The exact saved request has been preserved. Retry the saved request to recover the result.',
      );
    } finally {
      submitInFlight.current = false;
      setSubmissionMode(null);
      setBusy(false);
    }
  }

  async function submitNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitInFlight.current || savedAttempt || loadingSavedAttempt || storageError) return;

    setError('');
    let payload: CreateRecurringBillingScheduleV2Request;
    try {
      payload = buildPayloadWithNewKey();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Recurring schedule input is invalid.');
      return;
    }

    try {
      saveAttempt(storageKey, payload);
      setSavedAttempt(payload);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? `The recurring request could not be saved. No request was submitted. ${failure.message}`
          : 'The recurring request could not be saved. No request was submitted.',
      );
      return;
    }

    await submitSaved(payload, 'new');
  }

  if (success) {
    return (
      <Modal title="Create Recurring Schedule" onClose={onClose}>
        <p role="status">{success}</p>
        <button className="primary" type="button" onClick={onClose}>
          Done
        </button>
      </Modal>
    );
  }

  if (loadingSavedAttempt) {
    return (
      <Modal title="Create Recurring Schedule" onClose={onClose}>
        <p role="status">Checking for unresolved recurring schedule requests…</p>
      </Modal>
    );
  }

  if (storageError) {
    return (
      <Modal title="Create Recurring Schedule" onClose={onClose}>
        <p role="alert">{storageError}</p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </Modal>
    );
  }

  if (savedAttempt && !(busy && submissionMode === 'new')) {
    return (
      <Modal title="Create Recurring Schedule" onClose={onClose}>
        <h3>Unresolved Recurring Schedule Request</h3>
        <p>The exact saved request must be retried to recover its result.</p>
        <dl>
          <div>
            <dt>Scope</dt>
            <dd>{savedAttempt.scope}</dd>
          </div>
          <div>
            <dt>Generation day</dt>
            <dd>{savedAttempt.generationDay}</dd>
          </div>
          <div>
            <dt>Due day</dt>
            <dd>{savedAttempt.dueDay}</dd>
          </div>
          <div>
            <dt>Start period</dt>
            <dd>{savedAttempt.startBillingPeriod}</dd>
          </div>
          <div>
            <dt>End period</dt>
            <dd>{savedAttempt.endBillingPeriod ?? 'Open-ended'}</dd>
          </div>
          <div>
            <dt>Charge lines</dt>
            <dd>{savedAttempt.chargeLines.length}</dd>
          </div>
        </dl>
        {error && <p role="alert">{error}</p>}
        <div className="button-row">
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => void submitSaved(savedAttempt, 'retry')}
          >
            {busy ? 'Retrying…' : 'Retry Saved Request'}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Create Recurring Schedule" onClose={onClose}>
      <form onSubmit={(event) => void submitNew(event)}>
        <fieldset disabled={busy}>
          <label>
            Scope
            <select
              value={scope}
              onChange={(event) => resetScopedSelection(event.target.value as RecurringScheduleScopeV2)}
            >
              <option value="community">Entire Community</option>
              <option value="building">Building</option>
              <option value="unit">Individual Unit</option>
              <option value="units">Selected Units</option>
            </select>
          </label>

          {(scope === 'building' || scope === 'unit') && (
            <label>
              Building
              <select
                value={buildingId}
                required
                disabled={buildings.loading}
                onChange={(event) => {
                  setBuildingId(event.target.value);
                  setFlatId('');
                  setError('');
                }}
              >
                <option value="">{buildings.loading ? 'Loading buildings…' : 'Select building'}</option>
                {buildingOptions.map((building) => (
                  <option key={building.id} value={building.id}>
                    {building.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {scope === 'unit' && (
            <label>
              Unit
              <select
                value={flatId}
                required
                disabled={!buildingId || units.loading}
                onChange={(event) => {
                  setFlatId(event.target.value);
                  setError('');
                }}
              >
                <option value="">
                  {!buildingId ? 'Select building first' : units.loading ? 'Loading units…' : 'Select unit'}
                </option>
                {unitsForSelectedBuilding.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {scope === 'units' && (
            <fieldset>
              <legend>Selected Units</legend>
              {units.loading ? (
                <p role="status">Loading units…</p>
              ) : unitOptions.length === 0 ? (
                <p role="status">No units are available.</p>
              ) : (
                <div>
                  {unitOptions.map((unit) => {
                    const checked = selectedFlatIds.includes(unit.id);
                    return (
                      <label key={unit.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => toggleSelectedUnit(unit.id, event.target.checked)}
                        />
                        <span>{unit.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
          )}

          <label>
            Generation day
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={28}
              step={1}
              value={generationDay}
              onChange={(event) => setGenerationDay(event.target.value)}
              required
            />
          </label>

          <label>
            Due day
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={28}
              step={1}
              value={dueDay}
              onChange={(event) => setDueDay(event.target.value)}
              required
            />
          </label>

          <label>
            Start billing period
            <input
              type="month"
              value={startBillingPeriod}
              onChange={(event) => setStartBillingPeriod(event.target.value)}
              required
            />
          </label>

          <label>
            End billing period (optional)
            <input
              type="month"
              value={endBillingPeriod}
              onChange={(event) => setEndBillingPeriod(event.target.value)}
            />
          </label>

          <fieldset>
            <legend>Charge lines</legend>
            {chargeLines.map((line, index) => (
              <div key={line.lineId}>
                <label>
                  Charge type
                  <select
                    value={line.code}
                    onChange={(event) =>
                      setChargeLines((current) =>
                        current.map((item) =>
                          item.lineId === line.lineId
                            ? { ...item, code: event.target.value as RecurringChargeCodeV2 }
                            : item,
                        ),
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
                      value={line.customLabel}
                      maxLength={80}
                      onChange={(event) =>
                        setChargeLines((current) =>
                          current.map((item) =>
                            item.lineId === line.lineId
                              ? { ...item, customLabel: event.target.value }
                              : item,
                          ),
                        )
                      }
                      required
                    />
                  </label>
                )}
                <label>
                  Amount (INR)
                  <input
                    value={line.amountInr}
                    inputMode="decimal"
                    onChange={(event) =>
                      setChargeLines((current) =>
                        current.map((item) =>
                          item.lineId === line.lineId
                            ? { ...item, amountInr: event.target.value }
                            : item,
                        ),
                      )
                    }
                    placeholder="0.00"
                    required
                  />
                </label>
                <button
                  type="button"
                  disabled={chargeLines.length === 1}
                  onClick={() =>
                    setChargeLines((current) =>
                      current.length === 1
                        ? current
                        : current.filter((item) => item.lineId !== line.lineId),
                    )
                  }
                >
                  Remove line {index + 1}
                </button>
              </div>
            ))}

            {chargeLines.length < MAX_CHARGE_LINES && (
              <button
                type="button"
                onClick={() =>
                  setChargeLines((current) => [
                    ...current,
                    {
                      lineId: nextLineId(),
                      code: 'maintenance',
                      customLabel: '',
                      amountInr: '',
                    },
                  ])
                }
              >
                Add line
              </button>
            )}
          </fieldset>

          {buildings.error && (scope === 'building' || scope === 'unit') && (
            <p role="alert" className="form-error">
              Buildings could not be loaded.
            </p>
          )}

          {units.error && (scope === 'unit' || scope === 'units') && (
            <p role="alert" className="form-error">
              Units could not be loaded.
            </p>
          )}

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}

          <button className="primary" type="submit" disabled={busy || loadingSavedAttempt || !!savedAttempt}>
            {busy ? 'Submitting…' : 'Create Recurring Schedule'}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
