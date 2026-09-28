export type PullStatus = {
  running?: boolean; lastOutcome?: string | null; lastErrorCode?: string | null; lastErrorStatus?: number | null;
  nextAttemptAt?: string | null; requestedAt?: string | null; lastSuccessAt?: string | null;
  progress?: { stage: string; current: number; total: number | null } | null;
};
export function providerProgress(provider: 'anilist' | 'mal', status: PullStatus, now = Date.now()) {
  const name = provider === 'anilist' ? 'AniList' : 'MyAnimeList';
  const operation = provider === 'anilist' ? 'pull-anilist' as const : 'pull-mal' as const;
  if (!status.running && status.lastOutcome === 'reauthorization-required') {
    return { operation, stage: 'failed' as const, label: `Reconnect ${name} before updating your library.`, retryAllowed: false };
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
      retryAllowed: status.lastErrorStatus !== 429 || seconds === 0, errorCode: status.lastErrorCode ?? null };
  }
  const labels: Record<string, string> = { queued: `Waiting for the ${name} worker...`, starting: `Starting ${name} update...`,
    fetching: `Downloading Anime and Manga lists from ${name}...`, hydrating: `Saving ${name} titles and artwork...`,
    mapping: 'Matching MyAnimeList titles to Seenary...', reconciling: `Updating your library from ${name}...` };
  if (status.progress) return { operation, stage: status.progress.stage, label: labels[status.progress.stage] || `Updating from ${name}...`, current: status.progress.current, total: status.progress.total };
  return null;
}
