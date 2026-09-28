require('./env');

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} = require('./secretCrypto');

const HOSTED_PRODUCTION_DB_PATH = '/home/u145628270/domains/api.seenary.app/data/media.db';

function getDefaultDbPath() {
  if (process.versions.electron) {
    try {
      const { app } = require('electron');
      return path.join(app.getPath('userData'), 'media.db');
    } catch {
      return path.join(__dirname, 'media.db');
    }
  }

  if (process.env.NODE_ENV === 'production') {
    return HOSTED_PRODUCTION_DB_PATH;
  }

  return path.join(__dirname, 'media.db');
}

const dbPath = process.env.DATABASE_PATH || getDefaultDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS anime_series_dates (
  anime_id INTEGER PRIMARY KEY, start_date_json TEXT NOT NULL
)`);
function getSavedAnimeSeriesDate(id) {
  const row = db.prepare('SELECT start_date_json FROM anime_series_dates WHERE anime_id = ?').get(id);
  if (row) return JSON.parse(row.start_date_json);
  const anime = getAnimeById(id);
  if (anime?.franchise_start_resolved && anime.franchise_start_date) {
    const [year, month, day] = anime.franchise_start_date.split('-').map(Number);
    return { year, month, day };
  }
  return null;
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('wal_autocheckpoint = 1000');

const integrityResult = db.pragma('quick_check(1)', { simple: true });
if (integrityResult !== 'ok') {
  db.close();
  throw new Error(`SQLite integrity check failed: ${integrityResult}`);
}

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS anime (
    id INTEGER PRIMARY KEY,

    title_romaji TEXT,
    title_english TEXT,
    title_native TEXT,
    title_preferred TEXT,

    cover_image_large TEXT,
    banner_image TEXT,
    is_adult INTEGER,

    episodes INTEGER,
    format TEXT,
    status TEXT,

    season TEXT,
    season_year INTEGER,

    average_score INTEGER,
    mean_score INTEGER,
    popularity INTEGER,
    favourites INTEGER,
    duration INTEGER,
    source TEXT,
    country_of_origin TEXT,
    start_date TEXT,
    franchise_start_date TEXT,
    end_date TEXT,
    trailer_id TEXT,
    trailer_site TEXT,
    trailer_thumbnail TEXT,
    site_url TEXT,

    description TEXT,
    genres TEXT,
    synonyms TEXT,

    next_airing_episode INTEGER,
    next_airing_at INTEGER,

    studios TEXT,
    relations TEXT,
    recommendations TEXT,
    external_links TEXT,
    streaming_episodes TEXT,

    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    cached_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

function addColumnIfMissing(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

const animeColumnMigrations = [
  ['is_adult', 'INTEGER'],
  ['mean_score', 'INTEGER'],
  ['popularity', 'INTEGER'],
  ['favourites', 'INTEGER'],
  ['duration', 'INTEGER'],
  ['source', 'TEXT'],
  ['country_of_origin', 'TEXT'],
  ['start_date', 'TEXT'],
  ['franchise_start_date', 'TEXT'],
  ['franchise_start_resolved', 'INTEGER NOT NULL DEFAULT 0'],
  ['end_date', 'TEXT'],
  ['trailer_id', 'TEXT'],
  ['trailer_site', 'TEXT'],
  ['trailer_thumbnail', 'TEXT'],
  ['site_url', 'TEXT'],
  ['relations', "TEXT NOT NULL DEFAULT '[]'"],
  ['recommendations', "TEXT NOT NULL DEFAULT '[]'"],
  ['external_links', "TEXT NOT NULL DEFAULT '[]'"],
  ['streaming_episodes', "TEXT NOT NULL DEFAULT '[]'"],
];

for (const [columnName, definition] of animeColumnMigrations) {
  addColumnIfMissing('anime', columnName, definition);
}

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    local_credentials_confirmed INTEGER,
    tutorial_dismissed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  )
`
).run();

const userColumns = db.prepare(`PRAGMA table_info(users)`).all();

const hasTutorialDismissedColumn = userColumns.some(
  (column) => column.name === 'tutorial_dismissed'
);

if (!hasTutorialDismissedColumn) {
  db.prepare(
    `
    ALTER TABLE users
    ADD COLUMN tutorial_dismissed INTEGER NOT NULL DEFAULT 0
  `
  ).run();
}

