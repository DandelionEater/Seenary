import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import {
  ArrowRightStartOnRectangleIcon,
  BellIcon,
  BookmarkIcon,
  ChevronDownIcon,
  Cog6ToothIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  PowerIcon,
  UserCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { formatLocalDateTime } from "../utils/dateFormat";
import type { SearchMatchType } from "../types/domain";
import type { NavbarStyle } from "./SettingsPage";
import { FloatingMenu } from "./ui/FloatingMenu";
import { Tooltip } from "./ui/Tooltip";

export type ResolvedSearchTerm = {
  id: string;
  query: string;
  matchTypes: SearchMatchType[];
};

type NotificationItem = {
  id: number;
  kind: "success" | "error" | "warning";
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
};

type TopNavbarProps = {
  query: string;
  onSearch: (query: string) => void;
  resolvedSearchTerms: ResolvedSearchTerm[];
  activeSearchMatchTypes: SearchMatchType[];
  onCommitSearchTerm: (matchTypes: SearchMatchType[]) => void;
  onEditSearchTerm: (id: string) => void;
  onRemoveSearchTerm: (id: string) => void;
  onClear: () => void;
  onSubmitSearch: (query: string) => void;
  onRestoreSearchResults: () => void;
  username: string;
  notifications: NotificationItem[];
  onReadNotification: (id: number) => void;
  onDismissNotification: (id: number) => void;
  onClearNotifications: () => void;
  onLogout: () => void;
  currentView: "home" | "list" | "details" | "studio" | "artist" | "settings";
  onOpenHome: () => void;
  onOpenMyList: () => void;
  onOpenSettings: () => void;
  focusSearchOnMount?: boolean;
  navbarStyle: NavbarStyle;
  hideMyListShortcut?: boolean;
};

export function TopNavbar({
  query,
  onSearch,
  resolvedSearchTerms,
  activeSearchMatchTypes,
  onCommitSearchTerm,
  onEditSearchTerm,
  onRemoveSearchTerm,
  onClear,
  onSubmitSearch,
  onRestoreSearchResults,
  username,
  notifications,
  onReadNotification,
  onDismissNotification,
  onClearNotifications,
  onLogout,
  currentView,
  onOpenHome,
  onOpenMyList,
  onOpenSettings,
  focusSearchOnMount = false,
  navbarStyle,
  hideMyListShortcut = false,
}: TopNavbarProps) {
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedSearchResolutionIndex, setSelectedSearchResolutionIndex] = useState(0);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const selectSearchTextOnFocusRef = useRef(true);
  const lastNavigationWasPointerRef = useRef(false);
  const accountCloseTimerRef = useRef<number | null>(null);
  const notificationsCloseTimerRef = useRef<number | null>(null);
  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const isFloating = navbarStyle === "floating";
  const isMinimal = navbarStyle === "minimal";
  const hasSearch = Boolean(query.trim() || resolvedSearchTerms.length);
  const canCommitSearchTerm = Boolean(query.trim() && activeSearchMatchTypes.length);
  const searchResolutionOptions =
    activeSearchMatchTypes.length > 1
      ? [activeSearchMatchTypes, ...activeSearchMatchTypes.map((matchType) => [matchType])]
      : activeSearchMatchTypes.length
        ? [activeSearchMatchTypes]
        : [];
  const selectedSearchResolution =
    searchResolutionOptions[selectedSearchResolutionIndex] ?? activeSearchMatchTypes;

  useEffect(() => {
    setSelectedSearchResolutionIndex(0);
  }, [query, activeSearchMatchTypes]);

  const clearAccountCloseTimer = useCallback(() => {
    if (accountCloseTimerRef.current !== null) {
      window.clearTimeout(accountCloseTimerRef.current);
      accountCloseTimerRef.current = null;
    }
  }, []);

  const clearNotificationsCloseTimer = useCallback(() => {
    if (notificationsCloseTimerRef.current !== null) {
      window.clearTimeout(notificationsCloseTimerRef.current);
      notificationsCloseTimerRef.current = null;
    }
  }, []);

  const closeAccountMenu = useCallback(() => {
    clearAccountCloseTimer();
    setIsAccountMenuOpen(false);
  }, [clearAccountCloseTimer]);

  const closeNotifications = useCallback(() => {
    clearNotificationsCloseTimer();
    setIsNotificationsOpen(false);
  }, [clearNotificationsCloseTimer]);

  const openAccountMenu = () => {
    clearAccountCloseTimer();
    setIsAccountMenuOpen(true);
  };

  const openNotifications = () => {
    clearNotificationsCloseTimer();
    setIsNotificationsOpen(true);
  };

  const scheduleCloseAccountMenu = () => {
    clearAccountCloseTimer();

    accountCloseTimerRef.current = window.setTimeout(() => {
      setIsAccountMenuOpen(false);
      accountCloseTimerRef.current = null;
    }, 180);
  };

  const scheduleCloseNotifications = () => {
    clearNotificationsCloseTimer();

    notificationsCloseTimerRef.current = window.setTimeout(() => {
      setIsNotificationsOpen(false);
      notificationsCloseTimerRef.current = null;
    }, 180);
  };

  const handleAccountBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (accountMenuRef.current?.contains(event.relatedTarget as Node | null)) {
      return;
    }

    scheduleCloseAccountMenu();
  };

  const handleNotificationsBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (notificationsRef.current?.contains(event.relatedTarget as Node | null)) {
      return;
    }

    scheduleCloseNotifications();
  };

  const focusSearchInput = useCallback((selectExistingText = true) => {
    const input = searchInputRef.current;
    if (!input) return;

    selectSearchTextOnFocusRef.current = selectExistingText;
    input.focus();
    selectSearchTextOnFocusRef.current = true;

    if (selectExistingText && input.value) {
      window.requestAnimationFrame(() => {
        input.select();
      });
    }
  }, []);

  const handleClearSearch = () => {
    onClear();
    window.requestAnimationFrame(() => {
      focusSearchInput(false);
    });
  };

  const handleSearchCloseOrClear = () => {
    if (hasSearch) {
      handleClearSearch();
      return;
    }

    searchInputRef.current?.blur();
  };

  const handleEditResolvedSearchTerm = (id: string) => {
    onEditSearchTerm(id);
    window.requestAnimationFrame(() => {
      focusSearchInput(false);
    });
  };

  useEffect(() => {
    const handleWindowBlur = () => {
      closeAccountMenu();
      closeNotifications();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        closeAccountMenu();
        closeNotifications();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      lastNavigationWasPointerRef.current = true;

      if (!accountMenuRef.current?.contains(event.target as Node | null)) {
        closeAccountMenu();
      }

      if (!notificationsRef.current?.contains(event.target as Node | null)) {
        closeNotifications();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isKeyboardNavigationKey(event.key)) {
        lastNavigationWasPointerRef.current = false;
      }

    };

    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      clearAccountCloseTimer();
      clearNotificationsCloseTimer();
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    clearAccountCloseTimer,
    clearNotificationsCloseTimer,
    closeAccountMenu,
    closeNotifications,
  ]);

  useEffect(() => {
    if (!focusSearchOnMount) {
      return;
    }

    window.requestAnimationFrame(() => {
      focusSearchInput(false);
    });
  }, [focusSearchInput, focusSearchOnMount]);

  useEffect(() => {
    if (!window.desktopWindow?.onFocusSearch) return;

    return window.desktopWindow.onFocusSearch(() => {
      window.requestAnimationFrame(() => {
        focusSearchInput(false);
      });
    });
  }, [focusSearchInput]);

  useEffect(() => {
    function handleGlobalSearchFocus(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Delete") {
        const input = searchInputRef.current;
        const target = event.target as HTMLElement | null;
        const isSearchInput = target === input;

        if (
          !input ||
          !hasSearch ||
          (!isSearchInput && isKeyboardInputTarget(target)) ||
          hasOpenModalSurface()
        ) {
          return;
        }

        event.preventDefault();
        onClear();
        return;
      }

      if (!shouldFocusSearchFromKey(event, lastNavigationWasPointerRef.current)) {
        return;
      }

      const input = searchInputRef.current;
      if (!input || document.activeElement === input) {
        return;
      }

      event.preventDefault();

      if (event.key !== "Enter") {
        onSearch(event.key);
      }

      window.requestAnimationFrame(() => {
        focusSearchInput(event.key === "Enter");
      });
    }

    document.addEventListener("keydown", handleGlobalSearchFocus);
    return () => document.removeEventListener("keydown", handleGlobalSearchFocus);
  }, [focusSearchInput, hasSearch, onClear, onSearch]);

  return (
    <div
      onMouseDownCapture={(event) => {
        if (event.button !== 0) return;

        const target = event.target as HTMLElement | null;
        if (target?.closest("button")) {
          // Mouse-activated navbar controls should not retain keyboard focus and
          // intercept the next global Enter-to-search shortcut. Tab navigation
          // still focuses the same controls normally.
          event.preventDefault();
        }
      }}
      className={`drag-region absolute z-40 flex items-center justify-center transition-[inset,background-color,border-color,border-radius,box-shadow] duration-300 ${
        isFloating
          ? "inset-x-3 top-3 h-14 rounded-2xl border border-white/10 bg-[#111111]/62 px-3 shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur-xl"
          : "inset-x-0 top-0 h-16 px-4"
      } max-sm:inset-x-0 max-sm:top-0 max-sm:h-16 max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0 max-sm:bg-[#111111]/92 max-sm:px-2 max-sm:shadow-lg`}
    >
      {!isFloating && !isMinimal && (
        <div className="absolute inset-0 bg-[#0f0f0f]/45 backdrop-blur-md" />
      )}

      <div className="relative flex w-full items-center justify-center max-sm:gap-1">
        <div
          className={`absolute left-0 flex items-center transition-all duration-200 ${
            hideMyListShortcut ? "gap-0" : "gap-2"
          } ${
            isMinimal
              ? hideMyListShortcut
                ? "rounded-xl bg-[#111111]/82 shadow-xl backdrop-blur-xl"
                : "h-12 rounded-2xl border border-white/10 bg-[#111111]/62 p-1 shadow-xl backdrop-blur-xl"
              : ""
          } max-sm:static max-sm:shrink-0 max-sm:gap-0`}
        >
          <Tooltip content="Open home" placement="bottom" align="start">
          <button
            onClick={onOpenHome}
            aria-label="Open home"
            className={`no-drag inline-flex items-center justify-center rounded-xl border p-2 text-sm transition-all duration-200 ease-out active:scale-95 ${
              currentView === "home"
                ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white"
                : "border-transparent bg-transparent text-white/65 hover:bg-white/10 hover:text-white"
            }`}
          >
            <HomeIcon className="h-5 w-5" />
          </button>
          </Tooltip>

          <button
            onClick={onOpenMyList}
            aria-hidden={hideMyListShortcut}
            tabIndex={hideMyListShortcut ? -1 : 0}
            className={`no-drag flex items-center gap-2 overflow-hidden rounded-xl border py-2 text-sm whitespace-nowrap transition-all duration-200 ease-out active:scale-95 ${
              hideMyListShortcut
                ? "pointer-events-none max-w-0 border-transparent px-0 opacity-0"
                : "max-w-32 px-3 opacity-100 max-sm:max-w-10 max-sm:px-2"
            } ${
              !hideMyListShortcut && currentView === "list"
                ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white"
                : "border-transparent bg-transparent text-white/65 hover:bg-white/10 hover:text-white"
            }`}
          >
            <BookmarkIcon className="h-5 w-5" />
            <span className="max-sm:hidden">My List</span>
          </button>
        </div>

        <div
          className={`no-drag relative mx-auto flex w-full items-center gap-2 rounded-2xl border px-3 py-2 shadow-lg transition-[max-width,border-color,background-color,box-shadow] duration-300 max-sm:mx-1 max-sm:min-w-0 max-sm:flex-1 max-sm:px-2 ${
            isFloating ? "max-w-lg" : "max-w-xl"
          } ${isMinimal ? "h-12" : ""} ${
            isSearchFocused
              ? "border-white/20 bg-white/9 shadow-[0_10px_35px_rgba(0,0,0,0.32)]"
              : isMinimal
                ? "border-white/10 bg-[#111111]/62 backdrop-blur-xl"
                : "border-white/10 bg-white/6"
          }`}
        >
          <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-white/45" />

          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {resolvedSearchTerms.map((term) => (
              <div
                key={term.id}
                className="flex shrink-0 items-center overflow-hidden rounded-lg border border-[var(--app-accent)]/55 bg-[var(--app-accent-soft)] text-white shadow-[0_0_18px_rgba(0,0,0,0.12)]"
              >
                <button
                  type="button"
                  onClick={() => handleEditResolvedSearchTerm(term.id)}
                  className="flex min-w-0 items-center gap-1.5 py-1 pl-2 pr-1 text-xs transition hover:bg-white/5"
                  aria-label={`Edit resolved search ${term.query}`}
                >
                  <span className="flex items-center gap-1">
                    {term.matchTypes.map((matchType) => (
                      <span
                        key={matchType}
                        className="rounded bg-black/20 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white/60"
                      >
                        {getSearchMatchTypeLabel(matchType)}
                      </span>
                    ))}
                  </span>
                  <span className="max-w-28 truncate font-medium">{term.query}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveSearchTerm(term.id)}
                  className="mr-0.5 rounded p-1 text-white/45 transition hover:bg-white/10 hover:text-white"
                  aria-label={`Remove ${term.query} from search`}
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </div>
            ))}

            <input
              ref={searchInputRef}
              type="text"
              value={query}
              placeholder={
                resolvedSearchTerms.length
                  ? "Add another..."
                  : "Search titles, characters, studios, or music..."
              }
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
                const caretIsAtEnd =
                  event.currentTarget.selectionStart === event.currentTarget.value.length &&
                  event.currentTarget.selectionEnd === event.currentTarget.value.length;

                if (
                  canCommitSearchTerm &&
                  (event.key === "ArrowDown" || event.key === "ArrowUp")
                ) {
                  event.preventDefault();
                  setSelectedSearchResolutionIndex((current) => {
                    const direction = event.key === "ArrowDown" ? 1 : -1;
                    return (
                      current + direction + searchResolutionOptions.length
                    ) % searchResolutionOptions.length;
                  });
                  return;
                }

                if (
                  canCommitSearchTerm &&
                  ((event.key === "Tab" && !event.shiftKey) || (event.key === "ArrowRight" && caretIsAtEnd))
                ) {
                  event.preventDefault();
                  onCommitSearchTerm(selectedSearchResolution);
                  return;
                }

                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmitSearch(event.currentTarget.value);
                  event.currentTarget.blur();
                }
              }}
              onFocus={(event) => {
                const shouldSelectExistingText = selectSearchTextOnFocusRef.current;
                setIsSearchFocused(true);
                if (hasSearch) {
                  onRestoreSearchResults();
                  if (event.currentTarget.value && shouldSelectExistingText) {
                    event.currentTarget.select();
                  }
                }
              }}
              onBlur={() => setIsSearchFocused(false)}
              className="min-w-28 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
          </div>

          {!hasSearch && !isSearchFocused && (
            <kbd className="hidden shrink-0 items-center rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-medium tracking-wide text-white/38 sm:inline-flex">
              Enter
            </kbd>
          )}

          {(hasSearch || isSearchFocused) && (
            <>
              <kbd
                className={`hidden shrink-0 items-center rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-medium tracking-wide sm:inline-flex ${
                  hasSearch ? "text-white/38" : "text-white/25"
                }`}
              >
                Del
              </kbd>
              <Tooltip content={hasSearch ? "Clear search" : "Unfocus search"} placement="bottom">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleSearchCloseOrClear}
                className="no-drag rounded-full p-1 text-white/45 transition-all duration-200 ease-out hover:scale-105 hover:bg-white/10 hover:text-white active:scale-95"
                aria-label={hasSearch ? "Clear search" : "Unfocus search"}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
              </Tooltip>
            </>
          )}

          {isSearchFocused && canCommitSearchTerm && (
            <div
              role="listbox"
              aria-label={`Choose how to resolve ${query.trim()}`}
              className="absolute left-8 right-8 top-[calc(100%+0.45rem)] overflow-hidden rounded-xl border border-white/10 bg-[#171717]/96 p-1.5 shadow-2xl backdrop-blur-xl"
            >
              {searchResolutionOptions.map((matchTypes, index) => {
                const isAllOption = matchTypes.length > 1;
                const optionLabel = isAllOption
                  ? matchTypes.map(getSearchMatchTypeLabel).join(" + ")
                  : `${getSearchMatchTypeLabel(matchTypes[0])} only`;
                const isSelected = index === selectedSearchResolutionIndex;

                return (
                  <button
                    key={matchTypes.join("-")}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setSelectedSearchResolutionIndex(index)}
                    onClick={() => onCommitSearchTerm(matchTypes)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition ${
                      isSelected
                        ? "bg-white/10 text-white"
                        : "text-white/55 hover:bg-white/[0.06] hover:text-white/80"
                    }`}
                  >
                    <span className="min-w-0 truncate text-xs">
                      {isAllOption ? (
                        <>
                          Resolve <span className="font-semibold text-white">“{query.trim()}”</span>
                        </>
                      ) : (
                        <span className="font-medium">{optionLabel}</span>
                      )}
                      {isAllOption && (
                        <span className="ml-2 text-white/40">{optionLabel}</span>
                      )}
                    </span>
                    {isSelected && (
                      <span className="flex shrink-0 items-center gap-1 text-[9px] text-white/35">
                        <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
                          Tab
                        </kbd>
                        <span>or</span>
                        <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
                          →
                        </kbd>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          className={`no-drag absolute right-0 top-0 flex items-start gap-2 transition ${
            isMinimal
              ? "h-12 rounded-2xl border border-white/10 bg-[#111111]/62 p-1 shadow-xl backdrop-blur-xl"
              : ""
          } max-sm:static max-sm:h-auto max-sm:shrink-0 max-sm:gap-0 max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none`}
        >
          <div
            ref={notificationsRef}
            className="relative"
            onMouseLeave={scheduleCloseNotifications}
            onFocus={openNotifications}
            onBlur={handleNotificationsBlur}
          >
            <Tooltip content="Notifications" placement="bottom">
            <button
              type="button"
              onMouseEnter={openNotifications}
              onClick={() => setIsNotificationsOpen((current) => !current)}
              className="relative flex items-center justify-center rounded-xl border border-transparent p-2 text-white/70 transition-all duration-200 ease-out hover:bg-white/10 hover:text-white"
              aria-label="Notifications"
            >
              <BellIcon className="h-6 w-6" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[var(--app-accent)] px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-black">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            </Tooltip>

            <FloatingMenu
              open={isNotificationsOpen}
              widthClass="w-80 max-sm:w-auto"
              role="dialog"
              className="max-sm:fixed max-sm:left-2 max-sm:right-2 max-sm:top-16 max-sm:mt-2"
            >
              <div onMouseEnter={openNotifications}>
              <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
                <p className="text-sm font-semibold text-white">Notifications</p>
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearNotifications}
                    className="rounded-lg px-2 py-1 text-xs text-white/45 transition hover:bg-white/10 hover:text-white/75"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="scroll-container max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-white/40">
                    No notifications yet.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {notifications.map((notification) => (
                      <button
                        key={notification.id}
                        type="button"
                        onClick={() => onReadNotification(notification.id)}
                        className={`group/notification w-full rounded-xl border py-2.5 pl-3 pr-2 text-left transition ${
                          notification.read
                            ? "border-transparent bg-transparent hover:bg-white/[0.05]"
                            : "border-[var(--app-accent)] bg-[var(--app-accent-soft)]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">
                              {notification.title}
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/55">
                              {notification.message}
                            </p>
                          </div>
                          <div className="flex h-6 w-7 shrink-0 items-center justify-end">
                            {!notification.read && (
                              <span className="h-2 w-2 rounded-full bg-[var(--app-accent)] transition-transform duration-200 ease-out group-hover/notification:-translate-x-4 group-focus-within/notification:-translate-x-4" />
                            )}
                            <Tooltip content="Dismiss notification" align="end">
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={`Dismiss ${notification.title}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDismissNotification(notification.id);
                              }}
                              className="-ml-1 translate-x-1 rounded-full p-1 text-white/35 opacity-0 transition duration-200 ease-out hover:bg-white/10 hover:text-white/75 focus:translate-x-0 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/45 group-hover/notification:translate-x-0 group-hover/notification:opacity-100"
                            >
                              <XMarkIcon className="h-3.5 w-3.5" />
                            </span>
                            </Tooltip>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-white/30">
                          {formatLocalDateTime(notification.createdAt)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </FloatingMenu>
          </div>

          <div
            ref={accountMenuRef}
            className="relative"
            onMouseLeave={scheduleCloseAccountMenu}
            onFocus={openAccountMenu}
            onBlur={handleAccountBlur}
          >
            <Tooltip content={username} placement="bottom" align="end">
            <button
              type="button"
              onMouseEnter={openAccountMenu}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-all duration-200 ease-out ${
                currentView === "settings"
                  ? "border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-white"
                  : "border-transparent text-white/70 hover:bg-white/10 hover:text-white"
              } max-sm:px-2`}
              aria-label={username}
            >
              <UserCircleIcon className="h-6 w-6" />
              <span className="max-w-30 truncate text-sm max-sm:hidden">{username}</span>
              <ChevronDownIcon
                className={`h-4 w-4 text-white/45 transition-transform duration-200 max-sm:hidden ${
                  isAccountMenuOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            </Tooltip>

            <FloatingMenu open={isAccountMenuOpen} widthClass="w-48">
              <div onMouseEnter={openAccountMenu}>
              <button
                type="button"
                onClick={() => {
                  closeAccountMenu();
                  onOpenSettings();
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                  currentView === "settings"
                    ? "bg-[var(--app-accent-soft)] text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Cog6ToothIcon className="h-5 w-5" />
                Settings
              </button>

              <button
                type="button"
                onClick={() => {
                  closeAccountMenu();
                  onLogout();
                }}
                className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                <ArrowRightStartOnRectangleIcon className="h-5 w-5" />
                Log out
              </button>

              {window.desktopWindow?.closeApp && (
                <button
                  type="button"
                  onClick={() => window.desktopWindow?.closeApp()}
                  className="mt-2 flex w-full items-center gap-3 border-t border-white/10 px-3 pb-2 pt-3 text-left text-sm text-red-200/75 transition hover:text-red-100"
                >
                  <PowerIcon className="h-5 w-5" />
                  Close Seenary
                </button>
              )}
              </div>
            </FloatingMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

function getSearchMatchTypeLabel(matchType: SearchMatchType) {
  if (matchType === "ANIME") return "Anime";
  if (matchType === "MANGA") return "Manga";
  if (matchType === "CHARACTER") return "Character";
  if (matchType === "STUDIO") return "Studio";
  if (matchType === "ARTIST") return "Artist";
  return "Song";
}

function shouldFocusSearchFromKey(event: KeyboardEvent, lastNavigationWasPointer: boolean) {
  const isEnterShortcut = event.key === "Enter";
  const isTypeToSearchShortcut = event.key.length === 1;

  if (
    event.defaultPrevented ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    (!isEnterShortcut && !isTypeToSearchShortcut)
  ) {
    return false;
  }

  const target = event.target as HTMLElement | null;

  if (isKeyboardInputTarget(target)) {
    return false;
  }

  const interactiveTarget = target?.closest(
    "button, a, [role='button'], [role='menuitem'], [role='option']"
  );

  if (
    interactiveTarget &&
    (event.key === " " || (isEnterShortcut && !lastNavigationWasPointer))
  ) {
    return false;
  }

  if (hasOpenModalSurface()) {
    return false;
  }

  return true;
}

function isKeyboardNavigationKey(key: string) {
  return (
    key === "Tab" ||
    key === " " ||
    key === "Escape" ||
    key === "Home" ||
    key === "End" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key.startsWith("Arrow")
  );
}

function hasOpenModalSurface() {
  return Boolean(
    document.querySelector(
      '[role="dialog"]:not([aria-hidden="true"]), [role="alertdialog"]:not([aria-hidden="true"]), [aria-modal="true"]:not([aria-hidden="true"])'
    )
  );
}

function isKeyboardInputTarget(element: HTMLElement | null) {
  if (!element) return false;

  const tagName = element.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    element.isContentEditable ||
    Boolean(element.closest("input, textarea, select, [contenteditable='true']"))
  );
}
