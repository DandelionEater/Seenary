import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  HeartIcon,
  MinusIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { HeartIcon as HeartIconSolid } from "@heroicons/react/24/solid";
import type { EditableListEntry, MediaType } from "../types/domain";
import { getListStatusLabel, LIST_STATUS_ORDER } from "../utils/mediaFormatting";
import { Tooltip } from "./ui/Tooltip";

type EditableMediaListEntry = EditableListEntry & {
  manga_id?: number;
  volume_progress?: number;
  is_rereading?: number | boolean;
  cloud_pending?: boolean;
  cloud_conflict?: string | null;
  cloud_action?: "upsert" | "delete" | null;
};

type ListEntryModalProps = {
  animeId: number;
  mediaType?: MediaType;
  isOpen: boolean;
  entry: EditableMediaListEntry | null;
  title?: string;
  totalEpisodes?: number | null;
  totalVolumes?: number | null;
  onClose: () => void;
  onSaved: (entry: EditableMediaListEntry, message?: string) => void;
  onRemoved: (message?: string) => void;
};

let openListEntryModalCount = 0;

function updateModalOpenClass(delta: 1 | -1) {
  openListEntryModalCount = Math.max(0, openListEntryModalCount + delta);
  document.body.classList.toggle("modal-open", openListEntryModalCount > 0);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function dateFromInputValue(value: string) {
  if (!value) return new Date();

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return new Date();
  }

  return new Date(year, month - 1, day);
}

