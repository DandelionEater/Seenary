import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  BookOpenIcon,
  ChevronDownIcon,
  HomeIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  PlayCircleIcon,
} from "@heroicons/react/24/outline";
import type { MediaType } from "../types/domain";
import { FloatingMenu } from "./ui/FloatingMenu";

export type LibraryDestination = "personal" | "discover" | "list";

type LibraryLensProps = {
  mediaType: MediaType;
  destination: LibraryDestination;
  onMediaChange: (mediaType: MediaType) => void;
  onDestinationChange: (destination: LibraryDestination) => void;
  onVisibilityChange?: (isVisible: boolean) => void;
};

const DESTINATIONS = [
  { value: "personal", label: "Personal", icon: HomeIcon },
  { value: "discover", label: "Discover", icon: MagnifyingGlassIcon },
  { value: "list", label: "My List", icon: ListBulletIcon },
] as const;

export function LibraryLens({
  mediaType,
  destination,
  onMediaChange,
  onDestinationChange,
  onVisibilityChange,
}: LibraryLensProps) {
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mediaButtonRef = useRef<HTMLButtonElement | null>(null);
  const mediaMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MediaIcon = mediaType === "MANGA" ? BookOpenIcon : PlayCircleIcon;
  const mediaLabel = mediaType === "MANGA" ? "Manga" : "Anime";
  const destinationLabel = DESTINATIONS.find((item) => item.value === destination)?.label;

  useEffect(() => {
    const element = rootRef.current;
    if (!element || !onVisibilityChange) return;

    const observer = new IntersectionObserver(
      ([entry]) => onVisibilityChange(entry.isIntersecting),
      {
        // Floating and Minimal navbars leave transparent gaps. Keep the
        // duplicate shortcut hidden until the Lens has fully left the viewport,
        // including the portions that remain visible through those gaps.
        rootMargin: "0px",
        threshold: 0.01,
      }
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      onVisibilityChange(false);
    };
  }, [onVisibilityChange]);

  useEffect(() => {
    function closeMenus(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMediaMenuOpen(false);
        setMobileMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      if (mediaMenuCloseTimerRef.current) {
        clearTimeout(mediaMenuCloseTimerRef.current);
      }
    };
  }, []);

  function cancelMediaMenuClose() {
    if (!mediaMenuCloseTimerRef.current) return;
    clearTimeout(mediaMenuCloseTimerRef.current);
    mediaMenuCloseTimerRef.current = null;
  }

  function openMediaMenuOnHover(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    cancelMediaMenuClose();
    setMediaMenuOpen(true);
  }

  function closeMediaMenuAfterHover(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    cancelMediaMenuClose();
    mediaMenuCloseTimerRef.current = setTimeout(() => {
      setMediaMenuOpen(false);
      mediaMenuCloseTimerRef.current = null;
    }, 140);
  }

  function chooseMedia(nextMediaType: MediaType, restoreKeyboardFocus: boolean) {
    cancelMediaMenuClose();
    onMediaChange(nextMediaType);
    setMediaMenuOpen(false);
    if (restoreKeyboardFocus) {
      mediaButtonRef.current?.focus();
    }
  }

  function chooseDestination(nextDestination: LibraryDestination) {
    onDestinationChange(nextDestination);
    setMobileMenuOpen(false);
  }

  return (
    <div
      ref={rootRef}
      onMouseDownCapture={(event) => {
        if (event.button !== 0) return;

        const target = event.target as HTMLElement | null;
        if (target?.closest("button")) {
          // Pointer-driven view changes should not leave a Lens control focused
          // and intercept the next global Enter-to-search shortcut. Keyboard
          // activation still keeps the expected menu focus behavior.
          event.preventDefault();
        }
      }}
      className="no-drag relative z-30"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={mobileMenuOpen}
        onClick={() => setMobileMenuOpen((open) => !open)}
        className="flex w-full min-w-56 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-white/7 focus:outline-none focus:ring-2 focus:ring-(--app-accent)/45 md:hidden"
      >
        <span className="flex items-center gap-2.5">
          <MediaIcon className="h-5 w-5 text-(--app-accent)" />
          {mediaLabel} · {destinationLabel}
        </span>
        <ChevronDownIcon className={`h-4 w-4 text-white/45 transition ${mobileMenuOpen ? "rotate-180" : ""}`} />
      </button>

      <div className="hidden items-center rounded-2xl border border-white/10 bg-white/4 p-1 shadow-lg md:flex">
        <div
          className="relative"
          onPointerEnter={openMediaMenuOnHover}
          onPointerLeave={closeMediaMenuAfterHover}
        >
          <button
            ref={mediaButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={mediaMenuOpen}
            onClick={() => setMediaMenuOpen((open) => !open)}
            className="flex min-w-32 items-center justify-between gap-2 rounded-xl border border-(--app-accent)/15 bg-(--app-accent-soft) px-3.5 py-2.5 text-sm font-semibold text-white transition hover:border-(--app-accent)/30 focus:outline-none focus:ring-2 focus:ring-(--app-accent)/45"
          >
            <span className="flex items-center gap-2">
              <MediaIcon className="h-4.5 w-4.5 text-(--app-accent)" />
              {mediaLabel}
            </span>
            <ChevronDownIcon className={`h-3.5 w-3.5 text-white/45 transition-transform duration-200 ${mediaMenuOpen ? "rotate-180" : ""}`} />
          </button>

          <FloatingMenu open={mediaMenuOpen} widthClass="w-full">
            {(["ANIME", "MANGA"] as MediaType[]).map((option) => {
              const OptionIcon = option === "MANGA" ? BookOpenIcon : PlayCircleIcon;
              return (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mediaType === option}
                  tabIndex={mediaMenuOpen ? 0 : -1}
                  onClick={(event) => chooseMedia(option, event.detail === 0)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                    mediaType === option
                      ? "bg-(--app-accent) text-black"
                      : "text-white/65 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <OptionIcon className="h-4.5 w-4.5" />
                  {option === "MANGA" ? "Manga" : "Anime"}
                </button>
              );
            })}
          </FloatingMenu>
        </div>

        <div className="mx-1 h-7 w-px bg-white/10" />
        {DESTINATIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => chooseDestination(value)}
            aria-current={destination === value ? "page" : undefined}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-(--app-accent)/45 ${
              destination === value
                ? "bg-(--app-accent) text-black shadow-lg shadow-(--app-accent)/20"
                : "text-white/50 hover:bg-white/8 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4 xl:hidden" />
            <span className="hidden lg:inline">{label}</span>
          </button>
        ))}
      </div>

      {mobileMenuOpen && (
        <div className="absolute right-0 top-[calc(100%+0.6rem)] grid w-72 grid-cols-2 gap-2 rounded-3xl border border-white/12 bg-[#181818]/98 p-3 shadow-2xl backdrop-blur-xl md:hidden">
          {DESTINATIONS.flatMap(({ value, label, icon: Icon }) =>
            (["ANIME", "MANGA"] as MediaType[]).map((option) => (
              <button
                key={`${option}-${value}`}
                type="button"
                onClick={() => {
                  onMediaChange(option);
                  chooseDestination(value);
                }}
                className={`rounded-2xl border p-3 text-left transition ${
                  mediaType === option && destination === value
                    ? "border-(--app-accent)/35 bg-(--app-accent-soft) text-white"
                    : "border-white/7 bg-white/3 text-white/55 hover:bg-white/7 hover:text-white"
                }`}
              >
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                  <Icon className="h-4 w-4" />
                  {option === "MANGA" ? "Manga" : "Anime"}
                </span>
                <span className="mt-2 block text-sm font-semibold">{label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
