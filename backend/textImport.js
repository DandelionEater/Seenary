const anilist = require('./anilist');
const zlib = require('zlib');

const MAX_TEXT_IMPORT_LINES = 100;
const MAX_PDF_IMPORT_BYTES = 25 * 1024 * 1024;
const TEXT_IMPORT_SEARCH_CONCURRENCY = 8;
const TEXT_IMPORT_SEARCH_BATCH_DELAY_MS = 250;
const TEXT_IMPORT_PREVIEW_TIME_BUDGET_MS = 45_000;
const TEXT_IMPORT_MAX_SEARCH_VARIANTS = 2;
const TEXT_IMPORT_STATUS_WORDS = new Set([
  'completed',
  'complete',
  'watching',
  'reading',
  'planned',
  'planning',
  'plan to watch',
  'plan to read',
  'paused',
  'dropped',
  'rewatching',
  'rereading',
]);
const TEXT_IMPORT_TITLE_ALIASES = new Map([
  ['aoharuride', 'Ao Haru Ride'],
  ['apothecarsdiaries', 'The Apothecary Diaries'],
  ['apothecarydiaries', 'The Apothecary Diaries'],
  ['86', '86 EIGHTY-SIX'],
  ['blueexorcist', 'Blue Exorcist'],
  ['bluelock', 'BLUE LOCK'],
  ['bluespringride', 'Ao Haru Ride'],
  ['darlinginfranxx', 'Darling in the FranXX'],
  ['darlinginfranxxx', 'Darling in the FranXX'],
  ['darlinginthefranxx', 'Darling in the FranXX'],
  ['darlinginthefranxxoox', 'Darling in the FranXX'],
  ['darlinginthefranxxox', 'Darling in the FranXX'],
  ['darlinginthefranxxx', 'Darling in the FranXX'],
  ['donttoywithmemissnagatoro', "Don't Toy with Me, Miss Nagatoro"],
  ['franxx', 'Darling in the FranXX'],
  ['fruitbasket', 'Fruits Basket'],
  ['fruitsbasket', 'Fruits Basket'],
  ['hellparadise', "Hell's Paradise"],
  ['hellsparadise', "Hell's Paradise"],
  ['hotarubinomorie', 'Hotarubi no Mori e'],
  ['ijiranaidenagatorosan', 'Ijiranaide, Nagatoro-san'],
  ['ijirinaidenagatorosan', 'Ijiranaide, Nagatoro-san'],
  ['jigokuraku', 'Jigokuraku'],
  ['lightoffireflyforest', 'Hotarubi no Mori e'],
  ['lightofafireflyforest', 'Hotarubi no Mori e'],
  ['mashlemagicandmuscles', 'MASHLE: MAGIC AND MUSCLES'],
  ['myloveforyamadakunatlv999', 'My Love Story with Yamada-kun at Lv999'],
  ['mylovestorywithyamada999', 'My Love Story with Yamada-kun at Lv999'],
  ['mylovestorywithyamadaatlv999', 'My Love Story with Yamada-kun at Lv999'],
  ['nierautomata', 'NieR:Automata Ver1.1a'],
  ['oshinoko', 'Oshi no Ko'],
  ['spyfamily', 'SPY x FAMILY'],
  ['spyxfamily', 'SPY x FAMILY'],
  ['theapothecarydiaries', 'The Apothecary Diaries'],
  ['thelightofafireflyforest', 'Hotarubi no Mori e'],
  ['wotakoi', 'Wotakoi: Love is Hard for Otaku'],
  ['wotakoiloveishardforotaku', 'Wotakoi: Love is Hard for Otaku'],
]);
const PDF_IMPORT_BLOCKED_LINE_PATTERNS = [
  /\bsearch anime\b/i,
  /\bbookmark\b/i,
  /\bwatch now\b/i,
  /\bdetails\b/i,
  /\byour watchlist\b/i,
  /\bwatch history\b/i,
  /\bnever lose\b/i,
  /\bepisode\b/i,
  /\btrailer\b/i,
  /\blog in\b/i,
  /\bsign up\b/i,
  /\bprivacy\b/i,
  /\bterms\b/i,
];
const PDF_IMPORT_GENRE_WORDS = new Set([
  'action',
  'adventure',
  'comedy',
  'drama',
  'ecchi',
  'fantasy',
  'horror',
  'mahou',
  'mecha',
  'music',
  'mystery',
  'psychological',
  'romance',
  'sci-fi',
  'slice',
  'sports',
  'supernatural',
  'thriller',
]);
let pdfJsPromise = null;

