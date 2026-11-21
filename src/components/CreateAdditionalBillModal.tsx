import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import './CreateAdditionalBillModal.css';
import { Modal } from '../components';
import { useRows } from '../data';
import { formatInrMinorUnits, type Session } from '../models';
import { localSchedule, visitorTimeZoneError } from '../visitorPolicy';
import {
  additionalBillStorageKey,
  additionalChargeLabels,
  createAdditionalBill,
  occupiedBillUnits,
  parseAdditionalAmount,
  validateAdditionalBillRequest,
  type AdditionalBillRequest,
  type AdditionalBillResult,
  type AdditionalChargeCode,
} from '../additionalBill';

type DraftLine = { lineId: string; code: AdditionalChargeCode; label: string; amount: string };

function OccupiedUnitPicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: ReturnType<typeof occupiedBillUnits>;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const listId = useId();
  const selected = options.find((unit) => unit.id === value);
  const matches = options.filter((unit) =>
    `${unit.buildingName} ${unit.label} ${unit.residentName}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const activeOptionId = open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined;

  useEffect(() => {
    if (!open) {
      if (restoreFocus.current) changeButton.current?.focus();
      restoreFocus.current = false;
      return;
    }
    input.current?.focus();
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  useEffect(() => {
    if (activeOptionId)
      document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionId]);

  function choose(id: string) {
    restoreFocus.current = true;
    onChange(id);
    setOpen(false);
    setSearch('');
    setActiveIndex(-1);
  }

  return (
    <div
      className="additional-unit-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {selected && !open ? (
        <div className="additional-unit-summary">
          <div>
            <strong>
              {selected.buildingName} · {selected.label}
            </strong>
            <span>Resident: {selected.residentName}</span>
          </div>
          <button
            ref={changeButton}
            type="button"
            disabled={disabled}
            onClick={() => {
              setSearch('');
              setActiveIndex(-1);
              setOpen(true);
            }}
          >
            Change unit
          </button>
        </div>
      ) : (
        <>
          <label>
            Select occupied unit
            <input
              ref={input}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={activeOptionId}
              autoComplete="off"
              value={search}
              disabled={disabled}
              placeholder="Building, unit or resident"
              onClick={() => setOpen(true)}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setSearch(event.target.value);
                setActiveIndex(-1);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && open) {
                  event.preventDefault();
                  event.stopPropagation();
                  restoreFocus.current = !!selected;
                  setOpen(false);
                  setActiveIndex(-1);
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setOpen(true);
                  if (matches.length)
                    setActiveIndex((index) =>
                      event.key === 'ArrowDown'
                        ? (index + 1) % matches.length
                        : index <= 0
                          ? matches.length - 1
                          : index - 1,
                    );
                } else if (event.key === 'Enter') {
                  // Enter in the picker must never submit the billing form.
                  event.preventDefault();
                  if (open && matches[activeIndex]) choose(matches[activeIndex].id);
                  else setOpen(true);
                } else if (
                  open &&
                  (event.key === 'Home' || event.key === 'End') &&
                  matches.length
                ) {
                  event.preventDefault();
                  setActiveIndex(event.key === 'Home' ? 0 : matches.length - 1);
                }
              }}
            />
          </label>
          {open && !disabled && (
            <div className="additional-unit-dropdown">
              <div role="listbox" id={listId} aria-label="Occupied units">
                {matches.map((unit, index) => (
                  <div
                    key={unit.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={unit.id === value}
                    className={
                      index === activeIndex
                        ? 'additional-unit-option active'
                        : 'additional-unit-option'
                    }
                    onPointerMove={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(unit.id)}
                  >
                    {unit.buildingName} · {unit.label} · {unit.residentName}
                  </div>
                ))}
              </div>
              {!matches.length && <p role="status">No matching eligible occupied units.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function readAttempt(key: string, communityId: string): AdditionalBillRequest | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const request = validateAdditionalBillRequest(JSON.parse(raw));
  if (request.communityId !== communityId)
    throw Error('Saved request belongs to a different community.');
  return request;
}

export function CreateAdditionalBillModal({
  s,
  onClose,
  onCreated,
  submitBill = createAdditionalBill,
}: {
  s: Session;
  onClose: () => void;
  onCreated: () => void;
  submitBill?: (session: Session, request: AdditionalBillRequest) => Promise<AdditionalBillResult>;
}) {
  const communityId = s.community?.id || '';
  const storageKey = additionalBillStorageKey(s.uid, communityId);
  const [initial] = useState(() => {
    try {
      return { attempt: readAttempt(storageKey, communityId), error: '' };
    } catch {
      return {
        attempt: null,
        error:
          'Saved Additional Bill request could not be read. Restore browser storage before creating another bill.',
      };
    }
  });
  const [attempt, setAttempt] = useState(initial.attempt);
  const [error, setError] = useState(initial.error);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AdditionalBillResult | null>(null);
  const inFlight = useRef(false);
  const nextLine = useRef(2);
  const zone = typeof s.community?.data.timeZone === 'string' ? s.community.data.timeZone : null;
  const zoneError = visitorTimeZoneError(zone);
  const today = localSchedule(Date.now(), zone).slice(0, 10);
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [dueDate, setDueDate] = useState('');
  const [reason, setReason] = useState('');
  const [flatId, setFlatId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { lineId: 'line-1', code: 'other', label: '', amount: '' },
  ]);
  const units = useRows(s, 'units');
  const buildings = useRows(s, 'buildings');
  const residents = useRows(s, 'residents');
  const loading = units.loading || buildings.loading || residents.loading;
  const loadError = units.error || buildings.error || residents.error;
  const eligible = occupiedBillUnits(communityId, units.rows, residents.rows, buildings.rows);
  const selected = eligible.find((unit) => unit.id === flatId);
  const amounts = lines.map((line) => parseAdditionalAmount(line.amount));
  const total = amounts.every((amount) => amount !== null)
    ? amounts.reduce<number>((sum, amount) => sum + amount!, 0)
    : null;

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || result || initial.error) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    let payload: AdditionalBillRequest | null = attempt;
    let sent = false;
    let fresh = false;
    try {
      // Check storage again so reopening a dialog cannot replace an unresolved request.
      payload = readAttempt(storageKey, communityId) || payload;
      if (!payload) {
        fresh = true;
        if (s.role !== 'admin' || !communityId) throw Error('Select an authorized community.');
        if (zoneError) throw Error(zoneError);
        if (loading || loadError || !selected) throw Error('Select an eligible occupied unit.');
        if (dueDate < today)
          throw Error('Due date cannot precede today in the community time zone.');
        payload = validateAdditionalBillRequest({
          communityId,
          flatId,
          billingPeriod: period,
          dueDate,
          reason,
          idempotencyKey: crypto.randomUUID(),
          chargeLines: lines.map((line) => ({
            lineId: line.lineId,
            code: line.code,
            label: line.code === 'custom' ? line.label : additionalChargeLabels[line.code],
            amountMinor: parseAdditionalAmount(line.amount),
          })),
        });
      }
      // Persist before the callable. Storage failure must prevent issuance.
      localStorage.setItem(storageKey, JSON.stringify(payload));
      setAttempt(payload);
      sent = true;
      const response = await submitBill(s, payload);
      setResult(response);
      try {
        localStorage.removeItem(storageKey);
      } catch {
        setError(
          'The bill is confirmed, but the saved request could not be cleared. Reopening will safely confirm the same bill.',
        );
      }
      onCreated();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Additional Bill could not be created.';
      // A rejection on a retry cannot disprove successful issuance by an earlier attempt.
      // Only a fresh request's explicit rejection allows replacing its payload/key.
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : '';
      if (
        sent &&
        fresh &&
        [
          'functions/invalid-argument',
          'functions/failed-precondition',
          'functions/permission-denied',
          'functions/unauthenticated',
          'functions/not-found',
          'functions/unimplemented',
        ].includes(String(code))
      ) {
        try {
          localStorage.removeItem(storageKey);
          setAttempt(null);
        } catch {
          /* Keep the exact request if storage cannot be cleared. */
        }
      }
      setError(message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title="Create Additional Bill" onClose={onClose} dismissible={!busy}>
      {result ? (
        <>
          <p role="status">
            {result.existing
              ? 'Additional Bill already created. The saved request has been confirmed.'
              : 'Additional Bill created successfully.'}
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          {attempt ? (
            <>
              <p role="status">
                Unresolved Additional Bill request. Retry to confirm its outcome using the same
                details and request identifier.
              </p>
              <dl className="detail-fields">
                <div>
                  <dt>Unit</dt>
                  <dd>
                    {eligible.find((unit) => unit.id === attempt.flatId)?.label || attempt.flatId}
                  </dd>
                </div>
                <div>
                  <dt>Billing month</dt>
                  <dd>{attempt.billingPeriod}</dd>
                </div>
                <div>
                  <dt>Due date</dt>
                  <dd>{attempt.dueDate}</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{attempt.reason}</dd>
                </div>
                {attempt.chargeLines.map((line) => (
                  <div key={line.lineId}>
                    <dt>{line.label}</dt>
                    <dd>{formatInrMinorUnits(line.amountMinor)}</dd>
                  </div>
                ))}
                <div>
                  <dt>Review total</dt>
                  <dd>
                    {formatInrMinorUnits(
                      attempt.chargeLines.reduce((sum, line) => sum + line.amountMinor, 0),
                    )}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <fieldset disabled={busy || !!initial.error}>
              {zoneError && (
                <p role="alert" className="form-error">
                  {zoneError}
                </p>
              )}
              {loading && <p role="status">Loading occupied units…</p>}
              {loadError && (
                <p role="alert" className="form-error">
                  Occupied units could not be loaded. Reopen this dialog to retry.
                </p>
              )}
              <OccupiedUnitPicker
                options={eligible}
                value={flatId}
                onChange={setFlatId}
                disabled={busy || !!initial.error || loading || !!loadError}
              />
              <label>
                Billing month
                <input
                  type="month"
                  required
                  min="2000-01"
                  max="2100-12"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                />
              </label>
              <label>
                Due date
                <input
                  type="date"
                  required
                  min={today}
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </label>
              <label>
                Reason
                <textarea
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              {lines.map((line, index) => (
                <fieldset key={line.lineId}>
                  <legend>Charge {index + 1}</legend>
                  <label>
                    Charge type
                    <select
                      value={line.code}
                      onChange={(event) =>
                        updateLine(index, { code: event.target.value as AdditionalChargeCode })
                      }
                    >
                      {Object.entries(additionalChargeLabels).map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  {line.code === 'custom' && (
                    <label>
                      Charge label
                      <input
                        required
                        maxLength={80}
                        value={line.label}
                        onChange={(event) => updateLine(index, { label: event.target.value })}
                      />
                    </label>
                  )}
                  <label>
                    Amount (INR)
                    <input
                      required
                      inputMode="decimal"
                      value={line.amount}
                      onChange={(event) => updateLine(index, { amount: event.target.value })}
                      placeholder="0.00"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((item) => item.lineId !== line.lineId))
                    }
                  >
                    Remove charge {index + 1}
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                disabled={lines.length >= 20}
                onClick={() =>
                  setLines((current) => [
                    ...current,
                    { lineId: `line-${nextLine.current++}`, code: 'custom', label: '', amount: '' },
                  ])
                }
              >
                Add charge
              </button>
              <p aria-live="polite">
                <strong>
                  Review total:{' '}
                  {total !== null ? formatInrMinorUnits(total) : 'Enter valid charge amounts'}
                </strong>
              </p>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="primary"
            type="submit"
            disabled={
              busy ||
              !!initial.error ||
              (!attempt && (loading || !!loadError || !!zoneError || !selected))
            }
          >
            {busy ? 'Submitting…' : attempt ? 'Retry Saved Request' : 'Create Additional Bill'}
          </button>
        </form>
      )}
    </Modal>
  );
}
