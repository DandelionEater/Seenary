const fetch = require('node-fetch');

const ANILIST_URL = 'https://graphql.anilist.co';
const ANILIST_REQUEST_TIMEOUT_MS = 15000;

const USER_IMPORT_NOT_FOUND_MESSAGE =
  "We couldn't find that AniList user or list. Make sure the username is typed correctly, make sure the account is public, or try another username.";

async function anilistRequest(query, variables = {}, accessToken = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANILIST_REQUEST_TIMEOUT_MS);
  let res;
  let data;

  try {
    res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    data = await parseAniListResponseJson(res);
  } catch (error) {
    throw normalizeAniListTransportError(error);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    if (res.status === 404) {
      const error = new Error(USER_IMPORT_NOT_FOUND_MESSAGE);
      error.status = res.status;
      throw error;
    }

    const retryAfter = Number(res.headers.get('retry-after'));

    if (data?.errors?.length) {
      const error = new Error(
        data.errors[0]?.message || `AniList request failed with status ${res.status}`
      );
      error.status = res.status;
      error.retryAfter = Number.isFinite(retryAfter) ? retryAfter : null;
      throw error;
    }

    const error = new Error(data?.message || `AniList request failed with status ${res.status}`);
    error.status = res.status;
    error.retryAfter = Number.isFinite(retryAfter) ? retryAfter : null;
    throw error;
  }

  if (data.errors?.length) {
    const error = new Error(data.errors[0]?.message || 'AniList returned an error.');
    error.status = data.errors[0]?.status ?? null;
    throw error;
  }

  return data;
}

async function parseAniListResponseJson(res) {
  try {
    return await res.json();
  } catch (error) {
    const requestError = new Error(
      `AniList returned an unreadable response with status ${res.status}.`
    );
    requestError.status = res.status;
    requestError.cause = error;
    throw requestError;
  }
}

function normalizeAniListTransportError(error) {
  if (error?.name === 'AbortError') {
    const timeoutError = new Error('AniList request timed out. Try again in a moment.');
    timeoutError.status = 408;
    timeoutError.retryable = true;
    return timeoutError;
  }

  if (error?.status) {
    return error;
  }

  const requestError = new Error(
    error?.message
      ? `AniList request failed: ${error.message}`
      : 'AniList request failed before a response was received.'
  );
  requestError.retryable = true;
  requestError.cause = error;
  return requestError;
}

async function anilistRequestWithRetry(query, variables = {}, accessToken = null, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await anilistRequest(query, variables, accessToken);
    } catch (error) {
      lastError = error;

      if (!isRetryableAniListError(error) || attempt === attempts) {
        break;
      }

      const retryAfterMs =
        typeof error.retryAfter === 'number' && error.retryAfter > 0
          ? error.retryAfter * 1000
          : 2200 * attempt;
      await delay(retryAfterMs);
    }
  }

  throw lastError;
}

function isRateLimitError(error) {
  return error?.status === 429 || /too many requests/i.test(error?.message || '');
}

