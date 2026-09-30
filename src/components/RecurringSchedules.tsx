import { Card, Pill } from '../components';
import {
  formatInrMinorUnits,
  hasValidV2RecurringSchedule,
  nextRecurringBillingPeriod,
  recurringScheduleTotalMinor,
  str,
  type Data,
  type Row,
} from '../models';
import { type Resource } from '../data';

const scopeLabels = {
  community: 'Entire Community',
  building: 'Building',
  unit: 'Individual Unit',
  units: 'Selected Units',
} as const;
const statusLabels = { active: 'Active', paused: 'Paused', stopped: 'Stopped' } as const;

function displayedBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function ScheduleDetails({ row }: { row: Row }) {
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
    </article>
  );
}

export function RecurringSchedulesPanel({ resource }: { resource: Resource }) {
  return (
    <Card title="Recurring Billing">
      {resource.loading ? (
        <p role="status">Loading recurring schedules…</p>
      ) : resource.error ? (
        <p role="alert">Recurring billing schedules could not be loaded.</p>
      ) : resource.rows.length === 0 ? (
        <p>No recurring billing schedules yet.</p>
      ) : (
        <div>
          {resource.rows.map((row) => (
            <ScheduleDetails key={row.id} row={row} />
          ))}
        </div>
      )}
    </Card>
  );
}
