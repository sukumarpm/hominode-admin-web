import { useState, type FormEvent } from 'react';
import { recordOfflinePayment, type OfflinePaymentMethod } from '../actions';
import { amount, money, str, type Row, type Session } from '../models';

const methods: { label: string; value: OfflinePaymentMethod }[] = [
  { label: 'Cash', value: 'cash' },
  { label: 'Bank Transfer', value: 'bank_transfer' },
  { label: 'Cheque', value: 'cheque' },
];

function isUnsettledBill(row: Row) {
  const billStatus = str(row.data.status).toLowerCase();
  return (
    ['pending', 'overdue'].includes(billStatus) &&
    !str(row.data.paymentId) &&
    row.data.paidAt == null &&
    !(typeof row.data.paidAmount === 'number' && row.data.paidAmount !== 0)
  );
}

function referenceLabel(data: Row['data']) {
  return str(data.flatLabel) || str(data.flatId) || 'Not specified';
}

export function RecordPaymentPanel({
  session,
  bill,
  onRecorded,
  submitPayment = recordOfflinePayment,
}: {
  session: Session;
  bill: Row;
  onRecorded: () => void;
  submitPayment?: typeof recordOfflinePayment;
}) {
  const [open, setOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<OfflinePaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const label = methods.find((method) => method.value === paymentMethod)?.label ?? 'Cash';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed || busy || !isUnsettledBill(bill)) return;

    setBusy(true);
    setError('');
    try {
      await submitPayment(session, {
        billId: bill.id,
        paymentMethod,
        paymentReference: paymentReference.trim(),
      });
      setSuccess(`${label} payment recorded successfully.`);
      setOpen(false);
      onRecorded();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Payment could not be recorded. Refresh the bill and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (session.role !== 'admin') return null;

  return (
    <section className="record-payment-panel" aria-label="Record bill payment">
      {success && (
        <p role="status" className="form-success">
          {success}
        </p>
      )}
      {isUnsettledBill(bill) && !success && (
        <>
          {!open ? (
            <button type="button" className="primary" onClick={() => setOpen(true)}>
              Record Payment
            </button>
          ) : (
            <form className="record-payment-form" onSubmit={(event) => void submit(event)}>
              <h3>Record Payment</h3>
              <dl>
                <div>
                  <dt>Resident</dt>
                  <dd>
                    {str(bill.data.residentName) || str(bill.data.userName) || 'Not specified'}
                  </dd>
                </div>
                <div>
                  <dt>Unit</dt>
                  <dd>{referenceLabel(bill.data)}</dd>
                </div>
                <div>
                  <dt>Bill reference</dt>
                  <dd>{bill.id}</dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd>
                    <output aria-label="Bill amount">{money(amount(bill.data))}</output>
                  </dd>
                </div>
              </dl>
              <fieldset disabled={busy}>
                <label>
                  Payment method
                  <select
                    value={paymentMethod}
                    onChange={(event) =>
                      setPaymentMethod(event.target.value as OfflinePaymentMethod)
                    }
                  >
                    {methods.map((method) => (
                      <option value={method.value} key={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reference / receipt number (optional)
                  <input
                    type="text"
                    value={paymentReference}
                    maxLength={200}
                    onChange={(event) => setPaymentReference(event.target.value)}
                  />
                </label>
                <label className="record-payment-confirmation">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  I confirm the community received this payment.
                </label>
                <div className="button-row">
                  <button type="button" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="primary" disabled={!confirmed || busy}>
                    {busy ? 'Recording…' : `Confirm ${label} Received`}
                  </button>
                </div>
              </fieldset>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
