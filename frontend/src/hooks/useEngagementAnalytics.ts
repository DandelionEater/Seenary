import { useEffect, useRef } from "react";

const MEANINGFUL_FOREGROUND_SECONDS = 15;
const SENT_MARKER_PREFIX = "seenary:engagement-sent";

type EngagementAnalyticsOptions = {
  enabled: boolean;
  userId: number | null;
};

function getUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function getSentMarker(userId: number) {
  return `${SENT_MARKER_PREFIX}:${userId}:${getUtcDate()}`;
}

async function getPlatform() {
  if (!window.desktopEnvironment) return "web";

  try {
    const result = await window.desktopEnvironment.getInfo();
    return result.ok ? result.platform : "unknown";
  } catch {
    return "unknown";
  }
}

export function useEngagementAnalytics({
  enabled,
  userId,
}: EngagementAnalyticsOptions) {
  const foregroundSecondsRef = useRef(0);
  const interactedRef = useRef(false);
  const inFlightRef = useRef(false);
  const settledDayRef = useRef<string | null>(null);
  const retryAfterRef = useRef(0);
  const currentDayRef = useRef(getUtcDate());

  useEffect(() => {
    foregroundSecondsRef.current = 0;
    interactedRef.current = false;
    inFlightRef.current = false;
    settledDayRef.current = null;
    retryAfterRef.current = 0;
    currentDayRef.current = getUtcDate();

    if (!enabled || !userId || !window.api.recordEngagement) return;

    let active = true;

    const isForeground = () =>
      document.visibilityState === "visible" && document.hasFocus();

    const record = async () => {
      const activityDay = getUtcDate();
      const sentMarker = getSentMarker(userId);

      if (
        !active ||
        inFlightRef.current ||
        settledDayRef.current === activityDay ||
        window.localStorage.getItem(sentMarker) === "1" ||
        Date.now() < retryAfterRef.current ||
        !interactedRef.current ||
        foregroundSecondsRef.current < MEANINGFUL_FOREGROUND_SECONDS ||
        !isForeground()
      ) {
        return;
      }

      inFlightRef.current = true;

      try {
        const result = await window.api.recordEngagement({
          platform: await getPlatform(),
          appVersion: __APP_VERSION__,
        });

        if (!active) return;
        if (result.ok && (result.recorded || result.duplicate)) {
          window.localStorage.setItem(sentMarker, "1");
          settledDayRef.current = activityDay;
        } else {
          settledDayRef.current = activityDay;
        }
      } catch {
        retryAfterRef.current = Date.now() + 60_000;
      } finally {
        inFlightRef.current = false;
      }
    };

    const noteInteraction = (event: Event) => {
      if (event.isTrusted && isForeground()) {
        interactedRef.current = true;
      }
    };

    const intervalId = window.setInterval(() => {
      const activityDay = getUtcDate();
      if (currentDayRef.current !== activityDay) {
        currentDayRef.current = activityDay;
        foregroundSecondsRef.current = 0;
        interactedRef.current = false;
        settledDayRef.current = null;
        retryAfterRef.current = 0;
      }

      if (!interactedRef.current || !isForeground()) return;
      foregroundSecondsRef.current += 1;
      void record();
    }, 1000);

    const retryAfterReconnect = () => {
      retryAfterRef.current = 0;
      void record();
    };

    window.addEventListener("pointerdown", noteInteraction, { passive: true });
    window.addEventListener("online", retryAfterReconnect);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("pointerdown", noteInteraction);
      window.removeEventListener("online", retryAfterReconnect);
    };
  }, [enabled, userId]);
}