function parseTextList(text) {
  const seen = new Set();
  const entries = [];

  String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parsed = parseTextLine(line);
      const key = parsed.title.toLowerCase();

      if (!parsed.title || seen.has(key)) {
        return;
      }

      seen.add(key);
      entries.push(parsed);
    });

  return entries.slice(0, MAX_TEXT_IMPORT_LINES);
}

function parseTextLine(line) {
  const progressMatch = line.match(/(?:^|[\s([{-])(\d{1,4})\s*\/\s*(\d{1,4}|\?)(?:[\s)\]}-]|$)/);
  const progress = progressMatch ? Number(progressMatch[1]) : null;
  const total =
    progressMatch && /^\d+$/.test(progressMatch[2])
      ? Number(progressMatch[2])
      : null;
  const cleanedLine = line
    .replace(/^\s*(?:[-*]|\d+[.)])\s+/, '')
    .replace(progressMatch?.[0] || '', ' ')
    .replace(/\s+\[(?:completed|complete|watching|reading|planned|planning|plan to watch|plan to read|paused|dropped|rewatching|rereading)\]\s*$/i, '')
    .replace(/\s+-\s+(?:completed|complete|watching|reading|planned|planning|plan to watch|plan to read|paused|dropped|rewatching|rereading)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const title = extractTextImportTitle(cleanedLine);

  return {
    rawLine: line,
    title,
    progress: Number.isFinite(progress) ? progress : null,
    total: Number.isFinite(total) ? total : null,
  };
}

function extractTextImportTitle(line) {
  const candidates = splitTextImportLine(line)
    .map(cleanTextImportTitleCandidate)
    .filter(isLikelyTextImportTitleCandidate);

  return candidates[0] || cleanTextImportTitleCandidate(line);
}

function splitTextImportLine(line) {
  const text = String(line || '').trim();

  if (!text) {
    return [];
  }

  if (text.includes('\t')) {
    return text.split('\t');
  }

  if (text.includes('|')) {
    return text.split('|');
  }

  if (text.includes(';')) {
    return text.split(';');
  }

  const csvParts = splitCsvTextImportLine(text);

  return csvParts.length > 1 ? csvParts : [text];
}

function splitCsvTextImportLine(line) {
  const parts = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  parts.push(current);

  return parts;
}

function cleanTextImportTitleCandidate(value) {
  return String(value || '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+\[(?:completed|complete|watching|reading|planned|planning|plan to watch|plan to read|paused|dropped|rewatching|rereading)\]\s*$/i, '')
    .replace(/\s+-\s+(?:completed|complete|watching|reading|planned|planning|plan to watch|plan to read|paused|dropped|rewatching|rereading)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isLikelyTextImportTitleCandidate(value) {
  const text = String(value || '').trim();
  const lowerText = text.toLowerCase();

  if (text.length < 2 || text.length > 160) {
    return false;
  }

  if (TEXT_IMPORT_STATUS_WORDS.has(lowerText)) {
    return false;
  }

  if (/^(?:title|anime|manga|name|status|score|rating|progress|episodes?|chapters?|volumes?|type|format)$/i.test(text)) {
    return false;
  }

  if (/^\d+(?:\.\d+)?$/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }

  return /[\p{L}\p{N}]/u.test(text);
}

function prioritizeTextImportEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftHasAlias = hasTextImportTitleAlias(left.title);
    const rightHasAlias = hasTextImportTitleAlias(right.title);

    if (leftHasAlias !== rightHasAlias) {
      return leftHasAlias ? -1 : 1;
    }

    return 0;
  });
}

function hasTextImportTitleAlias(title) {
  return TEXT_IMPORT_TITLE_ALIASES.has(normalizeTextImportAliasKey(title));
}

