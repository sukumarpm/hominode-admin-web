import { useRef, useState } from 'react';
import { Bell, Check, ShieldCheck } from 'lucide-react';
import { updateScoped } from './actions';
import { Card, State } from './components';
import { useRows } from './data';
import { dateLabel, dateOf, str, type Row, type Session } from './models';
import { useAuth } from './session';
import './notifications.css';

function notificationError(error: string) {
  if (/permission|insufficient|access denied/i.test(error))
    return `Notification access was denied. Verify your signed-in account and community access. ${error}`;
  if (/index|failed-precondition/i.test(error))
    return `Notifications could not be loaded because a Firestore query prerequisite may be missing. Ask support to check the required index. ${error}`;
  return error;
}

export function Notifications() {
  const { session } = useAuth();
  if (
    session?.role !== 'admin' ||
    !session.community ||
    !session.profile.authorizedCommunityIds.includes(session.community.id)
  )
    return <p role="alert">Select an authorized Community Admin session.</p>;
  return <NotificationInbox key={`${session.uid}:${session.community.id}`} session={session} />;
}

function NotificationInbox({ session }: { session: Session }) {
  const [revision, setRevision] = useState(0);
  const resource = useRows(session, 'notifications', revision);
  const visible = { ...resource, rows: resource.rows.filter((row) => !row.data.deletedAt) };
  return (
    <div className="notification-inbox">
      <header className="page-header">
        <div>
          <h1>Notifications</h1>
          <p>Updates addressed to you in {session.community!.name}.</p>
        </div>
      </header>
      <State
        resource={{ ...visible, error: notificationError(resource.error) }}
        empty="You have no notifications in this community."
      >
        <div className="notification-list">
          {visible.rows.map((row) => (
            <NotificationCard key={row.id} session={session} row={row} />
          ))}
        </div>
      </State>
      {resource.error && (
        <button onClick={() => setRevision((value) => value + 1)}>Retry notifications</button>
      )}
    </div>
  );
}

function NotificationCard({ session, row }: { session: Session; row: Row }) {
  const [saving, setSaving] = useState(false);
  const [confirmedRead, setConfirmedRead] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const data = row.data;
  const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
  const support = 'eventType' in metadata && metadata.eventType === 'security_support_request';
  const reference = support && 'reference' in metadata ? str(metadata.reference) : '';
  const read = data.isRead === true || confirmedRead;
  const created = dateOf(data.createdAt);
  const Icon = support ? ShieldCheck : Bell;
  async function markRead() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await updateScoped(session, 'notifications', row.id, {});
      setConfirmedRead(true);
    } catch (e) {
      setError(
        notificationError(e instanceof Error ? e.message : 'Unable to mark as read. Please retry.'),
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <Card className={`notification-item${read ? '' : ' notification-unread'}`}>
      <article aria-label={str(data.title) || 'Community notification'}>
        <header className="notification-heading">
          <Icon size={22} aria-hidden="true" />
          <div>
            {support && <span className="notification-category">Security support request</span>}
            <h2>{str(data.title) || 'Community notification'}</h2>
          </div>
          <span className="pill">{read ? 'Read' : 'Unread'}</span>
        </header>
        <p className="notification-message">
          {str(data.message) || str(data.body) || str(data.content) || str(data.description)}
        </p>
        {reference && <p className="notification-reference">Reference: {reference}</p>}
        <footer className="notification-footer">
          <time dateTime={created?.toISOString()}>
            {created ? dateLabel(data.createdAt) : 'Date unavailable'}
          </time>
          {!read && (
            <button onClick={() => void markRead()} disabled={saving}>
              <Check size={16} aria-hidden="true" /> {saving ? 'Marking as read…' : 'Mark as read'}
            </button>
          )}
        </footer>
        {error && <p role="alert">{error}</p>}
      </article>
    </Card>
  );
}
