export type PullStatus = {
  running?: boolean; lastOutcome?: string | null; lastErrorCode?: string | null; lastErrorStatus?: number | null;
  nextAttemptAt?: string | null; requestedAt?: string | null; lastSuccessAt?: string | null;
  counts?: { applied?: number; skipped?: number } | null;
  progress?: { stage: string; current: number; total: number | null; updatedAt?: string; fetched?: Partial<Record<'ANIME' | 'MANGA', number>> } | null;
};
export function completedProviderProgress(provider: 'anilist' | 'mal', status: PullStatus, requestedAt?: number) {
  const completedAt = Date.parse(status.lastSuccessAt ?? '');
  const pendingAt = Date.parse(status.requestedAt ?? '');
  if (!Number.isFinite(completedAt) || (requestedAt !== undefined && completedAt < requestedAt)) return null;
  if (requestedAt === undefined && (status.running || status.lastOutcome !== 'success' || (Number.isFinite(pendingAt) && pendingAt > completedAt))) return null;
  const name = provider === 'anilist' ? 'AniList' : 'MyAnimeList';
  return {
    operation: provider === 'anilist' ? 'pull-anilist' as const : 'pull-mal' as const,
    stage: 'complete' as const,
    updatedAt: new Date(completedAt).toISOString(),
    label: `${name} update complete. ${status.counts?.applied ?? 0} entries applied. ${status.counts?.skipped ?? 0} skipped.`,
  };
}

export function providerProgress(provider: 'anilist' | 'mal', status: PullStatus, now = Date.now()) {
  const name = provider === 'anilist' ? 'AniList' : 'MyAnimeList';
  const operation = provider === 'anilist' ? 'pull-anilist' as const : 'pull-mal' as const;
  if (status.requestedAt) {
    const complete = completedProviderProgress(provider, status);
    if (complete) return complete;
  }
  if (!status.running && !status.requestedAt && status.lastOutcome === 'cancelled') {
    return { operation, stage: 'cancelled' as const, label: `${name} update cancelled. Any changes already applied are kept.` };
  }
  if (!status.running && status.lastOutcome === 'reauthorization-required') {
    return { operation, stage: 'failed' as const, label: `Reconnect ${name} before updating your library.`, retryAllowed: false };
  }
  if (!status.running && !status.requestedAt && status.lastOutcome === 'failed') {
    return { operation, stage: 'failed' as const, label: status.lastErrorCode === 'MAL_PAGINATION_LIMIT'
      ? `${name} could not finish sending your list. Try again later.`
      : `The ${name} update stopped after repeated failures. You can try again.` };
  }
  if (!status.running && status.lastOutcome === 'retry') {
    const next = Date.parse(String(status.nextAttemptAt || ''));
    const seconds = Number.isFinite(next) ? Math.max(0, Math.ceil((next - now) / 1000)) : 0;
    const reason = status.lastErrorStatus === 429 ? `${name} is limiting requests.`
      : status.lastErrorStatus === 401 ? `${name} could not authenticate this account.`
      : status.lastErrorCode === 'PROVIDER_BUDGET' ? `Waiting for available ${name} request capacity.`
      : `The ${name} update failed and will retry.`;
    return { operation, stage: 'waiting-retry' as const, label: `${reason} ${seconds ? `Next attempt in ${seconds >= 60 ? `${Math.ceil(seconds / 60)} min` : `${seconds} sec`}.` : 'Waiting for the worker.'}`,
      retryAt: Number.isFinite(next) ? new Date(next).toISOString() : null,
      retryAllowed: status.lastErrorStatus !== 429 || seconds === 0, errorCode: status.lastErrorCode ?? null, cancellable: Boolean(status.requestedAt) };
  }
  const requestedAt = Date.parse(status.requestedAt ?? '');
  const dueAt = Date.parse(status.nextAttemptAt ?? '');
  const progressAt = Date.parse(status.progress?.updatedAt ?? '');
  const awaitingWorker = !status.running && Number.isFinite(requestedAt);
  const starting = status.running && status.progress?.stage === 'starting';
  const waitingSince = starting && Number.isFinite(progressAt) ? progressAt
    : Number.isFinite(dueAt) && Number.isFinite(requestedAt) ? Math.max(dueAt, requestedAt) : requestedAt;
  if ((awaitingWorker || starting) && now - waitingSince >= 120000) {
    return { operation, stage: 'waiting-retry' as const, label: `The ${name} update has been waiting to start. Seenary will keep checking for the sync worker.`, retryAllowed: false, cancellable: true };
  }
  if (awaitingWorker) return { operation, stage: 'queued' as const, label: `Waiting for the ${name} worker...`, cancellable: true };
  const labels: Record<string, string> = { queued: `Waiting for the ${name} worker...`, starting: `Starting ${name} update...`,
    fetching: `Downloading Anime and Manga lists from ${name}...`, hydrating: `Saving ${name} titles and artwork...`,
    mapping: 'Matching MyAnimeList titles to Seenary...', reconciling: `Updating your library from ${name}...` };
  if (status.progress?.stage === 'fetching' && status.progress.fetched?.ANIME !== undefined && status.progress.fetched.MANGA === undefined) {
    labels.fetching = `Downloading the manga list from ${name}...`;
  }
  if (status.running && status.progress) return { operation, ...status.progress, label: labels[status.progress.stage] || `Updating from ${name}...`, cancellable: true };
  return null;
}
