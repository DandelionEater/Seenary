// Resolve public taxonomy names once per day; never cache a rejected request.
let taxonomy;
let expires = 0;
async function getSearchTaxonomy(request) {
  if (!taxonomy || Date.now() >= expires) {
    expires = Date.now() + 24 * 60 * 60 * 1000;
    taxonomy = request(`query { GenreCollection MediaTagCollection { name isAdult } }`).then(result => result.data).catch(error => {
      taxonomy = null;
      throw error;
    });
  }
  return await taxonomy;
}
async function searchTaxonomy(text, options, request) {
  const names = await getSearchTaxonomy(request);
  const normalized = text.trim().normalize('NFKC').toLowerCase();
  const match = values => {
    const exact = values.filter(name => name.toLowerCase() === normalized);
    return (exact.length ? exact : values.filter(name => name.toLowerCase().includes(normalized))).slice(0, 5);
  };
  const genres = match(names.GenreCollection || []);
  const tags = match((names.MediaTagCollection || []).filter(tag => options.hideAdultContent === false || !tag.isAdult).map(tag => tag.name));
  const fields = `id type isAdult title { romaji english userPreferred } coverImage { large } episodes chapters volumes format duration averageScore season seasonYear genres`;
  const clauses = [];
  const variables = { isAdult: options.hideAdultContent === false ? undefined : false };
  const declarations = ['$isAdult: Boolean'];
  for (const [kind, values] of [['genre', genres], ['tag', tags]]) {
    if (!values.length) continue;
    variables[kind] = values;
    declarations.push(`$${kind}: [String]`);
    for (const type of ['ANIME', 'MANGA']) clauses.push(`${kind}${type}: Page(perPage: 20) { media(type: ${type}, ${kind}_in: $${kind}, isAdult: $isAdult, sort: [POPULARITY_DESC]) { ${fields} } }`);
  }
  if (!clauses.length) return { media: [], genres: [], tags: [] };
  const result = await request(`query (${declarations.join(', ')}) { ${clauses.join(' ')} }`, variables);
  const collect = prefix => [...new Map(Object.entries(result.data || {})
    .filter(([key]) => key.startsWith(prefix)).flatMap(([, page]) => page.media || [])
    .filter(item => item?.id && (options.hideAdultContent === false || item.isAdult !== true))
    .map(item => [`${item.type}:${item.id}`, item])).values()];
  return { media: collect(''), genres: collect('genre'), tags: collect('tag') };
}
module.exports = { searchTaxonomy, getSearchTaxonomy };