async function previewTextImport(text, options = {}) {
  const mediaType = options.mediaType === 'MANGA' ? 'MANGA' : 'ANIME';
  const mediaLabel = mediaType === 'MANGA' ? 'Manga' : 'Anime';
  const parsedEntries = parseTextList(text);
  const searchEntries = prioritizeTextImportEntries(parsedEntries);

  if (!parsedEntries.length) {
    return { ok: false, message: `Add at least one ${mediaLabel} title to the text file.` };
  }

  const groupsByStatus = {
    watching: [],
    completed: [],
  };
  const unmatched = [];
  let rateLimitedCount = 0;
  let failedSearchCount = 0;
  let timedOutCount = 0;
  const searchCache = new Map();
  const startedAt = Date.now();

  for (let index = 0; index < searchEntries.length; index += TEXT_IMPORT_SEARCH_CONCURRENCY) {
    if (Date.now() - startedAt > TEXT_IMPORT_PREVIEW_TIME_BUDGET_MS) {
      const remainingEntries = searchEntries.slice(index);
      timedOutCount += remainingEntries.length;
      unmatched.push(...remainingEntries.map((entry) => entry.rawLine));
      break;
    }

    const batch = searchEntries.slice(index, index + TEXT_IMPORT_SEARCH_CONCURRENCY);
    const batchResults = await searchMediaBatchForTextImport(batch, {
      hideAdultContent: options.hideAdultContent,
      mediaType,
      searchCache,
    });

    const rateLimitedResultIndex = batchResults.findIndex(({ searchResult }) => searchResult.rateLimited);

    if (rateLimitedResultIndex !== -1) {
      const remainingEntries = parsedEntries.slice(index + rateLimitedResultIndex);
      rateLimitedCount += remainingEntries.length;
      unmatched.push(...remainingEntries.map((entry) => entry.rawLine));
      break;
    }

    for (const { parsedEntry, searchResult } of batchResults) {
      if (searchResult.error) {
        failedSearchCount += 1;
        unmatched.push(parsedEntry.rawLine);
        continue;
      }

      const results = searchResult.results;
      const match = Array.isArray(results) ? results[0] : null;

      if (!match?.id) {
        unmatched.push(parsedEntry.rawLine);
        continue;
      }

      const episodes = Number.isInteger(match.episodes) && match.episodes > 0 ? match.episodes : null;
      const chapters = Number.isInteger(match.chapters) && match.chapters > 0 ? match.chapters : null;
      const volumes = Number.isInteger(match.volumes) && match.volumes > 0 ? match.volumes : null;
      const totalUnits = mediaType === 'MANGA' ? chapters : episodes;
      const hasProgress = typeof parsedEntry.progress === 'number';
      const progress = hasProgress ? parsedEntry.progress : totalUnits ?? 0;
      const total = parsedEntry.total ?? totalUnits;
      const status =
        hasProgress && (!total || parsedEntry.progress < total) ? 'watching' : 'completed';

      groupsByStatus[status].push({
        animeId: match.id,
        mangaId: mediaType === 'MANGA' ? match.id : undefined,
        mediaId: match.id,
        mediaType,
        status,
        progress,
        score: null,
        notes: null,
        title: match.title || {},
        coverImage: match.coverImage || null,
        episodes,
        chapters,
        volumes,
        volumeProgress: 0,
        format: match.format ?? null,
        season: match.season ?? null,
        seasonYear: match.seasonYear ?? null,
        sourceTitle: parsedEntry.title,
        guessed: Boolean(searchResult.guessed),
        guessedFrom: searchResult.guessed ? parsedEntry.title : null,
        interpretedTitle: searchResult.guessed ? searchResult.searchTitle : null,
        media: match,
      });
    }

    await delayBetweenTextImportSearchBatches(index, searchEntries.length);
  }

  const groups = ['watching', 'completed']
    .map((status) => ({ status, items: groupsByStatus[status] }))
    .filter((group) => group.items.length > 0);
  const matchedCount = groups.reduce((sum, group) => sum + group.items.length, 0);

  if (!matchedCount) {
    return {
      ok: false,
      message:
        rateLimitedCount > 0
          ? 'AniList is rate limiting title matching. Wait a minute, then try the text import again.'
          : timedOutCount > 0
          ? 'Text import matching took too long. Try importing the matched titles now, or retry with fewer lines.'
          : failedSearchCount > 0
          ? 'AniList did not respond reliably while matching this text file. Try again in a moment, or try fewer titles at once.'
          : `No titles from the text file could be matched to AniList ${mediaLabel} records.`,
      unmatched,
    };
  }

  return {
    ok: true,
    message:
      rateLimitedCount > 0
        ? `Matched ${matchedCount} title${matchedCount === 1 ? '' : 's'}. AniList rate limited ${rateLimitedCount}, so try again later for the skipped lines.`
        : timedOutCount > 0
        ? `Matched ${matchedCount} title${matchedCount === 1 ? '' : 's'}. Matching took too long, so ${timedOutCount} line${timedOutCount === 1 ? '' : 's'} were skipped.`
        : failedSearchCount > 0
        ? `Matched ${matchedCount} title${matchedCount === 1 ? '' : 's'}. ${failedSearchCount} title${failedSearchCount === 1 ? '' : 's'} could not be checked because AniList did not respond.`
        : unmatched.length > 0
        ? `Matched ${matchedCount} title${matchedCount === 1 ? '' : 's'} and skipped ${unmatched.length}.`
        : `Matched ${matchedCount} title${matchedCount === 1 ? '' : 's'}.`,
    preview: {
      totalFound: parsedEntries.length,
      groups: groups.map((group) => ({ ...group, mediaType })),
      unmatched,
    },
  };
}

