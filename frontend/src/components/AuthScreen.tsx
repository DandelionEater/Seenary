import { PasswordRecovery } from './PasswordRecovery';
import { useEffect, useRef, useState } from "react";

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
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  useEffect(() => { let active = true; window.api.getRecoveryEmail().then(reply => { if (active) setRecoveryAvailable(reply.configured === true); }).catch(() => {}); return () => { active = false; }; }, []);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [registeredUser, setRegisteredUser] = useState<Parameters<AuthScreenProps["onAuthenticated"]>[0] | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [oauthProfile, setOauthProfile] = useState<{
    provider: "AniList" | "MyAnimeList";
    providerUsername: string;
    signupToken: string;
  } | null>(null);
  const [localUsername, setLocalUsername] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const providerAttempt = useRef<AbortController | null>(null);

  useEffect(() => () => providerAttempt.current?.abort(), []);

  const cancelProviderLogin = () => {
    providerAttempt.current?.abort();
    providerAttempt.current = null;
    setPendingProvider(null);
    setBusy(false);
    setMessage("Sign-in cancelled. Choose a login option to continue.");
  };

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
      if (mode === 'register' && recoveryEmail.trim()) {
        setRegisteredUser(result.user);
        try { const verification = await window.api.setRecoveryEmail(recoveryEmail.trim(), password); setMessage(verification.message); }
        catch { setMessage('Your account was created, but we could not send the verification email. Add your recovery email in Settings.'); }
        setPassword('');
        return;
      }

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

  const startProviderLogin = async (provider: "AniList" | "MyAnimeList") => {
    if (busy) return;
    const attempt = new AbortController();
    providerAttempt.current = attempt;
    setPendingProvider(provider);
    setBusy(true);
    setMessage(`Waiting for ${provider} authorization...`);
    try {
      const result = provider === "MyAnimeList"
        ? await window.api.startMalLogin(undefined, { signal: attempt.signal })
        : await window.api.startAniListLogin(undefined, { signal: attempt.signal });
      if (attempt.signal.aborted) return;
      if (result.ok && result.user) {
        await onAuthenticated({ id: result.user.id, username: result.user.username, tutorial_dismissed: result.user.tutorial_dismissed });
        return;
      }
      if (result.needsUsername && result.signupToken) {
        setOauthProfile({ provider, providerUsername: result.providerUsername || provider, signupToken: result.signupToken });
        setLocalUsername("");
        setMessage(`Connected as ${result.providerUsername || "your provider account"}. Choose your Seenary username.`);
        return;
      }
      setMessage(result.message || `${provider} login failed. Try again.`);
    } catch (error) {
      if (!attempt.signal.aborted) setMessage(errorMessage(error, `${provider} login failed. Try again.`));
    } finally {
      if (providerAttempt.current === attempt) {
        providerAttempt.current = null;
        setPendingProvider(null);
        setBusy(false);
      }
    }
  };

  const completeOauthSignup = async () => {
    if (busy) return;
    const profile = oauthProfile;
    if (!profile) return;

    const trimmedUsername = localUsername.trim();

    if (!trimmedUsername) {
      setMessage("Choose a local username.");
      return;
    }

    setBusy(true);
    setMessage(`Creating your Seenary account with ${profile.provider}...`);

    try {
      const result =
        profile.provider === "MyAnimeList"
          ? await window.api.completeMalLogin(trimmedUsername, profile.signupToken)
          : await window.api.completeAniListLogin(trimmedUsername, profile.signupToken);

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

  if (forgotPassword) return <PasswordRecovery onBack={() => setForgotPassword(false)} />;
  if (registeredUser) return <div className="flex h-full items-center justify-center px-6"><div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 text-white"><h1 className="text-2xl font-bold">Account created</h1><p role="status" className="mt-4 text-sm text-white/70">{message}</p><button type="button" disabled={busy} onClick={() => void onAuthenticated(registeredUser)} className="mt-5 rounded-2xl bg-white px-4 py-3 font-semibold text-black disabled:opacity-50">Continue to Seenary</button></div></div>;

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
            ? `You're connected to ${oauthProfile.provider} as ${oauthProfile.providerUsername}. Choose a Seenary username to finish creating your account.`
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

        {!oauthProfile && mode === 'register' && recoveryAvailable && <label className="mt-4 block text-sm text-white/60">Recovery email (optional)<input type="email" autoComplete="email" maxLength={254} value={recoveryEmail} onChange={e => setRecoveryEmail(e.target.value)} disabled={busy} className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white" /><span className="mt-2 block text-xs">Verify your email after registering to enable password recovery.</span></label>}
        {!oauthProfile && mode === 'login' && <button type="button" disabled={busy} onClick={() => { setPassword(''); setMessage(''); setForgotPassword(true); }} className="mt-3 w-full text-right text-sm text-white/60 hover:text-white">Forgot password?</button>}

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

        {pendingProvider && (
          <button
            type="button"
            onClick={cancelProviderLogin}
            className="mt-3 w-full rounded-2xl border border-white/15 px-4 py-3 text-sm text-white/80 transition hover:bg-white/10"
          >
            Cancel sign-in
          </button>
        )}

        {!oauthProfile && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[0.22em] text-white/25">
              <span className="h-px flex-1 bg-white/10" />
              <span>or</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <button
              type="button"
              onClick={() => void startProviderLogin("AniList")}
              disabled={busy}
              className="flex w-full items-center justify-center rounded-2xl border border-[#2ea6ff]/35 bg-[#2ea6ff]/10 px-4 py-3 font-semibold text-[#bde7ff] transition hover:border-[#2ea6ff]/60 hover:bg-[#2ea6ff]/15 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Continue with AniList
            </button>

            <button
              type="button"
              onClick={() => void startProviderLogin("MyAnimeList")}
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
