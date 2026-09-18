const hostname = window.location.hostname.toLowerCase();

export const isHostedSeenary = [
  'seenary.app',
  'www.seenary.app',
  'web.seenary.app',
].includes(hostname);

export const isAtlasProduction =
  import.meta.env.VITE_ATLAS_PRODUCTION === 'true' || isHostedSeenary;

export const atlasEndpoint =
  import.meta.env.VITE_API_BASE_URL ||
  (isHostedSeenary ? 'https://api.seenary.app' : `http://${hostname}:3001`);

export const atlasLabel = isAtlasProduction ? 'Atlas' : 'Atlas staging';
export const atlasDatabaseName = isAtlasProduction
  ? 'seenary-cloud-production'
  : 'seenary-cloud-staging';
