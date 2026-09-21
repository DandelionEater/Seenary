require('./env');

const { app, ipcMain } = require('electron');
const path = require('path');

app.setAppUserModelId('app.seenary.desktop');
app.setName('Seenary');

// Released desktop builds bundle the Atlas renderer. Keep the native/legacy
// bridge available under a separate name so the renderer can own window.api.
if (app.isPackaged) process.env.SEENARY_ATLAS_RENDERER = '1';

if (!app.isPackaged) {
  app.setPath('userData', path.join(__dirname, '.electron-user-data'));
  app.setPath('crashDumps', path.join(__dirname, '.electron-crash-dumps'));
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

const { createWindow } = require('./window');
const { registerWindowStateIpc } = require('./windowState');
const { setupTray } = require('./tray');
const {
  getGamingModeEnabled,
  registerShortcuts,
  registerShortcutIpc,
  setGamingModeEnabled,
} = require('./shortcuts');
const { registerStartupIpc } = require('./startup');
const { registerSystemLocaleIpc } = require('./systemLocale');
const { registerDesktopEnvironmentIpc } = require('./desktopEnvironment');
const { registerAppLifecycleIpc } = require('./appLifecycle');
const { registerLayoutConfigIpc, deleteLayoutOrders } = require('./layoutConfig');

const anilist = require('./anilist');
const searchOrchestrator = require('./searchOrchestrator');
const animethemes = require('./animethemes');
const anilistOAuth = require('./anilistOAuth');
const mal = require('./mal');
const { previewMalImport, importMalEntries } = require('./malImport');
const { previewMalMangaPull, importMalMangaEntries } = require('./malMangaImport');
const { previewTextImport, previewPdfImport, importTextEntries } = require('./textImport');
const { getMalTokenExpiry, withFreshMalAccount } = require('./malTokens');
const malOAuth = require('./malOAuth');
const {
  saveAnime,
  saveManga,
  saveAnimeSummary,
  updateAnimeFranchiseStartDate,
  getAnimeById,
  getMangaById,
  getPersonDetails,
  savePersonDetails,
  getAppSetting,
  setAppSetting,
  getSafeUserById,
  getUserByNormalizedUsername,
  getAniListAccountByAniListUserId,
  getAniListAccountByUserId,
  deleteAniListAccountByUserId,
  getMalAccountByMalUserId,
  getMalAccountByUserId,
  deleteMalAccountByUserId,
  clearProviderSyncQueue,
  mergeUserIntoUser,
  upsertAniListAccount,
  updateAniListAccountImportTime,
  upsertMalAccount,
  updateMalAccountImportTime,
  insertSyncHistory,
  deleteUser,
} = require('./db');
const { mapAnimeForDb, mapDbAnimeForFrontend } = require('./animeMapper');
const { exportBackup, importBackup } = require('./backup');
const {
  registerUser,
  loginUser,
  createLinkedUser,
  loginUserById,
  logoutUser,
  getCurrentSession,
  setTutorialDismissedForCurrentUser,
  normalizeUsername,
  validateUsername,
  verifyLocalPassword,
  setLocalPassword,
} = require('./auth');

const {
  getMyAnimeList,
  getMyAnimeEntry,
  saveMyAnimeEntry,
  removeMyAnimeEntry,
  getMyMangaList,
  getMyMangaEntry,
  saveMyMangaEntry,
  removeMyMangaEntry,
  clearMyAnimeList,
  clearMyMangaList,
  clearAllMediaLists,
  importAniListEntries,
  importAniListMangaEntries,
} = require('./lists');
const {
  runSyncForUser,
  getSyncStatus,
  getSyncActivity,
  restoreSyncExclusion,
  excludeSyncEntry,
  setAutoSyncEnabled,
  autoSyncEvents,
} = require('./sync');

const ANILIST_URL = 'https://graphql.anilist.co';
const MEDIA_DETAILS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const franchiseStartDateRequests = new Map();
const PERSON_DETAILS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let mainWindow = null;

const DEFAULT_APP_SETTINGS = {
  themeAccent: 'violet',
  customAccentColor: '#a78bfa',
  titleLanguage: 'userPreferred',
  showTrendingCarousel: true,
  autoRotateTrending: true,
  autoScrollHomeShelves: true,
  hideAdultContent: true,
  overlayOpacity: 100,
  overlayBackground: 'solid',
  navbarStyle: 'integrated',
  browseCardStyle: 'default',
  backgroundDim: 65,
  animationLevel: 'full',
  compactMode: false,
  discoverDensity: 'balanced',
  homeDensity: 'balanced',
  myListDensity: 'balanced',
  startView: 'home',
  shareAnonymousUsageStatistics: false,
  analyticsConsentDecided: false,
};

const ALLOWED_THEME_ACCENTS = ['violet', 'rose', 'amber', 'emerald', 'custom'];
const ALLOWED_TITLE_LANGUAGES = ['userPreferred', 'english', 'romaji', 'native'];
const ALLOWED_OVERLAY_BACKGROUNDS = ['solid', 'glass', 'transparent'];
const ALLOWED_NAVBAR_STYLES = ['integrated', 'floating', 'minimal'];
const ALLOWED_BROWSE_CARD_STYLES = ['default', 'immersive', 'gallery'];
const ALLOWED_START_VIEWS = ['home', 'list', 'search'];
const ALLOWED_ANIMATION_LEVELS = ['full', 'reduced', 'off'];
const ALLOWED_DISCOVER_DENSITIES = ['comfortable', 'balanced', 'compact'];
const ALLOWED_CARD_DENSITIES = ['comfortable', 'balanced', 'compact'];
const IMPORT_STATUS_ORDER = ['watching', 'planned', 'completed', 'paused', 'dropped'];

let pendingAniListSignup = null;
let pendingAniListLinkConflict = null;
let pendingMalSignup = null;
let pendingMalLinkConflict = null;

function emitSyncProgress(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('sync:progress', {
    updatedAt: new Date().toISOString(),
    ...payload,
  });
}

autoSyncEvents.on('complete', (result) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('sync:auto-complete', result);
});

function clampPreferenceNumber(value, fallback, min, max) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeAccentColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_APP_SETTINGS.customAccentColor;
}

function getAppPreferences() {
  const themeAccent = getAppSetting('preferences.themeAccent');
  const customAccentColor = getAppSetting('preferences.customAccentColor');
  const titleLanguage = getAppSetting('preferences.titleLanguage');
  const showTrendingCarousel = getAppSetting('preferences.showTrendingCarousel');
  const autoRotateTrending = getAppSetting('preferences.autoRotateTrending');
  const autoScrollHomeShelves = getAppSetting('preferences.autoScrollHomeShelves');
  const hideAdultContent = getAppSetting('preferences.hideAdultContent');
  const overlayOpacity = getAppSetting('preferences.overlayOpacity');
  const overlayBackground = getAppSetting('preferences.overlayBackground');
  const navbarStyle = getAppSetting('preferences.navbarStyle');
  const browseCardStyle = getAppSetting('preferences.browseCardStyle');
  const backgroundDim = getAppSetting('preferences.backgroundDim');
  const animationLevel = getAppSetting('preferences.animationLevel');
  const compactMode = getAppSetting('preferences.compactMode');
  const discoverDensity = getAppSetting('preferences.discoverDensity');
  const homeDensity = getAppSetting('preferences.homeDensity');
  const myListDensity = getAppSetting('preferences.myListDensity');
  const startView = getAppSetting('preferences.startView');
  const shareAnonymousUsageStatistics = getAppSetting(
    'preferences.shareAnonymousUsageStatistics'
  );
  const analyticsConsentDecided = getAppSetting('preferences.analyticsConsentDecided');

  return {
    themeAccent: ALLOWED_THEME_ACCENTS.includes(themeAccent)
      ? themeAccent
      : DEFAULT_APP_SETTINGS.themeAccent,
    customAccentColor: normalizeAccentColor(customAccentColor),
    titleLanguage: ALLOWED_TITLE_LANGUAGES.includes(titleLanguage)
      ? titleLanguage
      : DEFAULT_APP_SETTINGS.titleLanguage,
    showTrendingCarousel:
      showTrendingCarousel === null
        ? DEFAULT_APP_SETTINGS.showTrendingCarousel
        : showTrendingCarousel === 'true',
    autoRotateTrending:
      autoRotateTrending === null
        ? DEFAULT_APP_SETTINGS.autoRotateTrending
        : autoRotateTrending === 'true',
    autoScrollHomeShelves:
      autoScrollHomeShelves === null
        ? DEFAULT_APP_SETTINGS.autoScrollHomeShelves
        : autoScrollHomeShelves === 'true',
    hideAdultContent:
      hideAdultContent === null
        ? DEFAULT_APP_SETTINGS.hideAdultContent
        : hideAdultContent === 'true',
    overlayOpacity:
      overlayOpacity === null
        ? DEFAULT_APP_SETTINGS.overlayOpacity
        : clampPreferenceNumber(overlayOpacity, DEFAULT_APP_SETTINGS.overlayOpacity, 70, 100),
    overlayBackground: ALLOWED_OVERLAY_BACKGROUNDS.includes(overlayBackground)
      ? overlayBackground
      : DEFAULT_APP_SETTINGS.overlayBackground,
    navbarStyle: ALLOWED_NAVBAR_STYLES.includes(navbarStyle)
      ? navbarStyle
      : DEFAULT_APP_SETTINGS.navbarStyle,
    browseCardStyle: ALLOWED_BROWSE_CARD_STYLES.includes(browseCardStyle)
      ? browseCardStyle
      : DEFAULT_APP_SETTINGS.browseCardStyle,
    backgroundDim:
      backgroundDim === null
        ? DEFAULT_APP_SETTINGS.backgroundDim
        : clampPreferenceNumber(backgroundDim, DEFAULT_APP_SETTINGS.backgroundDim, 0, 100),
    animationLevel: ALLOWED_ANIMATION_LEVELS.includes(animationLevel)
      ? animationLevel
      : DEFAULT_APP_SETTINGS.animationLevel,
    compactMode:
      compactMode === null
        ? DEFAULT_APP_SETTINGS.compactMode
        : compactMode === 'true',
    discoverDensity: ALLOWED_DISCOVER_DENSITIES.includes(discoverDensity)
      ? discoverDensity
      : DEFAULT_APP_SETTINGS.discoverDensity,
    homeDensity: ALLOWED_CARD_DENSITIES.includes(homeDensity)
      ? homeDensity
      : DEFAULT_APP_SETTINGS.homeDensity,
    myListDensity: ALLOWED_CARD_DENSITIES.includes(myListDensity)
      ? myListDensity
      : DEFAULT_APP_SETTINGS.myListDensity,
    startView: ALLOWED_START_VIEWS.includes(startView)
      ? startView
      : DEFAULT_APP_SETTINGS.startView,
    shareAnonymousUsageStatistics:
      shareAnonymousUsageStatistics === null
        ? DEFAULT_APP_SETTINGS.shareAnonymousUsageStatistics
        : shareAnonymousUsageStatistics === 'true',
    analyticsConsentDecided:
      analyticsConsentDecided === null
        ? DEFAULT_APP_SETTINGS.analyticsConsentDecided
        : analyticsConsentDecided === 'true',
  };
}

