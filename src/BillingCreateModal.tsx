import { useState, type FormEvent } from 'react';
import { Modal } from './components';
import { useRows } from './data';
import { call } from './firebase';
import { str, type Session } from './models';

type BillScope = 'community' | 'building' | 'unit';

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

export function BillingCreateModal({
    s,
    onClose,
}: {
    s: Session;
    onClose: () => void;
}) {
    const now = new Date();

    const [scope, setScope] = useState<BillScope>('community');
    const [buildingId, setBuildingId] = useState('');
    const [flatId, setFlatId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState('');

    const buildings = useRows(s, 'buildings');
    const units = useRows(s, 'units');
    const residents = useRows(s, 'residents');

    const buildingRows = buildings.rows
        .map((row) => ({
            id: row.id,
            name:
                str(row.data.buildingName) ||
                str(row.data.name) ||
                row.id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const residentFlatIds = new Set(
        residents.rows
            .map((row) => str(row.data.flatId))
            .filter(Boolean),
    );

    const unitsForBuilding = units.rows
        .filter(
            (row) =>
                str(row.data.buildingId) === buildingId &&
                residentFlatIds.has(row.id),
        )
        .map((row) => ({
            id: row.id,
            label:
                str(row.data.flatLabel) ||
                str(row.data.unitLabel) ||
                str(row.data.flatNumber) ||
                str(row.data.unitId) ||
                row.id,
        }))
        .sort((a, b) =>
            a.label.localeCompare(b.label, undefined, {
                numeric: true,
                sensitivity: 'base',
            }),
        );

    async function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        const values = Object.fromEntries(
            new FormData(e.currentTarget),
        ) as Record<string, string>;

        const amount = Number(values.amount);
        const [year, monthNumberText] = values.period.split('-');
        const monthNumber = Number(monthNumberText);
        const month = MONTHS[monthNumber - 1];

        if (!month || !year) {
            setError('Select a valid billing period.');
            return;
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            setError('Enter a valid bill amount.');
            return;
        }

        if (scope !== 'community' && !buildingId) {
            setError('Select a building.');
            return;
        }

        if (scope === 'unit' && !flatId) {
            setError('Select a unit.');
            return;
        }

        const payload: Record<string, unknown> = {
            communityId: s.community!.id,
            scope,
            amount,
            chargeBreakdown: {
                Maintenance: amount,
            },
            month,
            year,
            dueDate: values.dueDate,
        };

        if (scope === 'building' || scope === 'unit') {
            payload.buildingId = buildingId;
        }

        if (scope === 'unit') {
            payload.flatId = flatId;
        }

        setBusy(true);
        setError('');

        try {
            const response = await call<{
                created: number;
                skipped: number;
            }>('createMaintenanceBills', payload);

            setResult(
                `${response.created} bill${response.created === 1 ? '' : 's'
                } created successfully.${response.skipped
                    ? ` ${response.skipped} resident record${response.skipped === 1 ? '' : 's'
                    } skipped.`
                    : ''
                }`,
            );
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : 'Maintenance bills could not be created.',
            );
        } finally {
            setBusy(false);
        }
    }

    if (result) {
        return (
            <Modal title="Create Bill" onClose={onClose}>
                <p role="status">{result}</p>

                <button
                    className="primary"
                    type="button"
                    onClick={onClose}
                >
                    Done
                </button>
            </Modal>
        );
    }

    return (
        <Modal title="Create Bill" onClose={onClose}>
            <form onSubmit={submit}>
                <fieldset disabled={busy}>
                    <label>
                        Billing period
                        <input
                            type="month"
                            name="period"
                            required
                            defaultValue={`${now.getFullYear()}-${String(
                                now.getMonth() + 1,
                            ).padStart(2, '0')}`}
                        />
                    </label>

                    <label>
                        Due date
                        <input
                            type="date"
                            name="dueDate"
                            required
                        />
                    </label>

                    <label>
                        Maintenance amount
                        <input
                            type="number"
                            name="amount"
                            min="0.01"
                            step="0.01"
                            required
                            placeholder="0.00"
                        />
                    </label>

                    <label>
                        Assign bill to
                        <select
                            value={scope}
                            onChange={(e) => {
                                const next = e.target.value as BillScope;

                                setScope(next);
                                setBuildingId('');
                                setFlatId('');
                                setError('');
                            }}
                        >
                            <option value="community">
                                Entire Community
                            </option>

                            <option value="building">
                                Building
                            </option>

                            <option value="unit">
                                Individual Unit
                            </option>
                        </select>
                    </label>

                    {(scope === 'building' || scope === 'unit') && (
                        <label>
                            Building
                            <select
                                value={buildingId}
                                required
                                disabled={buildings.loading}
                                onChange={(e) => {
                                    setBuildingId(e.target.value);
                                    setFlatId('');
                                }}
                            >
                                <option value="">
                                    {buildings.loading
                                        ? 'Loading buildings…'
                                        : 'Select building'}
                                </option>

                                {buildingRows.map((building) => (
                                    <option
                                        key={building.id}
                                        value={building.id}
                                    >
                                        {building.name}
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
                                disabled={
                                    !buildingId ||
                                    units.loading ||
                                    residents.loading
                                }
                                onChange={(e) => setFlatId(e.target.value)}
                            >
                                <option value="">
                                    {!buildingId
                                        ? 'Select building first'
                                        : units.loading || residents.loading
                                            ? 'Loading units…'
                                            : 'Select unit'}
                                </option>

                                {unitsForBuilding.map((unit) => (
                                    <option key={unit.id} value={unit.id}>
                                        {unit.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {buildings.error && (
                        <p role="alert" className="form-error">
                            Buildings could not be loaded.
                        </p>
                    )}

                    {(units.error || residents.error) && scope === 'unit' && (
                        <p role="alert" className="form-error">
                            Units could not be loaded.
                        </p>
                    )}

                    {error && (
                        <p role="alert" className="form-error">
                            {error}
                        </p>
                    )}

                    <button className="primary" type="submit">
                        {busy ? 'Generating…' : 'Generate Bill(s)'}
                    </button>
                </fieldset>
            </form>
        </Modal>
    );
}