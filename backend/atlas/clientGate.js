function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || '').trim());
  if (!match) return null;
  return { parts: match.slice(1, 4).map(Number), prerelease: match[4] || null };
}

function compareVersions(left, right) {
  const a = parseVersion(left); const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index++) if (a.parts[index] !== b.parts[index]) return a.parts[index] < b.parts[index] ? -1 : 1;
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function evaluateClient(version, env = process.env) {
  const mode = String(env.ATLAS_CLIENT_GATE_MODE || 'off').trim().toLowerCase();
  const minimum = String(env.ATLAS_MIN_CLIENT_VERSION || '').trim();
  if (!['off', 'observe', 'enforce'].includes(mode)) throw new Error('Invalid ATLAS_CLIENT_GATE_MODE.');
  if (mode === 'off') return { allowed: true, mode };
  if (!parseVersion(minimum)) throw new Error('ATLAS_MIN_CLIENT_VERSION must be a semantic version when the client gate is active.');
  const comparison = compareVersions(version, minimum);
  const compatible = comparison !== null && comparison >= 0;
  return { allowed: mode !== 'enforce' || compatible, compatible, mode, minimum };
}

module.exports = { parseVersion, compareVersions, evaluateClient };