function updateAppPreferences(payload = {}) {
  const current = getAppPreferences();
  const next = {
    themeAccent: ALLOWED_THEME_ACCENTS.includes(payload.themeAccent)
      ? payload.themeAccent
      : current.themeAccent,
    customAccentColor:
      typeof payload.customAccentColor === 'string'
        ? normalizeAccentColor(payload.customAccentColor)
        : current.customAccentColor,
    titleLanguage: ALLOWED_TITLE_LANGUAGES.includes(payload.titleLanguage)
      ? payload.titleLanguage
      : current.titleLanguage,
    showTrendingCarousel:
      typeof payload.showTrendingCarousel === 'boolean'
        ? payload.showTrendingCarousel
        : current.showTrendingCarousel,
    autoRotateTrending:
      typeof payload.autoRotateTrending === 'boolean'
        ? payload.autoRotateTrending
        : current.autoRotateTrending,
    autoScrollHomeShelves:
      typeof payload.autoScrollHomeShelves === 'boolean'
        ? payload.autoScrollHomeShelves
        : current.autoScrollHomeShelves,
    hideAdultContent:
      typeof payload.hideAdultContent === 'boolean'
        ? payload.hideAdultContent
        : current.hideAdultContent,
    overlayOpacity:
      typeof payload.overlayOpacity === 'number'
        ? clampPreferenceNumber(payload.overlayOpacity, current.overlayOpacity, 70, 100)
        : current.overlayOpacity,
    overlayBackground: ALLOWED_OVERLAY_BACKGROUNDS.includes(payload.overlayBackground)
      ? payload.overlayBackground
      : current.overlayBackground,
    navbarStyle: ALLOWED_NAVBAR_STYLES.includes(payload.navbarStyle)
      ? payload.navbarStyle
      : current.navbarStyle,
    browseCardStyle: ALLOWED_BROWSE_CARD_STYLES.includes(payload.browseCardStyle)
      ? payload.browseCardStyle
      : current.browseCardStyle,
    backgroundDim:
      typeof payload.backgroundDim === 'number'
        ? clampPreferenceNumber(payload.backgroundDim, current.backgroundDim, 0, 100)
        : current.backgroundDim,
    animationLevel: ALLOWED_ANIMATION_LEVELS.includes(payload.animationLevel)
      ? payload.animationLevel
      : current.animationLevel,
    compactMode:
      typeof payload.compactMode === 'boolean'
        ? payload.compactMode
        : current.compactMode,
    discoverDensity: ALLOWED_DISCOVER_DENSITIES.includes(payload.discoverDensity)
      ? payload.discoverDensity
      : current.discoverDensity,
    homeDensity: ALLOWED_CARD_DENSITIES.includes(payload.homeDensity)
      ? payload.homeDensity
      : current.homeDensity,
    myListDensity: ALLOWED_CARD_DENSITIES.includes(payload.myListDensity)
      ? payload.myListDensity
      : current.myListDensity,
    startView: ALLOWED_START_VIEWS.includes(payload.startView)
      ? payload.startView
      : current.startView,
    shareAnonymousUsageStatistics:
      typeof payload.shareAnonymousUsageStatistics === 'boolean'
        ? payload.shareAnonymousUsageStatistics
        : current.shareAnonymousUsageStatistics,
    analyticsConsentDecided:
      typeof payload.analyticsConsentDecided === 'boolean'
        ? payload.analyticsConsentDecided
        : current.analyticsConsentDecided,
  };

  setAppSetting('preferences.themeAccent', next.themeAccent);
  setAppSetting('preferences.customAccentColor', next.customAccentColor);
  setAppSetting('preferences.titleLanguage', next.titleLanguage);
  setAppSetting('preferences.showTrendingCarousel', next.showTrendingCarousel);
  setAppSetting('preferences.autoRotateTrending', next.autoRotateTrending);
  setAppSetting('preferences.autoScrollHomeShelves', next.autoScrollHomeShelves);
  setAppSetting('preferences.hideAdultContent', next.hideAdultContent);
  setAppSetting('preferences.overlayOpacity', next.overlayOpacity);
  setAppSetting('preferences.overlayBackground', next.overlayBackground);
  setAppSetting('preferences.navbarStyle', next.navbarStyle);
  setAppSetting('preferences.browseCardStyle', next.browseCardStyle);
  setAppSetting('preferences.backgroundDim', next.backgroundDim);
  setAppSetting('preferences.animationLevel', next.animationLevel);
  setAppSetting('preferences.compactMode', next.compactMode);
  setAppSetting('preferences.discoverDensity', next.discoverDensity);
  setAppSetting('preferences.homeDensity', next.homeDensity);
  setAppSetting('preferences.myListDensity', next.myListDensity);
  setAppSetting('preferences.startView', next.startView);
  setAppSetting(
    'preferences.shareAnonymousUsageStatistics',
    next.shareAnonymousUsageStatistics
  );
  setAppSetting('preferences.analyticsConsentDecided', next.analyticsConsentDecided);

  return next;
}

function buildMinimalAnimeForDb(media) {
  return mapAnimeForDb({
    id: media.id,
    title: {
      romaji: media.title?.romaji ?? null,
      english: media.title?.english ?? null,
      native: null,
      userPreferred:
        media.title?.userPreferred ?? media.title?.english ?? media.title?.romaji ?? null,
    },
    coverImage: {
      large: media.coverImage?.large ?? null,
    },
    bannerImage: null,
    episodes: media.episodes ?? null,
    format: media.format ?? null,
    status: null,
    season: media.season ?? null,
    seasonYear: media.seasonYear ?? null,
    averageScore: media.averageScore ?? null,
    meanScore: null,
    popularity: null,
    favourites: null,
    duration: null,
    source: null,
    countryOfOrigin: null,
    startDate: null,
    endDate: null,
    trailer: null,
    siteUrl: null,
    description: null,
    genres: [],
    synonyms: [],
    nextAiringEpisode: null,
    studios: {
      nodes: [],
    },
    tags: [],
    staff: {
      edges: [],
    },
    characters: {
      edges: [],
    },
    relations: {
      edges: [],
    },
    recommendations: {
      nodes: [],
    },
    externalLinks: [],
    streamingEpisodes: [],
  });
}

function sanitizeImportStatus(status) {
  const value = String(status || '')
    .trim()
    .toUpperCase();

  switch (value) {
    case 'CURRENT':
    case 'REPEATING':
      return 'watching';
    case 'PLANNING':
      return 'planned';
    case 'COMPLETED':
      return 'completed';
    case 'PAUSED':
      return 'paused';
    case 'DROPPED':
      return 'dropped';
    default:
      return null;
  }
}

function buildAniListImportPreview(collection, mediaType = 'ANIME') {
  const normalizedMediaType = mediaType === 'MANGA' ? 'MANGA' : 'ANIME';
  const lists = Array.isArray(collection?.lists) ? collection.lists : [];
  const grouped = {
    watching: [],
    planned: [],
    completed: [],
    paused: [],
    dropped: [],
  };

  for (const list of lists) {
    for (const entry of list?.entries || []) {
      const media = entry?.media;
      const status = sanitizeImportStatus(entry?.status);

      if (!media?.id || !status || !grouped[status]) {
        continue;
      }

      grouped[status].push({
        animeId: media.id,
        mangaId: normalizedMediaType === 'MANGA' ? media.id : undefined,
        mediaId: media.id,
        mediaType: normalizedMediaType,
        providerUpdatedAt: entry.updatedAt ?? null,
        status,
        progress: entry.progress ?? 0,
        score: entry.score ?? null,
        notes: entry.notes ?? null,
        title: {
          romaji: media.title?.romaji ?? null,
          english: media.title?.english ?? null,
          native: media.title?.native ?? null,
          userPreferred: media.title?.userPreferred ?? null,
        },
        coverImage: {
          large: media.coverImage?.large ?? null,
        },
        episodes: media.episodes ?? null,
        chapters: media.chapters ?? null,
        volumes: media.volumes ?? null,
        volumeProgress: entry.progressVolumes ?? 0,
        format: media.format ?? null,
        season: media.season ?? null,
        seasonYear: media.seasonYear ?? null,
      });
    }
  }

  return {
    totalFound: Object.values(grouped).reduce((sum, items) => sum + items.length, 0),
    groups: IMPORT_STATUS_ORDER.map((status) => ({
      status,
      mediaType: normalizedMediaType,
      items: grouped[status],
    })),
  };
}

function combineAniListImportPreviews(animeCollection, mangaCollection) {
  const animePreview = buildAniListImportPreview(animeCollection, 'ANIME');
  const mangaPreview = buildAniListImportPreview(mangaCollection, 'MANGA');
  return {
    totalFound: animePreview.totalFound + mangaPreview.totalFound,
    animeFound: animePreview.totalFound,
    mangaFound: mangaPreview.totalFound,
    groups: [...animePreview.groups, ...mangaPreview.groups].filter(
      (group) => group.items.length > 0
    ),
  };
}

function splitSelectedMediaKeys(selectedMediaKeys) {
  const animeIds = [];
  const mangaIds = [];
  for (const key of Array.isArray(selectedMediaKeys) ? selectedMediaKeys : []) {
    const match = /^(ANIME|MANGA):(\d+)$/.exec(String(key));
    if (!match) continue;
    const id = Number(match[2]);
    if (match[1] === 'MANGA') mangaIds.push(id);
    else animeIds.push(id);
  }
  return { animeIds, mangaIds };
}

