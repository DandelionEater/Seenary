import type { ListStatus, MediaType } from '../types/domain';
import { getMigratedLocalStorageItem } from './localStorageMigration';

export const DEFAULT_STATUS_ORDER: ListStatus[] = ['watching', 'planned', 'completed', 'paused', 'dropped'];

export function normalizeSectionOrder(value: unknown): ListStatus[] {
  const saved = Array.isArray(value)
    ? [...new Set(value.filter((status): status is ListStatus => DEFAULT_STATUS_ORDER.includes(status as ListStatus)))]
    : [];
  return [...saved, ...DEFAULT_STATUS_ORDER.filter(status => !saved.includes(status))];
}

export function readStoredSectionOrder(mediaType: MediaType = 'ANIME'): ListStatus[] {
  const suffix = mediaType === 'MANGA' ? '.manga' : '';
  try {
    const raw = getMigratedLocalStorageItem(`seenary.my-list.section-order${suffix}`, `media-tracker.my-list.section-order${suffix}`);
    return normalizeSectionOrder(raw ? JSON.parse(raw) : null);
  } catch { return [...DEFAULT_STATUS_ORDER]; }
}
