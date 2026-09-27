import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getCommunityPaymentConfig, updateCommunityPaymentConfig } from './actions';
import { Card, Modal } from './components';
import {
  type CommunityPaymentConfig,
  type CommunityPaymentConfigInput,
  type Session,
} from './models';

type LoadConfig = (session: Session) => Promise<CommunityPaymentConfig>;
type UpdateConfig = (
  session: Session,
  input: CommunityPaymentConfigInput,
) => Promise<CommunityPaymentConfig>;

interface Props {
  session: Session;
  loadConfig?: LoadConfig;
  updateConfig?: UpdateConfig;
}

interface CardState {
  communityId: string;
  loading: boolean;
  error: boolean;
  config: CommunityPaymentConfig | null;
}

interface EditorState {
  communityId: string;
  requestId: number;
  config: CommunityPaymentConfig;
}

const loadErrorMessage = 'Payment settings could not be loaded.';
const saveErrorMessage = 'Community payment settings could not be updated.';

function invalidateRequest(requestRef: { current: number }, requestId: number) {
  if (requestRef.current === requestId) requestRef.current++;
}

export function CommunityPaymentSettings({
  session,
  loadConfig = getCommunityPaymentConfig,
  updateConfig = updateCommunityPaymentConfig,
}: Props) {
  const communityId = session.community?.id ?? '';
  const requestIdRef = useRef(0);
  const currentCommunityIdRef = useRef(communityId);
  currentCommunityIdRef.current = communityId;
  const [reloadVersion, setReloadVersion] = useState(0);
  const [state, setState] = useState<CardState>({
    communityId,
    loading: true,
    error: false,
    config: null,
  });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (session.role !== 'admin' || !communityId) return;
    const requestId = ++requestIdRef.current;
    setState({ communityId, loading: true, error: false, config: null });
    setEditor(null);
    setFeedback('');

    void loadConfig(session)
      .then((config) => {
        if (requestIdRef.current === requestId && currentCommunityIdRef.current === communityId) {
          setState(
            config.communityId === communityId
              ? { communityId, loading: false, error: false, config }
              : { communityId, loading: false, error: true, config: null },
          );
        }
      })
      .catch(() => {
        if (requestIdRef.current === requestId && currentCommunityIdRef.current === communityId) {
          setState({ communityId, loading: false, error: true, config: null });
        }
      });

    return () => {
      invalidateRequest(requestIdRef, requestId);
    };
  }, [communityId, loadConfig, reloadVersion, session]);

  if (session.role !== 'admin' || !communityId) return null;

  // Key card state to the selected community so a previous tenant's config
  // cannot render during the frame before the new load effect runs.
  const currentState =
    state.communityId === communityId
      ? state
      : { communityId, loading: true, error: false, config: null };
  const config = currentState.config;
  const enabled = config?.directUpi.enabled === true;

  function openEditor() {
    if (config) {
      setEditor({ communityId, requestId: requestIdRef.current, config });
      setFeedback('');
    }
  }

  function saveReturnedConfig(
    editorCommunityId: string,
    requestId: number,
    updated: CommunityPaymentConfig,
  ) {
    if (requestIdRef.current !== requestId || currentCommunityIdRef.current !== editorCommunityId)
      return;
    if (updated.communityId !== editorCommunityId) {
      setState({ communityId: editorCommunityId, loading: false, error: true, config: null });
      setEditor(null);
      return;
    }
    setState({ communityId: editorCommunityId, loading: false, error: false, config: updated });
    setEditor(null);
    setFeedback(updated.directUpi.enabled ? 'Direct UPI settings saved.' : 'Direct UPI disabled.');
  }

  return (
    <div className="community-payment-settings">
      <Card title="Direct UPI payments">
        {currentState.loading ? (
          <p role="status">Loading payment settings…</p>
        ) : currentState.error || !config ? (
          <div>
            <p role="alert">{loadErrorMessage}</p>
            <button type="button" onClick={() => setReloadVersion((value) => value + 1)}>
              Retry
            </button>
          </div>
        ) : (
          <div className="community-payment-summary">
            <p className="community-payment-status" role="status">
              {enabled ? 'Enabled' : config.configured ? 'Disabled' : 'Not configured'}
            </p>
            {enabled ? (
              <dl className="detail-fields">
                <div>
                  <dt>Payee name</dt>
                  <dd>{config.directUpi.payeeName}</dd>
                </div>
                <div>
                  <dt>UPI ID (VPA)</dt>
                  <dd>{config.directUpi.vpa}</dd>
                </div>
              </dl>
            ) : (
              <p>Residents cannot use Direct UPI until it is configured.</p>
            )}
            <button type="button" onClick={openEditor}>
              {enabled ? 'Edit' : 'Configure'}
            </button>
          </div>
        )}
        {feedback && (
          <p className="form-message" role="status">
            {feedback}
          </p>
        )}
      </Card>

      {editor?.communityId === communityId && (
        <PaymentEditor
          key={`${editor.communityId}:${editor.requestId}`}
          session={session}
          config={editor.config}
          updateConfig={updateConfig}
          onClose={() => setEditor(null)}
          onSaved={(updated) => saveReturnedConfig(editor.communityId, editor.requestId, updated)}
        />
      )}
    </div>
  );
}