async function previewPdfImport(pdfBase64, options = {}) {
  const text = filterPdfImportText(await extractTextFromPdfBase64(pdfBase64));

  if (!text.trim()) {
    return {
      ok: false,
      message:
        'No readable text was found in this PDF. Try exporting a text-based page, not a scanned image.',
    };
  }

  return await previewTextImport(text, options);
}

function filterPdfImportText(text) {
  const seen = new Set();
  const lines = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = cleanPdfCandidateLine(rawLine);
    const key = line.toLowerCase();

    if (!line || seen.has(key) || !isLikelyPdfAnimeTitleLine(line)) {
      continue;
    }

    seen.add(key);
    lines.push(line);
  }

  return lines.join('\n');
}

function cleanPdfCandidateLine(line) {
  return String(line || '')
    .replace(/\s*\+\d+\s+more\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isLikelyPdfAnimeTitleLine(line) {
  if (line.length < 2 || line.length > 90) {
    return false;
  }

  if (PDF_IMPORT_BLOCKED_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
    return false;
  }

  const lowerLine = line.toLowerCase();
  const words = lowerLine.match(/[\p{L}\p{N}-]+/gu) || [];

  if (!words.length || words.length > 12) {
    return false;
  }

  const genreWordCount = words.filter((word) => PDF_IMPORT_GENRE_WORDS.has(word)).length;

  if (genreWordCount >= 3) {
    return false;
  }

  if (/[.!?]$/.test(line) && words.length > 4) {
    return false;
  }

  if (line.split(/[·•|]/).length > 3) {
    return false;
  }

  if (/\b(?:TV|OVA|ONA|MOVIE)\b/i.test(line) && /\b\d{1,3}\b/.test(line)) {
    return false;
  }

  if (/\b(?:is|are|was|were|with|from|into|that|this|who|when|where)\b/i.test(line) && words.length > 7) {
    return false;
  }

  return true;
}

async function searchMediaBatchForTextImport(parsedEntries, options) {
  const searchCache = options.searchCache;
  const resultsByTitle = new Map();
  const missingEntries = [];

  for (const parsedEntry of parsedEntries) {
    const cacheKey = normalizeSearchCacheKey(
      parsedEntry.title,
      options.hideAdultContent,
      options.mediaType
    );

    if (searchCache.has(cacheKey)) {
      resultsByTitle.set(parsedEntry.title, searchCache.get(cacheKey));
    } else {
      missingEntries.push({
        parsedEntry,
        cacheKey,
        searchTitles: getTextImportSearchTitles(parsedEntry.title),
      });
    }
  }

  const maxVariantCount = Math.max(
    0,
    ...missingEntries.map((entry) => entry.searchTitles.length)
  );
  const unresolvedEntries = new Set(missingEntries);

  for (let variantIndex = 0; variantIndex < maxVariantCount; variantIndex += 1) {
    const variantEntries = Array.from(unresolvedEntries).filter(
      (entry) => entry.searchTitles[variantIndex]
    );

    if (!variantEntries.length) {
      continue;
    }

    try {
      const searchBatch = options.mediaType === 'MANGA' ? anilist.searchMangaBatch : anilist.searchAnimeBatch;
      const batchResults = await searchBatch(
        variantEntries.map((entry) => entry.searchTitles[variantIndex].title),
        { hideAdultContent: options.hideAdultContent }
      );

      batchResults.forEach((results, resultIndex) => {
        if (!Array.isArray(results) || results.length === 0) {
          return;
        }

        const entry = variantEntries[resultIndex];
        const searchTitle = entry.searchTitles[variantIndex];
        const searchResult = {
          results,
          searchTitle: searchTitle.title,
          guessed: searchTitle.guessed,
        };

        searchCache.set(entry.cacheKey, searchResult);
        resultsByTitle.set(entry.parsedEntry.title, searchResult);
        unresolvedEntries.delete(entry);
      });
    } catch (error) {
      const searchResult = isRateLimitError(error)
        ? { rateLimited: true, error }
        : { error };

      variantEntries.forEach((entry) => {
        searchCache.set(entry.cacheKey, searchResult);
        resultsByTitle.set(entry.parsedEntry.title, searchResult);
        unresolvedEntries.delete(entry);
      });
    }
  }

  unresolvedEntries.forEach((entry) => {
    const searchResult = { results: [] };
    searchCache.set(entry.cacheKey, searchResult);
    resultsByTitle.set(entry.parsedEntry.title, searchResult);
  });

  return parsedEntries.map((parsedEntry) => ({
    parsedEntry,
    searchResult: resultsByTitle.get(parsedEntry.title) ?? { results: [] },
  }));
}

function getTextImportSearchTitles(title) {
  const original = String(title || '').trim();
  const alias = TEXT_IMPORT_TITLE_ALIASES.get(normalizeTextImportAliasKey(original));

  if (alias) {
    return [{ title: alias, guessed: true }];
  }

  const simplified = original
    .replace(/\s*\([^)]*(?:TV|OVA|ONA|Movie|Special|Season|Ep(?:isode)?|\d{4})[^)]*\)\s*/gi, ' ')
    .replace(/\s*\[[^\]]*(?:TV|OVA|ONA|Movie|Special|Season|Ep(?:isode)?|\d{4})[^\]]*\]\s*/gi, ' ')
    .replace(/\b(?:season|s)\s*\d+\b/gi, ' ')
    .replace(/\b(?:episode|ep)\s*\d+\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const punctuationSpaced = original
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const titles = [
    alias ? { title: alias, guessed: true } : null,
    original ? { title: original, guessed: false } : null,
    simplified
      ? {
          title: simplified,
          guessed:
            simplified !== original &&
            normalizeTextImportAliasKey(simplified) !== normalizeTextImportAliasKey(original),
        }
      : null,
    punctuationSpaced
      ? {
          title: punctuationSpaced,
          guessed:
            punctuationSpaced !== original &&
            normalizeTextImportAliasKey(punctuationSpaced) !== normalizeTextImportAliasKey(original),
        }
      : null,
  ]
    .filter(Boolean)
    .map((searchTitle) => searchTitle);

  const seen = new Set();

  return titles.filter((searchTitle) => {
    const key = normalizeTextImportAliasKey(searchTitle.title);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  }).slice(0, TEXT_IMPORT_MAX_SEARCH_VARIANTS);
}

function normalizeTextImportAliasKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(?:the|a|an)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function isRateLimitError(error) {
  return error?.status === 429 || /too many requests/i.test(error?.message || '');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSearchCacheKey(title, hideAdultContent, mediaType = 'ANIME') {
  return `${mediaType}:${hideAdultContent ? 'safe' : 'all'}:${String(title || '')
    .trim()
    .toLowerCase()}`;
}

async function delayBetweenTextImportSearchBatches(index, total) {
  if (index + TEXT_IMPORT_SEARCH_CONCURRENCY < total) {
    await delay(TEXT_IMPORT_SEARCH_BATCH_DELAY_MS);
  }
}

function importTextEntries(currentSession, entries = [], selectedMediaKeys = []) {
  // Atlas uses the preview parser without a SQLite runtime. Load the legacy
  // database modules only when the legacy desktop/server import is executed.
  const { mapAnimeForDb } = require('./animeMapper');
  const { saveAnimeSummary, saveManga } = require('./db');
  const { saveMyAnimeEntry, saveMyMangaEntry } = require('./lists');
  const selectedKeys = new Set(
    (Array.isArray(selectedMediaKeys) ? selectedMediaKeys : []).map((value) =>
      typeof value === 'number' ? `ANIME:${value}` : String(value)
    )
  );
  const hasSelection = selectedKeys.size > 0;
  const flatEntries = Array.isArray(entries) ? entries : [];

  let imported = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of flatEntries) {
    const mediaType = entry?.mediaType === 'MANGA' ? 'MANGA' : 'ANIME';
    const mediaId = Number(mediaType === 'MANGA' ? entry?.mangaId ?? entry?.mediaId : entry?.animeId ?? entry?.mediaId);
    const mediaKey = `${mediaType}:${mediaId}`;

    if (!Number.isInteger(mediaId) || mediaId <= 0 || (hasSelection && !selectedKeys.has(mediaKey))) {
      skipped += 1;
      continue;
    }

    if (!entry.media) {
      skipped += 1;
      continue;
    }

    if (mediaType === 'MANGA') saveManga(entry.media);
    else saveAnimeSummary(mapAnimeForDb(entry.media));
    const saveEntry = mediaType === 'MANGA' ? saveMyMangaEntry : saveMyAnimeEntry;
    const result = saveEntry(currentSession, mediaId, {
      status: entry.status || 'completed',
      progress: entry.progress ?? 0,
      score: entry.score ?? null,
      notes: entry.notes ?? null,
      volumeProgress: entry.volumeProgress ?? 0,
    });

    if (!result.ok) {
      skipped += 1;
      continue;
    }

    imported += 1;
    if (result.message === 'Anime added to your list.' || result.message === 'Manga added to your list.') {
      created += 1;
    } else {
      updated += 1;
    }
  }

  return {
    ok: true,
    message: `Imported ${imported} text entr${imported === 1 ? 'y' : 'ies'}.`,
    summary: {
      sourceUsername: 'Text file',
      totalFound: flatEntries.length,
      selectedStatuses: [],
      selectedAnimeIds: Array.from(selectedKeys)
        .filter((key) => key.startsWith('ANIME:'))
        .map((key) => Number(key.slice(6))),
      selectedMediaKeys: Array.from(selectedKeys),
      imported,
      created,
      updated,
      skipped,
    },
  };
}

