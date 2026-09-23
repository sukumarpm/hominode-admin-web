import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  FileText,
  Leaf,
  Plus,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  Users,
  WalletCards,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, Pill, State } from './components';
import { safeUrl, titleOf, useRows, type Resource } from './data';
import { amount, dateLabel, dateOf, first, money, status, type Row, type Session } from './models';
import { useAuth } from './session';
function Metric({
  label,
  value,
  icon: Icon,
  tone = 'blue',
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: string;
}) {
  return (
    <div className={'metric ' + tone}>
      <span className="metric-icon">
        <Icon size={25} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>Live community data</small>
      </div>
    </div>
  );
}
const count = (r: Resource) => (r.loading ? '…' : r.error ? '—' : r.rows.length);
export function RecordList({
  resource,
  base,
  module,
  empty,
}: {
  resource: Resource;
  base: string;
  module: string;
  empty?: string;
}) {
  return (
    <State resource={resource} empty={empty}>
      <div className="record-list">
        {resource.rows.slice(0, 4).map((row) => (
          <Link
            className="record"
            key={row.id}
            to={base + module + '?record=' + encodeURIComponent(row.id)}
          >
            <span className="record-icon">
              <FileText size={20} />
            </span>
            <div>
              <strong>{titleOf(row.data)}</strong>
              <small>
                {first(
                  row.data,
                  ['flatLabel', 'description', 'content', 'purpose', 'location', 'body'],
                  dateLabel(row.data.createdAt),
                )}
              </small>
            </div>
            <Pill value={status(row.data)} />
          </Link>
        ))}
      </div>
    </State>
  );
}
function QuickActions({ base, resident }: { base: string; resident: boolean }) {
  const items: [string, string, LucideIcon][] = resident
    ? [
        ['Invite Visitor', 'visitors?create=1', UserRound],
        ['My Bookings', 'bookings', CalendarDays],
        ['Raise Request', 'requests?create=1', Wrench],
        ['File Complaint', 'complaints?create=1', TriangleAlert],
        ['View Facilities', 'facilities', Building2],
        ['My Payments', 'bills', WalletCards],
      ]
    : [
        ['View Residents', 'residents', Users],
        ['View Visitors', 'visitors', UserRound],
        ['View Buildings', 'buildings', Building2],
        ['Raise Notice', 'notices?create=1', Plus],
        ['Review Tickets', 'complaints', Wrench],
        ['View Reports', 'reports', ChartNoAxesCombined],
      ];
  return (
    <Card title="Quick Actions">
      <div className="quick-grid">
        {items.map(([label, path, Icon], i) => (
          <Link className={'quick-action tone-' + i} key={label} to={base + path}>
            <span>
              <Icon size={25} />
            </span>
            {label}
          </Link>
        ))}
      </div>
    </Card>
  );
}
function Welcome({ s, resident }: { s: Session; resident?: boolean }) {
  return (
    <header
      className={'welcome ' + (resident ? 'resident-hero' : s.role === 'admin' ? 'admin-hero' : '')}
    >
      <div>
        {resident && (
          <p>
            Good{' '}
            {new Date().getHours() < 12
              ? 'morning'
              : new Date().getHours() < 18
                ? 'afternoon'
                : 'evening'}
            ,
          </p>
        )}
        <h1>{resident ? 'Welcome Home!' : 'Welcome back, ' + s.profile.name + '!'}</h1>
        <p>
          {resident
            ? 'A safer, cleaner and happier community.'
            : 'Here’s what’s happening in your community today.'}
        </p>
      </div>
      <div className="welcome-meta">
        <span className="date">
          <CalendarDays size={18} />
          {new Date().toLocaleDateString(undefined, {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}
        </span>
        <span className="tagline">SMART PLACE. BETTER LIVES.</span>
      </div>
    </header>
  );
}
function Banner({ resident = false }: { resident?: boolean }) {
  return (
    <section className={'community-banner ' + (resident ? 'lifestyle' : '')}>
      <h2>
        {resident ? (
          <>
            Better
            <br />
            Community.
            <br />
            Brighter
            <br />
            Tomorrow.
          </>
        ) : (
          <>
            Better Community.
            <br />
            Happier Living.
          </>
        )}
      </h2>
      <span>H O M I N O D E</span>
    </section>
  );
}
export function Dashboard() {
  const { session } = useAuth();
  if (!session) return null;
  return session.role === 'resident' ? (
    <ResidentDashboard s={session} />
  ) : session.role === 'superAdmin' ? (
    <PlatformDashboard s={session} />
  ) : (
    <AdminDashboard s={session} />
  );
}
function AdminDashboard({ s }: { s: Session }) {
  const bills = useRows(s, 'billing'),
    units = useRows(s, 'units'),
    visitors = useRows(s, 'visitors'),
    complaints = useRows(s, 'complaints'),
    residents = useRows(s, 'residents'),
    bookings = useRows(s, 'bookings');
  const total = (states: string[]) =>
    bills.rows
      .filter((r) => states.includes(status(r.data)))
      .reduce((sum, r) => sum + amount(r.data), 0);
  const paid = total(['paid', 'settled', 'approved']),
    pending = total(['pending', 'due', 'unpaid']),
    overdue = total(['overdue']);
  const occupied = units.rows.filter((r) => status(r.data) === 'occupied').length;
  const vacant = units.rows.filter((r) => status(r.data) === 'vacant').length;
  const reserved = units.rows.filter((r) => status(r.data) === 'reserved').length;
  const maintenance = units.rows.filter((r) => status(r.data) === 'maintenance').length;

  const totalUnits = Math.max(units.rows.length, 1);

  const occupiedEnd = (occupied / totalUnits) * 100;
  const vacantEnd = occupiedEnd + (vacant / totalUnits) * 100;
  const reservedEnd = vacantEnd + (reserved / totalUnits) * 100;
  const maintenanceEnd = reservedEnd + (maintenance / totalUnits) * 100;

  const percent = units.rows.length ? Math.round((occupied / units.rows.length) * 100) : 0;
  const activity: Resource = {
    rows: [...visitors.rows, ...complaints.rows].sort(
      (a, b) =>
        (dateOf(b.data.createdAt)?.getTime() || 0) - (dateOf(a.data.createdAt)?.getTime() || 0),
    ),
    loading: visitors.loading || complaints.loading,
    error: visitors.error || complaints.error,
  };
  return (
    <>
      <Welcome s={s} />
      <div className="admin-dashboard">
        <div className="dashboard-primary">
          <Card className="collection-card">
            <div className="card-heading">
              <div>
                <p>Maintenance Collection</p>
                <h2 className="collection-total">
                  {bills.loading ? '…' : bills.error ? '—' : money(paid + pending + overdue)}
                </h2>
              </div>
              <span className="period-label">All recorded bills</span>
            </div>
            <State resource={bills} empty="No maintenance bills have been issued.">
              <div className="collection-bubbles">
                <div>
                  <strong>{money(paid)}</strong>
                  <span>Collected</span>
                </div>
                <div className="pending-bubble">
                  <strong>{money(pending)}</strong>
                  <span>Pending</span>
                </div>
                <div>
                  <strong>{money(overdue)}</strong>
                  <span>Overdue</span>
                </div>
              </div>
            </State>
            <Link className="dark-button" to="/billing">
              View Details <ArrowRight size={15} />
            </Link>
          </Card>
          <div className="dashboard-pair">
            <Card title="Billing Overview">
              <BillingChart rows={bills.rows} error={bills.error} loading={bills.loading} />
            </Card>
            <Card title="Community Occupancy">
              <State resource={units} empty="No units have been configured.">
                <div className="occupancy">
                  <div
                    className="donut"
                    style={{
                      background: `conic-gradient(
  #1265ff 0 ${occupiedEnd}%,
  #1dc7bb ${occupiedEnd}% ${vacantEnd}%,
  #f3bb2e ${vacantEnd}% ${reservedEnd}%,
  #f97316 ${reservedEnd}% ${maintenanceEnd}%,
  #e4eaf3 ${maintenanceEnd}% 100%
)`,
                    }}
                  >
                    <div>
                      <strong>{percent}%</strong>
                      <small>Occupied</small>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>Occupied</dt>
                      <dd>{occupied}</dd>
                    </div>
                    <div>
                      <dt>Vacant</dt>
                      <dd>{vacant}</dd>
                    </div>
                    <div>
                      <dt>Reserved</dt>
                      <dd>{reserved}</dd>
                    </div>
                    <div>
                      <dt>Maintenance</dt>
                      <dd>{maintenance}</dd>
                    </div>
                    <div>
                      <dt>Total Units</dt>
                      <dd>{units.rows.length}</dd>
                    </div>
                  </dl>
                </div>
              </State>
            </Card>
          </div>
          <Card title="Community Overview">
            <div className="metrics-grid">
              <Metric label="Residents" value={count(residents)} icon={Users} tone="green" />
              <Metric label="Visitors" value={count(visitors)} icon={UserRound} />
              <Metric label="Complaints" value={count(complaints)} icon={Wrench} tone="purple" />
              <Metric label="Bookings" value={count(bookings)} icon={CalendarDays} tone="rose" />
            </div>
          </Card>
          <Card title="Facility Reservations" link="/bookings">
            <RecordList
              resource={bookings}
              base="/"
              module="bookings"
              empty="No facility reservations yet."
            />
          </Card>
        </div>
        <div className="dashboard-secondary">
          <Card title="Recent Activity" link="/complaints">
            <State resource={activity}>
              <div className="record-list">
                {activity.rows.slice(0, 5).map((row) => (
                  <Link
                    className="record"
                    to={
                      '/' +
                      (row.data.visitorName ? 'visitors' : 'complaints') +
                      '?record=' +
                      encodeURIComponent(row.id)
                    }
                    key={row.id}
                  >
                    <span className="record-icon">
                      {row.data.visitorName ? <UserRound /> : <Wrench />}
                    </span>
                    <div>
                      <strong>{titleOf(row.data)}</strong>
                      <small>{first(row.data, ['flatLabel', 'purpose', 'description'])}</small>
                    </div>
                    <Pill value={status(row.data)} />
                  </Link>
                ))}
              </div>
            </State>
          </Card>
          <QuickActions base="/" resident={false} />
          <Banner />
        </div>
      </div>
    </>
  );
}
function BillingChart({ rows, error, loading }: { rows: Row[]; error: string; loading: boolean }) {
  const months = Array.from({ length: 6 }, (_, i) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - 5 + i);
    return {
      label: date.toLocaleDateString(undefined, { month: 'short' }),
      year: date.getFullYear(),
      month: date.getMonth(),
      total: 0,
    };
  });
  for (const r of rows) {
    const d = dateOf(r.data.createdAt);
    if (!d) continue;
    const m = months.find((m) => m.month === d.getMonth() && m.year === d.getFullYear());
    if (m) m.total += amount(r.data);
  }
  const max = Math.max(1, ...months.map((m) => m.total));
  if (error) return <p role="alert">Billing data unavailable</p>;
  if (loading) return <p role="status">Loading billing…</p>;
  return (
    <>
      <div
        className="bar-chart"
        role="img"
        aria-label={
          'Bills issued by month: ' + months.map((m) => m.label + ' ' + money(m.total)).join(', ')
        }
      >
        {months.map((m) => (
          <div key={m.label}>
            <span
              title={money(m.total)}
              style={{ height: Math.max(2, (m.total / max) * 126) + 'px' }}
            />
            <small>{m.label}</small>
          </div>
        ))}
      </div>
      <p className="chart-caption">Bills issued · Last 6 months</p>
    </>
  );
}
function ResidentDashboard({ s }: { s: Session }) {
  const base = '/' + s.community!.slug + '/';
  const visitors = useRows(s, 'visitors'),
    complaints = useRows(s, 'complaints'),
    bookings = useRows(s, 'bookings'),
    notices = useRows(s, 'notices'),
    bills = useRows(s, 'billing'),
    vehicles = useRows(s, 'vehicles');
  return (
    <>
      <Welcome s={s} resident />
      <div className="resident-dashboard">
        <div className="resident-column">
          <Card className="apartment-card">
            <header className="card-heading">
              <span className="apartment-symbol">
                <Building2 />
              </span>
              <div>
                <h2>My Apartment</h2>
                <h3>{s.profile.flatLabel || 'Your home'}</h3>
                <p>{s.community!.name}</p>
              </div>
              <Link className="outline-link" to={base + 'apartment'}>
                View Details <ArrowRight size={15} />
              </Link>
            </header>
            <div className="apartment-metrics">
              <Metric label="Vehicles" value={count(vehicles)} icon={Users} tone="green" />
              <Metric label="Visitors" value={count(visitors)} icon={UserRound} />
              <Metric label="Requests" value={count(complaints)} icon={Wrench} tone="rose" />
              <Metric label="Bills" value={count(bills)} icon={WalletCards} />
            </div>
          </Card>
          <Card title="My Bookings" link={base + 'bookings'}>
            <State
              resource={bookings}
              empty="Your next community experience awaits. Explore available facilities."
            >
              <div className="booking-cards">
                {bookings.rows.slice(0, 4).map((r) => (
                  <Link to={base + 'bookings?record=' + encodeURIComponent(r.id)} key={r.id}>
                    <span className="booking-picture">
                      {safeUrl(r.data.imageUrl) ? (
                        <img src={safeUrl(r.data.imageUrl)} alt="" />
                      ) : (
                        <CalendarDays size={34} />
                      )}
                    </span>
                    <strong>{titleOf(r.data)}</strong>
                    <small>{dateLabel(r.data.date)}</small>
                  </Link>
                ))}
              </div>
            </State>
            <Link className="text-button" to={base + 'facilities'}>
              Explore facilities <ArrowRight size={15} />
            </Link>
          </Card>
          <Card title="Recent Visitors" link={base + 'visitors'}>
            <RecordList
              resource={visitors}
              base={base}
              module="visitors"
              empty="Invite your first visitor to get started."
            />
          </Card>
        </div>
        <div className="resident-column">
          <Card title="Community Announcements" link={base + 'notices'}>
            <RecordList
              resource={notices}
              base={base}
              module="notices"
              empty="No announcements for your home."
            />
          </Card>
          <Card title="My Service Requests" link={base + 'requests'}>
            <RecordList
              resource={complaints}
              base={base}
              module="complaints"
              empty="No requests at the moment."
            />
          </Card>
          <Card title="My Bills" link={base + 'bills'}>
            <RecordList
              resource={bills}
              base={base}
              module="bills"
              empty="You're all caught up. No bills to display."
            />
          </Card>
        </div>
        <div className="resident-column">
          <Banner resident />
          <QuickActions base={base} resident />
          <section className="green-banner">
            <Leaf size={34} />
            <h2>
              Let’s Keep
              <br />
              Our Community Green
            </h2>
            <p>
              Clean spaces. Happy faces.
              <br />A better tomorrow.
            </p>
            <Link to={base + 'community'}>
              Visit your community <ArrowRight size={17} />
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
function PlatformDashboard({ s }: { s: Session }) {
  const communities = useRows(s, 'communities'),
    admins = useRows(s, 'admins');
  return (
    <>
      <Welcome s={s} />
      <div className="dashboard-pair">
        <Card title="Community Registry" link="/communities">
          <Metric label="Communities" value={count(communities)} icon={Building2} />
          <RecordList resource={communities} base="/" module="communities" />
        </Card>
        <Card title="Administrators" link="/admins">
          <Metric label="Administrators" value={count(admins)} icon={ShieldCheck} />
          <RecordList resource={admins} base="/" module="admins" />
        </Card>
      </div>
    </>
  );
}
