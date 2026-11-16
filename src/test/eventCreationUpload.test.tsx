import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Resource } from '../data';
import { ModulePage } from '../pages';
import { AuthContext } from '../session';
import { makeSession } from './fixtures';

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  uploadEventImages: vi.fn(),
  useRows: vi.fn(),
}));

vi.mock('../firebase', () => ({
  call: vi.fn(),
  firebase: vi.fn(() => { throw Error('No live Firebase in UI tests'); }),
}));
vi.mock('../actions', async () => ({
  ...(await vi.importActual<typeof import('../actions')>('../actions')),
  createEvent: mocks.createEvent,
  updateEvent: mocks.updateEvent,
  uploadEventImages: mocks.uploadEventImages,
}));
vi.mock('../data', async () => ({
  ...(await vi.importActual<typeof import('../data')>('../data')),
  useRows: mocks.useRows,
}));
vi.mock('../subscriptionContext', () => ({
  useSubscription: () => ({
    entitlement: {
      communityId: 'community-1', planId: 'plus', planName: 'Plus', status: 'active',
      startsAtMs: null, endsAtMs: null,
      features: { facilityDirectory: true, facilityBooking: true, events: true, communityWall: true },
      limits: {}, schemaVersion: 1,
    },
    loading: false,
    error: '',
  }),
  SubscriptionProvider: ({ children }: { children: ReactNode }) => children,
}));

const session = makeSession('admin');
const empty: Resource = { rows: [], loading: false, error: '' };

function mount() {
  return render(
    <MemoryRouter initialEntries={['/?create=1']}>
      <AuthContext value={{
        session, loading: false, error: '', authenticated: true,
        signOut: vi.fn(), switchCommunity: vi.fn(),
      }}>
        <ModulePage module="events" />
      </AuthContext>
    </MemoryRouter>,
  );
}

function fillForm() {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Community picnic' } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-12-20' } });
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Community Hall' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bring lunch' } });
}

function choosePhoto() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw Error('Event photo input not found');
  fireEvent.change(input, {
    target: { files: [new File(['photo'], 'picnic.jpg', { type: 'image/jpeg' })] },
  });
}
function formElement() {
  const form = document.querySelector('form');
  if (!form) throw Error('Event creation form not found');
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  mocks.useRows.mockReturnValue(empty);
  mocks.createEvent.mockResolvedValue({ id: 'event-1' });
  mocks.updateEvent.mockResolvedValue(undefined);
  mocks.uploadEventImages.mockImplementation(async (_session, _id, _files, onStage) => {
    onStage('uploading');
    onStage('finalizing');
    onStage('completed');
  });
});

it('creates only one event on rapid duplicate Save submits', async () => {
  mount();
  fillForm();
  const form = formElement();
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(mocks.createEvent).toHaveBeenCalledTimes(1));
});

it('shows upload stages and blocks closing while photos are uploading', async () => {
  let releaseUpload!: () => void;
  let releaseFinalize!: () => void;
  mocks.uploadEventImages.mockImplementation(async (_session, _id, _files, onStage) => {
    onStage('uploading');
    await new Promise<void>((resolve) => { releaseUpload = resolve; });
    onStage('finalizing');
    await new Promise<void>((resolve) => { releaseFinalize = resolve; });
    onStage('completed');
  });
  let releaseCreate!: () => void;
  mocks.createEvent.mockImplementationOnce(() => new Promise((resolve) => {
    releaseCreate = () => resolve({ id: 'event-1' });
  }));
  mount();
  fillForm();
  choosePhoto();
  const form = formElement();
  fireEvent.submit(form);
  expect(await screen.findByRole('button', { name: 'Preparing…' })).toBeDisabled();
  await act(async () => releaseCreate());
  await waitFor(() => expect(mocks.uploadEventImages).toHaveBeenCalledOnce());
  expect(await screen.findByRole('button', { name: 'Uploading…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
  await act(async () => releaseUpload());
  expect(await screen.findByRole('button', { name: 'Finalizing…' })).toBeDisabled();
  await act(async () => releaseFinalize());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('shows failure instead of success, allows dismissal, and retries against the same event ID', async () => {
  mocks.uploadEventImages
    .mockImplementationOnce(async (_session, _id, _files, onStage) => {
      onStage('uploading');
      throw Error('Storage unavailable');
    })
    .mockImplementationOnce(async (_session, id, _files, onStage) => {
      onStage('uploading');
      onStage('finalizing');
      onStage('completed');
      expect(id).toBe('event-1');
    });
  mount();
  fillForm();
  choosePhoto();
  const form = formElement();
  fireEvent.submit(form);
  expect(await screen.findByRole('alert')).toHaveTextContent(/event was created.*photos were not fully submitted/i);
  expect(screen.getByRole('button', { name: 'Close dialog' })).toBeEnabled();
  expect(screen.queryByText(/success/i)).not.toBeInTheDocument();

  fillForm();
  fireEvent.submit(form);
  await waitFor(() => expect(mocks.uploadEventImages).toHaveBeenCalledTimes(2));
  expect(mocks.createEvent).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
