function normalizeFilters(value, genreNames, tagNames, type) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid browse filters.');
  const names = (input, allowed, maximum) => {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > maximum || input.some(name => typeof name !== 'string' || !allowed.includes(name))) throw new Error('Invalid browse selection.');
    return [...new Set(input)].sort();
  };
  const mode = value => { if (value !== undefined && value !== 'all' && value !== 'any') throw new Error('Invalid match rule.'); return value || 'all'; };
  const years = value.years ?? [];
  if (!Array.isArray(years) || years.length > 140 || years.some(year => !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 5)) throw new Error('Invalid browse years.');
  const season = value.season ?? 'any';
  const status = value.status ?? 'any';
  if (!['any','RELEASING','FINISHED','NOT_YET_RELEASED','HIATUS','CANCELLED'].includes(status)) throw new Error('Invalid publishing status.');
  if (!['any','winter','spring','summer','fall'].includes(season) || type === 'MANGA' && season !== 'any') throw new Error('Invalid browse season.');
  return { genres: names(value.genres, genreNames, 50), genreMode: mode(value.genreMode), tags: names(value.tags, tagNames, 500), tagMode: mode(value.tagMode), years: [...new Set(years)].sort((a,b)=>a-b), season, status };
}
function matchesFilters(item, filters, safe, type) {
  const matches = (selected, actual, mode) => !selected.length || (mode === 'all' ? selected.every(name => actual.includes(name)) : selected.some(name => actual.includes(name)));
  return (!safe || item.isAdult !== true)
    && (!filters.status || filters.status === 'any' || item.status === filters.status)
    && matches(filters.genres, item.genres || [], filters.genreMode)
    && matches(filters.tags, (item.tags || []).map(tag => tag.name), filters.tagMode)
    && (filters.season === 'any' || item.season === filters.season.toUpperCase())
    && (!filters.years.length || filters.years.includes(type === 'MANGA' ? item.startDate?.year : item.seasonYear ?? item.startDate?.year));
}
function createFilteredBrowsePager(fetchPages) {
  const cache = new Map();
  return async function browse(filters, type, safe, page, perPage) {
    const key = JSON.stringify([filters,type,safe]);
    let state = cache.get(key);
    if (!state || Date.now() - state.createdAt > 1800000) {
      const base = { genres: filters.genreMode === 'all' ? filters.genres : [], tags: filters.tagMode === 'all' ? filters.tags : [], season: filters.season === 'any' ? undefined : filters.season.toUpperCase(), status: filters.status === 'any' ? undefined : filters.status };
      const anchors = [];
      if (filters.genreMode === 'any' && filters.genres.length) anchors.push({field:'genre',names:filters.genres});
      if (filters.tagMode === 'any' && filters.tags.length) anchors.push({field:'tag',names:filters.tags});
      anchors.sort((a,b)=>a.names.length-b.names.length);
      // Large OR selections use one broad stream with exact local checks, rather than a request per tag.
      let definitions = anchors[0]?.names.length <= 12 ? anchors[0].names.map(name=>({...base,[anchors[0].field]:name})) : [base];
      if (filters.years.length && definitions.length * filters.years.length <= 12) definitions = definitions.flatMap(def=>filters.years.map(year=>({...def,...(type === 'MANGA' ? {startDate:year+'%'} : {seasonYear:year})})));
      state = { createdAt:Date.now(), results:[], seen:new Set(), streams:definitions.map(def=>({def,page:0,items:[],done:false})), chain:Promise.resolve() };
      cache.set(key,state);
      if (cache.size > 40) cache.delete(cache.keys().next().value);
    }
    const current = state;
    const task = current.chain.then(async () => {
      const needed = page * perPage;
      while (current.results.length < needed + 1) {
        const empty = current.streams.filter(stream=>!stream.items.length && !stream.done);
        if (empty.length) {
          const pages = await fetchPages(empty.map(stream=>({ ...stream.def, page:stream.page+1 })),type,safe);
          if (!Array.isArray(pages) || pages.length !== empty.length || pages.some(result=>!Array.isArray(result?.media))) throw new Error('Invalid browse response.');
          pages.forEach((result,index)=>{ const stream=empty[index];stream.page++;stream.items=result.media;stream.done=!result.pageInfo?.hasNextPage; });
        }
        const available=current.streams.filter(stream=>stream.items.length);
        if (!available.length) { if (current.streams.some(stream=>!stream.done)) continue; break; }
        available.sort((a,b)=>(b.items[0].popularity??0)-(a.items[0].popularity??0)||a.items[0].id-b.items[0].id);
        const item=available[0].items.shift();
        if (!item?.id || current.seen.has(item.id)) continue;
        current.seen.add(item.id);
        if (matchesFilters(item,filters,safe,type)) current.results.push(item);
      }
      const more=current.results.length>needed || current.streams.some(stream=>stream.items.length||!stream.done);
      return {items:current.results.slice((page-1)*perPage,needed),pageInfo:{currentPage:page,perPage,lastPage:more?page+1:page,hasNextPage:more,total:more?null:current.results.length}};
    });
    current.chain=task.catch(()=>{});
    return task;
  };
}
module.exports={normalizeFilters,matchesFilters,createFilteredBrowsePager};
