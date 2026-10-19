import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/components/HomePage.tsx'), 'utf8');
const ast = ts.createSourceFile('HomePage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['DiscoverPresetPanel','DiscoverPeriodSelect','SinceYouLikedSection', 'SinceYouLikedPairCard', 'SmallInfoPill', 'buildPersonalizedRecommendations',
  'selectFavoriteRecommendationMix', 'hasScoredRecommendationSource', 'getRecommendationSourceKey', 'buildGenreWeights',
  'getTasteStrength', 'getRecommendationSourceTitle', 'buildRecommendationSource', 'getRecommendationSummary', 'stripHtml',
  'hasNegativePersonalSignal', 'getEntryTitle', 'formatCompactMediaFormat', 'getSmallInfoPillTone', 'getSmallInfoPillIconTone']);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(ast)).join('\n');
const local = file => JSON.stringify(path.join(root, 'src', file).replaceAll('\\', '/'));
const genrePresets = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === 'DISCOVER_GENRE_PRESETS')).getText(ast);
const fixture = `
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronDownIcon, CheckIcon, SparklesIcon, CheckCircleIcon, PlayCircleIcon, MagnifyingGlassIcon, ArrowTrendingUpIcon, ArrowRightIcon, ArrowPathIcon, BookOpenIcon, TvIcon, StarIcon, PlusIcon, NoSymbolIcon, HandThumbUpIcon, HandThumbDownIcon, ClockIcon, CalendarDaysIcon, HeartIcon, FireIcon, BookmarkIcon } from '@heroicons/react/24/outline';
import { createBrowseShelfId } from ${local('utils/discoverBrowseFilters.ts')};
import { DiscoverGenres } from ${local('components/DiscoverGenres.tsx')};
import { RecommendationPreferences } from ${local('components/RecommendationPreferences.tsx')};
import { useSinceYouLiked } from ${local('hooks/useSinceYouLiked.ts')};
import { Tooltip } from ${local('components/ui/Tooltip.tsx')};
import { recommendationPairKey } from ${local('types/sinceYouLiked.ts')};
import { getPreferredTitle } from ${local('utils/titlePreference.ts')};
import { formatEnum, formatScore10 } from ${local('utils/mediaFormatting.ts')};
import ${local('index.css')};
${genrePresets}
${functions}
window.scoreRecommendations = buildPersonalizedRecommendations;
const root = createRoot(document.getElementById('root'));
window.renderFixture = (entries, mediaType = 'ANIME', account = 'alice') => root.render(
  <div style={{ maxWidth: 1200, margin: 'auto', padding: 24 }}>
    <SinceYouLikedSection key={account + mediaType} entries={entries} mediaType={mediaType} titleLanguage="english" onSelectMedia={id => window.openedMedia = id} />
  </div>
);
window.preferenceCounts = null;
const onPreferenceCounts = counts => { window.preferenceCounts = counts; };
window.renderPreferences = () => root.render(<div style={{maxWidth:900,margin:'auto',padding:24}}><RecommendationPreferences titleLanguage='native' hideAdultContent={true} onCounts={onPreferenceCounts} /></div>);
window.renderGenres = () => root.render(<div style={{maxWidth:600,padding:20}}><DiscoverGenres initialGenres={['Action','Adventure','Comedy','Drama','Fantasy','Mystery','Romance','Sci-Fi','Slice of Life']} hideAdultContent={true} disabled={false} onSelect={name=>window.selectedGenre=name} /></div>);
window.renderBrowse = (type = 'ANIME') => root.render(<div style={{maxWidth:1000,padding:20}}><DiscoverPresetPanel key={type} mediaType={type} hideAdultContent={true} disabled={false} onSelect={shelf=>window.selectedShelf=shelf} onOpenCalendar={()=>{}} /></div>);
window.fixtureReady = true;
`;
const outDir = path.join(root, 'node_modules/.cache/since-liked-fixture');
const fixtureId = path.join(root, '__since-liked-fixture.tsx').replaceAll('\\', '/');
await build({ configFile: false, root, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'since-liked-fixture',
  resolveId(id) { if (id.endsWith('__since-liked-fixture.tsx')) return fixtureId; },
  load(id) { if (id === fixtureId) return fixture; },
}], build: { outDir, emptyOutDir: true, lib: { entry: fixtureId, name: 'SinceLikedFixture', formats: ['iife'], fileName: () => 'fixture.js' } } });