function combineMalImportPreviews(animePreview, mangaPreview) {
  return {
    totalFound: (animePreview?.totalFound || 0) + (mangaPreview?.totalFound || 0),
    animeFound: animePreview?.totalFound || 0,
    mangaFound: mangaPreview?.totalFound || 0,
    skipped: (animePreview?.skipped || 0) + (mangaPreview?.skipped || 0),
    mappingFailures: [
      ...(animePreview?.mappingFailures || []),
      ...(mangaPreview?.mappingFailures || []),
    ],
    groups: [...(animePreview?.groups || []), ...(mangaPreview?.groups || [])].filter(
      (group) => group.items.length > 0
    ),
  };
}

function combineMediaPullResults(providerLabel, animeResult, mangaResult) {
  const animeSummary = animeResult?.summary || {};
  const mangaSummary = mangaResult?.summary || {};
  const summary = {
    sourceProvider: providerLabel,
    totalFound: (animeSummary.totalFound || 0) + (mangaSummary.totalFound || 0),
    imported: (animeSummary.imported || 0) + (mangaSummary.imported || 0),
    created: (animeSummary.created || 0) + (mangaSummary.created || 0),
    updated: (animeSummary.updated || 0) + (mangaSummary.updated || 0),
    skipped: (animeSummary.skipped || 0) + (mangaSummary.skipped || 0),
    anime: animeSummary,
    manga: mangaSummary,
  };
  const unmapped = (animeSummary.unmapped || 0) + (mangaSummary.unmapped || 0);
  const partial = unmapped > 0;
  const mappingFailures = [
    ...(animeSummary.mappingFailures || []),
    ...(mangaSummary.mappingFailures || []),
  ];
  const failedTitles = mappingFailures
    .map((failure) => failure?.title)
    .filter(Boolean);
  const failedTitleLabel = failedTitles.length
    ? ` (${failedTitles.slice(0, 3).join(', ')}${failedTitles.length > 3 ? ', ...' : ''})`
    : '';

  return {
    ok: Boolean(animeResult?.ok || mangaResult?.ok),
    partial,
    summary,
    message: `Updated Anime and Manga from ${providerLabel}. ${summary.created} created, ${summary.updated} updated.${
      partial
        ? ` ${unmapped} remote entr${unmapped === 1 ? 'y' : 'ies'}${failedTitleLabel} could not be mapped one-to-one and ${
            unmapped === 1 ? 'was' : 'were'
          } skipped.`
        : ''
    }`,
  };
}

function recordPullActivity(userId, provider, result, mappingFailures = []) {
  const providerKey = provider === 'mal' ? 'mal' : 'anilist';
  const providerLabel = providerKey === 'mal' ? 'MyAnimeList' : 'AniList';

  for (const failure of mappingFailures) {
    const mediaType = failure.mediaType === 'MANGA' ? 'MANGA' : 'ANIME';
    const externalId = Number(failure.malMangaId ?? failure.malAnimeId);
    insertSyncHistory({
      userId,
      mediaId: Number.isInteger(externalId) ? externalId : null,
      mediaType,
      mediaTitle: failure.title || `${mediaType === 'MANGA' ? 'Manga' : 'Anime'} mapping conflict`,
      operation: `pull_from_${providerKey}_unmapped`,
      changedFields: [
        {
          field: providerKey === 'mal' ? 'MyAnimeList ID' : 'External ID',
          from: null,
          to: Number.isInteger(externalId) ? externalId : null,
        },
        { field: 'reason', from: null, to: failure.reason || 'mapping_conflict' },
      ],
      status: 'partial',
      message:
        failure.message ||
        `No safe one-to-one ${providerLabel} mapping was available for this entry.`,
    });
  }

  insertSyncHistory({
    userId,
    mediaId: null,
    mediaType: 'ANIME',
    mediaTitle: `${providerLabel} pull summary`,
    operation: `pull_summary_${providerKey}`,
    changedFields: [
      { field: 'remote entries', from: null, to: result.summary?.totalFound || 0 },
      { field: 'created', from: null, to: result.summary?.created || 0 },
      { field: 'updated', from: null, to: result.summary?.updated || 0 },
      { field: 'mapping conflicts', from: null, to: mappingFailures.length },
    ],
    status: result.partial ? 'partial' : 'completed',
    message: result.message,
  });
}

async function importAuthenticatedAniListList(accessToken, viewer) {
  const [animeCollection, mangaCollection] = await Promise.all([
    anilist.getViewerAnimeCollection(accessToken, viewer.id),
    anilist.getViewerMangaCollection(accessToken, viewer.id),
  ]);
  const animeResult = importAniListEntries(getCurrentSession(), animeCollection, viewer.name, {
    selectedStatuses: IMPORT_STATUS_ORDER,
    selectedAnimeIds: [],
    sourceProvider: 'anilist',
  });
  const mangaResult = importAniListMangaEntries(
    getCurrentSession(),
    mangaCollection,
    viewer.name,
    { sourceProvider: 'anilist' }
  );
  const result = combineMediaPullResults('AniList', animeResult, mangaResult);
  result.message = `Imported ${result.summary?.imported || 0} Anime and Manga entr${
    result.summary?.imported === 1 ? 'y' : 'ies'
  } from AniList.`;

  if (result.ok) {
    updateAniListAccountImportTime(viewer.id);
  }

  return result;
}

async function importAuthenticatedMalList(accessToken, viewer) {
  const [animeList, mangaList] = await Promise.all([
    mal.getViewerAnimeList(accessToken),
    mal.getViewerMangaList(accessToken),
  ]);
  const animeResult = await importMalEntries(getCurrentSession(), animeList, {
    selectedStatuses: IMPORT_STATUS_ORDER,
    selectedAnimeIds: [],
    sourceProvider: 'mal',
  });
  const mangaResult = await importMalMangaEntries(getCurrentSession(), mangaList, {
    selectedStatuses: IMPORT_STATUS_ORDER,
    selectedMangaIds: [],
    sourceProvider: 'mal',
  });
  const result = combineMediaPullResults('MyAnimeList', animeResult, mangaResult);
  result.message = result.message.replace(
    'Updated Anime and Manga from MyAnimeList.',
    `Imported ${result.summary?.imported || 0} Anime and Manga entries from MyAnimeList.`
  );

  if (result.ok) {
    updateMalAccountImportTime(viewer.id);
  }

  return result;
}

async function finishAniListLogin({ accessToken, viewer, userId }) {
  deleteAniListAccountByUserId(userId);
  deleteMalAccountByUserId(userId);

  upsertAniListAccount({
    userId,
    anilistUserId: viewer.id,
    anilistUsername: viewer.name,
    originalAniListUsername: viewer.name,
    accessToken,
  });

  const loginResult = loginUserById(userId);

  if (!loginResult.ok) {
    return loginResult;
  }

  let importResult;

  try {
    importResult = await importAuthenticatedAniListList(accessToken, viewer);
  } catch (error) {
    console.error('AniList authenticated import error:', error);
    importResult = {
      ok: false,
      message: error.message || 'Failed to import AniList list.',
    };
  }

  return {
    ok: true,
    message: importResult.ok
      ? 'Logged in with AniList and imported your Anime and Manga lists.'
      : 'Logged in with AniList, but list import failed.',
    user: loginResult.user,
    import: importResult,
  };
}

function getAniListLinkStatus(currentSession) {
  if (!currentSession?.authenticated || !currentSession.user?.id) {
    return { ok: false, message: 'You must be logged in.', linked: false };
  }

  const linkedAccount = getAniListAccountByUserId(currentSession.user.id);
  const localCredentialsConfirmed = getLocalCredentialsConfirmed(currentSession.user.id);

  if (!linkedAccount) {
    return { ok: true, linked: false, account: null, localCredentialsConfirmed };
  }

  return {
    ok: true,
    linked: true,
    localCredentialsConfirmed,
    account: {
      anilistUserId: linkedAccount.anilist_user_id,
      anilistUsername: linkedAccount.anilist_username,
      originalAniListUsername: linkedAccount.original_anilist_username,
      lastImportAt: linkedAccount.last_import_at,
      updatedAt: linkedAccount.updated_at,
    },
  };
}

function getLocalCredentialsConfirmed(userId) {
  const value = getSafeUserById(userId)?.local_credentials_confirmed;
  return value === null || value === undefined ? null : Boolean(value);
}

function getUnlinkPasswordError(userId) {
  return getLocalCredentialsConfirmed(userId) === true
    ? 'Incorrect local password.'
    : 'Confirm an existing local password or create one before unlinking this account.';
}

function buildMalAccountPayload(account) {
  return {
    malUserId: account.mal_user_id,
    malUsername: account.mal_username,
    originalMalUsername: account.original_mal_username,
    lastImportAt: account.last_import_at,
    updatedAt: account.updated_at,
  };
}

async function linkAniListToUser({ accessToken, viewer, userId }) {
  if (getMalAccountByUserId(userId)) {
    return {
      ok: false,
      linked: false,
      message: 'Unlink MyAnimeList before linking AniList. Seenary supports one sync provider at a time.',
    };
  }
  deleteAniListAccountByUserId(userId);
  upsertAniListAccount({
    userId,
    anilistUserId: viewer.id,
    anilistUsername: viewer.name,
    originalAniListUsername: viewer.name,
    accessToken,
  });

  const importResult = await importAuthenticatedAniListList(accessToken, viewer).catch((error) => {
    console.error('AniList link import error:', error);
    return {
      ok: false,
      message: error.message || 'Failed to import AniList list.',
    };
  });

  return {
    ok: true,
    linked: true,
    message: importResult.ok
      ? `Linked AniList account ${viewer.name} and imported your Anime and Manga lists.`
      : `Linked AniList account ${viewer.name}, but list import failed.`,
    account: {
      anilistUserId: viewer.id,
      anilistUsername: viewer.name,
      originalAniListUsername: viewer.name,
      lastImportAt: importResult.ok ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    },
    import: importResult,
  };
}

async function finishMalLogin({ tokenData, viewer, userId }) {
  deleteAniListAccountByUserId(userId);
  deleteMalAccountByUserId(userId);

  upsertMalAccount({
    userId,
    malUserId: viewer.id,
    malUsername: viewer.name,
    originalMalUsername: viewer.name,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt: getMalTokenExpiry(tokenData),
  });

  const loginResult = loginUserById(userId);

  if (!loginResult.ok) {
    return loginResult;
  }

  let importResult;

  try {
    importResult = await importAuthenticatedMalList(tokenData.access_token, viewer);
  } catch (error) {
    console.error('MyAnimeList authenticated import error:', error);
    importResult = {
      ok: false,
      message: error.message || 'Failed to import MyAnimeList lists.',
    };
  }

  return {
    ok: true,
    message: importResult.ok
      ? 'Logged in with MyAnimeList and imported your Anime and Manga lists.'
      : 'Logged in with MyAnimeList, but list import failed.',
    user: loginResult.user,
    import: importResult,
  };
}

