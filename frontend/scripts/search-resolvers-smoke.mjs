import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let filter;
function walk(node) {
 if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'filteredQueryResults') filter = node.initializer.getText(ast);
 ts.forEachChild(node, walk);
}
walk(ast);
const start = source.indexOf('        const matchTypes: SearchMatchType[] = [];');
const end = source.indexOf('        setActiveSearchResolution(', start);
const merge = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'mergeMediaSearchResults').getText(ast);
const code = ts.transpileModule('function resolve(activeResults) {' + source.slice(start, end) + 'return matchTypes;} function filterResults(queryResults, matchTypeFilters, queries) { const normalizeSearchTerm = value => value.toLowerCase(); return ' + filter + '; }' + merge, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const context = vm.createContext({});vm.runInContext(code, context);
const tag = { anime: [{id:1,type:'ANIME'}], manga:[], characters:[], tags:[{id:2,type:'ANIME'},{id:2,type:'MANGA'}],genres:[] };
assert.deepEqual(Array.from(context.resolve(tag)),['ANIME','TAG'],'tag match offers Tag without Genre');
const selected = context.filterResults([tag],new Map([['yandere',['TAG']]]),['Yandere'])[0];
assert.equal(selected.anime.length,0);assert.equal(selected.tags.length,2);assert.equal(selected.genres.length,0);
const merged = context.mergeMediaSearchResults([selected,selected]);
assert.equal(merged.tags.length,2,'same ID in anime and manga is kept; repeated matches deduplicate');
assert.equal(merged.anime.length,0);
assert.deepEqual(Array.from(context.resolve({...tag,anime:[],tags:[],genres:[{id:3,type:'MANGA'}]})),['GENRE']);
const legacy = context.mergeMediaSearchResults([{anime:[],manga:[]}]);assert.equal(legacy.tags.length,0);assert.equal(legacy.genres.length,0);
console.log('PASS: matching Genre/Tag resolvers, committed type isolation, mixed-media taxonomy results, deduplication and legacy responses.');
