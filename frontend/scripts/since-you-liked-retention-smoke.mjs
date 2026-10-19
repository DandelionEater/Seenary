import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../node_modules/typescript/lib/typescript.js';
const source=fs.readFileSync(new URL('../src/components/HomePage.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('HomePage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['buildPersonalizedRecommendations','selectFavoriteRecommendationMix','hasScoredRecommendationSource','getRecommendationSourceKey','buildGenreWeights','getTasteStrength','getRecommendationSourceTitle','buildRecommendationSource','hasNegativePersonalSignal','getEntryTitle']);
const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text)).map(node=>node.getText(ast)).join('\n');
const js=ts.transpileModule(functions+'\nmodule.exports=buildPersonalizedRecommendations;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const box={module:{exports:{}},getPreferredTitle:title=>title?.english||title?.romaji||'Title',formatEnum:value=>value};
vm.runInNewContext(js,box);
const build=box.module.exports;
const sourceEntry={anime_id:1,is_favorite:true,status:'completed',score:10,genres:['Action'],title_english:'Source',recommendations:Array.from({length:8},(_,i)=>({rating:80,mediaRecommendation:{id:10+i,type:'ANIME',title:{english:'Title '+i},averageScore:75,genres:['Action']}}))};
const options={favoriteSourcesOnly:true,mediaType:'ANIME',retainedIds:new Set([10])};
for(const status of ['planned','watching','paused','completed']) {
  const result=build([sourceEntry,{anime_id:10,status}], 'english', options);
  assert.equal(result[0].animeId,10,'retain suggested title while '+status);
}
assert.ok(!build([sourceEntry,{anime_id:10,status:'dropped'}],'english',options).some(item=>item.animeId===10),'drop removes suggestion');
assert.ok(!build([sourceEntry,{anime_id:10,status:'completed'}],'english',{...options,retainedIds:new Set()}).some(item=>item.animeId===10),'unseen historical completions stay excluded');
assert.ok(!build([sourceEntry],'english',{...options,hiddenIds:new Set([10])}).some(item=>item.animeId===10),'Not Interested removes suggestion');
assert.ok(!build([sourceEntry],'english',{...options,feedback:{'1:10':{sinceYouLikedFeedback:'like'}}}).some(item=>item.animeId===10),'explicit reaction replaces suggestion');
assert.ok(build([sourceEntry,{anime_id:10,status:'planned'}],'english',options).some(item=>item.animeId===10),'adding to library does not replace suggestion');
console.log('PASS: renderer retention for planned/watching/paused/completed, drops, history, explicit reactions and Not Interested.');