async function linkMalToUser({ tokenData, viewer, userId }) {
  if (getAniListAccountByUserId(userId)) {
    return {
      ok: false,
      linked: false,
      message: 'Unlink AniList before linking MyAnimeList. Seenary supports one sync provider at a time.',
    };
  }
  deleteMalAccountByUserId(userId);

  upsertMalAccount({
    userId,
    malUserId: viewer.id,
    malUsername: viewer.name,
    originalMalUsername: viewer.name,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    tokenExpiresAt: getMalTokenExpiry(tokenData),
  });

  const importResult = await importAuthenticatedMalList(tokenData.access_token, viewer).catch(
    (error) => {
      console.error('MyAnimeList link import error:', error);
      return {
        ok: false,
        message: error.message || 'Failed to import MyAnimeList lists.',
      };
    }
  );

  const account = getMalAccountByUserId(userId);

  return {
    ok: true,
    linked: true,
    message: importResult.ok
      ? `Linked MyAnimeList account ${viewer.name} and imported your Anime and Manga lists.`
      : `Linked MyAnimeList account ${viewer.name}, but list import failed.`,
    account: account ? buildMalAccountPayload(account) : null,
    import: importResult,
  };
}

ipcMain.handle('anilist:search-media', async (_event, payload) => {
  const query = typeof payload === 'string' ? payload : payload?.query;
  const hideAdultContent =
    typeof payload === 'object' && payload !== null ? payload.hideAdultContent : undefined;

  return await searchOrchestrator.searchMedia(query, { hideAdultContent });
});

ipcMain.handle('anilist:discover-media', async (_event, payload) => {
  const hideAdultContent =
    typeof payload === 'object' && payload !== null ? payload.hideAdultContent : undefined;

  return await anilist.getDiscoverMedia({ hideAdultContent });
});

ipcMain.handle('anilist:discover-shelf', async (_event, payload) => {
  return await anilist.getDiscoverShelfAnime({
    shelfId: payload?.shelfId,
    page: payload?.page,
    hideAdultContent: payload?.hideAdultContent,
    mediaType: payload?.mediaType,
  });
});

ipcMain.handle('anilist:studio-media', async (_event, payload) => {
  return await anilist.getStudioMedia(payload?.studioId, payload?.page, {
    hideAdultContent: payload?.hideAdultContent,
  });
});

ipcMain.handle('animethemes:artist-media', async (_event, payload) => {
  return await searchOrchestrator.getArtistMedia(payload?.artistSlug, payload?.page, {
    hideAdultContent: payload?.hideAdultContent,
  });
});

ipcMain.handle('animethemes:anime-music', async (_event, payload) => {
  return await animethemes.getAnimeThemeMusic(payload?.anilistId, payload?.titles);
});

ipcMain.handle('anilist:preview-import', async (_event, payload) => {
  try {
    const username = String(payload?.username || '').trim();

    if (!username) {
      return { ok: false, message: 'Enter an AniList username first.' };
    }

    const [animeCollection, mangaCollection] = await Promise.all([
      anilist.getUserAnimeCollection(username),
      anilist.getUserMangaCollection(username),
    ]);
    const preview = combineAniListImportPreviews(animeCollection, mangaCollection);

    if (!preview.totalFound) {
      return {
        ok: false,
        message: `No Anime or Manga list data was found for ${username}.`,
      };
    }

    return {
      ok: true,
      username,
      preview,
    };
  } catch (error) {
    console.error('AniList preview error:', error);
    return {
      ok: false,
      message: error.message || 'Failed to preview AniList list.',
    };
  }
});

ipcMain.handle('anilist:import-list', async (_event, payload) => {
  try {
    const username = String(payload?.username || '').trim();
    const selectedStatuses = Array.isArray(payload?.selectedStatuses)
      ? payload.selectedStatuses
      : [];
    const selectedAnimeIds = Array.isArray(payload?.selectedAnimeIds)
      ? payload.selectedAnimeIds
      : [];
    const selectedMediaKeys = Array.isArray(payload?.selectedMediaKeys)
      ? payload.selectedMediaKeys
      : [];

    if (!username) {
      return { ok: false, message: 'Enter an AniList username first.' };
    }

    const [animeCollection, mangaCollection] = await Promise.all([
      anilist.getUserAnimeCollection(username),
      anilist.getUserMangaCollection(username),
    ]);

    if (!animeCollection?.lists?.length && !mangaCollection?.lists?.length) {
      return {
        ok: false,
        message: `No Anime or Manga list data was found for ${username}.`,
      };
    }

    const selection = splitSelectedMediaKeys(selectedMediaKeys);
    const animeResult = importAniListEntries(getCurrentSession(), animeCollection, username, {
      selectedStatuses,
      selectedAnimeIds: selectedMediaKeys.length ? selection.animeIds : selectedAnimeIds,
      selectionProvided: selectedMediaKeys.length > 0,
    });
    const mangaResult = importAniListMangaEntries(getCurrentSession(), mangaCollection, username, {
      selectedStatuses,
      selectedMangaIds: selection.mangaIds,
      selectionProvided: selectedMediaKeys.length > 0,
    });
    const result = combineMediaPullResults('AniList', animeResult, mangaResult);
    result.message = `Imported ${result.summary?.imported || 0} selected Anime and Manga entr${
      result.summary?.imported === 1 ? 'y' : 'ies'
    } from AniList.`;
    return result;
  } catch (error) {
    console.error('AniList import error:', error);
    return {
      ok: false,
      message: error.message || 'Failed to import AniList list.',
    };
  }
});

ipcMain.handle('mal:preview-import', async (_event, payload) => {
  try {
    const session = getCurrentSession();
    const username = String(payload?.username || '').trim();

    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }

    if (!username) {
      return { ok: false, message: 'Enter a MyAnimeList username first.' };
    }

    const [animeList, mangaList] = await Promise.all([
      mal.getUserAnimeList(username),
      mal.getUserMangaList(username),
    ]);
    const animeResult = await previewMalImport(animeList);
    const mangaResult = await previewMalMangaPull(mangaList);
    const preview = combineMalImportPreviews(animeResult.preview, mangaResult.preview);
    if (!preview.totalFound) {
      const remoteTotal = (animeList.data?.length || 0) + (mangaList.data?.length || 0);
      return {
        ok: false,
        message: remoteTotal
          ? `MyAnimeList returned ${remoteTotal} entries for ${username}, but none could be safely matched to AniList.`
          : `No public Anime or Manga list entries were found for ${username}.`,
      };
    }
    return {
      ok: true,
      message: `Found ${preview.totalFound} matched MyAnimeList Anime and Manga entries.`,
      username,
      preview,
    };
  } catch (error) {
    console.error('MyAnimeList preview error:', error);
    return { ok: false, message: error.message || 'Failed to preview MyAnimeList list.' };
  }
});

ipcMain.handle('mal:import-list', async (_event, payload) => {
  try {
    const session = getCurrentSession();

    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }

    const username = String(payload?.username || '').trim();
    if (!username) {
      return { ok: false, message: 'Enter a MyAnimeList username first.' };
    }

    const [animeList, mangaList] = await Promise.all([
      mal.getUserAnimeList(username),
      mal.getUserMangaList(username),
    ]);
    const selectedMediaKeys = Array.isArray(payload?.selectedMediaKeys)
      ? payload.selectedMediaKeys
      : [];
    const selection = splitSelectedMediaKeys(selectedMediaKeys);
    const selectionProvided = selectedMediaKeys.length > 0;
    const animeResult = await importMalEntries(session, animeList, {
      selectedStatuses: payload?.selectedStatuses,
      selectedAnimeIds: selection.animeIds,
      selectionProvided,
    });
    const mangaResult = await importMalMangaEntries(session, mangaList, {
      selectedStatuses: payload?.selectedStatuses,
      selectedMangaIds: selection.mangaIds,
      selectionProvided,
    });
    const result = combineMediaPullResults('MyAnimeList', animeResult, mangaResult);
    result.message = `Imported ${result.summary?.imported || 0} selected Anime and Manga entr${
      result.summary?.imported === 1 ? 'y' : 'ies'
    } from MyAnimeList.`;
    return result;
  } catch (error) {
    console.error('MyAnimeList import error:', error);
    return { ok: false, message: error.message || 'Failed to import MyAnimeList list.' };
  }
});

ipcMain.handle('text-import:preview', async (_event, payload) => {
  try {
    return await previewTextImport(payload?.text, {
      hideAdultContent: payload?.hideAdultContent,
      mediaType: payload?.mediaType,
    });
  } catch (error) {
    console.error('Text import preview error:', error);
    return { ok: false, message: error.message || 'Failed to preview text import.' };
  }
});

ipcMain.handle('pdf-import:preview', async (_event, payload) => {
  try {
    return await previewPdfImport(payload?.pdfBase64, {
      hideAdultContent: payload?.hideAdultContent,
      mediaType: payload?.mediaType,
    });
  } catch (error) {
    console.error('PDF import preview error:', error);
    return { ok: false, message: error.message || 'Failed to preview PDF import.' };
  }
});

ipcMain.handle('text-import:import', (_event, payload) => {
  try {
    return importTextEntries(
      getCurrentSession(),
      payload?.entries,
      payload?.selectedMediaKeys ?? payload?.selectedAnimeIds
    );
  } catch (error) {
    console.error('Text import error:', error);
    return { ok: false, message: error.message || 'Failed to import text list.' };
  }
});

ipcMain.handle('settings:get', () => {
  return getAppPreferences();
});

ipcMain.handle('settings:update', (_event, payload) => {
  return updateAppPreferences(payload);
});

ipcMain.handle('analytics:record-engagement', () => {
  return {
    ok: true,
    recorded: false,
    disabled: true,
    message: 'Engagement analytics are sent only through the hosted Seenary service.',
  };
});

ipcMain.handle('sync:get-status', () => {
  try {
    const session = getCurrentSession();

    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }

    return getSyncStatus(session.user.id);
  } catch (error) {
    console.error('Sync status error:', error);
    return { ok: false, message: 'Failed to load sync status.' };
  }
});

