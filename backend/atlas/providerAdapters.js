const ENDPOINTS = {
  anilist: { authorize: 'https://anilist.co/api/v2/oauth/authorize', token: 'https://anilist.co/api/v2/oauth/token' },
  mal: { authorize: 'https://myanimelist.net/v1/oauth2/authorize', token: 'https://myanimelist.net/v1/oauth2/token' },
};

function createProviderAdapters(env = process.env, request = fetch) {
  async function json(url, options) {
    const response = await request(url, { ...options, signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (!response.ok || body.errors) {
      const error = new Error('Provider request failed.');
      error.status = response.status;
      const retryAfter = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfter = retryAfter;
      throw error;
    }
    return body;
  }
  return Object.fromEntries(Object.entries(ENDPOINTS).map(([provider, endpoints]) => {
    const upper = provider.toUpperCase();
    const redirectUri = () => {
      const uri = env.MONGODB_DATABASE === 'seenary'
        ? env[`${upper}_REDIRECT_URI`]
        : env[`ATLAS_${upper}_REDIRECT_URI`] || env[`${upper}_REDIRECT_URI`];
      const parsed = new URL(uri);
      const local = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
      if (!local && parsed.protocol !== 'https:'
          || parsed.pathname !== `/auth/${provider}/callback` || parsed.search || parsed.hash) throw new Error('Configure the staging callback URL.');
      return uri;
    };
    const credentials = () => {
      const clientId = env[`${upper}_CLIENT_ID`];
      const clientSecret = env[`${upper}_CLIENT_SECRET`];
      if (!clientId || provider === 'anilist' && !clientSecret) throw new Error('Provider client configuration missing.');
      return { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) };
    };
    const tokenRequest = (fields) => {
      const body = { ...credentials(), ...fields };
      return json(endpoints.token, { method: 'POST', headers: { Accept: 'application/json',
        'Content-Type': provider === 'anilist' ? 'application/json' : 'application/x-www-form-urlencoded' },
      body: provider === 'anilist' ? JSON.stringify(body) : new URLSearchParams(body).toString() });
    };
    return [provider, {
      authorize(state, verifier) {
        const url = new URL(endpoints.authorize);
        url.searchParams.set('client_id', credentials().client_id);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('state', state);
        if (provider === 'mal') { url.searchParams.set('code_challenge', verifier); url.searchParams.set('code_challenge_method', 'plain'); }
        return url.toString();
      },
      exchange(code, verifier) {
        return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(),
          ...(provider === 'mal' ? { code_verifier: verifier } : {}) });
      },
      async viewer(accessToken) {
        if (provider === 'mal') return json('https://api.myanimelist.net/v2/users/@me?fields=id,name', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = await json('https://graphql.anilist.co', { method: 'POST', headers: {
          'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`,
        }, body: JSON.stringify({ query: 'query { Viewer { id name } }' }) });
        return result.data?.Viewer;
      },
      async refresh(refreshToken) {
        if (provider !== 'mal') throw new Error('AniList requires reauthorization.');
        return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
      },
    }];
  }));
}
module.exports = { createProviderAdapters };