function isRetryableAniListError(error) {
  const status = Number(error?.status);
  return (
    error?.retryable === true ||
    isRateLimitError(error) ||
    status === 408 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchMedia(search, options = {}) {
  const hideAdultContent = options.hideAdultContent !== false;
  const query = `
    query ($search: String, $isAdult: Boolean) {
      mediaPage: Page(perPage: 20) {
        media(search: $search, isAdult: $isAdult) {
          id
          type
          isAdult
          title {
            romaji
            english
            userPreferred
          }
          coverImage {
            large
          }
          episodes
          chapters
          volumes
          format
          duration
          averageScore
          season
          seasonYear
        }
      }
      characterPage: Page(perPage: 8) {
        characters(search: $search) {
          id
          name {
            full
            native
            userPreferred
          }
          image {
            large
          }
          media(perPage: 6, sort: [POPULARITY_DESC]) {
            nodes {
              id
              type
              isAdult
              title {
                romaji
                english
                userPreferred
              }
              coverImage {
                large
              }
              episodes
              chapters
              volumes
              format
              duration
              averageScore
              season
              seasonYear
            }
          }
        }
      }
      studioPage: Page(perPage: 6) {
        studios(search: $search) {
          id
          name
          isAnimationStudio
          media(perPage: 6, sort: [POPULARITY_DESC]) {
            edges {
              isMainStudio
              node {
                id
                type
                isAdult
                title {
                  romaji
                  english
                  userPreferred
                }
                coverImage {
                  large
                }
                episodes
                format
                duration
                averageScore
                season
                seasonYear
              }
            }
          }
        }
      }
    }
  `;

  const data = await anilistRequestWithRetry(query, {
    search,
    isAdult: hideAdultContent ? false : undefined,
  });
  const media = data.data?.mediaPage?.media ?? [];
  const characters = (data.data?.characterPage?.characters ?? []).flatMap((character) =>
    (character?.media?.nodes ?? [])
      .filter(
        (item) =>
          item?.id &&
          (item.type === 'ANIME' || item.type === 'MANGA') &&
          (!hideAdultContent || item.isAdult !== true)
      )
      .map((item) => ({
        character: {
          id: character.id,
          name: character.name,
          image: character.image,
        },
        media: item,
      }))
  );
  const studios = (data.data?.studioPage?.studios ?? [])
    .filter((studio) => studio?.isAnimationStudio === true)
    .flatMap((studio) =>
      (studio?.media?.edges ?? [])
        .filter(
          (edge) =>
            edge?.node?.id &&
            edge.node.type === 'ANIME' &&
            (!hideAdultContent || edge.node.isAdult !== true)
        )
        .map((edge) => ({
          studio: {
            id: studio.id,
            name: studio.name,
          },
          media: edge.node,
          isMainStudio: edge.isMainStudio === true,
        }))
    );

  return {
    anime: media.filter((item) => item?.type === 'ANIME'),
    manga: media.filter((item) => item?.type === 'MANGA'),
    characters,
    studios,
  };
}

async function getStudioMedia(studioId, page = 1, options = {}) {
  const normalizedStudioId = Number(studioId);
  const normalizedPage = Math.max(1, Number(page) || 1);
  const hideAdultContent = options.hideAdultContent !== false;

  if (!Number.isInteger(normalizedStudioId) || normalizedStudioId <= 0) {
    throw new Error('Invalid AniList studio ID.');
  }

  const query = `
    query ($studioId: Int!, $page: Int!) {
      Studio(id: $studioId) {
        id
        name
        isAnimationStudio
        media(page: $page, perPage: 20, sort: [POPULARITY_DESC]) {
          pageInfo {
            currentPage
            hasNextPage
          }
          edges {
            isMainStudio
            node {
              id
              type
              isAdult
              title {
                romaji
                english
                userPreferred
              }
              coverImage {
                large
              }
              episodes
              format
              duration
              averageScore
              season
              seasonYear
            }
          }
        }
      }
    }
  `;
  const data = await anilistRequestWithRetry(query, {
    studioId: normalizedStudioId,
    page: normalizedPage,
  });
  const studio = data.data?.Studio;

  if (!studio?.id) {
    throw new Error('AniList studio not found.');
  }

  const items = (studio.media?.edges ?? [])
    .filter(
      (edge) =>
        edge?.node?.id &&
        edge.node.type === 'ANIME' &&
        (!hideAdultContent || edge.node.isAdult !== true)
    )
    .map((edge) => ({
      studio: {
        id: studio.id,
        name: studio.name,
      },
      media: edge.node,
      isMainStudio: edge.isMainStudio === true,
    }));

  return {
    studio: {
      id: studio.id,
      name: studio.name,
      isAnimationStudio: studio.isAnimationStudio === true,
    },
    items,
    pageInfo: {
      currentPage: studio.media?.pageInfo?.currentPage ?? normalizedPage,
      hasNextPage: studio.media?.pageInfo?.hasNextPage === true,
    },
  };
}

async function searchAnime(search, options = {}) {
  const results = await searchMedia(search, options);
  return results.anime;
}

async function searchMediaBatch(searches, options = {}) {
  const normalizedSearches = Array.isArray(searches)
    ? searches.map((search) => String(search || '').trim()).filter(Boolean)
    : [];

  if (!normalizedSearches.length) {
    return [];
  }

  const hideAdultContent = options.hideAdultContent !== false;
  const mediaType = options.mediaType === 'MANGA' ? 'MANGA' : 'ANIME';
  const variableDefinitions = normalizedSearches
    .map((_, index) => `$search${index}: String`)
    .join(', ');
  const pages = normalizedSearches
    .map(
      (_, index) => `
        q${index}: Page(perPage: 10) {
          media(search: $search${index}, type: ${mediaType}, isAdult: $isAdult) {
            ...AnimeSearchResult
          }
        }
      `
    )
    .join('\n');
  const query = `
    query (${variableDefinitions}, $isAdult: Boolean) {
      ${pages}
    }

    fragment AnimeSearchResult on Media {
      id
      isAdult
      title {
        romaji
        english
        userPreferred
      }
      coverImage {
        large
      }
      episodes
      chapters
      volumes
      format
      duration
      averageScore
      season
      seasonYear
    }
  `;
  const variables = normalizedSearches.reduce(
    (current, search, index) => ({
      ...current,
      [`search${index}`]: search,
    }),
    {
      isAdult: hideAdultContent ? false : undefined,
    }
  );
  const data = await anilistRequestWithRetry(query, variables);

  return normalizedSearches.map((_, index) => data.data?.[`q${index}`]?.media ?? []);
}

async function searchAnimeBatch(searches, options = {}) {
  return searchMediaBatch(searches, { ...options, mediaType: 'ANIME' });
}

async function searchMangaBatch(searches, options = {}) {
  return searchMediaBatch(searches, { ...options, mediaType: 'MANGA' });
}

async function getDiscoverMedia(options = {}) {
  const hideAdultContent = options.hideAdultContent !== false;
  const { currentSeason, currentYear, nextSeason, nextYear } = getSeasonWindows();
  const query = `
    query (
      $isAdult: Boolean,
      $currentSeason: MediaSeason,
      $currentYear: Int,
      $nextSeason: MediaSeason,
      $nextYear: Int
    ) {
      trendingAnime: Page(page: 1, perPage: 8) {
        media(type: ANIME, status: RELEASING, sort: TRENDING_DESC, isAdult: $isAdult) {
          ...DiscoverMedia
        }
      }
      seasonal: Page(page: 1, perPage: 10) {
        media(
          type: ANIME,
          season: $currentSeason,
          seasonYear: $currentYear,
          sort: POPULARITY_DESC,
          isAdult: $isAdult
        ) {
          ...DiscoverMedia
        }
      }
      upcoming: Page(page: 1, perPage: 10) {
        media(
          type: ANIME,
          season: $nextSeason,
          seasonYear: $nextYear,
          sort: POPULARITY_DESC,
          isAdult: $isAdult
        ) {
          ...DiscoverMedia
        }
      }
      popular: Page(page: 1, perPage: 10) {
        media(type: ANIME, sort: POPULARITY_DESC, isAdult: $isAdult) {
          ...DiscoverMedia
        }
      }
      highlyRated: Page(page: 1, perPage: 10) {
        media(type: ANIME, sort: SCORE_DESC, isAdult: $isAdult) {
          ...DiscoverMedia
        }
      }
      trendingManga: Page(page: 1, perPage: 8) {
        media(type: MANGA, status: RELEASING, sort: TRENDING_DESC, isAdult: $isAdult) {
          ...DiscoverMedia
        }
      }
      publishingManga: Page(page: 1, perPage: 10) {
        media(type: MANGA, status: RELEASING, sort: TRENDING_DESC, isAdult: $isAdult) {
          ...DiscoverMedia
        }
      }
      newManga: Page(page: 1, perPage: 10) {
        media(type: MANGA, sort: START_DATE_DESC, isAdult: $isAdult) {
          ...DiscoverMedia
        }
      }
      popularManga: Page(page: 1, perPage: 10) {
        media(type: MANGA, sort: POPULARITY_DESC, isAdult: $isAdult) {
          ...DiscoverMedia
        }
      }
      highlyRatedManga: Page(page: 1, perPage: 10) {
        media(type: MANGA, sort: SCORE_DESC, isAdult: $isAdult) {
          ...DiscoverMedia
        }
      }
    }

    fragment DiscoverMedia on Media {
      id
      isAdult
      title {
        romaji
        english
        native
        userPreferred
      }
      coverImage {
        large
      }
      bannerImage
      episodes
      chapters
      volumes
      format
      status
      season
      seasonYear
      averageScore
      meanScore
      popularity
      favourites
      nextAiringEpisode {
        episode
        airingAt
      }
    }
  `;

  const data = await anilistRequestWithRetry(query, {
    isAdult: hideAdultContent ? false : undefined,
    currentSeason,
    currentYear,
    nextSeason,
    nextYear,
  });

  return {
    anime: {
      trending: data.data.trendingAnime.media,
      shelves: [
        {
          id: 'seasonal',
          title: 'Seasonal Picks',
          description: `Popular anime airing in ${formatSeasonLabel(currentSeason)} ${currentYear}.`,
          pills: [formatSeasonLabel(currentSeason), String(currentYear), 'Seasonal'],
          items: data.data.seasonal.media,
        },
        {
          id: 'upcoming',
          title: 'Next Season',
          description: `Anime gathering attention for ${formatSeasonLabel(nextSeason)} ${nextYear}.`,
          pills: [formatSeasonLabel(nextSeason), String(nextYear), 'Upcoming'],
          items: data.data.upcoming.media,
        },
        {
          id: 'popular',
          title: 'Popular',
          description: 'The most-watched anime across AniList.',
          pills: ['Popularity', 'All time'],
          items: data.data.popular.media,
        },
        {
          id: 'rated',
          title: 'Highly Rated',
          description: 'Anime ranked by community score.',
          pills: ['Score', 'Community'],
          items: data.data.highlyRated.media,
        },
      ],
    },
    manga: {
      trending: data.data.trendingManga.media,
      shelves: [
        {
          id: 'seasonal',
          title: 'Publishing Now',
          description: 'Manga currently drawing attention while publishing.',
          pills: ['Publishing', 'Trending'],
          items: data.data.publishingManga.media,
        },
        {
          id: 'upcoming',
          title: 'New & Noteworthy',
          description: 'Recently listed Manga and upcoming publications.',
          pills: ['New releases', 'Upcoming'],
          items: data.data.newManga.media,
        },
        {
          id: 'popular',
          title: 'Popular',
          description: 'The most-read Manga across AniList.',
          pills: ['Popularity', 'All time'],
          items: data.data.popularManga.media,
        },
        {
          id: 'rated',
          title: 'Highly Rated',
          description: 'Manga ranked by community score.',
          pills: ['Score', 'Community'],
          items: data.data.highlyRatedManga.media,
        },
      ],
    },
  };
}

async function getDiscoverShelfAnime(options = {}) {
  const hideAdultContent = options.hideAdultContent !== false;
  const mediaType = options.mediaType === 'MANGA' ? 'MANGA' : 'ANIME';
  const definition = getDiscoverShelfDefinition(options.shelfId, mediaType);
  const page = clampInteger(options.page, 1, 500, 1);
  const perPage = clampInteger(options.perPage, 1, 20, 20);
  const maxItems = definition.expandedLimit ?? Number.POSITIVE_INFINITY;
  const maxPage = Number.isFinite(maxItems) ? Math.ceil(maxItems / perPage) : 500;
  const safePage = Math.min(page, maxPage);
  const data = await fetchDiscoverShelfPage(definition, {
    page: safePage,
    perPage,
    hideAdultContent,
    mediaType,
  });
  const pageInfo = data.data.Page.pageInfo;
  const isCapped = Number.isFinite(maxItems);
  const cappedTotal = isCapped
    ? Math.min(pageInfo.total ?? maxItems, maxItems)
    : null;
  const cappedLastPage = isCapped
    ? Math.min(pageInfo.lastPage ?? maxPage, maxPage)
    : pageInfo.lastPage;
  const items = isCapped
    ? data.data.Page.media.slice(0, Math.max(0, maxItems - (safePage - 1) * perPage))
    : data.data.Page.media;
  const hasNextPage = Boolean(pageInfo.hasNextPage) && safePage < cappedLastPage;
  const effectiveTotal = isCapped
    ? cappedTotal
    : hasNextPage
    ? null
    : (safePage - 1) * perPage + items.length;

  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    pills: definition.pills,
    pageInfo: {
      currentPage: safePage,
      lastPage: hasNextPage ? safePage + 1 : safePage,
      hasNextPage,
      total: effectiveTotal,
      perPage,
    },
    items,
  };
}

async function fetchDiscoverShelfPage(definition, { page, perPage, hideAdultContent, mediaType }) {
  const query = `
    query (
      $page: Int,
      $perPage: Int,
      $isAdult: Boolean,
      $season: MediaSeason,
      $seasonYear: Int,
      $sort: [MediaSort],
      $mediaType: MediaType,
      $status: MediaStatus,
      $genre: String,
      $format: MediaFormat
    ) {
      Page(page: $page, perPage: $perPage) {
        pageInfo {
          currentPage
          lastPage
          hasNextPage
          total
          perPage
        }
        media(
          type: $mediaType,
          status: $status,
          season: $season,
          seasonYear: $seasonYear,
          sort: $sort,
          genre: $genre,
          format: $format,
          isAdult: $isAdult
        ) {
          id
          isAdult
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
          chapters
          volumes
          format
          season
          seasonYear
          averageScore
          meanScore
          popularity
        }
      }
    }
  `;

  return await anilistRequestWithRetry(
    query,
    {
      page,
      perPage,
      isAdult: hideAdultContent ? false : undefined,
      season: definition.season,
      seasonYear: definition.seasonYear,
      sort: definition.sort,
      mediaType,
      status: definition.status,
      genre: definition.genre,
      format: definition.format,
    },
    null,
    1
  );
}

function getDiscoverShelfDefinition(shelfId, mediaType = 'ANIME') {
  const { currentSeason, currentYear, nextSeason, nextYear } = getSeasonWindows();
  const genreDefinitions = {
    'genre-action': 'Action',
    'genre-adventure': 'Adventure',
    'genre-comedy': 'Comedy',
    'genre-drama': 'Drama',
    'genre-fantasy': 'Fantasy',
    'genre-mystery': 'Mystery',
    'genre-romance': 'Romance',
    'genre-sci-fi': 'Sci-Fi',
    'genre-slice-of-life': 'Slice of Life',
  };
  const genre = genreDefinitions[shelfId];
  if (genre) {
    return {
      id: shelfId,
      title: `${genre} ${mediaType === 'MANGA' ? 'Manga' : 'Anime'}`,
      description: `Popular ${genre.toLowerCase()} ${mediaType === 'MANGA' ? 'manga' : 'anime'} from across AniList.`,
      pills: [genre, 'Popularity'],
      genre,
      sort: ['POPULARITY_DESC'],
    };
  }

  const browseDefinitions = {
    'browse-complete': {
      id: 'browse-complete',
      title: 'Completed Stories',
      description: `${mediaType === 'MANGA' ? 'Manga' : 'Anime'} you can experience from beginning to end.`,
      pills: ['Finished', 'Highly rated'],
      status: 'FINISHED',
      sort: ['SCORE_DESC', 'POPULARITY_DESC'],
    },
    'browse-new': {
      id: 'browse-new',
      title: 'Fresh Releases',
      description: `Recently started and newly listed ${mediaType === 'MANGA' ? 'manga' : 'anime'}.`,
      pills: ['New', 'Recent'],
      sort: ['START_DATE_DESC', 'POPULARITY_DESC'],
    },
    ...(mediaType === 'MANGA'
      ? {
          'browse-one-shots': {
            id: 'browse-one-shots',
            title: 'One-Shots',
            description: 'Complete stories told in a single publication.',
            pills: ['One-shot', 'Quick read'],
            format: 'ONE_SHOT',
            sort: ['POPULARITY_DESC'],
          },
        }
      : {
          'browse-movies': {
            id: 'browse-movies',
            title: 'Anime Movies',
            description: 'Feature-length anime for a one-sitting watch.',
            pills: ['Movie', 'One sitting'],
            format: 'MOVIE',
            sort: ['POPULARITY_DESC'],
          },
        }),
  };
  if (browseDefinitions[shelfId]) return browseDefinitions[shelfId];

  if (mediaType === 'MANGA') {
    const mangaDefinitions = {
      seasonal: {
        id: 'seasonal',
        title: 'Publishing Now',
        description: 'Manga currently drawing attention while publishing.',
        pills: ['Publishing', 'Trending'],
        status: 'RELEASING',
        sort: ['TRENDING_DESC'],
      },
      upcoming: {
        id: 'upcoming',
        title: 'New & Noteworthy',
        description: 'Recently listed Manga and upcoming publications.',
        pills: ['New releases', 'Upcoming'],
        sort: ['START_DATE_DESC'],
      },
      popular: {
        id: 'popular',
        title: 'Popular',
        description: 'The most-read Manga across AniList.',
        pills: ['Popularity', 'All time'],
        sort: ['POPULARITY_DESC'],
        expandedLimit: 100,
      },
      rated: {
        id: 'rated',
        title: 'Highly Rated',
        description: 'Manga ranked by community score.',
        pills: ['Score', 'Community'],
        sort: ['SCORE_DESC'],
        expandedLimit: 100,
      },
    };

    return mangaDefinitions[shelfId] || mangaDefinitions.seasonal;
  }

  const definitions = {
    seasonal: {
      id: 'seasonal',
      title: 'Seasonal Picks',
      description: `Popular anime airing in ${formatSeasonLabel(currentSeason)} ${currentYear}.`,
      pills: [formatSeasonLabel(currentSeason), String(currentYear), 'Seasonal'],
      season: currentSeason,
      seasonYear: currentYear,
      sort: ['POPULARITY_DESC'],
    },
    upcoming: {
      id: 'upcoming',
      title: 'Next Season',
      description: `Anime gathering attention for ${formatSeasonLabel(nextSeason)} ${nextYear}.`,
      pills: [formatSeasonLabel(nextSeason), String(nextYear), 'Upcoming'],
      season: nextSeason,
      seasonYear: nextYear,
      sort: ['POPULARITY_DESC'],
    },
    popular: {
      id: 'popular',
      title: 'Popular',
      description: 'The most-watched anime across AniList.',
      pills: ['Popularity', 'All time'],
      season: undefined,
      seasonYear: undefined,
      sort: ['POPULARITY_DESC'],
      expandedLimit: 100,
    },
    rated: {
      id: 'rated',
      title: 'Highly Rated',
      description: 'Anime ranked by community score.',
      pills: ['Score', 'Community'],
      season: undefined,
      seasonYear: undefined,
      sort: ['SCORE_DESC'],
      expandedLimit: 100,
    },
  };

  return definitions[shelfId] || definitions.seasonal;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function getSeasonWindows(date = new Date()) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  const currentIndex = month <= 3 ? 0 : month <= 6 ? 1 : month <= 9 ? 2 : 3;
  const nextIndex = (currentIndex + 1) % seasons.length;

  return {
    currentSeason: seasons[currentIndex],
    currentYear: year,
    nextSeason: seasons[nextIndex],
    nextYear: nextIndex === 0 ? year + 1 : year,
  };
}

function formatSeasonLabel(season) {
  return season.charAt(0) + season.slice(1).toLowerCase();
}

async function getUserMediaCollection(userName, mediaType) {
  const query = `
    query ($userName: String, $type: MediaType) {
      MediaListCollection(
        userName: $userName
        type: $type
        forceSingleCompletedList: true
      ) {
        lists {
          name
          status
          entries {
            status
            updatedAt
            progress
            progressVolumes
            repeat
            notes
            score(format: POINT_10_DECIMAL)
            startedAt {
              year
              month
              day
            }
            completedAt {
              year
              month
              day
            }
            media {
              id
              idMal
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
              chapters
              volumes
              format
              status(version: 2)
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
            }
          }
        }
      }
    }
  `;

  const data = await anilistRequestWithRetry(query, {
    userName,
    type: mediaType === 'MANGA' ? 'MANGA' : 'ANIME',
  });

  if (!data?.data?.MediaListCollection) {
    throw new Error(USER_IMPORT_NOT_FOUND_MESSAGE);
  }

  return data.data.MediaListCollection;
}

async function getUserAnimeCollection(userName) {
  return await getUserMediaCollection(userName, 'ANIME');
}

async function getUserMangaCollection(userName) {
  return await getUserMediaCollection(userName, 'MANGA');
}

async function getViewer(accessToken) {
  const query = `
    query {
      Viewer {
        id
        name
      }
    }
  `;

  const data = await anilistRequestWithRetry(query, {}, accessToken, 2);
  return data.data.Viewer;
}

async function getViewerMediaCollection(accessToken, userId, mediaType) {
  const query = `
    query ($userId: Int, $type: MediaType) {
      MediaListCollection(
        userId: $userId
        type: $type
        forceSingleCompletedList: true
      ) {
        lists {
          name
          status
          entries {
            status
            updatedAt
            progress
            progressVolumes
            repeat
            notes
            score(format: POINT_10_DECIMAL)
            startedAt {
              year
              month
              day
            }
            completedAt {
              year
              month
              day
            }
            media {
              id
              idMal
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
              chapters
              volumes
              format
              status(version: 2)
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
            }
          }
        }
      }
    }
  `;

  const data = await anilistRequestWithRetry(
    query,
    { userId, type: mediaType === 'MANGA' ? 'MANGA' : 'ANIME' },
    accessToken,
    2
  );

  if (!data?.data?.MediaListCollection) {
    throw new Error(USER_IMPORT_NOT_FOUND_MESSAGE);
  }

  return data.data.MediaListCollection;
}

async function getViewerAnimeCollection(accessToken, userId) {
  return await getViewerMediaCollection(accessToken, userId, 'ANIME');
}

async function getViewerMangaCollection(accessToken, userId) {
  return await getViewerMediaCollection(accessToken, userId, 'MANGA');
}

async function getAnimeDetails(id, options = {}) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        isAdult
        title { romaji english native userPreferred }
        coverImage { extraLarge large }
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
        startDate { year month day }
        endDate { year month day }
        trailer { id site thumbnail }
        siteUrl
        description
        genres
        synonyms
        nextAiringEpisode { episode airingAt }
        studios { nodes { id name isAnimationStudio } }
        tags { id name description rank isMediaSpoiler isGeneralSpoiler }
        characters(perPage: 20) {
          edges {
            role
            node { id name { full native userPreferred } image { large } }
            voiceActors(language: JAPANESE) {
              id
              name { full native userPreferred }
              language
              image { large }
            }
          }
        }
        staff(perPage: 20) {
          edges {
            role
            node { id name { full native userPreferred } image { large } }
          }
        }
        relations {
          edges {
            relationType
            node {
              id
              type
              title { romaji english native userPreferred }
              coverImage { large }
              episodes
              format
              status
              season
              seasonYear
              averageScore
              startDate { year month day }
            }
          }
        }
        recommendations(perPage: 10) {
          nodes {
            rating
            mediaRecommendation {
              id
              title { romaji english native userPreferred }
              coverImage { large }
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
        streamingEpisodes { title thumbnail url site }
      }
    }
  `;

  const data = await anilistRequestWithRetry(query, { id });
  const media = data.data.Media;

  if (media && options.includeFranchiseStartDate !== false) {
    media.franchiseStartDate = await findAnimeSeriesStartDate(media);
  }

  return media;
}

async function fetchMangaDetails({ id = null, idMal = null } = {}) {
  const useMalId = Number.isInteger(Number(idMal)) && Number(idMal) > 0;
  const lookupId = useMalId ? Number(idMal) : Number(id);
  if (!Number.isInteger(lookupId) || lookupId <= 0) {
    throw new Error('A valid AniList or MyAnimeList Manga ID is required.');
  }
  const lookupArgument = useMalId ? 'idMal: $lookupId' : 'id: $lookupId';
  const query = `
    query ($lookupId: Int) {
      Media(${lookupArgument}, type: MANGA) {
        id
        idMal
        type
        isAdult
        title { romaji english native userPreferred }
        coverImage { extraLarge large }
        bannerImage
        chapters
        volumes
        format
        status(version: 2)
        averageScore
        meanScore
        popularity
        favourites
        source
        countryOfOrigin
        startDate { year month day }
        endDate { year month day }
        siteUrl
        description
        genres
        synonyms
        tags { id name description rank isMediaSpoiler isGeneralSpoiler }
        characters(perPage: 20) {
          edges {
            role
            node { id name { full native userPreferred } image { large } }
          }
        }
        staff(perPage: 20) {
          edges {
            role
            node { id name { full native userPreferred } image { large } }
          }
        }
        relations {
          edges {
            relationType
            node {
              id
              type
              title { romaji english native userPreferred }
              coverImage { large }
              episodes
              chapters
              volumes
              format
              status(version: 2)
              season
              seasonYear
              averageScore
              startDate { year month day }
            }
          }
        }
        recommendations(perPage: 10) {
          nodes {
            rating
            mediaRecommendation {
              id
              type
              title { romaji english native userPreferred }
              coverImage { large }
              description
              episodes
              chapters
              volumes
              format
              status(version: 2)
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
      }
    }
  `;

  const data = await anilistRequestWithRetry(query, { lookupId });
  return data.data.Media;
}

async function getMangaDetails(id) {
  return await fetchMangaDetails({ id });
}

async function getMangaDetailsByMalId(idMal) {
  return await fetchMangaDetails({ idMal });
}

async function getMediaByMalIds(malIds, mediaType = 'ANIME') {
  const ids = [...new Set((malIds || []).map(Number))].filter(
    (id) => Number.isInteger(id) && id > 0
  );
  const normalizedMediaType = mediaType === 'MANGA' ? 'MANGA' : 'ANIME';
  const results = [];

  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const query = `
      query ($ids: [Int]) {
        Page(page: 1, perPage: 50) {
          media(idMal_in: $ids, type: ${normalizedMediaType}) {
            id
            idMal
            type
            isAdult
            title { romaji english native userPreferred }
            coverImage { extraLarge large }
            bannerImage
            episodes
            chapters
            volumes
            format
            status(version: 2)
            season
            seasonYear
            averageScore
            meanScore
            popularity
            favourites
            duration
            source
            countryOfOrigin
            startDate { year month day }
            endDate { year month day }
            siteUrl
            description
            genres
            synonyms
          }
        }
      }
    `;
    const data = await anilistRequestWithRetry(query, { ids: batch });
    results.push(...(data?.data?.Page?.media ?? []));
  }

  return results;
}

async function getAnimeListMetadata(animeIds) {
  const ids = [...new Set((animeIds || []).map(Number))].filter(
    (id) => Number.isInteger(id) && id > 0
  );
  const results = [];

  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const query = `
      query ($ids: [Int]) {
        Page(page: 1, perPage: 50) {
          media(id_in: $ids, type: ANIME) {
            id
            isAdult
            episodes
            duration
          }
        }
      }
    `;
    const data = await anilistRequestWithRetry(query, { ids: batch });
    results.push(...(data?.data?.Page?.media ?? []));
  }

  return results;
}

async function getAnimeSearchMediaByIds(animeIds, options = {}) {
  const ids = [...new Set((animeIds || []).map(Number))].filter(
    (id) => Number.isInteger(id) && id > 0
  );

  if (!ids.length) {
    return [];
  }

  const hideAdultContent = options.hideAdultContent !== false;
  const results = [];

  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const query = `
      query ($ids: [Int], $isAdult: Boolean) {
        Page(page: 1, perPage: 50) {
          media(id_in: $ids, type: ANIME, isAdult: $isAdult) {
            id
            type
            isAdult
            title {
              romaji
              english
              userPreferred
            }
            coverImage {
              large
            }
            episodes
            format
            duration
            averageScore
            season
            seasonYear
          }
        }
      }
    `;
    const data = await anilistRequestWithRetry(query, {
      ids: batch,
      isAdult: hideAdultContent ? false : undefined,
    });
    results.push(...(data?.data?.Page?.media ?? []));
  }

  return results;
}

async function getAnimeAdultFlags(animeIds) {
  return await getAnimeListMetadata(animeIds);
}

async function findAnimeSeriesStartDate(media) {
  let earliestDate = media?.startDate ?? null;
  let frontier = (media?.relations?.edges ?? [])
    .filter((edge) => edge?.relationType === 'PREQUEL' && edge?.node?.id)
    .map((edge) => edge.node);
  const visited = new Set([Number(media?.id)]);

  for (let depth = 0; depth < 10 && frontier.length > 0; depth += 1) {
    const ids = [];

    for (const node of frontier) {
      earliestDate = getEarlierFuzzyDate(earliestDate, node?.startDate);
      const nodeId = Number(node?.id);

      if (Number.isInteger(nodeId) && nodeId > 0 && !visited.has(nodeId)) {
        visited.add(nodeId);
        ids.push(nodeId);
      }
    }

    if (!ids.length) break;

    const query = `
        query ($ids: [Int]) {
          Page(page: 1, perPage: 25) {
            media(id_in: $ids, type: ANIME) {
              id
              startDate { year month day }
              relations {
                edges {
                  relationType
                  node {
                    id
                    format
                    startDate { year month day }
                  }
                }
              }
            }
          }
        }
    `;
    const data = await anilistRequestWithRetry(query, { ids });
    const entries = data?.data?.Page?.media ?? [];

    frontier = [];
    for (const entry of entries) {
      earliestDate = getEarlierFuzzyDate(earliestDate, entry?.startDate);
      frontier.push(
        ...(entry?.relations?.edges ?? [])
          .filter((edge) => edge?.relationType === 'PREQUEL' && edge?.node?.id)
          .map((edge) => edge.node)
      );
    }
  }

  return earliestDate;
}

function getEarlierFuzzyDate(current, candidate) {
  if (!candidate?.year) return current ?? null;
  if (!current?.year) return candidate;

  const currentValue =
    current.year * 10_000 + Number(current.month || 1) * 100 + Number(current.day || 1);
  const candidateValue =
    candidate.year * 10_000 + Number(candidate.month || 1) * 100 + Number(candidate.day || 1);

  return candidateValue < currentValue ? candidate : current;
}

async function getCharacterDetails(id) {
  const query = `
    query ($id: Int) {
      Character(id: $id) {
        id
        name { full native userPreferred alternative alternativeSpoiler }
        image { large }
        description(asHtml: false)
        gender
        dateOfBirth { year month day }
        age
        bloodType
        favourites
        siteUrl
      }
    }
  `;

  const data = await anilistRequestWithRetry(query, { id });
  return data.data.Character;
}

async function getStaffDetails(id) {
  const query = `
    query ($id: Int) {
      Staff(id: $id) {
        id
        name { full native userPreferred alternative }
        image { large }
        description(asHtml: false)
        primaryOccupations
        gender
        dateOfBirth { year month day }
        dateOfDeath { year month day }
        age
        yearsActive
        homeTown
        bloodType
        languageV2
        favourites
        siteUrl
      }
    }
  `;

  const data = await anilistRequestWithRetry(query, { id });
  return data.data.Staff;
}

function mapDateInput(value) {
  if (!value) return null;

  if (
    typeof value === 'object' &&
    Number.isFinite(value.year) &&
    Number.isFinite(value.month) &&
    Number.isFinite(value.day)
  ) {
    return value;
  }

  const [year, month, day] = String(value).split('-').map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return { year, month, day };
}

function compactVariables(variables) {
  return Object.fromEntries(
    Object.entries(variables).filter(([, value]) => value !== null && value !== undefined)
  );
}

async function saveMediaListEntry(accessToken, payload) {
  const query = `
    mutation (
      $mediaId: Int,
      $status: MediaListStatus,
      $progress: Int,
      $progressVolumes: Int,
      $scoreRaw: Int,
      $notes: String,
      $startedAt: FuzzyDateInput,
      $completedAt: FuzzyDateInput,
      $repeat: Int
    ) {
      SaveMediaListEntry(
        mediaId: $mediaId,
        status: $status,
        progress: $progress,
        progressVolumes: $progressVolumes,
        scoreRaw: $scoreRaw,
        notes: $notes,
        startedAt: $startedAt,
        completedAt: $completedAt,
        repeat: $repeat
      ) {
        id
        updatedAt
      }
    }
  `;

  const data = await anilistRequest(
    query,
    compactVariables({
      mediaId: payload.mediaId,
      status: payload.status,
      progress: payload.progress,
      progressVolumes: payload.progressVolumes,
      scoreRaw: payload.score == null ? 0 : Math.round(payload.score * 10),
      notes: payload.notes,
      startedAt: mapDateInput(payload.startedAt),
      completedAt: mapDateInput(payload.completedAt),
      repeat: payload.repeat,
    }),
    accessToken
  );

  return data.data.SaveMediaListEntry;
}

async function getMediaListEntryId(accessToken, userId, mediaId, mediaType = 'ANIME') {
  const query = `
    query ($userId: Int, $mediaId: Int, $type: MediaType) {
      MediaList(userId: $userId, mediaId: $mediaId, type: $type) {
        id
      }
    }
  `;

  try {
    const data = await anilistRequest(
      query,
      {
        userId,
        mediaId,
        type: mediaType,
      },
      accessToken
    );

    return data?.data?.MediaList?.id ?? null;
  } catch (error) {
    if (error?.status === 404 || /not found/i.test(error?.message || '')) {
      return null;
    }

    throw error;
  }
}

async function deleteMediaListEntry(accessToken, payload) {
  const mediaId = Number(payload.mediaId);
  const userId = Number(payload.userId);

  if (!Number.isInteger(mediaId) || mediaId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    throw new Error('Invalid AniList delete payload.');
  }

  const entryId = await getMediaListEntryId(
    accessToken,
    userId,
    mediaId,
    payload.mediaType === 'MANGA' ? 'MANGA' : 'ANIME'
  );

  if (!entryId) {
    return {
      deleted: true,
      alreadyDeleted: true,
    };
  }

  const query = `
    mutation ($id: Int) {
      DeleteMediaListEntry(id: $id) {
        deleted
      }
    }
  `;
  const data = await anilistRequest(query, { id: entryId }, accessToken);

  return data.data.DeleteMediaListEntry;
}

module.exports = {
  searchMedia,
  getStudioMedia,
  searchAnime,
  searchAnimeBatch,
  searchMangaBatch,
  getDiscoverMedia,
  getDiscoverShelfAnime,
  getUserAnimeCollection,
  getUserMangaCollection,
  getViewer,
  getViewerAnimeCollection,
  getViewerMangaCollection,
  getAnimeDetails,
  findAnimeSeriesStartDate,
  getMangaDetails,
  getMangaDetailsByMalId,
  getMediaByMalIds,
  getAnimeListMetadata,
  getAnimeSearchMediaByIds,
  getAnimeAdultFlags,
  getCharacterDetails,
  getStaffDetails,
  saveMediaListEntry,
  deleteMediaListEntry,
};
