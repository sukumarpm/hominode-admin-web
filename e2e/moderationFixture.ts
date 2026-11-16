// Synthetic offline data only; never imported by a production entry point.
const count = Math.max(
  0,
  Math.min(1100, Number(new URLSearchParams(location.search).get('moderationCount') ?? 1001)),
);
const rows = Array.from({ length: count }, (_, i) => ({
  id: `record-${i}`,
  postId: `post-${i}`,
  reportId: `report-${i}`,
  targetType: 'post',
  status: 'open',
  action: i % 2 ? 'dismiss' : 'hide',
  reasonCode: i % 2 ? 'no_violation' : 'spam',
  contentSnapshot: `Reported content ${i} ${'long-content-'.repeat(12)}`,
  reason: 'Spam',
  reportReason: 'Spam',
  publicReason: 'Community guidelines',
  internalNote: 'Confidential Admin context',
  authorName: 'Resident',
  actorName: 'Community Admin',
  createdAtMs: 1700000000000 - i,
}));
const reports = [...rows];
const history = [...rows];
let failed = false;
export async function moderationCall(
  name: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  if (name === 'resolveWallModerationReport') {
    const index = reports.findIndex((row) => row.id === data.reportId);
    if (index >= 0)
      history.unshift({
        ...reports.splice(index, 1)[0],
        id: 'new-decision',
        action: String(data.action),
        publicReason: String(data.reasonCode),
        internalNote: String(data.internalNote ?? ''),
      });
    return { success: true };
  }
  if (new URLSearchParams(location.search).get('moderationState') === 'error' && !failed) {
    failed = true;
    throw Error('Synthetic moderation error');
  }
  const view = data.view;
  const size = view === 'summary' ? 3 : 10;
  const start = Number(data.cursor ?? 0);
  const page = (entries: typeof rows) => ({
    total: entries.length,
    totalCurrent: entries.length,
    pageCursor: String(start),
    nextCursor: start + size < entries.length ? String(start + size) : null,
    snapshotAtMs: 1700000000000,
  });
  const matching = data.search
    ? history.filter((row) => row[data.searchField as keyof typeof row] === data.search)
    : history;
  return {
    reports: view === 'history' ? [] : reports.slice(start, start + size),
    history: view === 'reports' ? [] : matching.slice(start, start + size),
    reportsPage: view === 'history' ? null : page(reports),
    historyPage: view === 'reports' ? null : page(matching),
  };
}
