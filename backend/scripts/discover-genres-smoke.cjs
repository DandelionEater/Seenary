const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const names=['Action','Adventure','Comedy','Drama','Ecchi','Fantasy','Hentai','Horror','Mahou Shoujo','Mecha','Music','Mystery','Psychological','Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller'];
const source=fs.readFileSync(require.resolve('../anilist'),'utf8');
let calls=0;const shelfCalls=[];
const moduleObject={exports:{}};
vm.runInNewContext(source,{
  module:moduleObject,AbortController,URL,Buffer,setTimeout,clearTimeout,console,
  require:name=>name==='node-fetch'?async(_url,options)=>{
    const {query,variables}=JSON.parse(options.body);
    if(query.includes('GenreCollection')){calls++;return{ok:true,json:async()=>({data:{GenreCollection:names,MediaTagCollection:[{name:'Time Travel',isAdult:false},{name:'Space',isAdult:false},{name:'Adult Tag',isAdult:true}]}})};}
    if(query.includes('s0: Page')){
      shelfCalls.push(variables);
      const data=Object.fromEntries(Object.keys(variables).filter(key=>/^page\d+$/.test(key)).map(key=>['s'+key.slice(4),{pageInfo:{hasNextPage:false},media:[{id:7,type:variables.type,isAdult:false,popularity:100,status:'FINISHED',startDate:{year:2024},genres:['Action','Drama'],tags:[{name:'Time Travel'},{name:'Space'}],seasonYear:2026,season:'SPRING',title:{english:'Example'}}]}]));
      return{ok:true,json:async()=>({data})};
    }
    shelfCalls.push(variables);return{ok:true,json:async()=>({data:{Page:{pageInfo:{hasNextPage:false,lastPage:1,total:1},media:[{id:7,title:{english:'Example'}}]}}})};
  }:require(require('node:path').join(__dirname,'..',name)),
});
async function main(){
 const api=moduleObject.exports;
 assert.equal((await api.getDiscoverGenres()).length,18);
 assert.equal((await api.getDiscoverGenres(false)).length,19);
 assert.deepEqual(Array.from(await api.getDiscoverTags()),['Space','Time Travel']);
 assert.ok((await api.getDiscoverTags(false)).includes('Adult Tag'));
 assert.equal(calls,1,'genre taxonomy shared across requests');
 for(const name of names.filter(name=>name!=='Hentai')){
   const slug='genre-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
   const result=await api.getDiscoverShelfAnime({shelfId:slug,mediaType:'ANIME'});
   assert.ok(result.title.includes(name));
   assert.equal(shelfCalls.at(-1).genre,name,'new genre opens correct shelf');
 }
 await api.getDiscoverShelfAnime({shelfId:'genre-mahou-shoujo',mediaType:'MANGA'});
 assert.equal(shelfCalls.at(-1).mediaType,'MANGA');
 await api.getDiscoverShelfAnime({shelfId:'genres-horror--psychological',mediaType:'ANIME'});
 assert.deepEqual(Array.from(shelfCalls.at(-1).genres),['Horror','Psychological']);
 await assert.rejects(api.getDiscoverShelfAnime({shelfId:'genre-hentai',hideAdultContent:true}));
 assert.equal((await api.getDiscoverShelfAnime({shelfId:'genre-hentai',hideAdultContent:false})).items.length,1);
 const filters={genres:['Action','Drama'],genreMode:'all',tags:['Time Travel','Space'],tagMode:'any',years:[],season:'any'};
 const shelfId='browse-filter-'+Buffer.from(JSON.stringify(filters)).toString('base64url');
 const combined=await api.getDiscoverShelfAnime({shelfId,mediaType:'ANIME'});
 assert.equal(combined.items.length,1,'combined filter result is deduplicated');
 assert.deepEqual(Array.from(shelfCalls.at(-1).genres0),['Action','Drama']);
 assert.ok(['Space','Time Travel'].includes(shelfCalls.at(-1).tag0));
 assert.equal(shelfCalls.at(-1).seasonYear0,undefined,'All years sends no year restriction');
 const adultId='browse-filter-'+Buffer.from(JSON.stringify({...filters,tags:['Adult Tag']})).toString('base64url');
 await assert.rejects(api.getDiscoverShelfAnime({shelfId:adultId,hideAdultContent:true}));
 const mangaId='browse-filter-'+Buffer.from(JSON.stringify({...filters,years:[2024],status:'FINISHED'})).toString('base64url');
 const manga=await api.getDiscoverShelfAnime({shelfId:mangaId,mediaType:'MANGA'});
 assert.equal(manga.items.length,1);
 assert.equal(shelfCalls.at(-1).startDate0,'2024%');
 assert.equal(shelfCalls.at(-1).seasonYear0,undefined);
 assert.equal(shelfCalls.at(-1).status0,'FINISHED');
 console.log('PASS: full provider genre list, cache reuse, all genre shelves, anime/manga, genre combinations and adult filtering.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
