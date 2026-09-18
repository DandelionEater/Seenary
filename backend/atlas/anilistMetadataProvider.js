const anilist = require('../anilist');
const animethemes = require('../animethemes');

// Public metadata only. This adapter has no account token or library mutation interface.
function createAniListMetadataProvider() {
  return {
    details: (type, id) => type === 'ANIME' ? anilist.getAnimeDetails(id, { includeFranchiseStartDate: false }) : anilist.getMangaDetails(id),
    search: (text, hideAdultContent) => anilist.searchMedia(text, { hideAdultContent }),
    discover: hideAdultContent => anilist.getDiscoverMedia({ hideAdultContent }),
    shelf: (shelfId, page, hideAdultContent, mediaType) => anilist.getDiscoverShelfAnime({ shelfId, page, hideAdultContent, mediaType }),
    studio: (id, page, hideAdultContent) => anilist.getStudioMedia(id, page, { hideAdultContent }),
    artistAssociations: (slug, page) => animethemes.getArtistThemeAssociations(slug, page),
    cards: (ids, hideAdultContent) => anilist.getAnimeSearchMediaByIds(ids, { hideAdultContent }),
    collection: (type, username) => type === 'ANIME' ? anilist.getUserAnimeCollection(username) : anilist.getUserMangaCollection(username),
  };
}
module.exports = { createAniListMetadataProvider };
