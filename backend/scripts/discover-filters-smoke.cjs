const assert=require('node:assert/strict');
const {normalizeFilters,matchesFilters,createFilteredBrowsePager}=require('../discoverFilters');
const genres=['Action','Drama','Fantasy'];
const tags=Array.from({length:15},(_,i)=>'Tag '+i);
const data=Array.from({length:180},(_,i)=>({id:i+1,popularity:180-i,isAdult:i%17===0,genres:genres.filter((_,j)=>(i+j)%3!==0),tags:tags.filter((_,j)=>(i+j)%4===0).map(name=>({name})),seasonYear:i%2?2024:2026,season:i%3?'SPRING':'WINTER'}));
let calls=0;
const provider=async(streams,type,safe)=>{
 calls++;
 assert.ok(streams.length<=12,'bounded OR fanout');
 return streams.map(stream=>{
  const rows=data.filter(item=>(!safe||!item.isAdult)&&(!stream.genre||item.genres.includes(stream.genre))&&(!stream.tag||item.tags.some(tag=>tag.name===stream.tag))
   &&(!stream.genres?.length||stream.genres.every(name=>item.genres.includes(name)))&&(!stream.tags?.length||stream.tags.every(name=>item.tags.some(tag=>tag.name===name)))
   &&(!stream.seasonYear||item.seasonYear===stream.seasonYear)&&(!stream.season||item.season===stream.season));
  return{media:rows.slice((stream.page-1)*50,stream.page*50),pageInfo:{hasNextPage:rows.length>stream.page*50}};
 });
};
async function main(){
 for(const genreMode of ['all','any'])for(const tagMode of ['all','any'])for(const pair of [['Tag 0','Tag 1'],['Tag 0','Tag 4']]){
  const filters=normalizeFilters({genres:['Action','Drama'],genreMode,tags:pair,tagMode,years:[],season:'any'},genres,tags,'ANIME');
  const pager=createFilteredBrowsePager(provider);
  const expected=data.filter(item=>matchesFilters(item,filters,true));
  const found=[];
  for(let page=1;;page++){const result=await pager(filters,'ANIME',true,page,7);found.push(...result.items);if(!result.pageInfo.hasNextPage)break;assert.ok(page<30);}
  assert.deepEqual(found.map(item=>item.id),expected.map(item=>item.id),genreMode+'/'+tagMode+' must be exact and ordered');
  const before=calls;await pager(filters,'ANIME',true,1,7);assert.equal(calls,before,'reuse cached results');
 }
 const all=normalizeFilters({},genres,tags,'ANIME');
 assert.deepEqual(all.years,[],'All years default');assert.deepEqual(all.genres,[]);assert.deepEqual(all.tags,[]);
 const pager=createFilteredBrowsePager(provider);
 const first=await pager(all,'ANIME',false,1,20);
 assert.equal(first.items.length,20);assert.equal(first.items[0].id,1);
 const filtered=normalizeFilters({genres:['Action'],tags:['Tag 0','Tag 1'],tagMode:'any',years:[2024],season:'spring'},genres,tags,'ANIME');
 assert.deepEqual((await pager(filtered,'ANIME',true,1,20)).items.map(item=>item.id),data.filter(item=>matchesFilters(item,filtered,true)&&item.season==='SPRING').slice(0,20).map(item=>item.id));
 const wide=normalizeFilters({tags,tagMode:'any'},genres,tags,'MANGA');
 assert.deepEqual((await pager(wide,'MANGA',true,1,20)).items.map(item=>item.id),data.filter(item=>matchesFilters(item,wide,true)).slice(0,20).map(item=>item.id));
 const concurrent=createFilteredBrowsePager(provider);
 const [one,two]=await Promise.all([concurrent(all,'ANIME',true,1,20),concurrent(all,'ANIME',true,2,20)]);
 assert.equal(new Set([...one.items,...two.items].map(item=>item.id)).size,40,'concurrent pages do not duplicate entries');
 let attempt=0;
 const resume=createFilteredBrowsePager(async(...args)=>{if(++attempt===2)throw new Error('Temporary provider outage');return provider(...args);});
 await assert.rejects(resume(all,'ANIME',true,3,20));
 const resumed=await resume(all,'ANIME',true,3,20);
 assert.deepEqual(resumed.items.map(item=>item.id),data.filter(item=>!item.isAdult).slice(40,60).map(item=>item.id),'retry resumes without skipping or duplicating matches');
 for(const patch of [{genreMode:'bad'},{genres:['Unknown']},{tags:['Adult unavailable']},{years:[1800]},{season:'wrong'},{status:'wrong'}])assert.throws(()=>normalizeFilters(patch,genres,tags,'ANIME'));
 assert.throws(()=>normalizeFilters({season:'spring'},genres,tags,'MANGA'));
 const mangaFilters=normalizeFilters({years:[2024],status:'FINISHED'},genres,tags,'MANGA');
 const mangaRows=[{id:901,startDate:{year:2024},status:'FINISHED'},{id:902,startDate:{year:2024},status:'RELEASING'},{id:903,startDate:{year:2023},status:'FINISHED'}];
 assert.deepEqual(mangaRows.filter(row=>matchesFilters(row,mangaFilters,true)).map(row=>row.id),[901]);
 const mangaPager=createFilteredBrowsePager(async streams=>{assert.equal(streams[0].startDate,'2024%');assert.equal(streams[0].status,'FINISHED');return streams.map(()=>({media:mangaRows,pageInfo:{hasNextPage:false}}));});
 assert.deepEqual((await mangaPager(mangaFilters,'MANGA',true,1,20)).items.map(row=>row.id),[901]);
 console.log('PASS: all/any genre/tag combinations, AND between sections, All defaults, years/season, exact sorted pagination, deduplication, caching, bounded OR queries, media/adult isolation and validation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