async function extractTextFromPdfBase64(pdfBase64) {
  const buffer = Buffer.from(String(pdfBase64 || ''), 'base64');

  if (!buffer.length) {
    return '';
  }

  if (buffer.length > MAX_PDF_IMPORT_BYTES) {
    throw new Error(`PDF import supports files up to ${MAX_PDF_IMPORT_BYTES / 1024 / 1024} MB for now.`);
  }

  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdfDocument = await loadingTask.promise;
  const lines = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      });

      lines.push(...pdfTextItemsToLines(textContent.items || []));
      page.cleanup?.();
    }
  } finally {
    await pdfDocument.destroy?.();
  }

  const pdfJsText = normalizeExtractedPdfText(lines.join('\n'));

  if (pdfJsText.trim()) {
    return pdfJsText;
  }

  const source = buffer.toString('latin1');
  const objects = parsePdfObjects(source);
  const unicodeMaps = buildPdfUnicodeMaps(objects);
  const fontMaps = buildPdfFontMaps(objects, unicodeMaps);
  const streams = objects
    .filter((object) => object.stream)
    .map((object) => decodePdfStream(object.dictionary, object.stream))
    .filter(Boolean);

  const streamText = streams
    .map((stream) => extractTextFromPdfContentStream(stream.toString('latin1'), fontMaps))
    .filter(Boolean)
    .join('\n');
  const normalizedStreamText = normalizeExtractedPdfText(streamText);

  if (normalizedStreamText.trim()) {
    return normalizedStreamText;
  }

  const looseText = streams
    .map((stream) => extractLooseTextFromPdfStream(stream.toString('latin1')))
    .filter(Boolean)
    .join('\n');

  return normalizeExtractedPdfText(looseText);
}

function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }

  return pdfJsPromise;
}

function pdfTextItemsToLines(items) {
  const positionedItems = items
    .map((item) => ({
      text: String(item.str || '').trim(),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0),
    }))
    .filter((item) => item.text);
  const rows = [];

  for (const item of positionedItems) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 3);

    if (row) {
      row.items.push(item);
      row.y = (row.y + item.y) / 2;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    )
    .filter(Boolean);
}

function parsePdfObjects(source) {
  const objects = [];
  const objectRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
  let match;

  while ((match = objectRegex.exec(source))) {
    const body = match[3];
    const streamMatch = body.match(/<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/);

    objects.push({
      id: Number(match[1]),
      body,
      dictionary: streamMatch?.[1] || body.match(/<<(.*?)>>/)?.[1] || '',
      stream: streamMatch ? Buffer.from(streamMatch[2], 'latin1') : null,
    });
  }

  const embeddedObjects = [];

  for (const object of objects) {
    if (!/\/Type\s*\/ObjStm\b/.test(object.dictionary) || !object.stream) {
      continue;
    }

    embeddedObjects.push(...parsePdfObjectStream(object));
  }

  objects.push(...embeddedObjects);

  return objects;
}

function parsePdfObjectStream(object) {
  const decoded = decodePdfStream(object.dictionary, object.stream);

  if (!decoded) {
    return [];
  }

  const count = Number(object.dictionary.match(/\/N\s+(\d+)/)?.[1] || 0);
  const first = Number(object.dictionary.match(/\/First\s+(\d+)/)?.[1] || 0);
  const text = decoded.toString('latin1');

  if (!count || !first || first >= text.length) {
    return [];
  }

  const header = text.slice(0, first).trim();
  const body = text.slice(first);
  const pairs = [...header.matchAll(/(\d+)\s+(\d+)/g)].slice(0, count);
  const embeddedObjects = [];

  for (let index = 0; index < pairs.length; index += 1) {
    const id = Number(pairs[index][1]);
    const start = Number(pairs[index][2]);
    const end = index + 1 < pairs.length ? Number(pairs[index + 1][2]) : body.length;
    const embeddedBody = body.slice(start, end).trim();

    if (!id || !embeddedBody) {
      continue;
    }

    embeddedObjects.push({
      id,
      body: embeddedBody,
      dictionary: embeddedBody.match(/<<(.*?)>>/)?.[1] || embeddedBody,
      stream: null,
    });
  }

  return embeddedObjects;
}

