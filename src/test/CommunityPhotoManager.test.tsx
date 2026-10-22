import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommunityPhotoManager } from '../CommunityPhotoManager';
import { makeSession } from './fixtures';
import type { Row } from '../models';
const mock = vi.hoisted(() => ({
  run: vi.fn(),
  remove: vi.fn(),
  validate: vi.fn(),
  construct: vi.fn(),
  photo: {
    id: 'photo-1',
    data: {
      title: 'Garden',
      contractVersion: 2,
      ownershipScope: 'COMMUNITY',
      resourceId: 'community-1',
      communityId: 'community-1',
      status: 'active',
      revision: 1,
    },
  } as Row,
}));
vi.mock('../privateImages', () => ({
  ApartmentGallery: ({
    actions,
    ownershipScope,
    title,
  }: {
    actions?: (row: Row) => React.ReactNode;
    ownershipScope?: string;
    title?: string;
  }) => (
    <section aria-label={title || 'Community photos'}>
      {ownershipScope ? actions?.(mock.photo) : 'Old photos (read-only)'}
    </section>
  ),
}));
vi.mock('../communityPhotos', async () => ({
  ...(await vi.importActual('../communityPhotos')),
  CommunityPhotoUpload: class {
    constructor(...args: unknown[]) {
      mock.construct(...args);
    }
    run = mock.run;
  },
  deleteCommunityPhoto: mock.remove,
  validateCommunityPhoto: mock.validate,
}));
const create = vi.fn(() => 'blob:preview'),
  revoke = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mock.run.mockResolvedValue({ imageId: 'photo-1', contractVersion: 2 });
  mock.remove.mockResolvedValue(undefined);
  mock.validate.mockResolvedValue('image/png');
  mock.photo = {
    id: 'photo-1',
    data: {
      title: 'Garden',
      contractVersion: 2,
      ownershipScope: 'COMMUNITY',
      resourceId: 'community-1',
      communityId: 'community-1',
      status: 'active',
      revision: 1,
    },
  };
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
});
async function choose() {
  fireEvent.change(screen.getByLabelText('Add Photos'), {
    target: { files: [new File(['mocked'], 'garden.png', { type: 'image/png' })] },
  });
  await screen.findByRole('img', { name: 'Selected photo 1' });
}
it('COMMUNITY upload requires no building and keeps pending previews separate from read-only legacy', async () => {
  render(<CommunityPhotoManager session={makeSession('admin')} />);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Legacy photos (read-only)' })).toHaveTextContent(
    'Old photos',
  );
  await choose();
  const pending = screen.getByLabelText('Pending photo uploads');
  expect(pending.firstElementChild).toHaveTextContent('Pending uploads');
  expect(pending.querySelector('.community-photo-preview-grid')).toBeInTheDocument();
  expect(within(pending).getByText('Ready to upload')).toBeVisible();
  expect(within(pending).getByLabelText('Photo 1 title')).toBeVisible();
  expect(pending.lastElementChild).toHaveClass('community-photo-selection-actions');
  fireEvent.click(screen.getByRole('button', { name: 'Upload Photos' }));
  await screen.findByText(/Photos added/);
  expect(mock.construct).toHaveBeenCalledWith(
    expect.anything(),
    'community-1',
    expect.any(File),
    'garden',
    expect.any(Function),
    'COMMUNITY',
  );
  expect(revoke).toHaveBeenCalled();
});
it('BUILDING upload uses only the selected canonical building', async () => {
  render(
    <CommunityPhotoManager
      session={makeSession('admin')}
      buildingId="tower-1"
      buildingName="Tower A"
    />,
  );
  await choose();
  expect(screen.getByLabelText('Pending photo uploads')).toHaveTextContent(
    'Ready to upload',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Upload Photos' }));
  await screen.findByText(/Photos added/);
  expect(mock.construct).toHaveBeenCalledWith(
    expect.anything(),
    'tower-1',
    expect.any(File),
    'garden',
    expect.any(Function),
    'BUILDING',
  );
  expect(screen.getByRole('region', { name: 'Building photos' })).toBeVisible();
});
it('opens a native modal naming the scope/photo; cancel never deletes', () => {
  render(<CommunityPhotoManager session={makeSession('admin')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Photo' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete community photo' });
  expect(dialog.tagName).toBe('DIALOG');
  expect(dialog).toHaveAttribute('open');
  expect(dialog).toHaveTextContent('Garden');
  expect(dialog).toHaveTextContent('Green Valley');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mock.remove).not.toHaveBeenCalled();
});
it('keeps denied deletion feedback inside the modal and retries the same scoped record', async () => {
  mock.remove.mockRejectedValueOnce(Error('denied'));
  render(<CommunityPhotoManager session={makeSession('admin')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Photo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Photo deletion failed');
  expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
  await screen.findByText('Photo deleted.');
  expect(mock.remove).toHaveBeenLastCalledWith(
    expect.anything(),
    mock.photo,
    'COMMUNITY',
    'community-1',
  );
});
it('retains failed upload for retry and rejects invalid files immediately', async () => {
  mock.validate.mockRejectedValueOnce(Error('Choose a supported image.'));
  render(<CommunityPhotoManager session={makeSession('admin')} />);
  fireEvent.change(screen.getByLabelText('Add Photos'), {
    target: { files: [new File(['bad'], 'bad.png')] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a supported image');
  mock.run.mockRejectedValueOnce(Error('permission-denied'));
  await choose();
  fireEvent.click(screen.getByRole('button', { name: 'Upload Photos' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Photo upload or attachment failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry Upload' }));
  await screen.findByText(/Photos added/);
  expect(mock.construct).toHaveBeenCalledTimes(1);
});
