import { useState } from "react";

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return "The request timed out. Check your connection and try again.";
    if (/failed to fetch|networkerror/i.test(error.message)) return "Seenary could not reach the cloud. Check your connection and try again.";
    if (error.message) return error.message;
  }
  return fallback;
}

type AuthScreenProps = {
  onAuthenticated: (user: {
    id: number;
    username: string;
    tutorial_dismissed: number;
  }) => void | Promise<void>;
};

function LoadingSpinner() {
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      <span className="absolute h-5 w-5 rounded-full border-2 border-black/20" />
      <span className="absolute h-5 w-5 rounded-full border-2 border-transparent border-t-black border-r-black animate-spin" />
    </span>
  );
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [oauthProfile, setOauthProfile] = useState<{
    provider: "AniList" | "MyAnimeList";
  } | null>(null);
  const [localUsername, setLocalUsername] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;

    const trimmedUsername = username.trim();

    if (!trimmedUsername || !password) {
      setMessage("Please enter both username and password.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const result =
        mode === "login"
          ? await window.api.login(trimmedUsername, password)
          : await window.api.register(trimmedUsername, password);

      if (!result.ok || !result.user) {
        setMessage(result.message);
        setPassword("");
        return;
      }

      setMessage("");

      await onAuthenticated({
        id: result.user.id,
        username: result.user.username,
        tutorial_dismissed: result.user.tutorial_dismissed,
      });
    } catch (error) {
      setMessage(errorMessage(error, mode === "login" ? "Login failed. Try again." : "Account creation failed. Try again."));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (oauthProfile) {
      await completeOauthSignup();
      return;
    }

    await submit();
  };

  const startAniListLogin = () => {
    if (busy) return;
    setOauthProfile({ provider: "AniList" });
    setLocalUsername(/^[a-zA-Z0-9_]{3,20}$/.test(username.trim()) ? username.trim() : "");
    setMessage("");
  };

  const startMalLogin = () => {
    if (busy) return;
    setOauthProfile({ provider: "MyAnimeList" });
    setLocalUsername(/^[a-zA-Z0-9_]{3,20}$/.test(username.trim()) ? username.trim() : "");
    setMessage("");
  };

  const completeOauthSignup = async () => {
    if (busy) return;

    const trimmedUsername = localUsername.trim();

    if (!trimmedUsername) {
      setMessage("Choose a local username.");
      return;
    }

    setBusy(true);
    setMessage(`Waiting for ${oauthProfile?.provider || "provider"} authorization...`);

    try {
      const result =
        oauthProfile?.provider === "MyAnimeList"
          ? await window.api.completeMalLogin(trimmedUsername)
          : await window.api.completeAniListLogin(trimmedUsername);

      if (!result.ok || !result.user) {
        setMessage(result.message);
        return;
      }

      await onAuthenticated({
        id: result.user.id,
        username: result.user.username,
        tutorial_dismissed: result.user.tutorial_dismissed,
      });
    } catch (error) {
      setMessage(errorMessage(error, `Failed to finish ${oauthProfile?.provider || "provider"} login. Try again.`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-md"
      >
        <p className="mb-2 text-sm uppercase tracking-[0.3em] text-white/35">
          Seenary
        </p>

        <h1 className="text-3xl font-bold text-white">
          {oauthProfile
            ? "Create account"
            : mode === "login"
              ? "Welcome back"
              : "Create account"}
        </h1>

        <p className="mt-3 text-sm text-white/55">
          {oauthProfile
            ? `Choose your Seenary username, then authorize with ${oauthProfile.provider}. Existing accounts keep their current Seenary username.`
            : mode === "login"
              ? "Log in to access your personal Anime and Manga library."
              : "Create your account to start building your Anime and Manga library."}
        </p>

        {oauthProfile ? (
          <div className="mt-6 space-y-4">
            <input
              type="text"
              placeholder="Local username"
              value={localUsername}
              onChange={(e) => setLocalUsername(e.target.value)}
              disabled={busy}
              autoComplete="username"
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-white/20 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
              autoComplete="username"
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-white/20 disabled:cursor-not-allowed disabled:opacity-70"
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-white/20 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>
        )}

        {message && (
          <p className="mt-4 text-sm text-white/70">{message}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-4 py-3 font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-80"
        >
          {busy ? (
            <>
              <LoadingSpinner />
              <span>
                {oauthProfile
                  ? "Waiting for authorization..."
                  : mode === "login"
                    ? "Logging in..."
                    : "Creating account..."}
              </span>
            </>
          ) : (
            <span>
              {oauthProfile
                ? `Continue with ${oauthProfile.provider}`
                : mode === "login"
                  ? "Log in"
                  : "Create account"}
            </span>
          )}
        </button>

        {!oauthProfile && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.22em] text-white/25">
              <span className="h-px flex-1 bg-white/10" />
              <span>or</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <button
              type="button"
              onClick={startAniListLogin}
              disabled={busy}
              className="flex w-full items-center justify-center rounded-2xl border border-[#2ea6ff]/35 bg-[#2ea6ff]/10 px-4 py-3 font-semibold text-[#bde7ff] transition hover:border-[#2ea6ff]/60 hover:bg-[#2ea6ff]/15 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Continue with AniList
            </button>

            <button
              type="button"
              onClick={startMalLogin}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center rounded-2xl border border-[#2e51a2]/60 bg-[#2e51a2]/15 px-4 py-3 font-semibold text-[#d6e3ff] transition hover:border-[#2e51a2] hover:bg-[#2e51a2]/25 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Continue with MyAnimeList
            </button>

            <button
              type="button"
              onClick={() =>
                setMode((prev) => (prev === "login" ? "register" : "login"))
              }
              disabled={busy}
              className="mt-4 w-full text-sm text-white/50 transition hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mode === "login"
                ? "Need an account? Register"
                : "Already have an account? Log in"}
            </button>
          </>
        )}

        {oauthProfile && (
          <button
            type="button"
            onClick={() => {
              setOauthProfile(null);
              setLocalUsername("");
              setMessage("");
            }}
            disabled={busy}
            className="mt-4 w-full text-sm text-white/50 transition hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back to login
          </button>
        )}
      </form>
    </div>
  );
}