function decodePdfStream(dictionary, streamContent) {
  const hasFlate = /\/Filter\s*(?:\/FlateDecode|\[[^\]]*\/FlateDecode[^\]]*\])/.test(dictionary);

  if (!hasFlate) {
    return streamContent;
  }

  try {
    return zlib.inflateSync(streamContent);
  } catch {
    return null;
  }
}

function buildPdfUnicodeMaps(objects) {
  const maps = new Map();

  for (const object of objects) {
    if (!object.stream) {
      continue;
    }

    const decoded = decodePdfStream(object.dictionary, object.stream);
    const text = decoded?.toString('latin1') || '';

    if (text.includes('beginbfchar') || text.includes('beginbfrange')) {
      maps.set(object.id, parsePdfUnicodeMap(text));
    }
  }

  return maps;
}

function buildPdfFontMaps(objects, unicodeMaps) {
  const fontObjectMaps = new Map();

  for (const object of objects) {
    const toUnicodeMatch = object.body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);

    if (toUnicodeMatch) {
      const map = unicodeMaps.get(Number(toUnicodeMatch[1]));

      if (map?.size) {
        fontObjectMaps.set(object.id, map);
      }
    }
  }

  const fontMaps = new Map();

  for (const object of objects) {
    const fontRefRegex = /\/([A-Za-z0-9._-]+)\s+(\d+)\s+\d+\s+R/g;
    let match;

    while ((match = fontRefRegex.exec(object.body))) {
      const fontMap = fontObjectMaps.get(Number(match[2]));

      if (fontMap) {
        fontMaps.set(match[1], fontMap);
      }
    }
  }

  return fontMaps;
}

function parsePdfUnicodeMap(content) {
  const map = new Map();
  const charRegex = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
  let charMatch;

  while ((charMatch = charRegex.exec(content))) {
    map.set(normalizeHexCode(charMatch[1]), decodePdfUnicodeHex(charMatch[2]));
  }

  const rangeRegex = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+(?:<([0-9a-fA-F]+)>|\[([^\]]+)\])/g;
  let rangeMatch;

  while ((rangeMatch = rangeRegex.exec(content))) {
    const start = parseInt(rangeMatch[1], 16);
    const end = parseInt(rangeMatch[2], 16);
    const codeLength = normalizeHexCode(rangeMatch[1]).length;

    if (rangeMatch[4]) {
      const values = [...rangeMatch[4].matchAll(/<([0-9a-fA-F]+)>/g)].map((match) =>
        decodePdfUnicodeHex(match[1])
      );

      values.forEach((value, index) => {
        map.set((start + index).toString(16).toUpperCase().padStart(codeLength, '0'), value);
      });
      continue;
    }

    const destinationStart = parseInt(rangeMatch[3], 16);

    for (let code = start; code <= end && code - start < 512; code += 1) {
      map.set(
        code.toString(16).toUpperCase().padStart(codeLength, '0'),
        decodePdfUnicodeHex((destinationStart + code - start).toString(16))
      );
    }
  }

  return map;
}

function extractTextFromPdfContentStream(content, fontMaps) {
  const blocks = content.match(/BT[\s\S]*?ET/g) || [];

  return blocks
    .map((block) => extractTextFromPdfTextBlock(block, fontMaps))
    .join('\n');
}

function extractLooseTextFromPdfStream(content) {
  const parts = [];
  const tokenRegex =
    /\/(?:ActualText|Alt)\s*(\((?:\\.|[^\\)])*\)|<([0-9a-fA-F\s]+)>)|\((?:\\.|[^\\)])*\)/g;
  let tokenMatch;

  while ((tokenMatch = tokenRegex.exec(content))) {
    const token = tokenMatch[1] || tokenMatch[0];

    if (token.startsWith('(')) {
      parts.push(decodePdfLiteralString(token.slice(1, -1)));
      continue;
    }

    if (tokenMatch[2]) {
      parts.push(decodePdfHexString(tokenMatch[2]));
    }
  }

  return parts.join('\n');
}

