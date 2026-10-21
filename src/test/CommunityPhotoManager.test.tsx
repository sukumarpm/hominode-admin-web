import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommunityPhotoManager } from '../CommunityPhotoManager';
import { makeSession } from './fixtures';
import type { Row } from '../models';
const mock = vi.hoisted(() => ({
  run: vi.fn(),
  remove: vi.fn(),
  validate: vi.fn(),
  previews: 0,
  photo: {
    id: 'photo-1',
    data: {
      communityId: 'community-1',
      buildingId: 'tower-1',
      status: 'active',
      type: 'Common Area',
      revision: 1,
    },
  } as Row,
  buildings: [{ id: 'tower-1', data: { communityId: 'community-1', name: 'Tower A' } }] as Row[],
  error: '',
}));
vi.mock('../data', () => ({
  useRows: () => ({ rows: mock.buildings, loading: false, error: mock.error }),
}));
vi.mock('../privateImages', () => ({
  ApartmentGallery: ({ actions }: { actions?: (row: Row) => unknown }) => (
    <section aria-label="Community photos">{actions?.(mock.photo) as React.ReactNode}</section>
  ),
}));
vi.mock('../communityPhotos', async () => ({
  ...(await vi.importActual('../communityPhotos')),
  CommunityPhotoUpload: class {
    run = mock.run;
  },
  deleteCommunityPhoto: mock.remove,
  validateCommunityPhoto: mock.validate,
}));
const create = vi.fn(() => `blob:preview-${++mock.previews}`),
  revoke = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mock.run.mockResolvedValue({ imageId: 'photo-1' });
  mock.remove.mockResolvedValue(undefined);
  mock.validate.mockResolvedValue('image/png');
  mock.error = '';
  mock.buildings = [{ id: 'tower-1', data: { communityId: 'community-1', name: 'Tower A' } }];
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
});
async function choose() {
  fireEvent.change(screen.getByLabelText('Add Photos'), {
    target: { files: [new File(['mocked'], 'garden.png', { type: 'image/png' })] },
  });
  await screen.findByRole('img', { name: 'Selected photo 1' });
}
it('shows validation, preview, upload confirmation and releases local preview URLs', async () => {
  const view = render(<CommunityPhotoManager session={makeSession('admin')} />);
  await choose();
  expect(screen.getByLabelText('Photo 1 title')).toHaveValue('garden');
  fireEvent.click(screen.getByRole('button', { name: 'Upload Photos' }));
  await screen.findByText('Photos added. The gallery will update automatically.');
  expect(mock.run).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalled();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  view.unmount();
});
it('keeps failed selection for explicit retry and skips completed uploads', async () => {
  mock.run.mockRejectedValueOnce(Error('denied'));
  render(<CommunityPhotoManager session={makeSession('admin')} />);
  await choose();
  fireEvent.click(screen.getByRole('button', { name: 'Upload Photos' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Photo upload or attachment failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry Upload' }));
  await screen.findByText('Photos added. The gallery will update automatically.');
  expect(mock.run).toHaveBeenCalledTimes(2);
});
it('requires confirmation and retains the photo on denied deletion', async () => {
  mock.remove.mockRejectedValueOnce(Error('permission-denied'));
  render(<CommunityPhotoManager session={makeSession('admin')} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Photo' }));
  expect(mock.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Photo deletion failed'));
  expect(screen.getByRole('dialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
  await screen.findByText('Photo deleted.');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('no resident management controls and no uploads without a scoped building', async () => {
  const view = render(<CommunityPhotoManager session={makeSession()} />);
  expect(screen.queryByLabelText('Add Photos')).not.toBeInTheDocument();
  mock.buildings = [{ id: 'foreign', data: { communityId: 'foreign', name: 'Other' } }];
  view.rerender(<CommunityPhotoManager session={makeSession('admin')} />);
  await choose();
  fireEvent.click(screen.getByRole('button', { name: 'Upload Photos' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Select an available building');
  expect(mock.run).not.toHaveBeenCalled();
});
it('invalid files remain explicit failures and building permission denial disables input', async () => {
  mock.validate.mockRejectedValue(Error('Choose a supported image.'));
  const view = render(<CommunityPhotoManager session={makeSession('admin')} />);
  fireEvent.change(screen.getByLabelText('Add Photos'), {
    target: { files: [new File(['bad'], 'bad.png', { type: 'image/png' })] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a supported image');
  expect(create).not.toHaveBeenCalled();
  mock.error = 'permission-denied';
  view.rerender(<CommunityPhotoManager session={makeSession('admin')} />);
  expect(screen.getByLabelText('Add Photos')).toBeDisabled();
});
