const anilist = require('../anilist');
const animethemes = require('../animethemes');

// Public metadata only. This adapter has no account token or library mutation interface.
function createAniListMetadataProvider() {
  return {
    people: (type, id, kind, page) => anilist.getMediaPeople(type, id, kind, page),
    details: (type, id) => type === 'ANIME' ? anilist.getAnimeDetails(id, { includeFranchiseStartDate: false }) : anilist.getMangaDetails(id),
    franchiseStartDate: (media, options) => anilist.findAnimeSeriesStartDate(media, options),
    search: (text, hideAdultContent) => anilist.searchMedia(text, { hideAdultContent }),
    discover: (hideAdultContent, mediaType) => anilist.getDiscoverMedia({ hideAdultContent, mediaType }),
    shelf: (shelfId, page, hideAdultContent, mediaType) => anilist.getDiscoverShelfAnime({ shelfId, page, hideAdultContent, mediaType }),
    calendar: (start, end, hideAdultContent, mediaType) => anilist.getReleaseCalendar({ start, end, hideAdultContent, mediaType }),
    studio: (id, page, hideAdultContent) => anilist.getStudioMedia(id, page, { hideAdultContent }),
    person: (kind, id) => kind === 'character' ? anilist.getCharacterDetails(id) : anilist.getStaffDetails(id),
    themes: (id, titles) => animethemes.getAnimeThemeMusic(id, titles),
    artistAssociations: (slug, page) => animethemes.getArtistThemeAssociations(slug, page),
    cards: (ids, hideAdultContent) => anilist.getAnimeSearchMediaByIds(ids, { hideAdultContent }),
    collection: (type, username) => type === 'ANIME' ? anilist.getUserAnimeCollection(username) : anilist.getUserMangaCollection(username),
  };
}
module.exports = { createAniListMetadataProvider };
