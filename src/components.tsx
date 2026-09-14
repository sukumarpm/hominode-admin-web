import { AlertCircle, ArrowUpRight, Inbox, X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { type Resource } from './data';
export function Card({
  title,
  link,
  children,
  className = '',
}: {
  title?: string;
  link?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'card ' + className}>
      {title && (
        <header className="card-heading">
          <h2>{title}</h2>
          {link && (
            <Link to={link}>
              View all <ArrowUpRight size={14} />
            </Link>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
export function State({
  resource,
  children,
  empty = 'Nothing here yet.',
}: {
  resource: Resource;
  children: ReactNode;
  empty?: string;
}) {
  if (resource.loading)
    return (
      <div role="status" aria-label="Loading information" className="skeletons">
        <i />
        <i />
        <i />
      </div>
    );
  if (resource.error)
    return (
      <div role="alert" className="error-state">
        <AlertCircle size={22} />
        <p>{resource.error}</p>
      </div>
    );
  if (!resource.rows.length)
    return (
      <div className="empty-state">
        <Inbox size={30} />
        <p>{empty}</p>
      </div>
    );
  return <>{children}</>;
}
export function Pill({ value }: { value: string }) {
  return (
    <span className={'pill ' + value.replace(/[^a-z]/gi, '').toLowerCase()}>
      {value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ') || 'Unspecified'}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    ref.current?.showModal();
    const el = ref.current;
    return () => el?.close();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={id} onCancel={onClose}>
      <header className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Boundary({
  title = 'Access unavailable',
  message,
  children,
}: {
  title?: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <main className="startup">
      <div className="startup-logo-wrap">
        <img src="/images/logo.png" alt="Hominode" />
      </div>
      <h1>{title}</h1>
      <p role="alert">{message}</p>
      {children}
    </main>
  );
}