function PaymentEditor({
  session,
  config,
  updateConfig,
  onClose,
  onSaved,
}: {
  session: Session;
  config: CommunityPaymentConfig;
  updateConfig: UpdateConfig;
  onClose: () => void;
  onSaved: (config: CommunityPaymentConfig) => void;
}) {
  const wasEnabled = config.directUpi.enabled;
  const [enabled, setEnabled] = useState(wasEnabled);
  const [vpa, setVpa] = useState(wasEnabled ? (config.directUpi.vpa ?? '') : '');
  const [payeeName, setPayeeName] = useState(wasEnabled ? (config.directUpi.payeeName ?? '') : '');
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({ vpa: '', payeeName: '' });

  function changeEnabled(value: boolean) {
    setError('');
    if (!value && wasEnabled && enabled) {
      setConfirmDisable(true);
      return;
    }
    if (!value) {
      setVpa('');
      setPayeeName('');
    }
    setEnabled(value);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const cleanVpa = vpa.trim();
    const cleanPayeeName = payeeName.trim();
    const nextFieldErrors = {
      vpa: enabled && !cleanVpa ? 'Enter a UPI ID (VPA).' : '',
      payeeName: enabled && !cleanPayeeName ? 'Enter a payee name.' : '',
    };
    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.vpa || nextFieldErrors.payeeName) return;

    const input: CommunityPaymentConfigInput = enabled
      ? { enabled: true, vpa: cleanVpa, payeeName: cleanPayeeName }
      : { enabled: false };
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const updated = await updateConfig(session, input);
      onSaved(updated);
    } catch {
      setError(saveErrorMessage);
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Direct UPI payment settings"
      onClose={() => {
        if (!savingRef.current) onClose();
      }}
    >
      {confirmDisable ? (
        <div>
          <p role="alert">
            Disabling Direct UPI will prevent residents from using this payment destination for new
            direct UPI payments.
          </p>
          <div className="button-row">
            <button type="button" onClick={() => setConfirmDisable(false)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setEnabled(false);
                setVpa('');
                setPayeeName('');
                setConfirmDisable(false);
              }}
            >
              Disable
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={saving}>
            <label className="community-payment-switch">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => changeEnabled(event.target.checked)}
              />
              Enable Direct UPI
            </label>
            {enabled && (
              <>
                <label htmlFor="community-payment-vpa">
                  UPI ID (VPA)
                  <input
                    id="community-payment-vpa"
                    value={vpa}
                    onChange={(event) => setVpa(event.target.value)}
                    aria-invalid={!!fieldErrors.vpa}
                    aria-describedby={fieldErrors.vpa ? 'community-payment-vpa-error' : undefined}
                  />
                </label>
                {fieldErrors.vpa && (
                  <p id="community-payment-vpa-error" className="form-error" role="alert">
                    {fieldErrors.vpa}
                  </p>
                )}
                <label htmlFor="community-payment-payee">
                  Payee name
                  <input
                    id="community-payment-payee"
                    value={payeeName}
                    onChange={(event) => setPayeeName(event.target.value)}
                    aria-invalid={!!fieldErrors.payeeName}
                    aria-describedby={
                      fieldErrors.payeeName ? 'community-payment-payee-error' : undefined
                    }
                  />
                </label>
                {fieldErrors.payeeName && (
                  <p id="community-payment-payee-error" className="form-error" role="alert">
                    {fieldErrors.payeeName}
                  </p>
                )}
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </Modal>
  );
}
