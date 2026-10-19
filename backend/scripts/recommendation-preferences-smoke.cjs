const assert=require('node:assert/strict');
const {fixture}=require('./since-you-liked-smoke');
const {createStagingServer}=require('../atlas/stagingServer');
async function main(){
  const {service,accounts,repo}=fixture();
  assert.equal((await service.preferences(null,{kind:'hidden'})).ok,false);
  for(const request of [{kind:'likes'},{kind:'hidden',page:-1},{kind:'hidden',page:1.2},null])assert.equal((await service.preferences('alice',request)).ok,false);
  for(let id=10;id<32;id++)await service.hide('alice',{mediaType:id%2?'ANIME':'MANGA',mediaId:id,hidden:true});
  await service.hide('bob',{mediaType:'ANIME',mediaId:99,hidden:true});
  for(let id=40;id<61;id++)await service.feedback('alice',{mediaType:'ANIME',sourceMediaId:1,recommendedMediaId:id,feedback:'dislike'});
  await service.feedback('bob',{mediaType:'ANIME',sourceMediaId:1,recommendedMediaId:40,feedback:'dislike'});
  let result=await service.preferences('alice',{kind:'hidden',page:0});
  assert.deepEqual(result.totals,{hidden:22,dislikes:21});
  assert.equal(result.items.length,20);assert.equal(result.hasMore,true);
  assert.ok(result.items.every(item=>item.mediaId!==99));
  assert.equal((await service.preferences('alice',{kind:'hidden',page:1})).items.length,2);
  result=await service.preferences('alice',{kind:'dislikes',page:0});
  assert.equal(result.items[0].sourceMediaId,1);
  assert.ok(!JSON.stringify(result).includes('userId'));
  await service.hide('alice',{mediaType:'MANGA',mediaId:10,hidden:false});
  assert.equal((await service.preferences('alice',{kind:'hidden'})).totals.hidden,21);
  await service.feedback('alice',{mediaType:'ANIME',sourceMediaId:1,recommendedMediaId:40,feedback:null});
  assert.equal((await service.preferences('alice',{kind:'dislikes'})).totals.dislikes,20);
  assert.ok(repo.sinceYouLikedFeedback.rows.some(row=>row.userId==='bob'&&row.recommendedMediaId===40),'other users choices untouched');
  const batches=[];
  const metadata={savedRecommendationCards:async(type,ids)=>{batches.push(ids);return ids.map(id=>({id,type,title:{english:'Title '+id,native:'Native '+id}}));}};
  const server=createStagingServer(accounts,null,null,null,metadata,null,{recommendations:service});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/rpc',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'seenary_atlas_staging=alice'},body:JSON.stringify({method:'getRecommendationPreferences',expectedUserId:'alice',args:[{kind:'dislikes',page:0,hideAdultContent:true}]})});
    const reply=await response.json();
    assert.equal(reply.ok,true);
    assert.equal(reply.items.length,20);
    assert.equal(reply.items[0].source.title.english,'Title 1');
    assert.ok(reply.items[0].media.title.native);
    assert.ok(batches.every(ids=>ids.length<=24),'bounded metadata batches');
  }finally{await new Promise(resolve=>server.close(resolve));}
  console.log('PASS: private preference lists, counts, pagination, pair identity, restoring choices, cross-account isolation, authenticated endpoint and metadata titles.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
