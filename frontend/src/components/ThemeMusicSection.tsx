import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ArrowPathIcon,
  MusicalNoteIcon,
  PauseIcon,
  PlayIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from "@heroicons/react/24/outline";
import type { AnimeThemeMusicItem } from "../types/domain";

const VOLUME_STORAGE_KEY = "seenary:song-preview-volume";
const PREVIEW_START_SECONDS = 12;
const PREVIEW_DURATION_SECONDS = 20;

let activeDetailsPreview: { audio: HTMLAudioElement; stop: () => void } | null = null;

type ThemeMusicSectionProps = {
  items: AnimeThemeMusicItem[];
  loading: boolean;
};

export function ThemeMusicSection({ items, loading }: ThemeMusicSectionProps) {
  const [volume, setVolume] = useState(readPreviewVolume);

  if (!loading && items.length === 0) return null;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-white/55">
            <MusicalNoteIcon className="h-4 w-4" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.22em]">
              Theme music
            </h2>
          </div>
          <p className="mt-1.5 text-xs text-white/35">
            Openings and endings provided by AnimeThemes.
          </p>
        </div>

        {items.length > 0 && (
          <label className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-white/55">
            {volume === 0 ? (
              <SpeakerXMarkIcon className="h-4 w-4 shrink-0" />
            ) : (
              <SpeakerWaveIcon className="h-4 w-4 shrink-0" />
            )}
            <span className="sr-only">Theme preview volume</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={Math.round(volume * 100)}
              onChange={(event) => {
                const nextVolume = Math.min(
                  1,
                  Math.max(0, Number(event.target.value) / 100)
                );
                setVolume(nextVolume);
                try {
                  window.localStorage.setItem(VOLUME_STORAGE_KEY, String(nextVolume));
                } catch {
                  // Keep the in-memory value if storage is unavailable.
                }
              }}
              className="h-1 w-20 cursor-pointer accent-fuchsia-300"
            />
            <span className="w-8 text-right text-[10px] font-semibold tabular-nums">
              {Math.round(volume * 100)}%
            </span>
          </label>
        )}
      </div>

      {items.some((item) => item.cache?.stale) && (
        <p role="status" className="mb-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          AnimeThemes is unavailable. Showing theme information saved by Seenary.
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-5 text-sm text-white/40">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          Loading theme music...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((item) => (
            <ThemeMusicCard
              key={`${item.song.id}:${item.theme.id}`}
              item={item}
              volume={volume}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ThemeMusicCard({
  item,
  volume,
}: {
  item: AnimeThemeMusicItem;
  volume: number;
}) {
  const title = item.song.title.romaji || item.song.title.native || "Unknown song";
  const artists =
    item.song.artists.map((artist) => artist.name).filter(Boolean).join(", ") ||
    "Unknown artist";
  const themeLabel = `${item.theme.type}${item.theme.sequence || ""}`;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const startedAtRef = useRef(0);
  const hasStartedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  function stop(resetProgress = true) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    if (activeDetailsPreview?.audio === audio) activeDetailsPreview = null;
    setPlaying(false);
    setLoading(false);
    if (resetProgress) {
      hasStartedRef.current = false;
      setProgress(0);
    }
  }

  function prepareAudio() {
    if (!item.previewUrl) return null;
    if (audioRef.current) return audioRef.current;
    const audio = new Audio(item.previewUrl);
    audio.preload = "metadata";
    audio.volume = volume;
    audio.onplaying = () => {
      setLoading(false);
      setPlaying(true);
    };
    audio.onwaiting = () => {
      if (!audio.paused) setLoading(true);
    };
    audio.onstalled = () => {
      if (!audio.paused) setLoading(true);
    };
    audio.onpause = () => setPlaying(false);
    audio.onerror = () => stop(false);
    audio.onended = () => stop();
    audio.ontimeupdate = () => {
      const elapsed = Math.max(0, audio.currentTime - startedAtRef.current);
      setProgress(Math.min(1, elapsed / PREVIEW_DURATION_SECONDS));
      if (!audio.paused && elapsed >= PREVIEW_DURATION_SECONDS) stop();
    };
    audioRef.current = audio;
    audio.load();
    return audio;
  }

  async function togglePreview(event: MouseEvent<HTMLButtonElement>) {
    event.currentTarget.blur();
    const audio = prepareAudio();
    if (!audio) return;
    if (loading || !audio.paused) {
      stop(false);
      return;
    }

    activeDetailsPreview?.stop();
    if (!hasStartedRef.current) {
      if (audio.readyState >= 1 && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(
          PREVIEW_START_SECONDS,
          Math.max(0, audio.duration - PREVIEW_DURATION_SECONDS)
        );
      }
      startedAtRef.current = audio.currentTime;
      hasStartedRef.current = true;
      setProgress(0);
    }
    activeDetailsPreview = { audio, stop: () => stop() };
    setLoading(true);
    try {
      await audio.play();
    } catch {
      stop(false);
    }
  }

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (activeDetailsPreview?.audio === audio) activeDetailsPreview = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
    [item.previewUrl]
  );

  return (
    <article className="relative overflow-hidden rounded-2xl border border-white/9 bg-white/[0.035] p-4">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-9 min-w-9 shrink-0 items-center justify-center rounded-xl border px-2 text-[10px] font-bold ${
            item.theme.type === "OP"
              ? "border-amber-300/20 bg-amber-400/12 text-amber-100"
              : "border-cyan-300/20 bg-cyan-400/12 text-cyan-100"
          }`}
        >
          {themeLabel}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white/90">{title}</p>
          <p className="mt-1 truncate text-xs text-white/42">{artists}</p>
        </div>

        {item.previewUrl && (
          <button
            type="button"
            onClick={(event) => void togglePreview(event)}
            className="relative flex h-9 min-w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-fuchsia-300/15 bg-fuchsia-400/8 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-fuchsia-100 transition hover:bg-fuchsia-400/15 focus:outline-none focus:ring-2 focus:ring-fuchsia-100/50"
          >
            <span
              className="absolute inset-y-0 left-0 bg-fuchsia-400/25"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
            <span className="relative flex items-center gap-1.5">
              {loading ? (
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
              ) : playing ? (
                <PauseIcon className="h-3.5 w-3.5" />
              ) : (
                <PlayIcon className="h-3.5 w-3.5" />
              )}
              {loading ? "Loading" : playing ? "Pause" : "Play"}
            </span>
          </button>
        )}
      </div>
    </article>
  );
}

function readPreviewVolume() {
  try {
    const stored = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    if (stored !== null) {
      const value = Number(stored);
      if (Number.isFinite(value)) return Math.min(1, Math.max(0, value));
    }
  } catch {
    // Use the default below.
  }
  return 0.7;
}
