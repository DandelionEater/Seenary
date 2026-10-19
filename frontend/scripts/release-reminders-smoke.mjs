import assert from 'node:assert/strict';
import ts from '../node_modules/typescript/lib/typescript.js';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const dir = await mkdtemp(join(tmpdir(), 'seenary-reminders-'));
try {
  const output = join(dir, 'reminders.mjs');
  for (const name of ['titlePreference','releaseReminders','releaseReminderSettings']) {
    const source = await readFile(new URL('../src/utils/'+name+'.ts',import.meta.url),'utf8');
    const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("'./titlePreference'", "'./titlePreference.mjs'");
    await writeFile(join(dir,name==='releaseReminders'?'reminders.mjs':name+'.mjs'),js);
  }
  const { collectReleaseReminders: collect } = await import(pathToFileURL(output));
  const now = Date.now();
  const entry = { anime_id: 7, status: 'watching', progress: 1, title_english: 'English', title_native: 'Native' };
  const item = { media: { id: 7 }, airingAt: (now + 60 * 60000) / 1000, episode: 2 };
  assert.equal(collect([entry], [item], 'native', now)[0].title, 'Native');
  assert.equal(collect([{...entry, status:'planned'}], [item], 'english', now).length, 1);
  for (const patch of [{status:'completed'}, {status:'paused'}, {hidden_by_adult_filter:true}, {progress:2}]) {
    assert.equal(collect([{...entry,...patch}], [item], 'english', now).length, 0);
  }
  assert.equal(collect([entry], [{...item,airingAt:(now+16*60000)/1000}], 'english', now).length, 0);
  assert.equal(collect([entry], [item,item], 'english', now).length, 1);
  assert.equal(collect([{...entry,next_airing_at:item.airingAt,next_airing_episode:2}], [], 'english', now).length, 1);
  assert.equal(collect([{...entry, media_type:'MANGA', manga_id:7}], [item], 'english', now).length, 0);
  const tomorrow = new Date(now+86400000);
  const publicationTime = new Date(tomorrow.getFullYear(),tomorrow.getMonth(),tomorrow.getDate()).getTime();
  const manga = collect([{...entry,media_type:'MANGA',manga_id:7}], [{media:{id:7},date:{year:tomorrow.getFullYear(),month:tomorrow.getMonth()+1,day:tomorrow.getDate()}}], 'english', publicationTime-86400000, [1440]);
  assert.equal(manga.length,1);
  assert.match(manga[0].message,/unavailable/);
  for (const minutes of [1440,720,360,60,30,15,0]) {
    const scheduled = {...item,airingAt:(now+minutes*60000)/1000};
    const notices = collect([entry],[scheduled],'english',now,[minutes]);
    assert.equal(notices.length,1,'selected timing '+minutes);
    assert.ok(notices[0].key.endsWith(':'+minutes));
    assert.equal(collect([entry],[scheduled],'english',now,[]).length,0,'empty selection disables reminders');
    assert.equal(collect([entry],[scheduled],'english',now-1000,[minutes]).length,0,'never send early');
    assert.equal(collect([entry],[scheduled],'english',now+121000,[minutes]).length,0,'do not replay stale timings');
  }
  const early = collect([entry],[{...item,airingAt:(now+3600000)/1000}],'english',now,[1440,720,360,60,30,15,0]);
  assert.equal(early.length,1,'multiple choices do not create catch-up bursts');
  const atRelease = collect([entry],[{...item,airingAt:now/1000}],'english',now,[0]);
  assert.notEqual(early[0].key,atRelease[0].key,'independent dedup keys for each selected timing');
  for (const minutes of [1440,720,360,60,30,15,0]) {
    const notices=collect([{...entry,media_type:'MANGA',manga_id:7}],[{media:{id:7},date:{year:tomorrow.getFullYear(),month:tomorrow.getMonth()+1,day:tomorrow.getDate()}}],'english',publicationTime-minutes*60000,[minutes]);
    assert.equal(notices.length,1,'manga timing '+minutes);
    assert.match(notices[0].message,/Publication date begins/);
    assert.match(notices[0].message,/Exact chapter release times are unavailable/);
  }
  const require=createRequire(import.meta.url);
  const { normalizeReminderGroups } = await import(pathToFileURL(join(dir,'releaseReminderSettings.mjs')));
  const groups = normalizeReminderGroups(null, [60, 15, 0]);
  assert.deepEqual(groups.premieres.minutes,[60,15,0],'migrate existing selected times');
  assert.deepEqual(groups.manga.minutes,[60,15,0],'manga supports matching timing choices');
  groups.episodes.enabled=false;
  assert.equal(collect([entry],[item],'english',now,[],groups).length,0,'disable ordinary episodes independently');
  assert.equal(collect([{...entry,progress:0}],[{...item,episode:1}],'english',now,[],groups).length,1,'premieres stay enabled');
  groups.premieres.minutes=[15];
  assert.equal(collect([{...entry,progress:0}],[{...item,episode:1}],'english',now,[],groups).length,0,'premiere timings are independent');
  assert.equal(collect([{...entry,episodes:2}],[item],'english',now,[],groups).length,1,'finales stay enabled without episode reminders');
  groups.finales.enabled=false;
  assert.equal(collect([{...entry,episodes:2}],[item],'english',now,[],groups).length,0,'disabled finale does not fall back to episode reminder');
  assert.deepEqual(normalizeReminderGroups({premieres:{enabled:false,minutes:[15,15,-1]}}).premieres,{enabled:false,minutes:[15]},'normalize saved category choices');
  const first = {...entry, progress:0, episodes:12};
  assert.equal(collect([first],[{...item,episode:1}],'english',now,[60])[0].message,'Starts airing in 1 hour.');
  assert.equal(collect([first],[{...item,episode:1,airingAt:now/1000}],'english',now,[0])[0].message,'Just started airing.');
  assert.equal(collect([first],[{...item,episode:12}],'english',now,[60])[0].message,'Final episode airs in 1 hour.');
  assert.equal(collect([first],[{...item,episode:12,airingAt:now/1000}],'english',now,[0])[0].message,'Just finished airing.');
  const calendarFinal = {...item,episode:12,airingAt:now/1000,media:{id:7,episodes:12}};
  const fallbackEntry = {...entry,next_airing_at:now/1000,next_airing_episode:12};
  const finalNotices = collect([fallbackEntry],[calendarFinal],'english',now,[0]);
  assert.equal(finalNotices.length,1,'milestone replaces episode reminder');
  assert.equal(finalNotices[0].message,'Just finished airing.','calendar episode total survives fallback deduplication');
  assert.match(collect([entry],[{...item,episode:12,airingAt:now/1000}],'english',now,[0])[0].message,/Episode 12/,'unknown totals cannot imply a finale');
  const {validateNotice}=require('../../backend/releaseNotifications.js');
  assert.equal(validateNotice({id:-1,type:'ANIME',title:'X',message:'X'}),null);
  assert.equal(validateNotice({id:1,type:'ANIME',title:'X',message:'X',cover:'javascript:alert(1)'}).cover,null);
  const pkg=require('../../backend/package.json'), lock=require('../../backend/package-lock.json');
  assert.match(pkg.version,/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/); assert.equal(lock.version,pkg.version);
  const settings=await readFile(new URL('../src/components/SettingsPage.tsx',import.meta.url),'utf8');
  assert.match(settings,/IS_DEVELOPER_BUILD && <div ref={rememberSectionRef\("developer"\)}/);
  assert.match(settings,/__APP_VERSION__\.endsWith\('-dev'\)/);
  console.log('Release reminder timing, eligibility, language, validation and developer gating passed.');
} finally { await rm(dir,{recursive:true,force:true}); }
