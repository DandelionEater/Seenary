export const REMINDER_TIMES = [1440, 720, 360, 60, 30, 15, 0];
export type ReminderCategory = 'episodes' | 'premieres' | 'finales' | 'manga';
export type ReleaseReminderGroups = Record<ReminderCategory, { enabled: boolean; minutes: number[] }>;
export function normalizeReminderGroups(value: unknown, legacyMinutes: unknown = [60, 0]): ReleaseReminderGroups {
  const source = value && typeof value === 'object' ? value as Partial<ReleaseReminderGroups> : {};
  const fallback = Array.isArray(legacyMinutes) ? legacyMinutes : [60, 0];
  return Object.fromEntries((['episodes', 'premieres', 'finales', 'manga'] as const).map(category => {
    const group = source[category];
    const selected: unknown[] = Array.isArray(group?.minutes) ? group.minutes : fallback;
    return [category, { enabled: group?.enabled !== false, minutes: [...new Set(selected.filter((minutes): minutes is number => typeof minutes === 'number' && REMINDER_TIMES.includes(minutes)))] }];
  })) as ReleaseReminderGroups;
}