function toDateInputValue(value: unknown) {
  if (!value) return "";

  const text = String(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function clampScore(value: number) {
  return Math.min(10, Math.max(0, Math.round(value * 10) / 10));
}

function normalizeScoreInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed || trimmed === "-") {
    return "";
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? String(clampScore(parsed)) : "";
}

export function ListEntryModal({
  animeId,
  mediaType = "ANIME",
  isOpen,
  entry,
  title,
  totalEpisodes,
  totalVolumes,
  onClose,
  onSaved,
  onRemoved,
}: ListEntryModalProps) {
  const [status, setStatus] = useState("planned");
  const [isFavorite, setIsFavorite] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volumeProgress, setVolumeProgress] = useState(0);
  const [score, setScore] = useState("");
  const [notes, setNotes] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [isRewatching, setIsRewatching] = useState(false);
  const [repeatCount, setRepeatCount] = useState(0);
  const [openDatePicker, setOpenDatePicker] = useState<"startedAt" | "completedAt" | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    updateModalOpenClass(1);

    return () => updateModalOpenClass(-1);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    setStatus(entry?.status ?? "planned");
    setIsFavorite(Boolean(entry?.is_favorite));
    setProgress(entry?.progress ?? 0);
    setVolumeProgress(entry?.volume_progress ?? 0);
    setScore(entry?.score != null ? String(entry.score) : "");
    setNotes(entry?.notes ?? "");
    setStartedAt(toDateInputValue(entry?.started_at));
    setCompletedAt(toDateInputValue(entry?.completed_at));
    setIsRewatching(Boolean(entry?.is_rereading ?? entry?.is_rewatching));
    setRepeatCount(Math.max(0, Number(entry?.repeat_count ?? 0)));
    setMessage(null);
  }, [isOpen, entry]);

  if (!isOpen) return null;

  const clampedProgress =
    totalEpisodes && totalEpisodes > 0
      ? Math.max(0, Math.min(progress, totalEpisodes))
      : Math.max(0, progress);
  const clampedVolumeProgress =
    totalVolumes && totalVolumes > 0
      ? Math.max(0, Math.min(volumeProgress, totalVolumes))
      : Math.max(0, volumeProgress);
  const isManga = mediaType === "MANGA";

  const progressPercent =
    totalEpisodes && totalEpisodes > 0
      ? Math.round((clampedProgress / totalEpisodes) * 100)
      : null;
  const normalizedScore = normalizeScoreInput(score);
  const scoreSliderValue = normalizedScore === "" ? 0 : Number(normalizedScore);
  const scoreLabel = normalizedScore === "" ? "Not rated" : `${normalizedScore} / 10`;

  const markCompleted = () => {
    setStatus("completed");

    if (totalEpisodes && totalEpisodes > 0) {
      setProgress(totalEpisodes);
    }
    if (isManga && totalVolumes && totalVolumes > 0) {
      setVolumeProgress(totalVolumes);
    }

    setStartedAt((current) => current || todayDate());
    setCompletedAt((current) => current || todayDate());

    if (isRewatching) {
      setRepeatCount((current) => current + 1);
      setIsRewatching(false);
    }
  };

  const startRewatch = () => {
    setIsRewatching(true);
    setStatus("watching");
    setProgress(0);
    if (isManga) setVolumeProgress(0);
    setStartedAt(todayDate());
    setCompletedAt("");
  };

  const stopRewatch = () => {
    setIsRewatching(false);
  };

  async function handleSave() {
    if (busy) return;

    try {
      setBusy(true);
      setMessage(null);

      const finalProgress =
        status === "completed" && totalEpisodes && totalEpisodes > 0
          ? totalEpisodes
          : clampedProgress;

      const finishingActiveRewatch = isRewatching && status === "completed";
      const finalRepeatCount = repeatCount + (finishingActiveRewatch ? 1 : 0);
      const data = {
        status,
        isFavorite,
        progress: finalProgress,
        volumeProgress: clampedVolumeProgress,
        score: normalizedScore === "" ? null : Number(normalizedScore),
        notes: notes.trim() || null,
        startedAt: startedAt || null,
        completedAt: completedAt || null,
        isRewatching: finishingActiveRewatch ? false : isRewatching,
        isRereading: finishingActiveRewatch ? false : isRewatching,
        repeatCount: finalRepeatCount,
      };
      const result = isManga
        ? await window.api.saveMyMangaListEntry(animeId, data)
        : await window.api.saveMyListEntry(animeId, data);

      if (!result.ok || !result.entry) {
        setMessage(result.message);
        return;
      }

      setMessage(result.message);
      onSaved(result.entry, result.message);
      onClose();
    } catch (error) {
      console.error(error);
      setMessage("Failed to save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (busy) return;

    try {
      setBusy(true);
      setMessage(null);

      const result = isManga
        ? await window.api.removeMyMangaListEntry(animeId)
        : await window.api.removeMyListEntry(animeId);

      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      onRemoved(result.message);
      onClose();
    } catch (error) {
      console.error(error);
      setMessage("Failed to remove entry.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveConflict(choice: "cloud" | "device") {
    if (resolvingConflict) return;
    try {
      setResolvingConflict(true);
      setMessage(null);
      const result = isManga
        ? await window.api.resolveMyMangaListConflict(animeId, choice)
        : await window.api.resolveMyListConflict(animeId, choice);
      if (!result.ok) { setMessage(result.message); return; }
      if (result.entry) onSaved(result.entry, result.message);
      else onRemoved(result.message);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to resolve the cloud conflict.");
    } finally { setResolvingConflict(false); }
  }

  function chooseStatus(nextStatus: string) {
    if (nextStatus === "watching") {
      setStartedAt((current) => current || todayDate());
      setCompletedAt("");
    }

    if (nextStatus === "completed") {
      markCompleted();
      return;
    }

    if (nextStatus !== "completed") {
      setCompletedAt("");
    }

    setStatus(nextStatus);
  }

  function updateProgress(nextProgress: number) {
    const nextValue =
      totalEpisodes && totalEpisodes > 0
        ? Math.max(0, Math.min(nextProgress, totalEpisodes))
        : Math.max(0, nextProgress);

    setProgress(nextValue);

    if (totalEpisodes && totalEpisodes > 0 && nextValue >= totalEpisodes) {
      markCompleted();
    } else if (status === "planned" && nextValue > 0) {
      setStatus("watching");
      setStartedAt((current) => current || todayDate());
    }
  }

  function updateScoreFromInput(value: string) {
    const trimmed = value.trim();

    if (!trimmed || trimmed === "-") {
      setScore("");
      return;
    }

    if (!/^\d{0,2}(?:\.\d?)?$/.test(trimmed)) {
      return;
    }

    const parsed = Number(trimmed);

    if (!Number.isFinite(parsed) || parsed > 10) {
      return;
    }

    setScore(trimmed);
  }

  function updateScoreFromSlider(value: string) {
    setScore(String(clampScore(Number(value))));
  }

  return (
    <div className="absolute inset-0 z-80 flex items-center justify-center bg-black/82 px-6 py-4">
      <div className="flex max-h-[calc(100vh-32px)] w-full max-w-3xl flex-col rounded-3xl border border-white/10 bg-[#111111]/95 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-white/35">
              List Entry
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Edit list entry
            </h2>
            {title && <p className="mt-2 text-sm text-white/55">{title}</p>}
          </div>

          <Tooltip content="Close">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-xl p-2 text-white/55 transition hover:bg-white/10 hover:text-white"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
          </Tooltip>
        </div>

        <div className="scroll-container -mr-4 flex min-h-0 flex-1 flex-col space-y-4 overflow-x-hidden overflow-y-auto pr-4">
          {entry?.cloud_conflict && (
            <section className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4" role="alert">
              <p className="font-semibold text-amber-50">This title changed on another device</p>
              <p className="mt-2 text-sm leading-6 text-amber-50/70">Review the values below, then keep the current cloud version or apply this device’s queued edit to the latest revision.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={resolvingConflict} onClick={() => void resolveConflict("cloud")} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">Keep cloud version</button>
                <button type="button" disabled={resolvingConflict} onClick={() => void resolveConflict("device")} className="rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-black">Apply my edit</button>
              </div>
            </section>
          )}
          {entry?.cloud_pending && !entry.cloud_conflict && (
            <p className="rounded-2xl border border-sky-300/20 bg-sky-300/10 px-4 py-3 text-sm text-sky-50/80" role="status">Saved on this device and waiting for Atlas acknowledgement.</p>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">Favorite</p>
                <p className="mt-1 text-sm text-white/45">
                  Pin this title to the top of its segment.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsFavorite((current) => !current)}
                className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition ${
                  isFavorite
                    ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white"
                    : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
                }`}
              >
                {isFavorite ? (
                  <HeartIconSolid className="h-4 w-4" />
                ) : (
                  <HeartIcon className="h-4 w-4" />
                )}
                {isFavorite ? "Favorited" : "Favorite"}
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    {isManga ? "Rereading" : "Rewatching"}
                  </p>
                  <p className="mt-1 text-sm text-white/45">
                    Starts from {isManga ? "chapter" : "episode"} 0 and counts on completion.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={isRewatching ? stopRewatch : startRewatch}
                  className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition ${
                    isRewatching
                      ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white"
                      : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  {isRewatching ? "Active" : "Start"}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
          <div>
            <label className="mb-2 block text-sm text-white/65">Status</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {LIST_STATUS_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => chooseStatus(option)}
                  className={`rounded-2xl border px-3 py-2.5 text-sm transition ${
                    status === option
                      ? "border-[var(--app-accent)] bg-[var(--app-accent)] text-black shadow-lg shadow-[var(--app-accent)]/15"
                      : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {getListStatusLabel(option, mediaType)}
                </button>
              ))}
            </div>
          </div>

          <div className={isManga ? "order-2" : ""}>
            <div className="mb-2 flex items-center justify-between gap-4">
              <label className="block text-sm text-white/65">
                {isManga ? "Chapter progress" : "Progress"}
              </label>
              <span className="text-sm text-white/35">
                {clampedProgress}
                {totalEpisodes ? ` / ${totalEpisodes}` : ""}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Tooltip content="Decrease progress">
              <button
                type="button"
                onClick={() => updateProgress(clampedProgress - 1)}
                aria-label="Decrease progress"
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                <MinusIcon className="h-4 w-4" />
              </button>
              </Tooltip>

              <input
                type="number"
                min={0}
                max={totalEpisodes ?? undefined}
                value={progress}
                onChange={(event) => updateProgress(Number(event.target.value))}
                className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />

              <Tooltip content="Increase progress">
              <button
                type="button"
                onClick={() => updateProgress(clampedProgress + 1)}
                aria-label="Increase progress"
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
              </Tooltip>
            </div>

            {progressPercent !== null && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--app-accent)] shadow-[0_0_14px_var(--app-accent)]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
          </div>

          {isManga && (
            <div className="order-1">
              <div className="mb-2 flex items-center justify-between gap-4">
                <label className="block text-sm text-white/65">Volume progress</label>
                <span className="text-sm text-white/35">
                  {clampedVolumeProgress}
                  {totalVolumes ? ` / ${totalVolumes}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip content="Decrease volume progress">
                <button
                  type="button"
                  onClick={() => setVolumeProgress(Math.max(0, clampedVolumeProgress - 1))}
                  aria-label="Decrease volume progress"
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white"
                >
                  <MinusIcon className="h-4 w-4" />
                </button>
                </Tooltip>
                <input
                  type="number"
                  min={0}
                  max={totalVolumes ?? undefined}
                  value={volumeProgress}
                  onChange={(event) =>
                    setVolumeProgress(
                      totalVolumes
                        ? Math.max(0, Math.min(Number(event.target.value), totalVolumes))
                        : Math.max(0, Number(event.target.value))
                    )
                  }
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <Tooltip content="Increase volume progress">
                <button
                  type="button"
                  onClick={() =>
                    setVolumeProgress(
                      totalVolumes
                        ? Math.min(totalVolumes, clampedVolumeProgress + 1)
                        : clampedVolumeProgress + 1
                    )
                  }
                  aria-label="Increase volume progress"
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
                </Tooltip>
              </div>
            </div>
          )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <DatePickerField
              id="startedAt"
              label="Start date"
              value={startedAt}
              open={openDatePicker === "startedAt"}
              onOpenChange={(open) => setOpenDatePicker(open ? "startedAt" : null)}
              onChange={setStartedAt}
            />

            <DatePickerField
              id="completedAt"
              label="End date"
              value={completedAt}
              open={openDatePicker === "completedAt"}
              onOpenChange={(open) => setOpenDatePicker(open ? "completedAt" : null)}
              onChange={setCompletedAt}
            />

            <label className="block">
              <span className="mb-2 block text-sm text-white/65">
                Total {isManga ? "rereads" : "rewatches"}
              </span>
              <input
                type="number"
                min={0}
                value={repeatCount}
                onChange={(event) =>
                  setRepeatCount(Math.max(0, Math.floor(Number(event.target.value) || 0)))
                }
                className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-white outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-4">
              <label className="block text-sm text-white/65">Score</label>
              <span className="text-sm text-white/35">{scoreLabel}</span>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_7rem_auto] sm:items-center">
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.1}
                  value={scoreSliderValue}
                  onChange={(event) => updateScoreFromSlider(event.target.value)}
                  aria-label="Score slider from 0 to 10"
                  className="h-2 w-full cursor-pointer accent-[var(--app-accent)]"
                />

                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={score}
                  onChange={(event) => updateScoreFromInput(event.target.value)}
                  onBlur={() => setScore((current) => normalizeScoreInput(current))}
                  onFocus={(event) => event.currentTarget.select()}
                  placeholder="None"
                  aria-label="Score from 0 to 10"
                  className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-center text-lg font-semibold text-white outline-none placeholder:text-white/25 [appearance:textfield] focus:border-white/25 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />

                <button
                  type="button"
                  onClick={() => setScore("")}
                  disabled={!score.trim()}
                  className="inline-flex h-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white/65 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Clear
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-white/35">
                <span>0</span>
                <span>Personal score out of 10</span>
                <span>10</span>
              </div>
            </div>
          </div>

          <div className="flex min-h-[150px] flex-1 flex-col">
            <label className="mb-2 block text-sm text-white/65">Notes</label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional notes..."
              className="min-h-0 flex-1 resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-white outline-none placeholder:text-white/25"
            />
          </div>
        </div>

        {message && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/75">
            {message}
          </div>
        )}

        <div className="mt-auto flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy || resolvingConflict || Boolean(entry?.cloud_conflict)}
            className="flex items-center justify-center gap-2 rounded-2xl border border-red-400/15 bg-red-500/10 px-4 py-3 text-sm text-red-200 transition hover:bg-red-500/15 disabled:opacity-50"
          >
            <TrashIcon className="h-4 w-4" />
            Remove
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy || resolvingConflict}
              className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/75 transition hover:bg-white/10 hover:text-white disabled:opacity-50 sm:flex-none"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={busy || resolvingConflict || Boolean(entry?.cloud_conflict)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--app-accent)] px-5 py-3 text-sm font-semibold text-black shadow-lg shadow-[var(--app-accent)]/15 transition hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 sm:flex-none"
            >
              <CheckCircleIcon className="h-4 w-4" />
              {busy ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DatePickerField({
  id,
  label,
  value,
  open,
  onOpenChange,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() => dateFromInputValue(value));

  const selectedDate = value ? dateFromInputValue(value) : null;
  const monthLabel = visibleMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const days = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const start = new Date(year, month, 1 - firstDay.getDay());

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [visibleMonth]);

  function moveMonth(offset: number) {
    setVisibleMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + offset, 1)
    );
  }

  function togglePicker() {
    const nextOpen = !open;

    if (nextOpen && value) {
      setVisibleMonth(dateFromInputValue(value));
    }

    onOpenChange(nextOpen);
  }

  function selectDate(date: Date) {
    onChange(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate()
      ).padStart(2, "0")}`
    );
    onOpenChange(false);
  }

  return (
    <div className="relative">
      <span className="mb-2 flex items-center gap-2 text-sm text-white/65">
        <CalendarDaysIcon className="h-4 w-4" />
        {label}
      </span>

      <button
        type="button"
        onClick={togglePicker}
        className="flex h-12 w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 text-left text-white outline-none transition hover:border-white/20 hover:bg-white/[0.04]"
        aria-expanded={open}
        aria-controls={`${id}-calendar`}
      >
        <span className={value ? "text-white" : "text-white/30"}>
          {value || "Pick date"}
        </span>
        <CalendarDaysIcon className="h-4 w-4 text-white/45" />
      </button>

      {open && (
        <div
          id={`${id}-calendar`}
          className="absolute left-0 top-full z-90 mt-2 w-72 rounded-3xl border border-white/10 bg-[#151515]/98 p-3 shadow-2xl backdrop-blur-md"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              Prev
            </button>
            <p className="text-sm font-semibold text-white">{monthLabel}</p>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              Next
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase text-white/35">
            {["S", "M", "T", "W", "T", "F", "S"].map((day) => (
              <div key={day} className="py-1">
                {day}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {days.map((date) => {
              const isCurrentMonth = date.getMonth() === visibleMonth.getMonth();
              const isSelected =
                selectedDate &&
                date.getFullYear() === selectedDate.getFullYear() &&
                date.getMonth() === selectedDate.getMonth() &&
                date.getDate() === selectedDate.getDate();

              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  onClick={() => selectDate(date)}
                  className={`h-8 rounded-xl text-sm transition ${
                    isSelected
                      ? "bg-white font-semibold text-black"
                      : isCurrentMonth
                        ? "text-white/75 hover:bg-white/10 hover:text-white"
                        : "text-white/25 hover:bg-white/5"
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onChange("");
                onOpenChange(false);
              }}
              className="rounded-xl px-3 py-2 text-sm text-white/45 transition hover:bg-white/10 hover:text-white"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => selectDate(new Date())}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/75 transition hover:bg-white/10 hover:text-white"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