ipcMain.handle('sync:set-auto', (_event, enabled) => {
  try {
    const session = getCurrentSession();

    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }

    setAutoSyncEnabled(session.user.id, Boolean(enabled));
    return getSyncStatus(session.user.id);
  } catch (error) {
    console.error('Sync setting error:', error);
    return { ok: false, message: 'Failed to update sync setting.' };
  }
});

ipcMain.handle('sync:run-now', async () => {
  try {
    const session = getCurrentSession();

    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }

    return await runSyncForUser(session.user.id, {
      forceRetry: true,
      onProgress: emitSyncProgress,
    });
  } catch (error) {
    console.error('Manual sync error:', error);
    return { ok: false, message: error.message || 'Failed to run sync.' };
  }
});

ipcMain.handle('sync:pull-from-anilist', async () => {
  const session = getCurrentSession();
  try {
    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }

    const linkedAccount = getAniListAccountByUserId(session.user.id);

    if (!linkedAccount?.access_token || !linkedAccount?.anilist_user_id) {
      return { ok: false, message: 'Link an AniList account before updating from AniList.' };
    }

    emitSyncProgress({
      operation: 'pull-anilist',
      stage: 'fetching',
      label: 'Fetching AniList library...',
      current: 0,
      total: null,
    });

    const [animeCollection, mangaCollection] = await Promise.all([
      anilist.getViewerAnimeCollection(
        linkedAccount.access_token,
        linkedAccount.anilist_user_id
      ),
      anilist.getViewerMangaCollection(
        linkedAccount.access_token,
        linkedAccount.anilist_user_id
      ),
    ]);
    const animeTotal =
      animeCollection?.lists?.flatMap((list) => list?.entries || []).length ?? 0;
    const mangaTotal =
      mangaCollection?.lists?.flatMap((list) => list?.entries || []).length ?? 0;
    emitSyncProgress({
      operation: 'pull-anilist',
      stage: 'saving',
      label: 'Saving AniList Anime and Manga locally...',
      current: 0,
      total: animeTotal + mangaTotal,
    });
    const animeResult = importAniListEntries(
      session,
      animeCollection,
      linkedAccount.anilist_username,
      {
        selectedStatuses: IMPORT_STATUS_ORDER,
        selectedAnimeIds: [],
        sourceProvider: 'anilist',
        onProgress: ({ current, total, entryTitle }) =>
          emitSyncProgress({
            operation: 'pull-anilist',
            stage: 'saving',
            label: `Saving ${current} of ${total}: ${entryTitle}`,
            current,
            total,
          }),
      }
    );
    const mangaResult = importAniListMangaEntries(
      session,
      mangaCollection,
      linkedAccount.anilist_username,
      {
        sourceProvider: 'anilist',
        onProgress: ({ current, entryTitle }) =>
          emitSyncProgress({
            operation: 'pull-anilist',
            stage: 'saving',
            label: `Saving Manga ${current} of ${mangaTotal}: ${entryTitle}`,
            current: animeTotal + current,
            total: animeTotal + mangaTotal,
          }),
      }
    );
    const result = combineMediaPullResults('AniList', animeResult, mangaResult);

    if (result.ok) {
      updateAniListAccountImportTime(linkedAccount.anilist_user_id);
      for (const change of animeResult.summary?.changes || []) {
        insertSyncHistory({
          userId: session.user.id,
          animeId: change.animeId,
          animeTitle: change.animeTitle,
          operation: 'pull_from_anilist',
          changedFields: change.changedFields,
          status: 'completed',
          message: 'Updated local entry from AniList.',
        });
      }
      for (const change of mangaResult.summary?.changes || []) {
        insertSyncHistory({
          userId: session.user.id,
          mangaId: change.mangaId,
          mediaType: 'MANGA',
          animeTitle: change.animeTitle,
          operation: 'pull_from_anilist_manga',
          changedFields: change.changedFields,
          status: 'completed',
          message: 'Updated local Manga entry from AniList.',
        });
      }
      recordPullActivity(session.user.id, 'anilist', result);
    }
    const response = result;

    emitSyncProgress({
      operation: 'pull-anilist',
      stage: response.ok ? 'complete' : 'failed',
      label: response.message,
      current: result.summary?.totalFound ?? null,
      total: result.summary?.totalFound ?? null,
    });

    return response;
  } catch (error) {
    console.error('AniList pull sync error:', error);
    if (session.authenticated && session.user?.id) {
      insertSyncHistory({
        userId: session.user.id,
        mediaId: null,
        mediaTitle: 'AniList pull summary',
        operation: 'pull_summary_anilist',
        status: 'failed',
        message: error.message || 'Failed to update from AniList.',
      });
    }
    emitSyncProgress({
      operation: 'pull-anilist',
      stage: 'failed',
      label: error.message || 'Failed to update from AniList.',
      current: null,
      total: null,
    });
    return {
      ok: false,
      message: error.message || 'Failed to update from AniList.',
    };
  }
});

ipcMain.handle('sync:get-activity', () => {
  try {
    const session = getCurrentSession();

    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }

    return getSyncActivity(session.user.id);
  } catch (error) {
    console.error('Sync activity error:', error);
    return { ok: false, message: 'Failed to load sync activity.' };
  }
});

ipcMain.handle('sync:restore-exclusion', (_event, payload) => {
  try {
    const session = getCurrentSession();
    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }
    return restoreSyncExclusion(session.user.id, payload?.id);
  } catch (error) {
    console.error('Restore sync exclusion error:', error);
    return { ok: false, message: 'Failed to restore the excluded sync entry.' };
  }
});

ipcMain.handle('sync:exclude-entry', (_event, payload) => {
  try {
    const session = getCurrentSession();
    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }
    return excludeSyncEntry(session.user.id, payload?.id);
  } catch (error) {
    console.error('Exclude sync entry error:', error);
    return { ok: false, message: 'Failed to exclude the queued sync entry.' };
  }
});

ipcMain.handle('sync:pull-from-mal', async () => {
  const session = getCurrentSession();
  try {
    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }

    let linkedAccount = null;
    emitSyncProgress({
      operation: 'pull-mal',
      stage: 'fetching',
      label: 'Fetching MyAnimeList library...',
      current: 0,
      total: null,
    });
    const { anime: malAnimeList, manga: malMangaList } = await withFreshMalAccount(
      session.user.id,
      async (account) => {
      if (!account?.access_token) {
        throw new Error('Link a MyAnimeList account before updating from MyAnimeList.');
      }

      linkedAccount = account;
        const [anime, manga] = await Promise.all([
          mal.getViewerAnimeList(account.access_token),
          mal.getViewerMangaList(account.access_token),
        ]);
        return { anime, manga };
      }
    );
    const totalRemoteEntries =
      (malAnimeList?.data?.length || 0) + (malMangaList?.data?.length || 0);
    emitSyncProgress({
      operation: 'pull-mal',
      stage: 'mapping',
      label: 'Matching MyAnimeList entries...',
      current: 0,
      total: totalRemoteEntries,
    });
    const animeResult = await importMalEntries(session, malAnimeList, {
      selectedStatuses: IMPORT_STATUS_ORDER,
      selectedAnimeIds: [],
      sourceProvider: 'mal',
      onProgress: ({ stage, current, total, entryTitle }) =>
        emitSyncProgress({
          operation: 'pull-mal',
          stage,
          label:
            stage === 'mapping'
              ? `Matching ${current} of ${total}: ${entryTitle}`
              : `Processing ${current} of ${total}: ${entryTitle}`,
          current,
          total,
        }),
      onImportProgress: ({ current, total, entryTitle }) =>
        emitSyncProgress({
          operation: 'pull-mal',
          stage: 'saving',
          label: `Saving ${current} of ${total}: ${entryTitle}`,
          current,
          total,
        }),
    });
    const mangaResult = await importMalMangaEntries(session, malMangaList, {
      sourceProvider: 'mal',
      onProgress: ({ current, total, entryTitle }) =>
        emitSyncProgress({
          operation: 'pull-mal',
          stage: 'mapping',
          label: `Matching Manga ${current} of ${total}: ${entryTitle}`,
          current: (malAnimeList?.data?.length || 0) + current,
          total: totalRemoteEntries,
        }),
      onImportProgress: ({ current, total, entryTitle }) =>
        emitSyncProgress({
          operation: 'pull-mal',
          stage: 'saving',
          label: `Saving Manga ${current} of ${total}: ${entryTitle}`,
          current,
          total,
        }),
    });
    const result = combineMediaPullResults('MyAnimeList', animeResult, mangaResult);

    if (result.partial) {
      console.warn(
        'MyAnimeList pull skipped entries:',
        JSON.stringify([
          ...(animeResult.summary?.mappingFailures || []),
          ...(mangaResult.summary?.mappingFailures || []),
        ])
      );
    }

    if (result.ok) {
      updateMalAccountImportTime(linkedAccount.mal_user_id);
      for (const change of animeResult.summary?.changes || []) {
        insertSyncHistory({
          userId: session.user.id,
          animeId: change.animeId,
          animeTitle: change.animeTitle,
          operation: 'pull_from_mal',
          changedFields: change.changedFields,
          status: 'completed',
          message: 'Updated local entry from MyAnimeList.',
        });
      }
      for (const change of mangaResult.summary?.changes || []) {
        insertSyncHistory({
          userId: session.user.id,
          mangaId: change.mangaId,
          mediaType: 'MANGA',
          animeTitle: change.animeTitle,
          operation: 'pull_from_mal_manga',
          changedFields: change.changedFields,
          status: 'completed',
          message: 'Updated local Manga entry from MyAnimeList.',
        });
      }
      recordPullActivity(session.user.id, 'mal', result, [
        ...(animeResult.summary?.mappingFailures || []).map((failure) => ({
          ...failure,
          mediaType: 'ANIME',
        })),
        ...(mangaResult.summary?.mappingFailures || []).map((failure) => ({
          ...failure,
          mediaType: 'MANGA',
        })),
      ]);
    }
    const response = result;

    emitSyncProgress({
      operation: 'pull-mal',
      stage: response.ok ? 'complete' : 'failed',
      label: response.message,
      current: result.summary?.totalFound ?? null,
      total: result.summary?.totalFound ?? null,
    });

    return response;
  } catch (error) {
    console.error('MyAnimeList pull error:', error);
    if (session.authenticated && session.user?.id) {
      insertSyncHistory({
        userId: session.user.id,
        mediaId: null,
        mediaTitle: 'MyAnimeList pull summary',
        operation: 'pull_summary_mal',
        status: 'failed',
        message: error.message || 'Failed to update from MyAnimeList.',
      });
    }
    emitSyncProgress({
      operation: 'pull-mal',
      stage: 'failed',
      label: error.message || 'Failed to update from MyAnimeList.',
      current: null,
      total: null,
    });
    return { ok: false, message: error.message || 'Failed to update from MyAnimeList.' };
  }
});