addColumnIfMissing('users', 'local_credentials_confirmed', 'INTEGER');

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS user_anime_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    anime_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    is_favorite INTEGER NOT NULL DEFAULT 0,
    progress INTEGER NOT NULL DEFAULT 0,
    score REAL,
    notes TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    local_updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE,
    UNIQUE(user_id, anime_id)
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS manga (
    id INTEGER PRIMARY KEY,
    title_romaji TEXT,
    title_english TEXT,
    title_native TEXT,
    title_preferred TEXT,
    cover_image_large TEXT,
    banner_image TEXT,
    is_adult INTEGER,
    chapters INTEGER,
    volumes INTEGER,
    format TEXT,
    status TEXT,
    average_score INTEGER,
    mean_score INTEGER,
    popularity INTEGER,
    favourites INTEGER,
    source TEXT,
    country_of_origin TEXT,
    start_date TEXT,
    end_date TEXT,
    site_url TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    recommendations TEXT NOT NULL DEFAULT '[]',
    details_json TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS user_manga_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    manga_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    is_favorite INTEGER NOT NULL DEFAULT 0,
    repeat_count INTEGER NOT NULL DEFAULT 0,
    is_rereading INTEGER NOT NULL DEFAULT 0,
    progress INTEGER NOT NULL DEFAULT 0,
    volume_progress INTEGER NOT NULL DEFAULT 0,
    score REAL,
    notes TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    local_updated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE,
    UNIQUE(user_id, manga_id)
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS anime_external_ids (
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    anime_id INTEGER NOT NULL,
    first_submitted_by_user_id INTEGER,
    first_submitted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (provider, external_id),
    UNIQUE(provider, anime_id),
    FOREIGN KEY (first_submitted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS manga_external_ids (
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    manga_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (provider, external_id),
    UNIQUE(provider, manga_id),
    FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS provider_mapping_misses (
    provider TEXT NOT NULL,
    media_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title_signature TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (provider, media_type, external_id)
  )
`
).run();

db.prepare(`DELETE FROM provider_mapping_misses WHERE expires_at <= ?`).run(Date.now());

addColumnIfMissing('user_anime_lists', 'is_favorite', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('user_anime_lists', 'repeat_count', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('user_anime_lists', 'is_rewatching', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('user_anime_lists', 'local_updated_at', 'TEXT');
addColumnIfMissing('user_manga_lists', 'local_updated_at', 'TEXT');
addColumnIfMissing('anime_external_ids', 'first_submitted_by_user_id', 'INTEGER');
addColumnIfMissing('anime_external_ids', 'first_submitted_at', 'TEXT');

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS web_sessions (
    session_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS anilist_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    anilist_user_id INTEGER NOT NULL UNIQUE,
    anilist_username TEXT NOT NULL,
    original_anilist_username TEXT NOT NULL,
    access_token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_import_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS mal_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    mal_user_id INTEGER NOT NULL UNIQUE,
    mal_username TEXT NOT NULL,
    original_mal_username TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_import_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'ANIME',
    media_id INTEGER NOT NULL,
    operation TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    changed_fields_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, media_type, media_id, operation)
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'ANIME',
    media_id INTEGER,
    media_title TEXT,
    operation TEXT NOT NULL,
    changed_fields_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`
).run();

function migrateSyncTablesToMediaAwareSchema() {
  const queueColumns = db.prepare('PRAGMA table_info(sync_queue)').all();
  if (!queueColumns.some((column) => column.name === 'media_type')) {
    db.transaction(() => {
      db.prepare('ALTER TABLE sync_queue RENAME TO sync_queue_anime_legacy').run();
      db.prepare(`
        CREATE TABLE sync_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          media_type TEXT NOT NULL DEFAULT 'ANIME',
          media_id INTEGER NOT NULL,
          operation TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          changed_fields_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          next_attempt_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(user_id, media_type, media_id, operation)
        )
      `).run();
      db.prepare(`
        INSERT INTO sync_queue (
          id, user_id, media_type, media_id, operation, payload_json,
          changed_fields_json, status, attempts, last_error, next_attempt_at,
          created_at, updated_at
        )
        SELECT id, user_id, 'ANIME', anime_id, operation, payload_json,
          changed_fields_json, status, attempts, last_error, next_attempt_at,
          created_at, updated_at
        FROM sync_queue_anime_legacy
      `).run();
      db.prepare('DROP TABLE sync_queue_anime_legacy').run();
    })();
  }

  const historyColumns = db.prepare('PRAGMA table_info(sync_history)').all();
  if (!historyColumns.some((column) => column.name === 'media_type')) {
    db.transaction(() => {
      db.prepare('ALTER TABLE sync_history RENAME TO sync_history_anime_legacy').run();
      db.prepare(`
        CREATE TABLE sync_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          media_type TEXT NOT NULL DEFAULT 'ANIME',
          media_id INTEGER,
          media_title TEXT,
          operation TEXT NOT NULL,
          changed_fields_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL,
          message TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `).run();
      db.prepare(`
        INSERT INTO sync_history (
          id, user_id, media_type, media_id, media_title, operation,
          changed_fields_json, status, message, created_at
        )
        SELECT id, user_id, 'ANIME', anime_id, anime_title, operation,
          changed_fields_json, status, message, created_at
        FROM sync_history_anime_legacy
      `).run();
      db.prepare('DROP TABLE sync_history_anime_legacy').run();
    })();
  }
}

migrateSyncTablesToMediaAwareSchema();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS anime_tags (
    anime_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    name TEXT,
    description TEXT,
    rank INTEGER,
    is_media_spoiler INTEGER NOT NULL DEFAULT 0,
    is_general_spoiler INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (anime_id, tag_id),
    FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS anime_staff (
    anime_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    name_full TEXT,
    name_native TEXT,
    image_large TEXT,
    role TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (anime_id, staff_id, role),
    FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS anime_characters (
    anime_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    name_full TEXT,
    name_native TEXT,
    image_large TEXT,
    role TEXT,
    voice_actors TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (anime_id, character_id, role),
    FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS person_details (
    kind TEXT NOT NULL,
    anilist_id INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (kind, anilist_id)
  )
`
).run();

const upsertAnimeStmt = db.prepare(`
  INSERT INTO anime (
    id,
    title_romaji,
    title_english,
    title_native,
    title_preferred,
    cover_image_large,
    banner_image,
    is_adult,
    episodes,
    format,
    status,
    season,
    season_year,
    average_score,
    mean_score,
    popularity,
    favourites,
    duration,
    source,
    country_of_origin,
    start_date,
    franchise_start_date,
    end_date,
    trailer_id,
    trailer_site,
    trailer_thumbnail,
    site_url,
    description,
    genres,
    synonyms,
    next_airing_episode,
    next_airing_at,
    studios,
    relations,
    recommendations,
    external_links,
    streaming_episodes,
    updated_at,
    cached_at
  ) VALUES (
    @id,
    @title_romaji,
    @title_english,
    @title_native,
    @title_preferred,
    @cover_image_large,
    @banner_image,
    @is_adult,
    @episodes,
    @format,
    @status,
    @season,
    @season_year,
    @average_score,
    @mean_score,
    @popularity,
    @favourites,
    @duration,
    @source,
    @country_of_origin,
    @start_date,
    @franchise_start_date,
    @end_date,
    @trailer_id,
    @trailer_site,
    @trailer_thumbnail,
    @site_url,
    @description,
    @genres,
    @synonyms,
    @next_airing_episode,
    @next_airing_at,
    @studios,
    @relations,
    @recommendations,
    @external_links,
    @streaming_episodes,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(id) DO UPDATE SET
    title_romaji = excluded.title_romaji,
    title_english = excluded.title_english,
    title_native = excluded.title_native,
    title_preferred = excluded.title_preferred,
    cover_image_large = excluded.cover_image_large,
    banner_image = excluded.banner_image,
    is_adult = excluded.is_adult,
    episodes = excluded.episodes,
    format = excluded.format,
    status = excluded.status,
    season = excluded.season,
    season_year = excluded.season_year,
    average_score = excluded.average_score,
    mean_score = excluded.mean_score,
    popularity = excluded.popularity,
    favourites = excluded.favourites,
    duration = excluded.duration,
    source = excluded.source,
    country_of_origin = excluded.country_of_origin,
    start_date = excluded.start_date,
    franchise_start_date = COALESCE(excluded.franchise_start_date, anime.franchise_start_date),
    end_date = excluded.end_date,
    trailer_id = excluded.trailer_id,
    trailer_site = excluded.trailer_site,
    trailer_thumbnail = excluded.trailer_thumbnail,
    site_url = excluded.site_url,
    description = excluded.description,
    genres = excluded.genres,
    synonyms = excluded.synonyms,
    next_airing_episode = excluded.next_airing_episode,
    next_airing_at = excluded.next_airing_at,
    studios = excluded.studios,
    relations = excluded.relations,
    recommendations = excluded.recommendations,
    external_links = excluded.external_links,
    streaming_episodes = excluded.streaming_episodes,
    updated_at = CURRENT_TIMESTAMP,
    cached_at = CURRENT_TIMESTAMP
`);

const upsertAnimeSummaryStmt = db.prepare(`
  INSERT INTO anime (
    id,
    title_romaji,
    title_english,
    title_native,
    title_preferred,
    cover_image_large,
    banner_image,
    is_adult,
    episodes,
    format,
    status,
    season,
    season_year,
    average_score,
    mean_score,
    popularity,
    favourites,
    duration,
    source,
    country_of_origin,
    start_date,
    end_date,
    trailer_id,
    trailer_site,
    trailer_thumbnail,
    site_url,
    description,
    genres,
    synonyms,
    next_airing_episode,
    next_airing_at,
    studios,
    relations,
    recommendations,
    external_links,
    streaming_episodes,
    updated_at,
    cached_at
  ) VALUES (
    @id,
    @title_romaji,
    @title_english,
    @title_native,
    @title_preferred,
    @cover_image_large,
    @banner_image,
    @is_adult,
    @episodes,
    @format,
    @status,
    @season,
    @season_year,
    @average_score,
    @mean_score,
    @popularity,
    @favourites,
    @duration,
    @source,
    @country_of_origin,
    @start_date,
    @end_date,
    @trailer_id,
    @trailer_site,
    @trailer_thumbnail,
    @site_url,
    @description,
    @genres,
    @synonyms,
    @next_airing_episode,
    @next_airing_at,
    @studios,
    @relations,
    @recommendations,
    @external_links,
    @streaming_episodes,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(id) DO UPDATE SET
    title_romaji = COALESCE(excluded.title_romaji, anime.title_romaji),
    title_english = COALESCE(excluded.title_english, anime.title_english),
    title_native = COALESCE(excluded.title_native, anime.title_native),
    title_preferred = COALESCE(excluded.title_preferred, anime.title_preferred),
    cover_image_large = COALESCE(excluded.cover_image_large, anime.cover_image_large),
    banner_image = COALESCE(excluded.banner_image, anime.banner_image),
    is_adult = COALESCE(excluded.is_adult, anime.is_adult),
    episodes = COALESCE(excluded.episodes, anime.episodes),
    format = COALESCE(excluded.format, anime.format),
    status = COALESCE(excluded.status, anime.status),
    season = COALESCE(excluded.season, anime.season),
    season_year = COALESCE(excluded.season_year, anime.season_year),
    average_score = COALESCE(excluded.average_score, anime.average_score),
    mean_score = COALESCE(excluded.mean_score, anime.mean_score),
    popularity = COALESCE(excluded.popularity, anime.popularity),
    favourites = COALESCE(excluded.favourites, anime.favourites),
    duration = COALESCE(excluded.duration, anime.duration),
    source = COALESCE(excluded.source, anime.source),
    country_of_origin = COALESCE(excluded.country_of_origin, anime.country_of_origin),
    start_date = COALESCE(excluded.start_date, anime.start_date),
    end_date = COALESCE(excluded.end_date, anime.end_date),
    trailer_id = COALESCE(excluded.trailer_id, anime.trailer_id),
    trailer_site = COALESCE(excluded.trailer_site, anime.trailer_site),
    trailer_thumbnail = COALESCE(excluded.trailer_thumbnail, anime.trailer_thumbnail),
    site_url = COALESCE(excluded.site_url, anime.site_url),
    description = COALESCE(excluded.description, anime.description),
    genres = COALESCE(excluded.genres, anime.genres),
    synonyms = COALESCE(excluded.synonyms, anime.synonyms),
    next_airing_episode = COALESCE(excluded.next_airing_episode, anime.next_airing_episode),
    next_airing_at = COALESCE(excluded.next_airing_at, anime.next_airing_at),
    studios = COALESCE(excluded.studios, anime.studios),
    relations = COALESCE(excluded.relations, anime.relations),
    recommendations = COALESCE(excluded.recommendations, anime.recommendations),
    external_links = COALESCE(excluded.external_links, anime.external_links),
    streaming_episodes = COALESCE(excluded.streaming_episodes, anime.streaming_episodes),
    updated_at = CURRENT_TIMESTAMP,
    cached_at = CURRENT_TIMESTAMP
`);

const getAnimeByIdStmt = db.prepare(`
  SELECT * FROM anime
  WHERE id = ?
`);

const updateAnimeAdultFlagStmt = db.prepare(`
  UPDATE anime
  SET is_adult = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateAnimeListMetadataStmt = db.prepare(`
  UPDATE anime
  SET
    is_adult = COALESCE(?, is_adult),
    episodes = COALESCE(?, episodes),
    duration = COALESCE(?, duration),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateAnimeFranchiseStartDateStmt = db.prepare(`
  UPDATE anime
  SET
    franchise_start_date = ?,
    franchise_start_resolved = 1,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const createUserStmt = db.prepare(`
  INSERT INTO users (
    username,
    username_normalized,
    password_hash,
    local_credentials_confirmed
  ) VALUES (?, ?, ?, ?)
`);

const updateUserPasswordStmt = db.prepare(`
  UPDATE users
  SET
    password_hash = ?,
    local_credentials_confirmed = 1,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const confirmLocalCredentialsStmt = db.prepare(`
  UPDATE users
  SET
    local_credentials_confirmed = 1,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const getUserByNormalizedUsernameStmt = db.prepare(`
  SELECT * FROM users
  WHERE username_normalized = ?
`);

const getUserByIdStmt = db.prepare(`
  SELECT
    id,
    username,
    username_normalized,
    local_credentials_confirmed,
    tutorial_dismissed,
    created_at,
    updated_at,
    last_login_at
  FROM users
  WHERE id = ?
`);

const updateLastLoginStmt = db.prepare(`
  UPDATE users
  SET
    last_login_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const updateTutorialDismissedStmt = db.prepare(`
  UPDATE users
  SET
    tutorial_dismissed = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const getAppSettingStmt = db.prepare(`
  SELECT value
  FROM app_settings
  WHERE key = ?
`);

const setAppSettingStmt = db.prepare(`
  INSERT INTO app_settings (
    key,
    value,
    updated_at
  ) VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = CURRENT_TIMESTAMP
`);

const deleteAppSettingStmt = db.prepare(`
  DELETE FROM app_settings
  WHERE key = ?
`);

const insertWebSessionStmt = db.prepare(`
  INSERT INTO web_sessions (
    session_hash,
    user_id,
    expires_at,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?)
`);

const getWebSessionStmt = db.prepare(`
  SELECT *
  FROM web_sessions
  WHERE session_hash = ?
`);

const updateWebSessionExpiryStmt = db.prepare(`
  UPDATE web_sessions
  SET
    expires_at = ?,
    updated_at = ?
  WHERE session_hash = ?
`);

const deleteWebSessionStmt = db.prepare(`
  DELETE FROM web_sessions
  WHERE session_hash = ?
`);

const deleteExpiredWebSessionsStmt = db.prepare(`
  DELETE FROM web_sessions
  WHERE expires_at <= ?
`);

const getAniListAccountByAniListUserIdStmt = db.prepare(`
  SELECT *
  FROM anilist_accounts
  WHERE anilist_user_id = ?
`);

const getAniListAccountByUserIdStmt = db.prepare(`
  SELECT *
  FROM anilist_accounts
  WHERE user_id = ?
`);

const deleteAniListAccountByUserIdStmt = db.prepare(`
  DELETE FROM anilist_accounts
  WHERE user_id = ?
`);

const getMalAccountByMalUserIdStmt = db.prepare(`
  SELECT *
  FROM mal_accounts
  WHERE mal_user_id = ?
`);

const getMalAccountByUserIdStmt = db.prepare(`
  SELECT *
  FROM mal_accounts
  WHERE user_id = ?
`);

const deleteMalAccountByUserIdStmt = db.prepare(`
  DELETE FROM mal_accounts
  WHERE user_id = ?
`);

const deleteUserAnimeListByUserIdStmt = db.prepare(`
  DELETE FROM user_anime_lists
  WHERE user_id = ?
`);

const deleteUserMangaListByUserIdStmt = db.prepare(`
  DELETE FROM user_manga_lists
  WHERE user_id = ?
`);

const deleteUserSyncQueueByUserIdStmt = db.prepare(`
  DELETE FROM sync_queue
  WHERE user_id = ?
`);

const deleteProviderSyncQueueByUserIdStmt = db.prepare(`
  DELETE FROM sync_queue
  WHERE user_id = ?
    AND operation IN (?, ?, ?, ?)
`);

const deleteUserSyncHistoryByUserIdStmt = db.prepare(`
  DELETE FROM sync_history
  WHERE user_id = ?
`);

const deleteUserWebSessionsByUserIdStmt = db.prepare(`
  DELETE FROM web_sessions
  WHERE user_id = ?
`);

const clearExternalIdSubmitterByUserIdStmt = db.prepare(`
  UPDATE anime_external_ids
  SET first_submitted_by_user_id = NULL
  WHERE first_submitted_by_user_id = ?
`);

const deleteUserStmt = db.prepare(`
  DELETE FROM users
  WHERE id = ?
`);

const mergeMissingUserAnimeEntriesStmt = db.prepare(`
  INSERT INTO user_anime_lists (
    user_id,
    anime_id,
    status,
    is_favorite,
    repeat_count,
    is_rewatching,
    progress,
    score,
    notes,
    started_at,
    completed_at,
    created_at,
    updated_at,
    local_updated_at
  )
  SELECT
    ?,
    source.anime_id,
    source.status,
    source.is_favorite,
    source.repeat_count,
    source.is_rewatching,
    source.progress,
    source.score,
    source.notes,
    source.started_at,
    source.completed_at,
    source.created_at,
    CURRENT_TIMESTAMP,
    source.local_updated_at
  FROM user_anime_lists source
  WHERE source.user_id = ?
    AND NOT EXISTS (
      SELECT 1
      FROM user_anime_lists target
      WHERE target.user_id = ?
        AND target.anime_id = source.anime_id
    )
`);

const mergeMissingUserMangaEntriesStmt = db.prepare(`
  INSERT INTO user_manga_lists (
    user_id, manga_id, status, is_favorite, repeat_count, is_rereading,
    progress, volume_progress, score, notes, started_at, completed_at,
    created_at, updated_at, local_updated_at
  )
  SELECT
    ?, source.manga_id, source.status, source.is_favorite, source.repeat_count,
    source.is_rereading, source.progress, source.volume_progress, source.score,
    source.notes, source.started_at, source.completed_at, source.created_at,
    CURRENT_TIMESTAMP, source.local_updated_at
  FROM user_manga_lists source
  WHERE source.user_id = ?
    AND NOT EXISTS (
      SELECT 1
      FROM user_manga_lists target
      WHERE target.user_id = ?
        AND target.manga_id = source.manga_id
    )
`);

const upsertAniListAccountStmt = db.prepare(`
  INSERT INTO anilist_accounts (
    user_id,
    anilist_user_id,
    anilist_username,
    original_anilist_username,
    access_token,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(anilist_user_id) DO UPDATE SET
    user_id = excluded.user_id,
    anilist_username = excluded.anilist_username,
    access_token = excluded.access_token,
    updated_at = CURRENT_TIMESTAMP
`);

const upsertMalAccountStmt = db.prepare(`
  INSERT INTO mal_accounts (
    user_id,
    mal_user_id,
    mal_username,
    original_mal_username,
    access_token,
    refresh_token,
    token_expires_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(mal_user_id) DO UPDATE SET
    user_id = excluded.user_id,
    mal_username = excluded.mal_username,
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    token_expires_at = excluded.token_expires_at,
    updated_at = CURRENT_TIMESTAMP
`);

const getAniListTokensForEncryptionStmt = db.prepare(`
  SELECT user_id, access_token
  FROM anilist_accounts
`);

const updateAniListEncryptedTokenStmt = db.prepare(`
  UPDATE anilist_accounts
  SET access_token = ?
  WHERE user_id = ?
`);

const getMalTokensForEncryptionStmt = db.prepare(`
  SELECT user_id, access_token, refresh_token
  FROM mal_accounts
`);

const updateMalEncryptedTokensStmt = db.prepare(`
  UPDATE mal_accounts
  SET access_token = ?, refresh_token = ?
  WHERE user_id = ?
`);

const encryptStoredOAuthTokens = db.transaction(() => {
  for (const account of getAniListTokensForEncryptionStmt.all()) {
    if (isEncryptedSecret(account.access_token)) continue;
    const encryptedAccessToken = encryptSecret(account.access_token);
    if (encryptedAccessToken !== account.access_token) {
      updateAniListEncryptedTokenStmt.run(encryptedAccessToken, account.user_id);
    }
  }

  for (const account of getMalTokensForEncryptionStmt.all()) {
    const accessToken = encryptSecret(account.access_token);
    const refreshToken = encryptSecret(account.refresh_token);
    if (
      accessToken !== account.access_token ||
      refreshToken !== account.refresh_token
    ) {
      updateMalEncryptedTokensStmt.run(accessToken, refreshToken, account.user_id);
    }
  }
});

encryptStoredOAuthTokens();

const updateAniListAccountImportTimeStmt = db.prepare(`
  UPDATE anilist_accounts
  SET
    last_import_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
  WHERE anilist_user_id = ?
`);

const updateMalAccountImportTimeStmt = db.prepare(`
  UPDATE mal_accounts
  SET
    last_import_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
  WHERE mal_user_id = ?
`);

const getSyncQueueJobStmt = db.prepare(`
  SELECT *
  FROM sync_queue
  WHERE user_id = ? AND media_type = ? AND media_id = ? AND operation = ?
`);

const upsertSyncQueueJobStmt = db.prepare(`
  INSERT INTO sync_queue (
    user_id,
    media_type,
    media_id,
    operation,
    payload_json,
    changed_fields_json,
    status,
    attempts,
    last_error,
    next_attempt_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, CURRENT_TIMESTAMP)
  ON CONFLICT(user_id, media_type, media_id, operation) DO UPDATE SET
    payload_json = excluded.payload_json,
    changed_fields_json = excluded.changed_fields_json,
    status = CASE WHEN sync_queue.status = 'blocked' THEN 'blocked' ELSE 'pending' END,
    last_error = CASE WHEN sync_queue.status = 'blocked' THEN sync_queue.last_error ELSE NULL END,
    next_attempt_at = NULL,
    updated_at = CURRENT_TIMESTAMP
`);

const getDueSyncQueueJobsStmt = db.prepare(`
  SELECT
    q.*,
    COALESCE(a.title_preferred, m.title_preferred) AS title_preferred,
    COALESCE(a.title_english, m.title_english) AS title_english,
    COALESCE(a.title_romaji, m.title_romaji) AS title_romaji
  FROM sync_queue q
  LEFT JOIN anime a ON q.media_type = 'ANIME' AND a.id = q.media_id
  LEFT JOIN manga m ON q.media_type = 'MANGA' AND m.id = q.media_id
  WHERE q.user_id = ?
    AND (q.status = 'pending' OR q.status = 'failed')
    AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= CURRENT_TIMESTAMP)
  ORDER BY q.updated_at ASC
  LIMIT ?
`);

const getRunnableSyncQueueJobsStmt = db.prepare(`
  SELECT
    q.*,
    COALESCE(a.title_preferred, m.title_preferred) AS title_preferred,
    COALESCE(a.title_english, m.title_english) AS title_english,
    COALESCE(a.title_romaji, m.title_romaji) AS title_romaji
  FROM sync_queue q
  LEFT JOIN anime a ON q.media_type = 'ANIME' AND a.id = q.media_id
  LEFT JOIN manga m ON q.media_type = 'MANGA' AND m.id = q.media_id
  WHERE q.user_id = ?
    AND (q.status = 'pending' OR q.status = 'failed')
  ORDER BY q.updated_at ASC
  LIMIT ?
`);

const getSyncQueueItemsStmt = db.prepare(`
  SELECT
    q.*,
    COALESCE(a.title_preferred, m.title_preferred) AS title_preferred,
    COALESCE(a.title_english, m.title_english) AS title_english,
    COALESCE(a.title_romaji, m.title_romaji) AS title_romaji
  FROM sync_queue q
  LEFT JOIN anime a ON q.media_type = 'ANIME' AND a.id = q.media_id
  LEFT JOIN manga m ON q.media_type = 'MANGA' AND m.id = q.media_id
  WHERE q.user_id = ?
  ORDER BY q.updated_at DESC
  LIMIT ?
`);

const countSyncQueueItemsStmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM sync_queue
  WHERE user_id = ? AND (status = 'pending' OR status = 'failed')
`);

const markSyncQueueJobFailedStmt = db.prepare(`
  UPDATE sync_queue
  SET
    status = ?,
    attempts = attempts + 1,
    last_error = ?,
    next_attempt_at = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const restoreSyncQueueJobStmt = db.prepare(`
  UPDATE sync_queue
  SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND user_id = ? AND status = 'blocked'
`);

const excludeSyncQueueJobStmt = db.prepare(`
  UPDATE sync_queue
  SET status = 'blocked', next_attempt_at = NULL,
      last_error = COALESCE(last_error, 'Manually excluded by user.'),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ? AND user_id = ? AND attempts > 0
    AND (status = 'pending' OR status = 'failed')
`);

const applySyncQueueFailureStateStmt = db.prepare(`
  UPDATE sync_queue
  SET status = ?, attempts = ?, last_error = ?, next_attempt_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  WHERE user_id = ? AND media_type = ? AND media_id = ? AND operation = ?
`);

const deleteSyncQueueJobStmt = db.prepare(`
  DELETE FROM sync_queue
  WHERE id = ?
`);

const deleteSyncQueueJobByEntryStmt = db.prepare(`
  DELETE FROM sync_queue
  WHERE user_id = ? AND media_type = ? AND media_id = ? AND operation = ?
`);

const insertSyncHistoryStmt = db.prepare(`
  INSERT INTO sync_history (
    user_id,
    media_type,
    media_id,
    media_title,
    operation,
    changed_fields_json,
    status,
    message
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const getSyncHistoryItemsStmt = db.prepare(`
  SELECT
    h.*,
    COALESCE(a.title_preferred, m.title_preferred) AS title_preferred,
    COALESCE(a.title_english, m.title_english) AS title_english,
    COALESCE(a.title_romaji, m.title_romaji) AS title_romaji,
    COALESCE(a.title_native, m.title_native) AS title_native
  FROM sync_history h
  LEFT JOIN anime a
    ON h.media_type = 'ANIME'
    AND h.media_id = a.id
    AND h.operation NOT LIKE '%_unmapped'
  LEFT JOIN manga m
    ON h.media_type = 'MANGA'
    AND h.media_id = m.id
    AND h.operation NOT LIKE '%_unmapped'
  WHERE h.user_id = ? AND h.status = ?
  ORDER BY h.created_at DESC, h.id DESC
  LIMIT ?
`);

const hasCompletedSyncHistoryStmt = db.prepare(`
  SELECT 1
  FROM sync_history
  WHERE user_id = ? AND media_type = ? AND media_id = ? AND operation = ? AND status = 'completed'
  LIMIT 1
`);

const getUserAnimeEntryStmt = db.prepare(`
  SELECT *
  FROM user_anime_lists
  WHERE user_id = ? AND anime_id = ?
`);

const getUserAnimeListStmt = db.prepare(`
  SELECT
    l.*,
    a.title_romaji,
    a.title_english,
    a.title_native,
    a.title_preferred,
    a.cover_image_large,
    a.banner_image,
    a.is_adult,
    a.episodes,
    a.format,
    a.status AS anime_status,
    a.season,
    a.season_year,
    a.average_score,
    a.mean_score,
    a.popularity,
    a.favourites,
    a.duration,
    a.source,
    a.country_of_origin,
    a.start_date,
    a.end_date,
    a.next_airing_episode,
    a.next_airing_at,
    a.genres,
    a.recommendations
  FROM user_anime_lists l
  JOIN anime a ON a.id = l.anime_id
  WHERE l.user_id = ?
  ORDER BY l.updated_at DESC
`);

const upsertAnimeExternalIdStmt = db.prepare(`
  INSERT INTO anime_external_ids (
    provider,
    external_id,
    anime_id,
    first_submitted_by_user_id,
    first_submitted_at,
    updated_at
  ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT(provider, external_id) DO UPDATE SET
    anime_id = excluded.anime_id,
    first_submitted_by_user_id = COALESCE(
      anime_external_ids.first_submitted_by_user_id,
      excluded.first_submitted_by_user_id
    ),
    first_submitted_at = COALESCE(
      anime_external_ids.first_submitted_at,
      excluded.first_submitted_at
    ),
    updated_at = CURRENT_TIMESTAMP
`);

const getAnimeExternalIdStmt = db.prepare(`
  SELECT *
  FROM anime_external_ids
  WHERE provider = ? AND external_id = ?
`);

const getAnimeExternalIdByAnimeIdStmt = db.prepare(`
  SELECT *
  FROM anime_external_ids
  WHERE provider = ? AND anime_id = ?
`);

const upsertMangaExternalIdStmt = db.prepare(`
  INSERT INTO manga_external_ids (provider, external_id, manga_id, updated_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(provider, external_id) DO UPDATE SET
    manga_id = excluded.manga_id,
    updated_at = CURRENT_TIMESTAMP
`);

const getMangaExternalIdStmt = db.prepare(`
  SELECT * FROM manga_external_ids WHERE provider = ? AND external_id = ?
`);

const getMangaExternalIdByMangaIdStmt = db.prepare(`
  SELECT * FROM manga_external_ids WHERE provider = ? AND manga_id = ?
`);

const getProviderMappingMissStmt = db.prepare(`
  SELECT * FROM provider_mapping_misses
  WHERE provider = ? AND media_type = ? AND external_id = ?
`);

const upsertProviderMappingMissStmt = db.prepare(`
  INSERT INTO provider_mapping_misses (
    provider, media_type, external_id, title_signature, expires_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(provider, media_type, external_id) DO UPDATE SET
    title_signature = excluded.title_signature,
    expires_at = excluded.expires_at,
    updated_at = CURRENT_TIMESTAMP
`);

const deleteProviderMappingMissStmt = db.prepare(`
  DELETE FROM provider_mapping_misses
  WHERE provider = ? AND media_type = ? AND external_id = ?
`);

const addUserAnimeEntryStmt = db.prepare(`
  INSERT INTO user_anime_lists (
    user_id,
    anime_id,
    status,
    is_favorite,
    repeat_count,
    is_rewatching,
    progress,
    score,
    notes,
    started_at,
    completed_at,
    local_updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateUserAnimeEntryStmt = db.prepare(`
  UPDATE user_anime_lists
  SET
    status = ?,
    is_favorite = ?,
    repeat_count = ?,
    is_rewatching = ?,
    progress = ?,
    score = ?,
    notes = ?,
    started_at = ?,
    completed_at = ?,
    updated_at = CURRENT_TIMESTAMP,
    local_updated_at = COALESCE(?, local_updated_at)
  WHERE user_id = ? AND anime_id = ?
`);

const removeUserAnimeEntryStmt = db.prepare(`
  DELETE FROM user_anime_lists
  WHERE user_id = ? AND anime_id = ?
`);

const clearUserAnimeListStmt = db.prepare(`
  DELETE FROM user_anime_lists
  WHERE user_id = ?
`);

const upsertMangaStmt = db.prepare(`
  INSERT INTO manga (
    id, title_romaji, title_english, title_native, title_preferred,
    cover_image_large, banner_image, is_adult, chapters, volumes,
    format, status, average_score, mean_score, popularity, favourites,
    source, country_of_origin, start_date, end_date, site_url, genres,
    recommendations, details_json, updated_at, cached_at
  ) VALUES (
    @id, @title_romaji, @title_english, @title_native, @title_preferred,
    @cover_image_large, @banner_image, @is_adult, @chapters, @volumes,
    @format, @status, @average_score, @mean_score, @popularity, @favourites,
    @source, @country_of_origin, @start_date, @end_date, @site_url, @genres,
    @recommendations, @details_json, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT(id) DO UPDATE SET
    title_romaji = excluded.title_romaji,
    title_english = excluded.title_english,
    title_native = excluded.title_native,
    title_preferred = excluded.title_preferred,
    cover_image_large = excluded.cover_image_large,
    banner_image = excluded.banner_image,
    is_adult = excluded.is_adult,
    chapters = excluded.chapters,
    volumes = excluded.volumes,
    format = excluded.format,
    status = excluded.status,
    average_score = excluded.average_score,
    mean_score = excluded.mean_score,
    popularity = excluded.popularity,
    favourites = excluded.favourites,
    source = excluded.source,
    country_of_origin = excluded.country_of_origin,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    site_url = excluded.site_url,
    genres = excluded.genres,
    recommendations = excluded.recommendations,
    details_json = excluded.details_json,
    updated_at = CURRENT_TIMESTAMP,
    cached_at = CURRENT_TIMESTAMP
`);

const getMangaByIdStmt = db.prepare(`SELECT * FROM manga WHERE id = ?`);
const getUserMangaEntryStmt = db.prepare(`
  SELECT l.*, l.manga_id AS anime_id, l.is_rereading AS is_rewatching,
    'MANGA' AS media_type,
    m.title_romaji, m.title_english, m.title_native, m.title_preferred,
    m.cover_image_large, m.banner_image, m.is_adult, m.chapters,
    m.chapters AS episodes, m.volumes, m.format, m.status AS anime_status,
    m.average_score, m.mean_score, m.popularity, m.favourites,
    m.source, m.country_of_origin, m.start_date, m.end_date, m.genres,
    m.recommendations, m.details_json
  FROM user_manga_lists l
  JOIN manga m ON m.id = l.manga_id
  WHERE l.user_id = ? AND l.manga_id = ?
`);
const getUserMangaListStmt = db.prepare(`
  SELECT l.*, l.manga_id AS anime_id, l.is_rereading AS is_rewatching,
    'MANGA' AS media_type,
    m.title_romaji, m.title_english, m.title_native, m.title_preferred,
    m.cover_image_large, m.banner_image, m.is_adult, m.chapters,
    m.chapters AS episodes, m.volumes, m.format, m.status AS anime_status,
    m.average_score, m.mean_score, m.popularity, m.favourites,
    m.source, m.country_of_origin, m.start_date, m.end_date, m.genres,
    m.recommendations, m.details_json
  FROM user_manga_lists l
  JOIN manga m ON m.id = l.manga_id
  WHERE l.user_id = ?
  ORDER BY l.updated_at DESC
`);
const addUserMangaEntryStmt = db.prepare(`
  INSERT INTO user_manga_lists (
    user_id, manga_id, status, is_favorite, repeat_count, is_rereading,
    progress, volume_progress, score, notes, started_at, completed_at,
    local_updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateUserMangaEntryStmt = db.prepare(`
  UPDATE user_manga_lists SET
    status = ?, is_favorite = ?, repeat_count = ?, is_rereading = ?,
    progress = ?, volume_progress = ?, score = ?, notes = ?,
    started_at = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP,
    local_updated_at = COALESCE(?, local_updated_at)
  WHERE user_id = ? AND manga_id = ?
`);
const removeUserMangaEntryStmt = db.prepare(`
  DELETE FROM user_manga_lists WHERE user_id = ? AND manga_id = ?
`);
const clearUserMangaListStmt = db.prepare(`
  DELETE FROM user_manga_lists WHERE user_id = ?
`);

const deleteAnimeTagsStmt = db.prepare(`
  DELETE FROM anime_tags
  WHERE anime_id = ?
`);

const insertAnimeTagStmt = db.prepare(`
  INSERT INTO anime_tags (
    anime_id,
    tag_id,
    name,
    description,
    rank,
    is_media_spoiler,
    is_general_spoiler
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getAnimeTagsStmt = db.prepare(`
  SELECT
    tag_id AS id,
    name,
    description,
    rank,
    is_media_spoiler AS isMediaSpoiler,
    is_general_spoiler AS isGeneralSpoiler
  FROM anime_tags
  WHERE anime_id = ?
  ORDER BY rank DESC, name ASC
`);

const deleteAnimeStaffStmt = db.prepare(`
  DELETE FROM anime_staff
  WHERE anime_id = ?
`);

const insertAnimeStaffStmt = db.prepare(`
  INSERT OR IGNORE INTO anime_staff (
    anime_id,
    staff_id,
    name_full,
    name_native,
    image_large,
    role,
    sort_order
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getAnimeStaffStmt = db.prepare(`
  SELECT
    staff_id,
    name_full,
    name_native,
    image_large,
    role,
    sort_order
  FROM anime_staff
  WHERE anime_id = ?
  ORDER BY sort_order ASC
`);

const deleteAnimeCharactersStmt = db.prepare(`
  DELETE FROM anime_characters
  WHERE anime_id = ?
`);

const insertAnimeCharacterStmt = db.prepare(`
  INSERT INTO anime_characters (
    anime_id,
    character_id,
    name_full,
    name_native,
    image_large,
    role,
    voice_actors,
    sort_order
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const getAnimeCharactersStmt = db.prepare(`
  SELECT
    character_id,
    name_full,
    name_native,
    image_large,
    role,
    voice_actors,
    sort_order
  FROM anime_characters
  WHERE anime_id = ?
  ORDER BY sort_order ASC
`);

const getPersonDetailsStmt = db.prepare(`
  SELECT kind, anilist_id, payload_json, cached_at, updated_at
  FROM person_details
  WHERE kind = ? AND anilist_id = ?
`);

const upsertPersonDetailsStmt = db.prepare(`
  INSERT INTO person_details (
    kind,
    anilist_id,
    payload_json,
    created_at,
    updated_at,
    cached_at
  ) VALUES (
    @kind,
    @anilist_id,
    @payload_json,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(kind, anilist_id) DO UPDATE SET
    payload_json = excluded.payload_json,
    updated_at = CURRENT_TIMESTAMP,
    cached_at = CURRENT_TIMESTAMP
`);

const saveAnimeTransaction = db.transaction((anime) => {
  upsertAnimeStmt.run(anime);

  deleteAnimeTagsStmt.run(anime.id);
  for (const tag of anime.tags ?? []) {
    if (!tag.tag_id) continue;

    insertAnimeTagStmt.run(
      anime.id,
      tag.tag_id,
      tag.name,
      tag.description,
      tag.rank,
      tag.is_media_spoiler,
      tag.is_general_spoiler
    );
  }

  deleteAnimeStaffStmt.run(anime.id);
  for (const staff of anime.staff ?? []) {
    if (!staff.staff_id || !staff.role) continue;

    insertAnimeStaffStmt.run(
      anime.id,
      staff.staff_id,
      staff.name_full,
      staff.name_native,
      staff.image_large,
      staff.role,
      staff.sort_order
    );
  }

  deleteAnimeCharactersStmt.run(anime.id);
  for (const character of anime.characters ?? []) {
    if (!character.character_id || !character.role) continue;

    insertAnimeCharacterStmt.run(
      anime.id,
      character.character_id,
      character.name_full,
      character.name_native,
      character.image_large,
      character.role,
      character.voice_actors,
      character.sort_order
    );
  }
});

function saveAnime(anime) {
  saveAnimeTransaction(anime);
}

function saveAnimeSummary(anime) {
  upsertAnimeSummaryStmt.run(anime);
}

function updateAnimeAdultFlag(animeId, isAdult) {
  updateAnimeAdultFlagStmt.run(isAdult ? 1 : 0, animeId);
}

function updateAnimeListMetadata(media) {
  const animeId = Number(media?.id);
  if (!Number.isInteger(animeId) || animeId <= 0) return;

  updateAnimeListMetadataStmt.run(
    typeof media.isAdult === 'boolean' ? (media.isAdult ? 1 : 0) : null,
    Number.isFinite(Number(media.episodes)) && Number(media.episodes) > 0
      ? Number(media.episodes)
      : null,
    Number.isFinite(Number(media.duration)) && Number(media.duration) > 0
      ? Number(media.duration)
      : null,
    animeId
  );
}

function updateAnimeFranchiseStartDate(animeId, franchiseStartDate) {
  const normalizedAnimeId = Number(animeId);
  if (!Number.isInteger(normalizedAnimeId) || normalizedAnimeId <= 0) return false;

  const year = Number(franchiseStartDate?.year);
  if (!Number.isInteger(year) || year <= 0) return false;

  db.prepare('INSERT OR REPLACE INTO anime_series_dates (anime_id, start_date_json) VALUES (?, ?)').run(normalizedAnimeId, JSON.stringify(franchiseStartDate));

  const month = String(Number(franchiseStartDate?.month) || 1).padStart(2, '0');
  const day = String(Number(franchiseStartDate?.day) || 1).padStart(2, '0');
  return updateAnimeFranchiseStartDateStmt.run(`${year}-${month}-${day}`, normalizedAnimeId).changes > 0;
}

function getAnimeById(id) {
  const anime = getAnimeByIdStmt.get(id);

  if (!anime) return null;

  anime.tags = getAnimeTagsStmt.all(id).map((tag) => ({
    ...tag,
    isMediaSpoiler: Boolean(tag.isMediaSpoiler),
    isGeneralSpoiler: Boolean(tag.isGeneralSpoiler),
  }));

  anime.staff = getAnimeStaffStmt.all(id).map((edge) => ({
    role: edge.role,
    node: {
      id: edge.staff_id,
      name: {
        full: edge.name_full,
        native: edge.name_native,
        userPreferred: edge.name_full,
      },
      image: {
        large: edge.image_large,
      },
    },
  }));

  anime.characters = getAnimeCharactersStmt.all(id).map((edge) => ({
    role: edge.role,
    voiceActors: JSON.parse(edge.voice_actors || '[]'),
    node: {
      id: edge.character_id,
      name: {
        full: edge.name_full,
        native: edge.name_native,
        userPreferred: edge.name_full,
      },
      image: {
        large: edge.image_large,
      },
    },
  }));

  return anime;
}

function getPersonDetails(kind, anilistId) {
  const normalizedKind = normalizePersonKind(kind);
  const numericId = Number(anilistId);

  if (!normalizedKind || !Number.isInteger(numericId) || numericId <= 0) {
    return null;
  }

  const row = getPersonDetailsStmt.get(normalizedKind, numericId);
  if (!row) return null;

  return {
    kind: row.kind,
    anilistId: row.anilist_id,
    details: safeJsonParse(row.payload_json, null),
    cachedAt: row.cached_at,
    updatedAt: row.updated_at,
  };
}

function savePersonDetails(kind, anilistId, details) {
  const normalizedKind = normalizePersonKind(kind);
  const numericId = Number(anilistId);

  if (!normalizedKind || !Number.isInteger(numericId) || numericId <= 0 || !details) {
    return null;
  }

  upsertPersonDetailsStmt.run({
    kind: normalizedKind,
    anilist_id: numericId,
    payload_json: JSON.stringify(details),
  });

  return getPersonDetails(normalizedKind, numericId);
}

function normalizePersonKind(kind) {
  return kind === 'character' || kind === 'staff' ? kind : null;
}

function createUser({ username, usernameNormalized, passwordHash, localCredentialsConfirmed = null }) {
  const result = createUserStmt.run(
    username,
    usernameNormalized,
    passwordHash,
    localCredentialsConfirmed === null ? null : localCredentialsConfirmed ? 1 : 0
  );
  return result.lastInsertRowid;
}

function updateUserPassword(userId, passwordHash) {
  updateUserPasswordStmt.run(passwordHash, userId);
}

function confirmLocalCredentials(userId) {
  confirmLocalCredentialsStmt.run(userId);
}

function clearProviderSyncQueue(userId, provider) {
  const operations = provider === 'mal'
    ? ['upsert_mal_entry', 'delete_mal_entry', 'upsert_mal_manga_entry', 'delete_mal_manga_entry']
    : ['upsert_anilist_entry', 'delete_anilist_entry', 'upsert_anilist_manga_entry', 'delete_anilist_manga_entry'];
  return deleteProviderSyncQueueByUserIdStmt.run(userId, ...operations).changes;
}

function getUserByNormalizedUsername(usernameNormalized) {
  return getUserByNormalizedUsernameStmt.get(usernameNormalized);
}

function getSafeUserById(id) {
  return getUserByIdStmt.get(id);
}

function updateLastLogin(id) {
  updateLastLoginStmt.run(id);
}

function saveManga(media) {
  if (!media?.id) return null;

  upsertMangaStmt.run({
    id: Number(media.id),
    title_romaji: media.title?.romaji ?? null,
    title_english: media.title?.english ?? null,
    title_native: media.title?.native ?? null,
    title_preferred: media.title?.userPreferred ?? null,
    cover_image_large: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
    banner_image: media.bannerImage ?? null,
    is_adult:
      media.isAdult === null || media.isAdult === undefined ? null : media.isAdult ? 1 : 0,
    chapters: media.chapters ?? null,
    volumes: media.volumes ?? null,
    format: media.format ?? null,
    status: media.status ?? null,
    average_score: media.averageScore ?? null,
    mean_score: media.meanScore ?? null,
    popularity: media.popularity ?? null,
    favourites: media.favourites ?? null,
    source: typeof media.source === 'string' ? media.source : null,
    country_of_origin: media.countryOfOrigin ?? null,
    start_date: media.startDate ? JSON.stringify(media.startDate) : null,
    end_date: media.endDate ? JSON.stringify(media.endDate) : null,
    site_url: media.siteUrl ?? null,
    genres: JSON.stringify(media.genres ?? []),
    recommendations: JSON.stringify(media.recommendations?.nodes ?? []),
    details_json: JSON.stringify(media),
  });

  return getMangaById(Number(media.id));
}

function mapMangaRow(row) {
  if (!row) return null;
  const details = safeJsonParse(row.details_json, null);
  return {
    ...row,
    genres: safeJsonParse(row.genres, []),
    tags: Array.isArray(details?.tags) ? details.tags : [],
    recommendations: safeJsonParse(row.recommendations, []),
    details,
  };
}

function getMangaById(id) {
  return mapMangaRow(getMangaByIdStmt.get(Number(id)));
}

function getUserMangaEntry(userId, mangaId) {
  return mapMangaRow(getUserMangaEntryStmt.get(userId, mangaId));
}

function getUserMangaList(userId) {
  return getUserMangaListStmt.all(userId).map(mapMangaRow);
}

function addUserMangaEntry({
  userId,
  mangaId,
  status,
  isFavorite,
  repeatCount,
  isRereading,
  progress,
  volumeProgress,
  score,
  notes,
  startedAt,
  completedAt,
  localUpdatedAt = null,
}) {
  return addUserMangaEntryStmt.run(
    userId,
    mangaId,
    status,
    isFavorite ? 1 : 0,
    repeatCount,
    isRereading ? 1 : 0,
    progress,
    volumeProgress,
    score,
    notes,
    startedAt,
    completedAt,
    localUpdatedAt
  ).lastInsertRowid;
}

function updateUserMangaEntry({
  userId,
  mangaId,
  status,
  isFavorite,
  repeatCount,
  isRereading,
  progress,
  volumeProgress,
  score,
  notes,
  startedAt,
  completedAt,
  localUpdatedAt = null,
}) {
  updateUserMangaEntryStmt.run(
    status,
    isFavorite ? 1 : 0,
    repeatCount,
    isRereading ? 1 : 0,
    progress,
    volumeProgress,
    score,
    notes,
    startedAt,
    completedAt,
    localUpdatedAt,
    userId,
    mangaId
  );
}

function removeUserMangaEntry(userId, mangaId) {
  return removeUserMangaEntryStmt.run(userId, mangaId).changes;
}

function clearUserMangaList(userId) {
  return clearUserMangaListStmt.run(userId).changes;
}

function getUserAnimeEntry(userId, animeId) {
  const entry = getUserAnimeEntryStmt.get(userId, animeId);
  return entry
    ? {
        ...entry,
        tags: getAnimeTagsStmt.all(animeId),
      }
    : null;
}

function getUserAnimeList(userId) {
  return getUserAnimeListStmt.all(userId).map((entry) => ({
    ...entry,
    tags: getAnimeTagsStmt.all(entry.anime_id),
  }));
}

function upsertAnimeExternalId({ provider, externalId, animeId, submittedByUserId = null }) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedExternalId = String(externalId || '').trim();
  const numericAnimeId = Number(animeId);
  const numericSubmittedByUserId = Number(submittedByUserId);
  const safeSubmittedByUserId =
    Number.isInteger(numericSubmittedByUserId) && numericSubmittedByUserId > 0
      ? numericSubmittedByUserId
      : null;

  if (!normalizedProvider || !normalizedExternalId || !Number.isInteger(numericAnimeId)) {
    return;
  }

  upsertAnimeExternalIdStmt.run(
    normalizedProvider,
    normalizedExternalId,
    numericAnimeId,
    safeSubmittedByUserId
  );
}

function getAnimeExternalId(provider, externalId) {
  return getAnimeExternalIdStmt.get(
    String(provider || '').trim().toLowerCase(),
    String(externalId || '').trim()
  );
}

function getAnimeExternalIdByAnimeId(provider, animeId) {
  return getAnimeExternalIdByAnimeIdStmt.get(
    String(provider || '').trim().toLowerCase(),
    Number(animeId)
  );
}

function upsertMangaExternalId({ provider, externalId, mangaId }) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedExternalId = String(externalId || '').trim();
  const numericMangaId = Number(mangaId);
  if (!normalizedProvider || !normalizedExternalId || !Number.isInteger(numericMangaId)) return;
  upsertMangaExternalIdStmt.run(normalizedProvider, normalizedExternalId, numericMangaId);
}

function getMangaExternalId(provider, externalId) {
  return getMangaExternalIdStmt.get(
    String(provider || '').trim().toLowerCase(),
    String(externalId || '').trim()
  );
}

function getMangaExternalIdByMangaId(provider, mangaId) {
  return getMangaExternalIdByMangaIdStmt.get(
    String(provider || '').trim().toLowerCase(),
    Number(mangaId)
  );
}

function getProviderMappingMiss(provider, mediaType, externalId, titleSignature) {
  const row = getProviderMappingMissStmt.get(
    String(provider || '').trim().toLowerCase(),
    mediaType === 'MANGA' ? 'MANGA' : 'ANIME',
    String(externalId || '').trim()
  );
  if (!row || Number(row.expires_at) <= Date.now() || row.title_signature !== titleSignature) {
    return null;
  }
  return row;
}

function upsertProviderMappingMiss({ provider, mediaType, externalId, titleSignature, ttlMs }) {
  upsertProviderMappingMissStmt.run(
    String(provider || '').trim().toLowerCase(),
    mediaType === 'MANGA' ? 'MANGA' : 'ANIME',
    String(externalId || '').trim(),
    String(titleSignature || ''),
    Date.now() + Math.max(60_000, Number(ttlMs) || 24 * 60 * 60 * 1000)
  );
}

function deleteProviderMappingMiss(provider, mediaType, externalId) {
  deleteProviderMappingMissStmt.run(
    String(provider || '').trim().toLowerCase(),
    mediaType === 'MANGA' ? 'MANGA' : 'ANIME',
    String(externalId || '').trim()
  );
}

function addUserAnimeEntry({
  userId,
  animeId,
  status,
  isFavorite,
  repeatCount,
  isRewatching,
  progress,
  score,
  notes,
  startedAt,
  completedAt,
  localUpdatedAt = null,
}) {
  const result = addUserAnimeEntryStmt.run(
    userId,
    animeId,
    status,
    isFavorite ? 1 : 0,
    repeatCount,
    isRewatching ? 1 : 0,
    progress,
    score,
    notes,
    startedAt,
    completedAt,
    localUpdatedAt
  );

  return result.lastInsertRowid;
}

function updateUserAnimeEntry({
  userId,
  animeId,
  status,
  isFavorite,
  repeatCount,
  isRewatching,
  progress,
  score,
  notes,
  startedAt,
  completedAt,
  localUpdatedAt = null,
}) {
  updateUserAnimeEntryStmt.run(
    status,
    isFavorite ? 1 : 0,
    repeatCount,
    isRewatching ? 1 : 0,
    progress,
    score,
    notes,
    startedAt,
    completedAt,
    localUpdatedAt,
    userId,
    animeId
  );
}

function removeUserAnimeEntry(userId, animeId) {
  removeUserAnimeEntryStmt.run(userId, animeId);
}

function clearUserAnimeList(userId) {
  const result = clearUserAnimeListStmt.run(userId);
  return result.changes;
}

function updateTutorialDismissed(id, dismissed) {
  updateTutorialDismissedStmt.run(dismissed ? 1 : 0, id);
}

function getAppSetting(key) {
  return getAppSettingStmt.get(key)?.value ?? null;
}

function setAppSetting(key, value) {
  setAppSettingStmt.run(key, value == null ? null : String(value));
}

function deleteAppSetting(key) {
  deleteAppSettingStmt.run(key);
}

function createWebSessionRecord({ sessionHash, userId, expiresAt }) {
  const now = Date.now();
  insertWebSessionStmt.run(sessionHash, userId, expiresAt, now, now);
}

function getWebSessionByHash(sessionHash) {
  return getWebSessionStmt.get(sessionHash);
}

function updateWebSessionExpiry(sessionHash, expiresAt) {
  updateWebSessionExpiryStmt.run(expiresAt, Date.now(), sessionHash);
}

function deleteWebSession(sessionHash) {
  deleteWebSessionStmt.run(sessionHash);
}

function deleteExpiredWebSessions(now = Date.now()) {
  deleteExpiredWebSessionsStmt.run(now);
}

function decryptAniListAccount(account) {
  return account
    ? {
        ...account,
        access_token: decryptSecret(account.access_token),
      }
    : account;
}

function decryptMalAccount(account) {
  return account
    ? {
        ...account,
        access_token: decryptSecret(account.access_token),
        refresh_token: decryptSecret(account.refresh_token),
      }
    : account;
}

function getAniListAccountByAniListUserId(anilistUserId) {
  return decryptAniListAccount(getAniListAccountByAniListUserIdStmt.get(anilistUserId));
}

function getAniListAccountByUserId(userId) {
  return decryptAniListAccount(getAniListAccountByUserIdStmt.get(userId));
}

function deleteAniListAccountByUserId(userId) {
  deleteAniListAccountByUserIdStmt.run(userId);
}

function getMalAccountByMalUserId(malUserId) {
  return decryptMalAccount(getMalAccountByMalUserIdStmt.get(malUserId));
}

function getMalAccountByUserId(userId) {
  return decryptMalAccount(getMalAccountByUserIdStmt.get(userId));
}

function deleteMalAccountByUserId(userId) {
  deleteMalAccountByUserIdStmt.run(userId);
}

function deleteUser(userId) {
  const remove = db.transaction(() => {
    deleteUserWebSessionsByUserIdStmt.run(userId);
    deleteUserSyncQueueByUserIdStmt.run(userId);
    deleteUserSyncHistoryByUserIdStmt.run(userId);
    deleteAniListAccountByUserIdStmt.run(userId);
    deleteMalAccountByUserIdStmt.run(userId);
    clearExternalIdSubmitterByUserIdStmt.run(userId);
    deleteUserAnimeListByUserIdStmt.run(userId);
    deleteUserMangaListByUserIdStmt.run(userId);
    deleteAppSettingStmt.run(`sync.auto.${userId}`);
    return deleteUserStmt.run(userId).changes;
  });

  return remove();
}

function mergeUserIntoUser(sourceUserId, targetUserId) {
  const merge = db.transaction(() => {
    const animeResult = mergeMissingUserAnimeEntriesStmt.run(
      targetUserId,
      sourceUserId,
      targetUserId
    );
    const mangaResult = mergeMissingUserMangaEntriesStmt.run(
      targetUserId,
      sourceUserId,
      targetUserId
    );
    deleteUser(sourceUserId);

    return {
      movedEntries: animeResult.changes + mangaResult.changes,
      movedAnimeEntries: animeResult.changes,
      movedMangaEntries: mangaResult.changes,
    };
  });

  return merge();
}

function upsertAniListAccount({
  userId,
  anilistUserId,
  anilistUsername,
  originalAniListUsername,
  accessToken,
}) {
  upsertAniListAccountStmt.run(
    userId,
    anilistUserId,
    anilistUsername,
    originalAniListUsername,
    encryptSecret(accessToken)
  );
}

function updateAniListAccountImportTime(anilistUserId) {
  updateAniListAccountImportTimeStmt.run(anilistUserId);
}

function upsertMalAccount({
  userId,
  malUserId,
  malUsername,
  originalMalUsername,
  accessToken,
  refreshToken,
  tokenExpiresAt,
}) {
  upsertMalAccountStmt.run(
    userId,
    malUserId,
    malUsername,
    originalMalUsername,
    encryptSecret(accessToken),
    encryptSecret(refreshToken ?? null),
    tokenExpiresAt ?? null
  );
}

function updateMalAccountImportTime(malUserId) {
  updateMalAccountImportTimeStmt.run(malUserId);
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function mergeChangedFields(existingFields, nextFields) {
  const byField = new Map();

  for (const change of Array.isArray(existingFields) ? existingFields : []) {
    if (change?.field) {
      byField.set(change.field, change);
    }
  }

  for (const change of Array.isArray(nextFields) ? nextFields : []) {
    if (!change?.field) continue;

    const existing = byField.get(change.field);
    byField.set(change.field, {
      field: change.field,
      from: existing ? existing.from : change.from,
      to: change.to,
    });
  }

  return Array.from(byField.values()).filter((change) => change.from !== change.to);
}

function enqueueSyncJob({ userId, animeId, mangaId, mediaType = 'ANIME', mediaId, operation, payload, changedFields }) {
  const normalizedMediaType = mediaType === 'MANGA' ? 'MANGA' : 'ANIME';
  const normalizedMediaId = Number(mediaId ?? mangaId ?? animeId);
  const existing = getSyncQueueJobStmt.get(
    userId,
    normalizedMediaType,
    normalizedMediaId,
    operation
  );
  const existingFields = existing
    ? safeJsonParse(existing.changed_fields_json, [])
    : [];
  const mergedFields = mergeChangedFields(existingFields, changedFields);

  if (!mergedFields.length) {
    return null;
  }

  upsertSyncQueueJobStmt.run(
    userId,
    normalizedMediaType,
    normalizedMediaId,
    operation,
    JSON.stringify(payload),
    JSON.stringify(mergedFields)
  );

  return getSyncQueueJobStmt.get(userId, normalizedMediaType, normalizedMediaId, operation);
}

function getSyncQueueJob(userId, mediaId, operation, mediaType = 'ANIME') {
  const row = getSyncQueueJobStmt.get(userId, mediaType, mediaId, operation);
  return row ? mapSyncQueueRow(row) : null;
}

function getDueSyncQueueJobs(userId, limit = 10, options = {}) {
  const stmt = options.includeFutureRetries
    ? getRunnableSyncQueueJobsStmt
    : getDueSyncQueueJobsStmt;
  return stmt.all(userId, limit).map(mapSyncQueueRow);
}

function getSyncQueueItems(userId, limit = 50) {
  return getSyncQueueItemsStmt.all(userId, limit).map(mapSyncQueueRow);
}

function getSyncQueueCount(userId) {
  return Number(countSyncQueueItemsStmt.get(userId)?.count ?? 0);
}

function markSyncQueueJobFailed(id, error, nextAttemptAt, blocked = false) {
  markSyncQueueJobFailedStmt.run(blocked ? 'blocked' : 'failed', error, blocked ? null : nextAttemptAt, id);
}

function restoreSyncQueueJob(userId, id) {
  return restoreSyncQueueJobStmt.run(id, userId).changes > 0;
}

function excludeSyncQueueJob(userId, id) {
  return excludeSyncQueueJobStmt.run(id, userId).changes > 0;
}

function applySyncQueueFailureState({
  userId,
  mediaType,
  mediaId,
  operation,
  attempts,
  lastError,
  excluded,
}) {
  const normalizedAttempts = Math.min(100, Math.max(1, Math.round(Number(attempts) || 1)));
  return applySyncQueueFailureStateStmt.run(
    excluded ? 'blocked' : 'failed',
    normalizedAttempts,
    lastError || null,
    userId,
    mediaType === 'MANGA' ? 'MANGA' : 'ANIME',
    Number(mediaId),
    operation
  ).changes > 0;
}

function deleteSyncQueueJob(id) {
  deleteSyncQueueJobStmt.run(id);
}

function deleteSyncQueueJobByEntry(userId, mediaId, operation, mediaType = 'ANIME') {
  deleteSyncQueueJobByEntryStmt.run(userId, mediaType, mediaId, operation);
}

function insertSyncHistory({ userId, animeId, mangaId, mediaType = 'ANIME', mediaId, animeTitle, mediaTitle, operation, changedFields, status, message }) {
  const normalizedMediaType = mediaType === 'MANGA' ? 'MANGA' : 'ANIME';
  const numericMediaId = Number(mediaId ?? mangaId ?? animeId);
  const safeMediaId = Number.isInteger(numericMediaId) ? numericMediaId : null;

  insertSyncHistoryStmt.run(
    userId,
    normalizedMediaType,
    safeMediaId,
    mediaTitle ?? animeTitle,
    operation,
    JSON.stringify(changedFields || []),
    status,
    message
  );
}

function getSyncHistoryItems(userId, status, limit = 50) {
  return getSyncHistoryItemsStmt.all(userId, status, limit).map((row) => ({
    ...row,
    anime_id: row.media_type === 'ANIME' ? row.media_id : null,
    manga_id: row.media_type === 'MANGA' ? row.media_id : null,
    anime_title: row.media_title,
    changedFields: safeJsonParse(row.changed_fields_json, []),
  }));
}

function hasCompletedSyncHistory(userId, mediaType, mediaId, operation) {
  return Boolean(hasCompletedSyncHistoryStmt.get(userId, mediaType, mediaId, operation));
}

function mapSyncQueueRow(row) {
  const mediaType = row.media_type === 'MANGA' ? 'MANGA' : 'ANIME';
  return {
    ...row,
    anime_id: mediaType === 'ANIME' ? row.media_id : null,
    manga_id: mediaType === 'MANGA' ? row.media_id : null,
    payload: safeJsonParse(row.payload_json, {}),
    changedFields: safeJsonParse(row.changed_fields_json, []),
    animeTitle:
      row.title_preferred ||
      row.title_english ||
      row.title_romaji ||
      `${mediaType === 'MANGA' ? 'Manga' : 'Anime'} #${row.media_id}`,
  };
}

module.exports = {
  db,
  dbPath,
  saveAnime,
  saveManga,
  saveAnimeSummary,
  updateAnimeAdultFlag,
  updateAnimeListMetadata,
  updateAnimeFranchiseStartDate,
  getSavedAnimeSeriesDate,
  getAnimeById,
  getMangaById,
  getPersonDetails,
  savePersonDetails,
  createUser,
  updateUserPassword,
  confirmLocalCredentials,
  getUserByNormalizedUsername,
  getSafeUserById,
  updateLastLogin,
  getUserAnimeEntry,
  getUserAnimeList,
  upsertAnimeExternalId,
  getAnimeExternalId,
  getAnimeExternalIdByAnimeId,
  upsertMangaExternalId,
  getMangaExternalId,
  getMangaExternalIdByMangaId,
  getProviderMappingMiss,
  upsertProviderMappingMiss,
  deleteProviderMappingMiss,
  addUserAnimeEntry,
  updateUserAnimeEntry,
  removeUserAnimeEntry,
  clearUserAnimeList,
  getUserMangaEntry,
  getUserMangaList,
  addUserMangaEntry,
  updateUserMangaEntry,
  removeUserMangaEntry,
  clearUserMangaList,
  updateTutorialDismissed,
  getAppSetting,
  setAppSetting,
  deleteAppSetting,
  createWebSessionRecord,
  getWebSessionByHash,
  updateWebSessionExpiry,
  deleteWebSession,
  deleteExpiredWebSessions,
  getAniListAccountByAniListUserId,
  getAniListAccountByUserId,
  deleteAniListAccountByUserId,
  getMalAccountByMalUserId,
  getMalAccountByUserId,
  deleteMalAccountByUserId,
  clearProviderSyncQueue,
  deleteUser,
  mergeUserIntoUser,
  upsertAniListAccount,
  updateAniListAccountImportTime,
  upsertMalAccount,
  updateMalAccountImportTime,
  enqueueSyncJob,
  getSyncQueueJob,
  getDueSyncQueueJobs,
  getSyncQueueItems,
  getSyncQueueCount,
  markSyncQueueJobFailed,
  restoreSyncQueueJob,
  excludeSyncQueueJob,
  applySyncQueueFailureState,
  deleteSyncQueueJob,
  deleteSyncQueueJobByEntry,
  insertSyncHistory,
  getSyncHistoryItems,
  hasCompletedSyncHistory,
};
