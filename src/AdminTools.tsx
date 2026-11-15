import { Plus, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { currentAuthority } from './actions';
import { Modal, Pill } from './components';
import { PhoneNumberInput } from './components/PhoneNumberInput';
import { parseResidentCsv } from './csv';
import { safeUrl, useRows } from './data';
import { call } from './firebase';
import { str, type Data, type Row, type Session } from './models';
import { phoneCountries } from './utils/phone';
import { isResidentUnitAvailable, residentUnitLabel } from './residentUnitOptions';
import { canApproveRegistration, canRejectRegistration } from './registrationLifecycle';
interface ImportResult {
  rows: Data[];
  summary: { validRows?: number; errorRows?: number; successCount?: number; failedCount?: number };
  importJobId?: string;
}
export function AdminCreateButtons({ s, module }: { s: Session; module: string }) {
  const [open, setOpen] = useState<'resident' | 'building' | 'bulk' | null>(null);
  if (s.role !== 'admin') return null;
  return (
    <>
      {module === 'residents' && (
        <>
          <button className="primary" onClick={() => setOpen('resident')}>
            <Plus size={16} />
            Add Resident
          </button>
          <button className="outline-link" onClick={() => setOpen('bulk')}>
            <Upload size={16} />
            Bulk Import
          </button>
        </>
      )}
      {module === 'buildings' && (
        <button className="primary" onClick={() => setOpen('building')}>
          <Plus size={16} />
          Add Building
        </button>
      )}
      {open === 'bulk' ? (
        <BulkImport s={s} onClose={() => setOpen(null)} />
      ) : (
        open && (
          <CreateRecord key={s.community?.id} s={s} kind={open} onClose={() => setOpen(null)} />
        )
      )}
    </>
  );
}

function communityPhoneCountry(s: Session) {
  const configured = str(
    s.community?.data.phoneCountryCode || s.community?.data.countryCode,
  ).toUpperCase();
  return phoneCountries.find((country) => country.code === configured)?.code;
}
function CreateRecord({
  s,
  kind,
  onClose,
}: {
  s: Session;
  kind: 'resident' | 'building';
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState(''),
    [structure, setStructure] = useState('apartment_building'),
    [buildingId, setBuildingId] = useState(''),
    [flatId, setFlatId] = useState(''),
    [unitSearch, setUnitSearch] = useState('');

  const buildings = useRows(s, 'buildings');
  const units = useRows(s, 'units');

  const buildingRows = buildings.rows
    .filter((row) => row.data.communityId === s.community?.id && row.data.isActive !== false)
    .map((row) => ({
      id: row.id,
      name: str(row.data.buildingName) || str(row.data.name) || row.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const eligibleUnits = units.rows
    .filter(
      (row) =>
        row.data.communityId === s.community?.id &&
        buildingRows.some((building) => building.id === str(row.data.buildingId)) &&
        isResidentUnitAvailable(row.data),
    )
    .map((row) => ({
      id: row.id,
      buildingId: str(row.data.buildingId),
      buildingName: buildingRows.find((building) => building.id === str(row.data.buildingId))!.name,
      label: residentUnitLabel(row.data, row.id),
    }))
    .sort(
      (a, b) =>
        a.buildingName.localeCompare(b.buildingName) ||
        a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }),
    );
  const unitsForBuilding = eligibleUnits.filter((unit) => unit.buildingId === buildingId);
  const searchMatches = eligibleUnits.filter((unit) =>
    unit.label.toLowerCase().includes(unitSearch.trim().toLowerCase()),
  );

  const selectedBuildingName =
    buildingRows.find((building) => building.id === buildingId)?.name || '';

  const selectedUnitLabel = unitsForBuilding.find((unit) => unit.id === flatId)?.label || '';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError('');
    try {
      await currentAuthority(s);
      if (kind === 'resident') {
        if (!buildingId) {
          throw Error('Select a building for this resident.');
        }

        if (!flatId) {
          throw Error('Select an available unit for this resident.');
        }

        const selectedUnit = unitsForBuilding.find((unit) => unit.id === flatId);

        if (!selectedUnit || units.loading || buildings.loading || units.error || buildings.error) {
          throw Error('The selected unit is no longer available.');
        }

        const response = await call<{ onboardingId: string }>('createResidentOnboarding', {
          communityId: s.community!.id,
          residentName: v.residentName.trim(),
          phoneNumber: v.phoneNumber.trim(),
          residentType: v.residentType,
          email: v.email.trim() || null,
          familyMembers: v.familyMembers ? Number(v.familyMembers) : null,

          // Assignment is performed securely in the next callable.
          buildingReference: null,
          unitReference: null,
        });

        if (!response.onboardingId) {
          throw Error('Onboarding could not be confirmed. Contact support before retrying.');
        }

        try {
          await call('assignResidentOnboardingToFlat', {
            communityId: s.community!.id,
            onboardingId: response.onboardingId,
            buildingId,
            flatId,
          });
        } catch (assignmentError) {
          throw Error(
            'Resident onboarding was created, but the unit could not be reserved. ' +
              `Onboarding reference: ${response.onboardingId}. ` +
              (assignmentError instanceof Error
                ? assignmentError.message
                : 'Please retry the unit assignment.'),
          );
        }

        setResult(
          `Resident onboarding created successfully. ` +
            `${selectedBuildingName} / ${selectedUnitLabel} has been reserved for the resident. ` +
            `The resident can continue registration and any required identity verification in the mobile app. ` +
            `Reference: ${response.onboardingId}`,
        );
      } else {
        const floors = structure === 'apartment_building' ? Number(v.floors) : 1;
        const flatsPerFloor =
          structure === 'apartment_building' ? Number(v.flatsPerFloor) : Number(v.totalFlats);
        const response = await call<{ buildingId: string }>('createBuilding', {
          communityId: s.community!.id,
          name: v.name.trim(),
          floors,
          flatsPerFloor,
          totalFlats: floors * flatsPerFloor,
          flatBhkConfig: {},
          structureType: structure,
        });
        if (!response.buildingId) throw Error('Building creation could not be confirmed.');
        setResult('Building and its units were created successfully.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={kind === 'resident' ? 'Add a Resident' : 'Add a Building'} onClose={onClose}>
      {result ? (
        <p role="status">{result}</p>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            {kind === 'resident' ? (
              <>
                <label>
                  Resident name
                  <input name="residentName" required maxLength={120} />
                </label>
                <PhoneNumberInput
                  name="phoneNumber"
                  label="Phone number"
                  required
                  defaultCountry={communityPhoneCountry(s) || 'PH'}
                  respectDefaultCountry
                  requireCountrySelection={!communityPhoneCountry(s)}
                />
                <label>
                  Resident type
                  <select name="residentType">
                    <option value="owner">Owner</option>
                    <option value="tenant">Tenant</option>
                  </select>
                </label>
                <label>
                  Email
                  <input name="email" type="email" />
                </label>
                <label>
                  Household size
                  <input name="familyMembers" type="number" min="1" max="99" />
                </label>
                <label>
                  Building
                  <select
                    value={buildingId}
                    onChange={(e) => {
                      setBuildingId(e.target.value);
                      setFlatId('');
                    }}
                    required
                  >
                    <option value="">
                      {buildings.loading
                        ? 'Loading buildings…'
                        : buildingRows.length
                          ? 'Select building'
                          : 'No buildings available'}
                    </option>

                    {buildingRows.map((building) => {
                      const vacantCount = eligibleUnits.filter(
                        (unit) => unit.buildingId === building.id,
                      ).length;

                      return (
                        <option key={building.id} value={building.id}>
                          {building.name} — {vacantCount} vacant
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label>
                  Unit
                  <select
                    value={flatId}
                    onChange={(e) => setFlatId(e.target.value)}
                    required
                    disabled={!buildingId || units.loading}
                  >
                    <option value="">
                      {!buildingId
                        ? 'Select a building first'
                        : units.loading
                          ? 'Loading units…'
                          : unitsForBuilding.length
                            ? 'Select unit'
                            : 'No eligible units in this building'}
                    </option>

                    {unitsForBuilding.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Search units across all buildings
                  <input
                    type="search"
                    value={unitSearch}
                    placeholder="Enter a unit number or label"
                    disabled={
                      units.loading ||
                      buildings.loading ||
                      !!units.error ||
                      !!buildings.error ||
                      !eligibleUnits.length
                    }
                    onChange={(e) => setUnitSearch(e.target.value)}
                  />
                </label>
                {unitSearch.trim() &&
                  (searchMatches.length ? (
                    <div
                      role="group"
                      aria-label="Matching units"
                      style={{ maxHeight: 220, overflowY: 'auto' }}
                    >
                      {searchMatches.map((unit) => (
                        <button
                          key={unit.id}
                          type="button"
                          className="outline-link"
                          onClick={() => {
                            setBuildingId(unit.buildingId);
                            setFlatId(unit.id);
                            setUnitSearch('');
                          }}
                        >
                          {unit.buildingName} · {unit.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p role="status">No matching eligible units</p>
                  ))}

                {buildings.error && <p className="form-message">{buildings.error}</p>}

                {units.error && <p className="form-message">{units.error}</p>}
              </>
            ) : (
              <>
                <label>
                  Building name
                  <input name="name" required maxLength={100} />
                </label>
                <label>
                  Structure type
                  <select value={structure} onChange={(e) => setStructure(e.target.value)}>
                    {[
                      'apartment_building',
                      'villa_cluster',
                      'row_house_cluster',
                      'townhouse_cluster',
                      'mixed',
                      'other',
                    ].map((t) => (
                      <option value={t} key={t}>
                        {t.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                {structure === 'apartment_building' ? (
                  <>
                    <label>
                      Floors
                      <input type="number" name="floors" min="1" max="499" required />
                    </label>
                    <label>
                      Units per floor
                      <input type="number" name="flatsPerFloor" min="1" max="499" required />
                    </label>
                  </>
                ) : (
                  <label>
                    Total units
                    <input type="number" name="totalFlats" min="1" max="499" required />
                  </label>
                )}
                <p>
                  Units use the existing default 2BHK layout. A building can contain up to 499
                  units.
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="primary">{busy ? 'Creating…' : 'Create'}</button>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
function BulkImport({ s, onClose }: { s: Session; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string | number>[]>([]),
    [name, setName] = useState(''),
    [job, setJob] = useState(''),
    [result, setResult] = useState<ImportResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [imported, setImported] = useState(false);
  async function load(file: File) {
    setResult(null);
    setRows([]);
    setError('');
    setImported(false);
    try {
      if (file.size > 2 * 1024 * 1024) throw Error('Choose a CSV smaller than 2 MB.');
      const rows = parseResidentCsv(await file.text());
      setRows(rows);
      setName(file.name);
      setJob('job_' + crypto.randomUUID().replaceAll('-', ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to read CSV.');
    }
  }
  async function run(importRows = false) {
    setBusy(true);
    setError('');
    try {
      await currentAuthority(s);
      const response = await call<ImportResult>(
        importRows ? 'importResidentsBulk' : 'validateResidentBulkImport',
        { communityId: s.community!.id, sourceFileName: name, rows, importJobId: job },
      );
      if (!response.summary || !Array.isArray(response.rows))
        throw Error('Invalid import response. Keep this job reference when retrying: ' + job);
      setResult(response);
      if (importRows) setImported(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import could not be completed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Import Residents" onClose={onClose}>
      <p>
        CSV columns: building, unit, residentName, phoneNumber, residentType. Optional: email,
        countryCode, alternatePhone, moveInDate. Up to 500 rows.
      </p>
      <label>
        Select CSV
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(file);
          }}
        />
      </label>
      {name && (
        <p>
          {name} · {rows.length} residents
        </p>
      )}
      <button
        className="primary"
        disabled={!rows.length || busy || imported}
        onClick={() => void run(false)}
      >
        Validate residents
      </button>
      {result && (
        <>
          <p>
            {imported
              ? `${result.summary.successCount || 0} imported · ${result.summary.failedCount || 0} failed`
              : `${result.summary.validRows || 0} valid · ${result.summary.errorRows || 0} need review`}
          </p>
          <div className="import-results">
            {result.rows.map((row, i) => (
              <div key={i}>
                <strong>{str(row.residentName) || 'Row ' + String(row.rowNumber || i + 2)}</strong>
                <Pill value={str(row.status)} />
                <p>{str(row.message)}</p>
              </div>
            ))}
          </div>
          {!imported && (
            <button
              className="primary"
              disabled={busy || !result.summary.validRows}
              onClick={() => void run(true)}
            >
              Import {result.summary.validRows || 0} validated residents
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
export function ResidentReview({ s, row }: { s: Session; row: Row }) {
  const buildings = useRows(s, 'buildings'),
    units = useRows(s, 'units');
  const [buildingId, setBuilding] = useState(str(row.data.buildingId)),
    [flatId, setFlat] = useState(str(row.data.flatId)),
    [type, setType] = useState(
      str(row.data.residentType) ||
        str(row.data.declaredResidentType) ||
        str(row.data.ownershipType) ||
        'owner',
    ),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(''),
    [proof, setProof] = useState(''),
    [confirmReject, setConfirmReject] = useState(false),
    [hasError, setHasError] = useState(false),
    [registrationDone, setRegistrationDone] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const scoped =
    s.role === 'admin' &&
    !!s.community &&
    row.data.communityId === s.community.id &&
    row.data.role === 'resident';
  const pending = scoped && !registrationDone && canApproveRegistration(row.data);
  const rejectable =
    scoped &&
    !registrationDone &&
    canRejectRegistration(row.data, s.community?.ownerIdentityVerificationRequired === true);
  const pendingRef = useRef(pending);
  const rejectableRef = useRef(rejectable);
  pendingRef.current = pending;
  rejectableRef.current = rejectable;
  async function run(name: string, data: Data = {}) {
    if (inFlight.current || !scoped) return;
    const registrationAction = [
      'approveResidentRegistration',
      'rejectResidentRegistration',
    ].includes(name);
    if (
      registrationAction &&
      !(name === 'rejectResidentRegistration' ? rejectableRef.current : pendingRef.current)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setHasError(false);
    setMessage('');
    try {
      await currentAuthority(s);
      if (
        !mounted.current ||
        (registrationAction &&
          !(name === 'rejectResidentRegistration' ? rejectableRef.current : pendingRef.current))
      )
        return;
      const result = await call<{ url?: string }>(name, {
        communityId: s.community!.id,
        userId: row.id,
        ...data,
      });
      if (!mounted.current) return;
      if (name === 'getResidentIdentityProofUrl') {
        const url = safeUrl(result.url);
        if (!url) throw Error('Identity proof is unavailable.');
        setProof(url);
      } else if (registrationAction) {
        setRegistrationDone(true);
        setConfirmReject(false);
        setMessage(
          name === 'rejectResidentRegistration'
            ? 'Registration rejected.'
            : 'Registration approved.',
        );
      } else setMessage('Identity proof review updated.');
    } catch (e) {
      if (mounted.current) {
        setHasError(true);
        setMessage(e instanceof Error ? e.message : 'Unable to update resident.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (!scoped) return null;
  return (
    <section className="resident-review">
      <h3>Registration & Identity</h3>
      <fieldset disabled={busy}>
        <button onClick={() => void run('getResidentIdentityProofUrl')}>View identity proof</button>
        {proof && (
          <a className="outline-link" href={proof} target="_blank" rel="noopener noreferrer">
            Open private identity proof
          </a>
        )}
        <label>
          Review note
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="button-row">
          <button
            onClick={() =>
              void run('reviewResidentIdentityProof', {
                decision: 'verified',
                reason: reason.trim() || null,
              })
            }
          >
            Verify identity
          </button>
          <button
            disabled={busy || !reason.trim()}
            onClick={() =>
              void run('reviewResidentIdentityProof', {
                decision: 'rejected',
                reason: reason.trim(),
              })
            }
          >
            Reject Identity Proof
          </button>
        </div>
        {pending && (
          <>
            <label>
              Building
              <select
                value={buildingId}
                onChange={(e) => {
                  setBuilding(e.target.value);
                  setFlat('');
                }}
              >
                <option value="">Select building</option>
                {buildings.rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {str(r.data.name) || r.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Unit
              <select value={flatId} onChange={(e) => setFlat(e.target.value)}>
                <option value="">Select unit</option>
                {units.rows
                  .filter((r) => r.data.buildingId === buildingId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {str(r.data.flatLabel) || r.id} · {str(r.data.status)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Resident type
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="owner">Owner</option>
                <option value="tenant">Tenant</option>
              </select>
            </label>
            <button
              className="primary"
              disabled={busy || !buildingId || !flatId}
              onClick={() =>
                void run('approveResidentRegistration', { buildingId, flatId, residentType: type })
              }
            >
              Approve Registration
            </button>
          </>
        )}
        {rejectable && (
          <button
            disabled={busy}
            onClick={() => {
              setMessage('');
              setHasError(false);
              setConfirmReject(true);
            }}
          >
            Reject Registration
          </button>
        )}
      </fieldset>
      {busy && !confirmReject && <p role="status">Processing review…</p>}
      {message && !confirmReject && <p role={hasError ? 'alert' : 'status'}>{message}</p>}
      {confirmReject && rejectable && (
        <Modal
          title="Reject Registration"
          onClose={(event?: { preventDefault(): void }) => {
            if (inFlight.current) {
              event?.preventDefault();
              return;
            }
            setConfirmReject(false);
          }}
        >
          <p>
            This cancels onboarding and finally rejects the registration. Only this Resident’s
            applicable unit allocation will be released. Rejecting identity proof instead allows
            resubmission.
          </p>
          <label>
            Rejection reason (optional)
            <textarea value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          </label>
          {busy && <p role="status">Processing registration…</p>}
          {hasError && message && <p role="alert">{message}</p>}
          <button type="button" disabled={busy} onClick={() => setConfirmReject(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void run('rejectResidentRegistration', { reason: reason.trim() || null })
            }
          >
            Confirm Reject Registration
          </button>
        </Modal>
      )}
    </section>
  );
}