async function fetchAnimeDetailsFromAniList(id) {
  if (typeof anilist.getAnimeDetails === 'function') {
    return await anilist.getAnimeDetails(id, { includeFranchiseStartDate: false });
  }

  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        isAdult

        title {
          romaji
          english
          native
          userPreferred
        }

        coverImage {
          extraLarge
          large
        }

        bannerImage

        episodes
        format
        status

        season
        seasonYear

        averageScore
        meanScore
        popularity
        favourites
        duration
        source
        countryOfOrigin
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
        trailer {
          id
          site
          thumbnail
        }
        siteUrl
        description

        genres
        synonyms

        nextAiringEpisode {
          episode
          airingAt
        }

        studios {
          nodes {
            id
            name
            isAnimationStudio
          }
        }

        tags {
          id
          name
          description
          rank
          isMediaSpoiler
          isGeneralSpoiler
        }

        characters(perPage: 20) {
          edges {
            role
            node {
              id
              name {
                full
                native
                userPreferred
              }
              image {
                large
              }
            }
            voiceActors(language: JAPANESE) {
              id
              name {
                full
                native
                userPreferred
              }
              language
              image {
                large
              }
            }
          }
        }

        staff(perPage: 20) {
          edges {
            role
            node {
              id
              name {
                full
                native
                userPreferred
              }
              image {
                large
              }
            }
          }
        }

        relations {
          edges {
            relationType
            node {
              id
              type
              title {
                romaji
                english
                native
                userPreferred
              }
              coverImage {
                large
              }
              episodes
              format
              status
              season
              seasonYear
              averageScore
            }
          }
        }

        recommendations(perPage: 10) {
          nodes {
            rating
            mediaRecommendation {
              id
              title {
                romaji
                english
                native
                userPreferred
              }
              coverImage {
                large
              }
              description
              episodes
              format
              status
              season
              seasonYear
              averageScore
            }
          }
        }

        externalLinks {
          id
          url
          site
          siteId
          type
          language
          color
          icon
          notes
          isDisabled
        }

        streamingEpisodes {
          title
          thumbnail
          url
          site
        }
      }
    }
  `;

  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { id },
    }),
  });

  if (!response.ok) {
    throw new Error(`AniList request failed with status ${response.status}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0]?.message || 'AniList returned an error');
  }

  return data.data.Media;
}

function hasUsableAnimeDetailsCache(row) {
  if (!row) return false;
  if (row.is_adult === null || row.is_adult === undefined) return false;
  if (!hasCachedStudioIds(row.studios)) return false;

  const hasFullDetails =
    Boolean(row.site_url) ||
    Boolean(row.description) ||
    Boolean(row.trailer_id) ||
    Boolean(row.external_links && row.external_links !== '[]') ||
    Boolean(row.relations && row.relations !== '[]') ||
    Boolean(row.recommendations && row.recommendations !== '[]');

  return hasFullDetails;
}

function hasFreshAnimeDetailsCache(row) {
  if (!hasUsableAnimeDetailsCache(row)) return false;

  const cachedAt = Date.parse(row.cached_at);
  return Number.isFinite(cachedAt) && Date.now() - cachedAt < MEDIA_DETAILS_CACHE_TTL_MS;
}

function hasFreshMangaDetailsCache(row) {
  if (!row?.details) return false;

  const cachedAt = Date.parse(row.cached_at);
  return Number.isFinite(cachedAt) && Date.now() - cachedAt < MEDIA_DETAILS_CACHE_TTL_MS;
}

function hasCachedStudioIds(value) {
  try {
    const studios = JSON.parse(value || '[]');
    return (
      !studios.length ||
      studios.every(
        (studio) =>
          studio &&
          typeof studio === 'object' &&
          Number.isInteger(Number(studio.id)) &&
          Number(studio.id) > 0
      )
    );
  } catch {
    return false;
  }
}

async function getAnimeDetails(id) {
  const cachedAnime = getAnimeById(id);

  if (hasFreshAnimeDetailsCache(cachedAnime)) {
    return mapDbAnimeForFrontend(cachedAnime);
  }

  try {
    const media = await fetchAnimeDetailsFromAniList(id);
    saveAnime(mapAnimeForDb(media));
    return media;
  } catch (error) {
    if (cachedAnime) {
      console.warn(`AniList anime details unavailable for ${id}; serving stale cached data.`);
      return mapDbAnimeForFrontend(cachedAnime);
    }

    throw error;
  }
}

async function calculateAnimeFranchiseStartDate(id) {
  const cachedAnime = getAnimeById(id);
  if (cachedAnime?.franchise_start_resolved && cachedAnime.franchise_start_date) {
    return mapDbAnimeForFrontend(cachedAnime).franchiseStartDate;
  }

  let media = cachedAnime ? mapDbAnimeForFrontend(cachedAnime) : null;
  if (!media) {
    media = await fetchAnimeDetailsFromAniList(id);
    if (media?.id) saveAnime(mapAnimeForDb(media));
  }

  const franchiseStartDate = await anilist.findAnimeSeriesStartDate(media);
  if (!franchiseStartDate?.year) {
    throw new Error('AniList did not provide enough dates to calculate the franchise age.');
  }

  updateAnimeFranchiseStartDate(id, franchiseStartDate);
  return franchiseStartDate;
}

function getAnimeFranchiseStartDate(id) {
  const animeId = Number(id);
  if (!Number.isInteger(animeId) || animeId <= 0) {
    throw new Error('A valid anime ID is required.');
  }

  const existingRequest = franchiseStartDateRequests.get(animeId);
  if (existingRequest) return existingRequest;

  const request = calculateAnimeFranchiseStartDate(animeId).finally(() => {
    franchiseStartDateRequests.delete(animeId);
  });
  franchiseStartDateRequests.set(animeId, request);
  return request;
}

async function getMangaDetails(id) {
  const cachedManga = getMangaById(id);

  if (hasFreshMangaDetailsCache(cachedManga)) {
    return cachedManga.details;
  }

  try {
    const media = await anilist.getMangaDetails(id);
    saveManga(media);
    return media;
  } catch (error) {
    if (cachedManga?.details) {
      console.warn(`AniList manga details unavailable for ${id}; serving stale cached data.`);
      return cachedManga.details;
    }

    throw error;
  }
}

function hasFreshPersonDetailsCache(row) {
  if (!row?.details) return false;

  const cachedAt = Date.parse(row.cachedAt);
  return Number.isFinite(cachedAt) && Date.now() - cachedAt < PERSON_DETAILS_CACHE_TTL_MS;
}

async function getCachedPersonDetails(kind, id) {
  const cachedDetails = getPersonDetails(kind, id);

  if (hasFreshPersonDetailsCache(cachedDetails)) {
    return cachedDetails.details;
  }

  const details =
    kind === 'character'
      ? await anilist.getCharacterDetails(Number(id))
      : await anilist.getStaffDetails(Number(id));

  if (details?.id) {
    savePersonDetails(kind, details.id, details);
  }

  return details;
}

ipcMain.handle('anime:get-details', async (_event, id) => {
  try {
    return await getAnimeDetails(id);
  } catch (error) {
    console.error('Failed to fetch anime details:', error);
    throw error;
  }
});

ipcMain.handle('anime:get-franchise-start-date', async (_event, id) => {
  return { franchiseStartDate: await getAnimeFranchiseStartDate(id) };
});

ipcMain.handle('media:get-details', async (_event, payload) => {
  const id = Number(payload?.id);
  const mediaType = String(payload?.mediaType || '').toUpperCase();

  try {
    if (mediaType === 'ANIME') {
      return await getAnimeDetails(id);
    }

    if (mediaType === 'MANGA') {
      return await getMangaDetails(id);
    }

    throw new Error('Unsupported media type.');
  } catch (error) {
    console.error(`Failed to fetch ${mediaType || 'media'} details:`, error);
    throw error;
  }
});

ipcMain.handle('anime:get-character-details', async (_event, id) => {
  try {
    return await getCachedPersonDetails('character', id);
  } catch (error) {
    console.error('Failed to fetch character details:', error);
    throw error;
  }
});

ipcMain.handle('anime:get-staff-details', async (_event, id) => {
  try {
    return await getCachedPersonDetails('staff', id);
  } catch (error) {
    console.error('Failed to fetch staff details:', error);
    throw error;
  }
});

ipcMain.handle('anime:cache-minimal', async (_event, media) => {
  try {
    if (!media?.id) {
      return { ok: false, message: 'Invalid anime data.' };
    }

    const mappedAnime = buildMinimalAnimeForDb(media);
    saveAnimeSummary(mappedAnime);

    return { ok: true };
  } catch (error) {
    console.error('Failed to cache minimal anime:', error);
    return { ok: false, message: 'Failed to cache anime.' };
  }
});

ipcMain.handle('manga:cache-minimal', async (_event, media) => {
  try {
    if (!media?.id) {
      return { ok: false, message: 'Invalid manga data.' };
    }

    if (!getMangaById(media.id)) {
      saveManga(media);
    }
    return { ok: true };
  } catch (error) {
    console.error('Failed to cache minimal manga:', error);
    return { ok: false, message: 'Failed to cache manga.' };
  }
});

ipcMain.handle('auth:anilist-start', async () => {
  try {
    const accessToken = await anilistOAuth.authorizeWithBrowser();
    const viewer = await anilist.getViewer(accessToken);

    if (!viewer?.id || !viewer?.name) {
      return { ok: false, message: 'AniList did not return account details.' };
    }

    const linkedAccount = getAniListAccountByAniListUserId(viewer.id);

    if (linkedAccount?.user_id) {
      pendingAniListSignup = null;
      return await finishAniListLogin({
        accessToken,
        viewer,
        userId: linkedAccount.user_id,
      });
    }

    pendingAniListSignup = {
      accessToken,
      viewer,
      createdAt: Date.now(),
    };

    return {
      ok: true,
      needsProfile: true,
      message: 'AniList account verified. Choose your local display name.',
      anilist: {
        id: viewer.id,
        username: viewer.name,
      },
      suggestedUsername: viewer.name,
    };
  } catch (error) {
    console.error('AniList OAuth start error:', error);
    return {
      ok: false,
      message: error.message || 'Failed to log in with AniList.',
    };
  }
});

