export function readRecoveryLink() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const kind = params.get('recovery');
  return kind === 'verify' || kind === 'reset' ? { kind, token: params.get('token') || '' } : null;
}
