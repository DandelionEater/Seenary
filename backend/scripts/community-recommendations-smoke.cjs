const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture } = require('./since-you-liked-smoke');
const { Collection } = require('./atlas-metadata-smoke');
const { createMetadataService } = require('../atlas/metadata');
const { createStagingServer } = require('../atlas/stagingServer');
async function main() {
  const { service, accounts } = fixture();
  const request = { mediaType:'ANIME', sourceMediaId:1, hideAdultContent:true };
  assert.equal((await service.community(null,request)).ok,false);
  assert.equal((await service.community('alice',{...request,mediaType:'BOOK'})).ok,false);
  assert.equal((await service.community('alice',null)).ok,false);
  assert.deepEqual((await service.community('alice',request)).items,[]);
  for(const [user,id] of [['a',10],['b',10],['c',11],['d',12],['e',13],['f',14]]) {
    await service.feedback(user,{mediaType:'ANIME',sourceMediaId:1,recommendedMediaId:id,feedback:'like'});
  }
  await service.feedback('disliker',{mediaType:'ANIME',sourceMediaId:1,recommendedMediaId:15,feedback:'dislike'});
  await service.feedback('critic',{mediaType:'ANIME',sourceMediaId:1,recommendedMediaId:10,feedback:'dislike'});
  await service.feedback('a',{mediaType:'MANGA',sourceMediaId:1,recommendedMediaId:20,feedback:'like'});
  const ranked=await service.community('alice',request);
  assert.deepEqual(ranked.items.map(item=>[item.mediaId,item.recommendations]),[[10,2],[11,1],[12,1],[13,1],[14,1]]);
  assert.equal(ranked.items[0].dislikes,1);
  assert.equal(ranked.items[1].dislikes,0);
  assert.ok(!JSON.stringify(ranked).includes('userId'),'only aggregates are exposed');
  assert.equal((await service.community('alice',{...request,sourceMediaId:99})).items.length,0);
  assert.equal((await service.community('alice',{...request,mediaType:'MANGA'})).items[0].mediaId,20);
  const catalog=new Collection();
  for(const id of [10,11,12,13,14]) catalog.rows.push({_id:'anime:'+id,type:'ANIME',anilistId:id,metadata:{title_english:'Title '+id,is_adult:id===14},sources:{anilist:{}}});
  const metadata=createMetadataService({repo:{media:catalog},queries:new Collection(),provider:{},media:{}});
  assert.equal((await metadata.savedRecommendationCards('ANIME',[10,14],true)).length,1);
  assert.equal((await metadata.savedRecommendationCards('ANIME',[10,14],false)).length,2);
  assert.equal((await metadata.savedRecommendationCards('MANGA',[10],false)).length,0);
  const server=createStagingServer(accounts,null,null,null,metadata,null,{recommendations:service});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const rpc=async cookie=>fetch('http://127.0.0.1:'+server.address().port+'/rpc',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({method:'getCommunityRecommendations',args:[request]})});
    const result=await (await rpc('seenary_atlas_staging=alice')).json();
    assert.equal(result.ok,true);
    assert.equal(result.items.length,4,'adult filtering precedes display count');
    assert.equal(result.items[0].recommendations,2);
    assert.equal(result.items[0].dislikes,1,'dislike count reaches title details');
    assert.equal(result.items[0].media.title.english,'Title 10');
    assert.equal((await (await rpc('')).json()).ok,false);
  } finally { await new Promise(resolve=>server.close(resolve)); }
  const ui=fs.readFileSync(require('node:path').join(__dirname,'../../frontend/src/components/AnimeDetails.tsx'),'utf8');
  assert.match(ui,/if \(!items.length\) return null/);
  assert.match(ui,/cards.slice\(0, 4\)/);
  assert.match(ui,/Show all \$\{cards.length\}/);
  console.log('PASS: community counts, descending order, medium/source isolation, empty data, aggregate privacy, adult filtering, authenticated RPC and four-card expansion.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
