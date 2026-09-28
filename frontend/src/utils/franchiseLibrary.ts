import type { EditableListEntry, ListStatus, MediaType } from '../types/domain';

export function franchiseStatusPayload(type: MediaType, status: ListStatus,
  entry: (EditableListEntry & { volume_progress?: number; is_rereading?: number | boolean }) | null) {
  if (!entry) return { status };
  // Older desktop save handlers replace fields, so explicitly retain the latest personal data.
  return { status, progress: entry.progress, score: entry.score, notes: entry.notes,
    isFavorite: Boolean(entry.is_favorite), repeatCount: entry.repeat_count ?? 0,
    startedAt: entry.started_at ?? null, completedAt: entry.completed_at ?? null,
    ...(type === 'ANIME' ? { isRewatching: Boolean(entry.is_rewatching) }
      : { isRereading: Boolean(entry.is_rereading), volumeProgress: entry.volume_progress ?? 0 }),
  };
}
