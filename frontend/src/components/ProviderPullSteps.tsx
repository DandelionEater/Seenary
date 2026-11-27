import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useState } from "react";

type PullProgress = Parameters<Parameters<Window["api"]["onSyncProgress"]>[0]>[0];

const stages = {
  queued: "prepare",
  starting: "prepare",
  fetching: "download",
  mapping: "prepare-titles",
  hydrating: "prepare-titles",
  saving: "apply",
  processing: "apply",
  reconciling: "apply",
} as const;
type PullStep = (typeof stages)[keyof typeof stages];

export function ProviderPullSteps({ provider, progress: liveProgress, cancelling, error }: {
  provider: "mal" | "anilist";
  progress: PullProgress | null;
  cancelling: boolean;
  error: string | null;
}) {
  // Keep the terminal rows in the layout while the outer card animates closed.
  const [result, setResult] = useState<PullProgress | null>(null);
  if (liveProgress && result !== liveProgress) {
    const nextResult = liveProgress.stage === "complete" || liveProgress.stage === "cancelled" ? liveProgress : null;
    if (result !== nextResult) setResult(nextResult);
  }
  const progress = liveProgress ?? result;

  const steps = [
    { id: "prepare", label: "Start pull" },
    { id: "download", label: "Download anime and manga lists" },
    { id: "prepare-titles", label: provider === "mal" ? "Match titles to Seenary" : "Save title details" },
    { id: "apply", label: "Update your library" },
  ] as const;
  const stage = progress && Object.hasOwn(stages, progress.stage) ? stages[progress.stage as keyof typeof stages] : null;
  const [history, setHistory] = useState<{ lastStage: PullStep; details: Partial<Record<PullStep, PullProgress>> } | null>(null);
  if (!progress && history) setHistory(null);
  if (progress && stage && history?.details[stage] !== progress) {
    setHistory({ lastStage: stage, details: { ...(stage !== "prepare" && history?.details), [stage]: progress } });
  }

  const latestStage = stage ?? history?.lastStage ?? (progress?.stage === "waiting-retry" ? "prepare" : null);
  const currentIndex = steps.findIndex((step) => step.id === latestStage);
  const complete = progress?.stage === "complete";
  const stopped = progress?.stage === "cancelled" || progress?.stage === "failed";
  const waiting = progress?.stage === "waiting-retry";
  const summary = cancelling ? "Cancelling update..." : complete || stopped || waiting ? progress?.label : null;

  return (
    <div className="mt-4 border-t border-white/8 pt-3 sm:pb-14">
      {(currentIndex >= 0 || complete) && <ol aria-label="Pull steps" className="divide-y divide-white/8">
        {steps.map((step, index) => {
          const done = complete || index < currentIndex;
          const working = index === currentIndex && !stopped && !complete && !waiting && !cancelling;
          const details = working ? progress : history?.details[step.id];
          const total = details?.total ?? 0;
          const fetched = details?.fetched;
          const showListCounts = (step.id === "download" || step.id === "apply") && fetched && Object.keys(fetched).length > 0;
          return (
            <li key={step.id} aria-current={working ? "step" : undefined}>
              <div className={`flex min-h-10 items-center gap-2.5 text-[15px] transition-colors duration-300 ${working ? "font-medium text-white" : done ? "text-white/70" : "text-white/45"}`}>
                <span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-300 ${done ? "bg-emerald-400/10 text-emerald-300" : working ? "bg-(--app-accent)/15 text-(--app-accent)" : "bg-white/5 text-white/35"}`}>
                  {working ? <span className="flex items-center gap-0.5">
                    {[0, 120, 240].map((delay) => <span key={delay} style={{ animationDelay: `${delay}ms` }} className="size-1 rounded-full bg-current motion-safe:animate-[pull-step-hop_900ms_ease-in-out_infinite]" />)}
                  </span> : done ? <CheckIcon className="size-4" /> : <XMarkIcon className="size-4" />}
                </span>
                {step.label}
                <span className="sr-only">{done ? " completed" : working ? " in progress" : " incomplete"}</span>
              </div>
              <div aria-hidden={!working} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${working ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="min-h-0 overflow-hidden">
                  {details && <div className="pb-3 pl-9.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-white/55">
                      <span>{details.label}</span>
                      {total > 0 && <span className="tabular-nums">
                        {(details.current ?? 0).toLocaleString()} of {total.toLocaleString()} {step.id === "download" && details.fetched ? "lists downloaded" : "titles processed"}
                      </span>}
                    </div>
                    {total > 0 && <progress aria-label={step.label} value={details.current ?? 0} max={total}
                      className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-white/8 [&::-moz-progress-bar]:bg-(--app-accent) [&::-webkit-progress-bar]:bg-white/8 [&::-webkit-progress-value]:bg-(--app-accent) [&::-webkit-progress-value]:transition-all" />}
                    {showListCounts && <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                      <div className="flex gap-2"><dt className="text-white/45">Anime found</dt><dd className="tabular-nums text-white/80">{fetched.ANIME?.toLocaleString() ?? "Pending"}</dd></div>
                      <div className="flex gap-2"><dt className="text-white/45">Manga found</dt><dd className="tabular-nums text-white/80">{fetched.MANGA?.toLocaleString() ?? "Pending"}</dd></div>
                    </dl>}
                  </div>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>}
      <p role="status" className={summary ? "mt-2 text-sm text-white/70" : "sr-only"}>{summary ?? progress?.label}</p>
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