ipcMain.handle('auth:anilist-complete', async (_event, payload) => {
  try {
    if (!pendingAniListSignup?.accessToken || !pendingAniListSignup?.viewer) {
      return { ok: false, message: 'AniList login session expired. Try again.' };
    }

    if (Date.now() - pendingAniListSignup.createdAt > 10 * 60 * 1000) {
      pendingAniListSignup = null;
      return { ok: false, message: 'AniList login session expired. Try again.' };
    }

    const username = String(payload?.username || '').trim();
    const usernameError = validateUsername(username);

    if (usernameError) {
      return { ok: false, message: usernameError };
    }

    const usernameNormalized = normalizeUsername(username);

    if (getUserByNormalizedUsername(usernameNormalized)) {
      return { ok: false, message: 'Username is already taken.' };
    }

    const signup = pendingAniListSignup;
    const created = await createLinkedUser(username);

    if (!created.ok || !created.user) {
      return created;
    }

    pendingAniListSignup = null;

    return await finishAniListLogin({
      accessToken: signup.accessToken,
      viewer: signup.viewer,
      userId: created.user.id,
    });
  } catch (error) {
    console.error('AniList OAuth complete error:', error);
    return {
      ok: false,
      message: error.message || 'Failed to finish AniList login.',
    };
  }
});

ipcMain.handle('auth:mal-start', async () => {
  try {
    const tokenData = await malOAuth.authorizeWithBrowser();
    const viewer = await mal.getViewer(tokenData.access_token);

    if (!viewer?.id || !viewer?.name) {
      return { ok: false, message: 'MyAnimeList did not return account details.' };
    }

    const linkedAccount = getMalAccountByMalUserId(viewer.id);

    if (linkedAccount?.user_id) {
      pendingMalSignup = null;
      return await finishMalLogin({
        tokenData,
        viewer,
        userId: linkedAccount.user_id,
      });
    }

    pendingMalSignup = {
      tokenData,
      viewer,
      createdAt: Date.now(),
    };

    return {
      ok: true,
      needsProfile: true,
      message: 'MyAnimeList account verified. Choose your local display name.',
      mal: {
        id: viewer.id,
        username: viewer.name,
      },
      suggestedUsername: viewer.name,
    };
  } catch (error) {
    console.error('MyAnimeList OAuth start error:', error);
    return {
      ok: false,
      message: error.message || 'Failed to log in with MyAnimeList.',
    };
  }
});

ipcMain.handle('auth:mal-complete', async (_event, payload) => {
  try {
    if (!pendingMalSignup?.tokenData || !pendingMalSignup?.viewer) {
      return { ok: false, message: 'MyAnimeList login session expired. Try again.' };
    }

    if (Date.now() - pendingMalSignup.createdAt > 10 * 60 * 1000) {
      pendingMalSignup = null;
      return { ok: false, message: 'MyAnimeList login session expired. Try again.' };
    }

    const username = String(payload?.username || '').trim();
    const usernameError = validateUsername(username);

    if (usernameError) {
      return { ok: false, message: usernameError };
    }

    const usernameNormalized = normalizeUsername(username);

    if (getUserByNormalizedUsername(usernameNormalized)) {
      return { ok: false, message: 'Username is already taken.' };
    }

    const signup = pendingMalSignup;
    const created = await createLinkedUser(username);

    if (!created.ok || !created.user) {
      return created;
    }

    pendingMalSignup = null;

    return await finishMalLogin({
      tokenData: signup.tokenData,
      viewer: signup.viewer,
      userId: created.user.id,
    });
  } catch (error) {
    console.error('MyAnimeList OAuth complete error:', error);
    return {
      ok: false,
      message: error.message || 'Failed to finish MyAnimeList login.',
    };
  }
});

ipcMain.handle('auth:anilist-link-status', () => {
  try {
    return getAniListLinkStatus(getCurrentSession());
  } catch (error) {
    console.error('AniList link status error:', error);
    return { ok: false, message: 'Failed to load AniList link status.', linked: false };
  }
});

ipcMain.handle('auth:anilist-link', async () => {
  try {
    const session = getCurrentSession();

    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.', linked: false };
    }

    if (getMalAccountByUserId(session.user.id)) {
      return {
        ok: false,
        linked: false,
        message: 'Unlink MyAnimeList before linking AniList. Seenary supports one sync provider at a time.',
      };
    }

    const accessToken = await anilistOAuth.authorizeWithBrowser();
    const viewer = await anilist.getViewer(accessToken);

    if (!viewer?.id || !viewer?.name) {
      return { ok: false, message: 'AniList did not return account details.', linked: false };
    }

    const existingLinkedAccount = getAniListAccountByAniListUserId(viewer.id);

    if (
      existingLinkedAccount?.user_id &&
      Number(existingLinkedAccount.user_id) !== Number(session.user.id)
    ) {
      const existingUser = getSafeUserById(existingLinkedAccount.user_id);

      pendingAniListLinkConflict = {
        accessToken,
        viewer,
        sourceUserId: Number(existingLinkedAccount.user_id),
        targetUserId: Number(session.user.id),
        createdAt: Date.now(),
      };

      return {
        ok: true,
        message: `AniList account ${viewer.name} is already linked to another local account.`,
        linked: false,
        needsConflictResolution: true,
        conflict: {
          anilistUserId: viewer.id,
          anilistUsername: viewer.name,
          sourceUser: existingUser
            ? {
                id: existingUser.id,
                username: existingUser.username,
              }
            : null,
          targetUser: {
            id: session.user.id,
            username: session.user.username,
          },
        },
      };
    }

    pendingAniListLinkConflict = null;

    return await linkAniListToUser({
      accessToken,
      viewer,
      userId: session.user.id,
    });
  } catch (error) {
    console.error('AniList link error:', error);
    return {
      ok: false,
      linked: false,
      message: error.message || 'Failed to link AniList account.',
    };
  }
});

ipcMain.handle('auth:anilist-resolve-link-conflict', async (_event, payload) => {
  try {
    const session = getCurrentSession();

    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.', linked: false };
    }

    if (!pendingAniListLinkConflict) {
      return { ok: false, message: 'No AniList link conflict is waiting.', linked: false };
    }

    if (Date.now() - pendingAniListLinkConflict.createdAt > 10 * 60 * 1000) {
      pendingAniListLinkConflict = null;
      return { ok: false, message: 'AniList link conflict expired. Try linking again.', linked: false };
    }

    if (Number(pendingAniListLinkConflict.targetUserId) !== Number(session.user.id)) {
      pendingAniListLinkConflict = null;
      return { ok: false, message: 'AniList link conflict no longer matches this account.', linked: false };
    }

    const action = String(payload?.action || '').trim();

    if (!['transfer', 'merge'].includes(action)) {
      return { ok: false, message: 'Choose transfer or merge.', linked: false };
    }

    const conflict = pendingAniListLinkConflict;
    pendingAniListLinkConflict = null;

    let mergeSummary = null;

    if (action === 'merge') {
      mergeSummary = mergeUserIntoUser(conflict.sourceUserId, conflict.targetUserId);
    }

    const result = await linkAniListToUser({
      accessToken: conflict.accessToken,
      viewer: conflict.viewer,
      userId: conflict.targetUserId,
    });

    return {
      ...result,
      message:
        action === 'merge'
          ? `${result.message} Merged ${mergeSummary?.movedEntries ?? 0} list entries from the old local account.`
          : result.message,
      resolution: action,
      mergeSummary,
    };
  } catch (error) {
    console.error('AniList link conflict resolution error:', error);
    return {
      ok: false,
      linked: false,
      message: error.message || 'Failed to resolve AniList link conflict.',
    };
  }
});

ipcMain.handle('auth:mal-link-status', () => {
  try {
    const session = getCurrentSession();

    if (!session?.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.', linked: false };
    }

    const linkedAccount = getMalAccountByUserId(session.user.id);

    return {
      ok: true,
      linked: Boolean(linkedAccount),
      account: linkedAccount ? buildMalAccountPayload(linkedAccount) : null,
      localCredentialsConfirmed: getLocalCredentialsConfirmed(session.user.id),
    };
  } catch (error) {
    console.error('MyAnimeList link status error:', error);
    return { ok: false, message: 'Failed to load MyAnimeList link status.', linked: false };
  }
});

ipcMain.handle('auth:set-local-password', async (_event, payload) => {
  try {
    const session = getCurrentSession();
    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }
    if (getLocalCredentialsConfirmed(session.user.id) === true) {
      return { ok: false, message: 'Your local password is already confirmed.' };
    }
    const result = await setLocalPassword(session.user.id, payload?.password ?? '');
    return result.ok ? { ...result, localCredentialsConfirmed: true } : result;
  } catch (error) {
    console.error('Set local password error:', error);
    return { ok: false, message: 'Failed to set a local password.' };
  }
});

async function unlinkProviderAccount(provider, password) {
  const session = getCurrentSession();
  if (!session.authenticated || !session.user?.id) {
    return { ok: false, message: 'You must be logged in.', linked: false };
  }

  const userId = session.user.id;
  const validPassword = await verifyLocalPassword(userId, password);
  if (!validPassword) {
    return {
      ok: false,
      linked: true,
      needsLocalPassword: getLocalCredentialsConfirmed(userId) !== true,
      message: getUnlinkPasswordError(userId),
    };
  }

  if (provider === 'mal') {
    deleteMalAccountByUserId(userId);
  } else {
    deleteAniListAccountByUserId(userId);
  }
  clearProviderSyncQueue(userId, provider);

  const providerName = provider === 'mal' ? 'MyAnimeList' : 'AniList';
  return {
    ok: true,
    linked: false,
    localCredentialsConfirmed: true,
    message: `${providerName} was unlinked. Your Seenary library data was kept.`,
  };
}

ipcMain.handle('auth:anilist-unlink', async (_event, payload) => {
  try {
    return await unlinkProviderAccount('anilist', payload?.password ?? '');
  } catch (error) {
    console.error('AniList unlink error:', error);
    return { ok: false, linked: true, message: 'Failed to unlink AniList.' };
  }
});

ipcMain.handle('auth:mal-unlink', async (_event, payload) => {
  try {
    return await unlinkProviderAccount('mal', payload?.password ?? '');
  } catch (error) {
    console.error('MyAnimeList unlink error:', error);
    return { ok: false, linked: true, message: 'Failed to unlink MyAnimeList.' };
  }
});

