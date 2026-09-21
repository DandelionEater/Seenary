const { contextBridge, ipcRenderer } = require('electron');

function getSystemLocaleInfo() {
  try {
    return ipcRenderer.sendSync('system-locale:get');
  } catch {
    return { locale: null, locales: [] };
  }
}

contextBridge.exposeInMainWorld('desktopEnvironment', {
  getInfo: () => ipcRenderer.invoke('desktop-environment:get'),
});

contextBridge.exposeInMainWorld('api', {
  searchMedia: (query, hideAdultContent = true) =>
    ipcRenderer.invoke('anilist:search-media', { query, hideAdultContent }),
  getDiscoverMedia: (hideAdultContent = true) =>
    ipcRenderer.invoke('anilist:discover-media', { hideAdultContent }),
  getDiscoverShelfAnime: (shelfId, page = 1, hideAdultContent = true, mediaType = 'ANIME') =>
    ipcRenderer.invoke('anilist:discover-shelf', { shelfId, page, hideAdultContent, mediaType }),
  getStudioMedia: (studioId, page = 1, hideAdultContent = true) =>
    ipcRenderer.invoke('anilist:studio-media', { studioId, page, hideAdultContent }),
  getArtistMedia: (artistSlug, page = 1, hideAdultContent = true) =>
    ipcRenderer.invoke('animethemes:artist-media', {
      artistSlug,
      page,
      hideAdultContent,
    }),
  getAnimeThemeMusic: (anilistId, titles = []) =>
    ipcRenderer.invoke('animethemes:anime-music', { anilistId, titles }),
  previewAniListImport: (username) => ipcRenderer.invoke('anilist:preview-import', { username }),
  importAniList: (username, selectedStatuses, selectedMediaKeys) =>
    ipcRenderer.invoke('anilist:import-list', {
      username,
      selectedStatuses,
      selectedMediaKeys,
    }),
  previewMalImport: (username) => ipcRenderer.invoke('mal:preview-import', { username }),
  importMal: (username, selectedStatuses, selectedMediaKeys) =>
    ipcRenderer.invoke('mal:import-list', {
      username,
      selectedStatuses,
      selectedMediaKeys,
    }),
  previewTextImport: (text, hideAdultContent = true, mediaType = 'ANIME') =>
    ipcRenderer.invoke('text-import:preview', { text, hideAdultContent, mediaType }),
  previewPdfImport: (pdfBase64, hideAdultContent = true, mediaType = 'ANIME') =>
    ipcRenderer.invoke('pdf-import:preview', { pdfBase64, hideAdultContent, mediaType }),
  importTextList: (entries, selectedMediaKeys) =>
    ipcRenderer.invoke('text-import:import', { entries, selectedMediaKeys }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  recordEngagement: (payload) => ipcRenderer.invoke('analytics:record-engagement', payload),
  getSyncStatus: () => ipcRenderer.invoke('sync:get-status'),
  setAutoSync: (enabled) => ipcRenderer.invoke('sync:set-auto', enabled),
  runSyncNow: () => ipcRenderer.invoke('sync:run-now'),
  pullFromAniList: () => ipcRenderer.invoke('sync:pull-from-anilist'),
  pullFromMal: () => ipcRenderer.invoke('sync:pull-from-mal'),
  onSyncProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('sync:progress', handler);
    return () => ipcRenderer.removeListener('sync:progress', handler);
  },
  onAutoSyncComplete: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('sync:auto-complete', handler);
    return () => ipcRenderer.removeListener('sync:auto-complete', handler);
  },
  getSyncActivity: () => ipcRenderer.invoke('sync:get-activity'),
  restoreSyncExclusion: (payload) => ipcRenderer.invoke('sync:restore-exclusion', payload),
  excludeSyncEntry: (payload) => ipcRenderer.invoke('sync:exclude-entry', payload),
  getAnimeDetails: (id) => ipcRenderer.invoke('anime:get-details', id),
  getAnimeFranchiseStartDate: (id) =>
    ipcRenderer.invoke('anime:get-franchise-start-date', id),
  getMediaDetails: (mediaType, id) =>
    ipcRenderer.invoke('media:get-details', { mediaType, id }),
  getCharacterDetails: (id) => ipcRenderer.invoke('anime:get-character-details', id),
  getStaffDetails: (id) => ipcRenderer.invoke('anime:get-staff-details', id),
  cacheMinimalAnime: (media) => ipcRenderer.invoke('anime:cache-minimal', media),
  cacheMinimalManga: (media) => ipcRenderer.invoke('manga:cache-minimal', media),

  register: (username, password) => ipcRenderer.invoke('auth:register', { username, password }),

  login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),

  startAniListLogin: () => ipcRenderer.invoke('auth:anilist-start'),

  completeAniListLogin: (username) =>
    ipcRenderer.invoke('auth:anilist-complete', { username }),

  startMalLogin: () => ipcRenderer.invoke('auth:mal-start'),

  completeMalLogin: (username) => ipcRenderer.invoke('auth:mal-complete', { username }),

  getAniListLinkStatus: () => ipcRenderer.invoke('auth:anilist-link-status'),

  linkAniListAccount: () => ipcRenderer.invoke('auth:anilist-link'),

  resolveAniListLinkConflict: (action) =>
    ipcRenderer.invoke('auth:anilist-resolve-link-conflict', { action }),

  unlinkAniListAccount: (password) =>
    ipcRenderer.invoke('auth:anilist-unlink', { password }),

  getMalLinkStatus: () => ipcRenderer.invoke('auth:mal-link-status'),

  linkMalAccount: () => ipcRenderer.invoke('auth:mal-link'),

  resolveMalLinkConflict: (action) =>
    ipcRenderer.invoke('auth:mal-resolve-link-conflict', { action }),

  unlinkMalAccount: (password) => ipcRenderer.invoke('auth:mal-unlink', { password }),

  setLocalPassword: (password) =>
    ipcRenderer.invoke('auth:set-local-password', { password }),

  logout: () => ipcRenderer.invoke('auth:logout'),
  exportAccountData: async () => ({ ok: true, export: await ipcRenderer.invoke('backup:export', {}) }),
  deleteAccount: (usernameConfirmation) =>
    ipcRenderer.invoke('auth:delete-account', usernameConfirmation),

  getSession: () => ipcRenderer.invoke('auth:get-session'),

  setTutorialDismissed: (dismissed) => ipcRenderer.invoke('auth:set-tutorial-dismissed', dismissed),

  getMyList: () => ipcRenderer.invoke('list:get'),

  getMyListEntry: (animeId) => ipcRenderer.invoke('list:get-entry', animeId),

  saveMyListEntry: (animeId, data) => ipcRenderer.invoke('list:save-entry', { animeId, data }),

  removeMyListEntry: (animeId) => ipcRenderer.invoke('list:remove-entry', animeId),
  getMyMangaList: () => ipcRenderer.invoke('manga-list:get'),
  getMyMangaListEntry: (mangaId) => ipcRenderer.invoke('manga-list:get-entry', mangaId),
  saveMyMangaListEntry: (mangaId, data) =>
    ipcRenderer.invoke('manga-list:save-entry', { mangaId, data }),
  removeMyMangaListEntry: (mangaId) => ipcRenderer.invoke('manga-list:remove-entry', mangaId),

  clearMyList: (options) => ipcRenderer.invoke('list:clear', options),
  clearMyMangaList: (options) => ipcRenderer.invoke('manga-list:clear', options),
  clearAllMediaLists: (options) => ipcRenderer.invoke('media-list:clear-all', options),
  exportLocalBackup: (preferenceBundle) => ipcRenderer.invoke('backup:export', preferenceBundle),
  importLocalBackup: (backup) => ipcRenderer.invoke('backup:import', backup),
});