function extractTextFromPdfTextBlock(block, fontMaps) {
  const parts = [];
  let currentFontMap = null;
  const tokenRegex = /\/([A-Za-z0-9._-]+)\s+[-\d.]+\s+Tf|\((?:\\.|[^\\)])*\)|<([0-9a-fA-F\s]+)>/g;
  let tokenMatch;

  while ((tokenMatch = tokenRegex.exec(block))) {
    if (tokenMatch[1]) {
      currentFontMap = fontMaps.get(tokenMatch[1]) || null;
      continue;
    }

    const token = tokenMatch[0];

    if (token.startsWith('(')) {
      parts.push(decodePdfLiteralString(token.slice(1, -1)));
      continue;
    }

    if (tokenMatch[2]) {
      parts.push(decodePdfHexString(tokenMatch[2], currentFontMap));
    }
  }

  return parts.join(' ');
}

function decodePdfLiteralString(value) {
  return value
    .replace(/\\([nrtbf()\\])/g, (_match, char) => {
      switch (char) {
        case 'n':
          return '\n';
        case 'r':
          return '\r';
        case 't':
          return '\t';
        case 'b':
        case 'f':
          return ' ';
        default:
          return char;
      }
    })
    .replace(/\\\r?\n/g, '')
    .replace(/\\([0-7]{1,3})/g, (_match, octal) =>
      String.fromCharCode(parseInt(octal, 8))
    );
}

function decodePdfHexString(value, unicodeMap = null) {
  const hex = value.replace(/\s+/g, '');

  if (!hex) {
    return '';
  }

  if (unicodeMap?.size) {
    const decoded = decodePdfHexWithUnicodeMap(hex, unicodeMap);

    if (decoded) {
      return decoded;
    }
  }

  try {
    const paddedHex = hex.length % 2 === 0 ? hex : `${hex}0`;
    const bytes = Buffer.from(paddedHex, 'hex');

    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const chars = [];

      for (let index = 2; index + 1 < bytes.length; index += 2) {
        chars.push(String.fromCharCode(bytes.readUInt16BE(index)));
      }

      return chars.join('');
    }

    return bytes.toString('utf8');
  } catch {
    return '';
  }
}

function decodePdfHexWithUnicodeMap(hex, unicodeMap) {
  const codeLengths = Array.from(
    new Set([...unicodeMap.keys()].map((key) => key.length))
  ).sort((a, b) => b - a);
  let output = '';
  let index = 0;

  while (index < hex.length) {
    const matchLength = codeLengths.find((length) =>
      unicodeMap.has(normalizeHexCode(hex.slice(index, index + length)))
    );

    if (!matchLength) {
      index += 2;
      continue;
    }

    output += unicodeMap.get(normalizeHexCode(hex.slice(index, index + matchLength))) || '';
    index += matchLength;
  }

  return output;
}

function decodePdfUnicodeHex(value) {
  const hex = normalizeHexCode(value);
  const paddedHex = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = Buffer.from(paddedHex, 'hex');

  if (!bytes.length) {
    return '';
  }

  const shouldDecodeUtf16 = bytes.length >= 2 && bytes.length % 2 === 0;

  if (shouldDecodeUtf16) {
    const chars = [];

    for (let index = 0; index + 1 < bytes.length; index += 2) {
      chars.push(String.fromCharCode(bytes.readUInt16BE(index)));
    }

    return chars.join('');
  }

  return bytes.toString('utf8');
}

function normalizeHexCode(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function normalizeExtractedPdfText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(isReadablePdfTextLine)
    .filter(Boolean)
    .join('\n');
}

function isReadablePdfTextLine(line) {
  if (line.length < 2 || line.length > 180) {
    return false;
  }

  const lettersAndNumbers = (line.match(/[\p{L}\p{N}]/gu) || []).length;
  const commonText = (line.match(/[A-Za-z0-9\s:'’.,!?&+/-]/g) || []).length;
  const replacementOrControl = (line.match(/[\u0000-\u001f\u007f-\u009f�]/g) || []).length;
  const readable = (line.match(/[\p{L}\p{N}\p{P}\p{Zs}]/gu) || []).length;
  const readableRatio = readable / Math.max(line.length, 1);
  const commonTextRatio = commonText / Math.max(line.length, 1);

  return (
    lettersAndNumbers >= 2 &&
    replacementOrControl === 0 &&
    readableRatio > 0.85 &&
    commonTextRatio > 0.65
  );
}

module.exports = {
  previewTextImport,
  previewPdfImport,
  importTextEntries,
};