ipcMain.handle('auth:mal-link', async () => {
  try {
    const session = getCurrentSession();

    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.', linked: false };
    }

    if (getAniListAccountByUserId(session.user.id)) {
      return {
        ok: false,
        linked: false,
        message: 'Unlink AniList before linking MyAnimeList. Seenary supports one sync provider at a time.',
      };
    }

    const tokenData = await malOAuth.authorizeWithBrowser();
    const viewer = await mal.getViewer(tokenData.access_token);

    if (!viewer?.id || !viewer?.name) {
      return { ok: false, message: 'MyAnimeList did not return account details.', linked: false };
    }

    const existingLinkedAccount = getMalAccountByMalUserId(viewer.id);

    if (
      existingLinkedAccount?.user_id &&
      Number(existingLinkedAccount.user_id) !== Number(session.user.id)
    ) {
      const existingUser = getSafeUserById(existingLinkedAccount.user_id);

      pendingMalLinkConflict = {
        tokenData,
        viewer,
        sourceUserId: Number(existingLinkedAccount.user_id),
        targetUserId: Number(session.user.id),
        createdAt: Date.now(),
      };

      return {
        ok: true,
        message: `MyAnimeList account ${viewer.name} is already linked to another local account.`,
        linked: false,
        needsConflictResolution: true,
        conflict: {
          malUserId: viewer.id,
          malUsername: viewer.name,
          sourceUser: existingUser
            ? {
                id: existingUser.id,
                username: existingUser.username,
              }
            : null,
          targetUser: {
            id: session.user.id,
            username: session.user.username,
          },
        },
      };
    }

    pendingMalLinkConflict = null;

    return await linkMalToUser({
      tokenData,
      viewer,
      userId: session.user.id,
    });
  } catch (error) {
    console.error('MyAnimeList link error:', error);
    return {
      ok: false,
      linked: false,
      message: error.message || 'Failed to link MyAnimeList account.',
    };
  }
});

ipcMain.handle('auth:mal-resolve-link-conflict', async (_event, payload) => {
  try {
    const session = getCurrentSession();

    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.', linked: false };
    }

    if (!pendingMalLinkConflict) {
      return { ok: false, message: 'No MyAnimeList link conflict is waiting.', linked: false };
    }

    if (Date.now() - pendingMalLinkConflict.createdAt > 10 * 60 * 1000) {
      pendingMalLinkConflict = null;
      return { ok: false, message: 'MyAnimeList link conflict expired. Try linking again.', linked: false };
    }

    if (Number(pendingMalLinkConflict.targetUserId) !== Number(session.user.id)) {
      pendingMalLinkConflict = null;
      return { ok: false, message: 'MyAnimeList link conflict no longer matches this account.', linked: false };
    }

    const action = String(payload?.action || '').trim();

    if (!['transfer', 'merge'].includes(action)) {
      return { ok: false, message: 'Choose transfer or merge.', linked: false };
    }

    const conflict = pendingMalLinkConflict;
    pendingMalLinkConflict = null;

    let mergeSummary = null;

    if (action === 'merge') {
      mergeSummary = mergeUserIntoUser(conflict.sourceUserId, conflict.targetUserId);
    }

    const result = await linkMalToUser({
      tokenData: conflict.tokenData,
      viewer: conflict.viewer,
      userId: conflict.targetUserId,
    });

    return {
      ...result,
      message:
        action === 'merge'
          ? `${result.message} Merged ${mergeSummary?.movedEntries ?? 0} list entries from the old local account.`
          : result.message,
      resolution: action,
      mergeSummary,
    };
  } catch (error) {
    console.error('MyAnimeList link conflict resolution error:', error);
    return {
      ok: false,
      linked: false,
      message: error.message || 'Failed to resolve MyAnimeList link conflict.',
    };
  }
});

ipcMain.handle('auth:register', async (_event, payload) => {
  try {
    const username = payload?.username ?? '';
    const password = payload?.password ?? '';
    return await registerUser(username, password);
  } catch (error) {
    console.error('Register error:', error);
    return { ok: false, message: 'Failed to create account.' };
  }
});

ipcMain.handle('auth:login', async (_event, payload) => {
  try {
    const username = payload?.username ?? '';
    const password = payload?.password ?? '';
    return await loginUser(username, password);
  } catch (error) {
    console.error('Login error:', error);
    return { ok: false, message: 'Failed to log in.' };
  }
});

ipcMain.handle('auth:logout', () => {
  try {
    return logoutUser();
  } catch (error) {
    console.error('Logout error:', error);
    return { ok: false, message: 'Failed to log out.' };
  }
});

ipcMain.handle('auth:delete-account', (_event, usernameConfirmation) => {
  try {
    const session = getCurrentSession();
    if (!session.authenticated || !session.user?.id) {
      return { ok: false, message: 'You must be logged in.' };
    }
    if (String(usernameConfirmation || '').trim() !== session.user.username) {
      return { ok: false, message: 'The username confirmation does not match.' };
    }

    const userId = session.user.id;
    const deleted = deleteUser(userId);
    if (!deleted) return { ok: false, message: 'The account could not be deleted.' };
    deleteLayoutOrders(userId);
    logoutUser();
    return { ok: true, message: 'Your Seenary account and its stored data were deleted.' };
  } catch (error) {
    console.error('Account deletion error:', error);
    return { ok: false, message: 'Failed to delete the account.' };
  }
});

ipcMain.handle('auth:get-session', () => {
  try {
    return getCurrentSession();
  } catch (error) {
    console.error('Session error:', error);
    return { authenticated: false, user: null };
  }
});

ipcMain.handle('auth:set-tutorial-dismissed', (_event, dismissed) => {
  try {
    return setTutorialDismissedForCurrentUser(Boolean(dismissed));
  } catch (error) {
    console.error('Tutorial preference update error:', error);
    return { ok: false, message: 'Failed to update tutorial preference.', user: null };
  }
});

ipcMain.handle('list:get', () => {
  try {
    return getMyAnimeList(getCurrentSession());
  } catch (error) {
    console.error('List get error:', error);
    return { ok: false, message: 'Failed to load list.', entries: [] };
  }
});

ipcMain.handle('list:get-entry', (_event, animeId) => {
  try {
    return getMyAnimeEntry(getCurrentSession(), animeId);
  } catch (error) {
    console.error('List get entry error:', error);
    return { ok: false, message: 'Failed to load list entry.', entry: null };
  }
});

ipcMain.handle('list:save-entry', (_event, payload) => {
  try {
    const animeId = payload?.animeId;
    const data = payload?.data ?? {};
    return saveMyAnimeEntry(getCurrentSession(), animeId, data, {
      localActivityAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('List save entry error:', error);
    return { ok: false, message: 'Failed to save list entry.' };
  }
});

ipcMain.handle('list:remove-entry', (_event, animeId) => {
  try {
    return removeMyAnimeEntry(getCurrentSession(), animeId);
  } catch (error) {
    console.error('List remove entry error:', error);
    return { ok: false, message: 'Failed to remove list entry.' };
  }
});

ipcMain.handle('manga-list:get', () => {
  try {
    return getMyMangaList(getCurrentSession());
  } catch (error) {
    console.error('Manga list get error:', error);
    return { ok: false, message: 'Failed to load manga list.', entries: [] };
  }
});

ipcMain.handle('manga-list:get-entry', (_event, mangaId) => {
  try {
    return getMyMangaEntry(getCurrentSession(), mangaId);
  } catch (error) {
    console.error('Manga list entry get error:', error);
    return { ok: false, message: 'Failed to load manga list entry.', entry: null };
  }
});

ipcMain.handle('manga-list:save-entry', (_event, payload) => {
  try {
    return saveMyMangaEntry(getCurrentSession(), payload?.mangaId, payload?.data ?? {}, {
      localActivityAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Manga list entry save error:', error);
    return { ok: false, message: 'Failed to save manga list entry.' };
  }
});

ipcMain.handle('manga-list:remove-entry', (_event, mangaId) => {
  try {
    return removeMyMangaEntry(getCurrentSession(), mangaId);
  } catch (error) {
    console.error('Manga list entry remove error:', error);
    return { ok: false, message: 'Failed to remove manga list entry.' };
  }
});

ipcMain.handle('list:clear', (_event, options = {}) => {
  try {
    return clearMyAnimeList(getCurrentSession(), options);
  } catch (error) {
    console.error('List clear error:', error);
    return { ok: false, message: 'Failed to clear your list.', removedCount: 0 };
  }
});

ipcMain.handle('manga-list:clear', (_event, options = {}) => {
  try {
    return clearMyMangaList(getCurrentSession(), options);
  } catch (error) {
    console.error('Manga list clear error:', error);
    return { ok: false, message: 'Failed to clear your Manga list.', removedCount: 0 };
  }
});

ipcMain.handle('media-list:clear-all', (_event, options = {}) => {
  try {
    return clearAllMediaLists(getCurrentSession(), options);
  } catch (error) {
    console.error('Media lists clear error:', error);
    return { ok: false, message: 'Failed to clear your media lists.', removedCount: 0 };
  }
});

ipcMain.handle('backup:export', async (_event, preferenceBundle) => {
  try {
    return await exportBackup(getCurrentSession(), getAppPreferences(), preferenceBundle);
  } catch (error) {
    console.error('Backup export error:', error);
    throw new Error(error.message || 'Failed to export backup.');
  }
});

ipcMain.handle('backup:import', async (_event, backup) => {
  try {
    return await importBackup(getCurrentSession(), backup, updateAppPreferences);
  } catch (error) {
    console.error('Backup import error:', error);
    return { ok: false, message: error.message || 'Failed to import backup.' };
  }
});

registerSystemLocaleIpc();
registerDesktopEnvironmentIpc();

function getTrayOptions(win) {
  return {
    isGamingModeEnabled: getGamingModeEnabled,
    onToggleGamingMode: (enabled) => setGamingModeEnabled(win, enabled),
  };
}

function bootAppWindow() {
  mainWindow = createWindow();

  setupTray(mainWindow, getTrayOptions(mainWindow));
  registerShortcuts(mainWindow);
  registerShortcutIpc(() => mainWindow);
  registerStartupIpc();
  registerWindowStateIpc(() => mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerAppLifecycleIpc();
  registerLayoutConfigIpc();
  bootAppWindow();

  app.on('activate', () => {
    if (!mainWindow) {
      bootAppWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