contextBridge.exposeInMainWorld('desktopShortcuts', {
  getHideShowShortcut: () => ipcRenderer.invoke('shortcuts:get-hide-show'),
  setHideShowShortcut: (payload) => ipcRenderer.invoke('shortcuts:set-hide-show', payload),
  setShortcutRecordingActive: (active) =>
    ipcRenderer.invoke('shortcuts:set-recording-active', active),
});

contextBridge.exposeInMainWorld('desktopStartup', {
  getStartupSetting: () => ipcRenderer.invoke('startup:get'),
  setStartupSetting: (enabled) => ipcRenderer.invoke('startup:set', enabled),
});

contextBridge.exposeInMainWorld('desktopWindow', {
  closeApp: () => ipcRenderer.send('app:quit'),
  onFocusSearch: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('focus-search', handler);
    return () => ipcRenderer.removeListener('focus-search', handler);
  },
  getWindowState: () => ipcRenderer.invoke('window-state:get'),
  setWindowPreset: (preset) => ipcRenderer.invoke('window-state:set-preset', preset),
  setCustomBounds: (bounds) => ipcRenderer.invoke('window-state:set-custom-bounds', bounds),
  onWindowStateChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('window-state:changed', handler);
    return () => ipcRenderer.removeListener('window-state:changed', handler);
  },
});

contextBridge.exposeInMainWorld('desktopConfig', {
  getLayoutOrders: (userId) => ipcRenderer.invoke('layout-config:get', userId),
  setLayoutOrders: (userId, layouts) =>
    ipcRenderer.sendSync('layout-config:set', userId, layouts),
  deleteLayoutOrders: (userId) => ipcRenderer.invoke('layout-config:delete', userId),
});

contextBridge.exposeInMainWorld('systemLocale', getSystemLocaleInfo());
