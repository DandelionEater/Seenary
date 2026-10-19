const anilist = require('./anilist');
const animethemes = require('./animethemes');

const OPTIONAL_MUSIC_WAIT_MS = 2500;

async function searchMedia(search, options = {}) {
  const query = String(search || '').trim();
  const musicResolutionPromise =
    query.normalize('NFKC').length >= 2
      ? resolveMusicSearch(query, options).catch((error) => {
          console.warn('AnimeThemes song search failed:', error);
          return {
            songs: [],
            artists: [],
            warnings: [
              {
                provider: 'animethemes',
                message: 'Music matches are temporarily unavailable.',
              },
            ],
          };
        })
      : Promise.resolve({ songs: [], artists: [], warnings: [] });

  const [baseResults, musicResults] = await Promise.all([
    anilist.searchMedia(query, options),
    waitForOptionalMusicSearch(musicResolutionPromise),
  ]);

  return {
    ...baseResults,
    songs: musicResults.songs,
    artists: musicResults.artists,
    warnings: [...(baseResults.warnings || []), ...musicResults.warnings],
  };
}

async function resolveMusicSearch(query, options) {
  const musicSearch = await animethemes.searchMusic(query);
  const musicAssociations = [...musicSearch.songs, ...musicSearch.artists];
  if (!musicAssociations.length) {
    return { songs: [], artists: [], warnings: [] };
  }

  try {
    const mediaItems = await anilist.getAnimeSearchMediaByIds(
      musicAssociations.map((item) => item.anilistId),
      options
    );
    const mediaById = new Map(mediaItems.map((media) => [Number(media.id), media]));
    const songs = new Map();

    for (const association of musicSearch.songs) {
      const media = mediaById.get(Number(association.anilistId));
      if (!media) continue;

      const key = `${association.song.id}:${association.theme.id}:${media.id}`;
      songs.set(key, {
        song: association.song,
        theme: association.theme,
        media,
        previewUrl: association.previewUrl,
      });
    }

    const artists = new Map();
    for (const association of musicSearch.artists) {
      const media = mediaById.get(Number(association.anilistId));
      if (!media) continue;

      const key = `${association.artist.id}:${association.song.id}:${association.theme.id}:${media.id}`;
      artists.set(key, {
        artist: association.artist,
        creditedAs: association.creditedAs,
        song: association.song,
        theme: association.theme,
        media,
        previewUrl: association.previewUrl,
      });
    }

    return {
      songs: Array.from(songs.values()),
      artists: Array.from(artists.values()),
      warnings: [],
    };
  } catch (error) {
    console.warn('AnimeThemes media resolution failed:', error);
    return {
      songs: [],
      artists: [],
      warnings: [
        {
          provider: 'animethemes',
          message: 'Music matches could not be connected to AniList right now.',
        },
      ],
    };
  }
}

function waitForOptionalMusicSearch(searchPromise) {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        songs: [],
        artists: [],
        warnings: [
          {
            provider: 'animethemes',
            message: 'Music matches are taking longer than usual and were skipped.',
          },
        ],
      });
    }, OPTIONAL_MUSIC_WAIT_MS);

    searchPromise.then((result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

async function getArtistMedia(slug, page = 1, options = {}) {
  const catalog = await animethemes.getArtistThemeAssociations(slug, page);
  const mediaItems = await anilist.getAnimeSearchMediaByIds(
    catalog.items.map((item) => item.anilistId),
    options
  );
  const mediaById = new Map(mediaItems.map((media) => [Number(media.id), media]));

  return {
    artist: catalog.artist,
    items: catalog.items.flatMap((association) => {
      const media = mediaById.get(Number(association.anilistId));
      return media
        ? [
            {
              artist: association.artist,
              creditedAs: association.creditedAs,
              song: association.song,
              theme: association.theme,
              media,
              previewUrl: association.previewUrl,
            },
          ]
        : [];
    }),
    pageInfo: catalog.pageInfo,
  };
}

module.exports = {
  getArtistMedia,
  searchMedia,
};
