// The scenes compare.js plays on both versions. Each scene starts in a fresh browser (no saved home, no cache)
// at 2026-11-20 12:00 JST, and records a checkpoint at every s.snap().
// To add a scene, add { name, run(s) } below; compare.js lists the methods of s.
'use strict';

const SAPPORO = '?lat=43.062&lon=141.354&name=%E6%9C%AD%E5%B9%8C&z=8';
const PLAY_STEP = 120; // ms per frame of the playback

module.exports = [
  // --- Loading ---
  { name: 'load ja', run: async (s) => { await s.open('?lang=ja'); await s.snap('loaded'); } },
  { name: 'load en', locale: 'en-US', run: async (s) => { await s.open('?lang=en'); await s.snap('loaded'); } },
  { name: 'load place URL', run: async (s) => { await s.open(SAPPORO); await s.snap('loaded'); } },
  { name: 'load place URL en', locale: 'en-US', run: async (s) => { await s.open(`${SAPPORO}&lang=en`); await s.snap('loaded'); } },
  // --- Language (#122) ---
  { name: 'browser language en', locale: 'en-US', run: async (s) => { await s.open(SAPPORO); await s.snap('loaded'); } },
  {
    name: 'language switch',
    run: async (s) => {
      await s.open(SAPPORO);
      await s.clickAndReload('.lang-switch [data-lang="en"]');
      await s.snap('switched to en');
    },
  },
  { name: 'load map=ofm', run: async (s) => { await s.open('?lang=ja&map=ofm'); await s.snap('loaded'); } },
  { name: 'load hash URL', run: async (s) => { await s.open('#36.100,138.200'); await s.snap('loaded'); } },
  {
    name: 'hash change',
    run: async (s) => {
      await s.open(SAPPORO);
      await s.setHash('#36.100,138.200');
      await s.advance(300);
      await s.snap('loaded');
    },
  },

  // --- Auto refresh and coming back online (#97, #99) ---
  {
    name: 'back after 2 hours',
    run: async (s) => {
      await s.open(SAPPORO);
      await s.hide();
      await s.advance(2 * 3600000);
      await s.snap('hidden');
      await s.show();
      await s.snap('shown');
    },
  },
  {
    name: 'online after 3 hours',
    run: async (s) => {
      await s.open(SAPPORO);
      await s.slider(40);
      await s.offline();
      await s.advance(3 * 3600000);
      await s.snap('offline');
      await s.online();
      await s.snap('online');
    },
  },
  {
    name: 'first load offline',
    run: async (s) => {
      await s.offline();
      await s.open(SAPPORO);
      await s.snap('failed');
      await s.online();
      await s.snap('online');
    },
  },
  {
    name: 'first load error',
    run: async (s) => {
      s.forecast('error');
      await s.open(SAPPORO);
      await s.snap('failed');
    },
  },
  {
    name: 'refresh fails',
    run: async (s) => {
      await s.open(SAPPORO);
      s.forecast('fail');
      await s.advance(35 * 60000);
      await s.snap('stale');
      s.forecast('ok');
      await s.advance(5 * 60000);
      await s.snap('refreshed');
    },
  },

  // --- Reload button (#108) and a failure at another place (#103) ---
  {
    name: 'reload button',
    run: async (s) => {
      s.forecast('fail');
      await s.open(SAPPORO);
      await s.snap('failed');
      s.forecast('ok');
      await s.click('#retry');
      await s.snap('reloaded');
      s.forecast('fail');
      await s.clickMap();
      await s.advance(300);
      await s.snap('another place fails');
      await s.click('#retry');
      await s.snap('pressed again');
      await s.advance(30000);
      await s.snap('still disabled');
      await s.clickMap(0.4, 0.4);
      await s.snap('another place');
    },
  },
  {
    name: 'another place fails',
    run: async (s) => {
      await s.open(SAPPORO);
      s.forecast('fail');
      await s.clickMap();
      await s.advance(300);
      await s.snap('cleared');
      s.forecast('ok');
      await s.clickMap(0.4, 0.4);
      await s.advance(300);
      await s.snap('loaded again');
    },
  },

  // --- Time controls (#100) ---
  {
    name: 'play and stop',
    run: async (s) => {
      await s.open(SAPPORO);
      await s.click('#play');
      await s.snap('playing');
      await s.advance(PLAY_STEP * 5);
      await s.snap('5 frames');
      await s.click('#play');
      await s.snap('stopped');
      await s.click('#now');
      await s.snap('now');
      await s.slider(50);
      await s.snap('slider');
    },
  },
  {
    name: 'play to the end',
    run: async (s) => {
      await s.open(SAPPORO);
      await s.slider(70);
      await s.click('#play');
      await s.advance(PLAY_STEP * 10);
      await s.snap('stopped at the end');
      await s.click('#play');
      await s.advance(PLAY_STEP);
      await s.snap('from now again');
    },
  },
  {
    name: 'timeline drag',
    run: async (s) => {
      await s.open(SAPPORO);
      await s.click('#play');
      await s.timelineDown(0.5);
      await s.snap('pressed');
      await s.timelineMove(0.7, true);
      await s.snap('dragged');
      await s.timelineUp(0.7);
      await s.timelineMove(0.3, false);
      await s.snap('moved without button');
    },
  },
  {
    name: 'resize',
    run: async (s) => {
      await s.open(SAPPORO);
      await s.resize(700);
      await s.snap('narrow');
    },
  },
  {
    name: 'choose a place while playing',
    run: async (s) => {
      await s.open(SAPPORO);
      await s.click('#play');
      await s.advance(PLAY_STEP * 3);
      await s.clickMap();
      await s.snap('stopped');
      await s.advance(300);
      await s.snap('loaded');
    },
  },

  // --- Map (#101) ---
  {
    name: 'zoom ja',
    run: async (s) => {
      await s.open('?lang=ja');
      await s.click('.leaflet-control-zoom-in');
      await s.snap('zoom in');
      for (let i = 0; i < 3; i++) await s.click('.leaflet-control-zoom-out');
      await s.snap('zoom out 3');
    },
  },
  {
    name: 'zoom map=ofm',
    run: async (s) => {
      await s.open('?lang=ja&map=ofm');
      for (let i = 0; i < 3; i++) await s.click('.leaflet-control-zoom-out');
      await s.snap('zoom out 3');
    },
  },
  {
    name: 'zoom en',
    locale: 'en-US',
    run: async (s) => {
      await s.open(`${SAPPORO}&lang=en`);
      await s.click('.leaflet-control-zoom-in');
      await s.snap('zoom in');
    },
  },
  {
    name: 'choose on the map',
    run: async (s) => {
      await s.open('?lang=ja');
      await s.clickMap();
      await s.snap('chosen');
      await s.advance(300);
      await s.snap('loaded');
    },
  },

  // --- Home place (#108) ---
  {
    name: 'home with a name',
    run: async (s) => {
      await s.open(SAPPORO);
      await s.click('#home-toggle');
      await s.snap('saved');
      await s.open('?bad=1');
      await s.snap('opened');
      await s.click('#home-toggle');
      await s.snap('unset');
    },
  },
  {
    name: 'home without a name',
    run: async (s) => {
      await s.open('#36.100,138.200');
      await s.click('#home-toggle');
      await s.open('');
      await s.snap('opened');
    },
  },

  // --- Place search (#106) ---
  {
    name: 'search and tap the map',
    run: async (s) => {
      await s.open('?lang=ja');
      await s.search('松本');
      await s.snap('results');
      await s.clickMap();
      await s.snap('closed');
      await s.search('松本');
      await s.snap('same name again');
    },
  },
  {
    name: 'tap the map while searching',
    run: async (s) => {
      await s.open('?lang=ja');
      s.hold(() => true);
      await s.search('長野');
      await s.snap('searching');
      await s.clickMap();
      await s.release();
      await s.snap('late results');
    },
  },
  {
    name: 'choose a result',
    run: async (s) => {
      await s.open('?lang=ja');
      await s.search('松本');
      await s.click('#search-results button');
      await s.snap('chosen');
      await s.advance(300);
      await s.snap('loaded');
    },
  },
  {
    name: 'search coordinates',
    run: async (s) => {
      await s.open('?lang=ja');
      await s.search('36.1, 138.2');
      await s.advance(300);
      await s.snap('loaded');
    },
  },
  {
    name: 'search not found',
    run: async (s) => {
      await s.open('?lang=ja');
      await s.search('存在しない地名');
      await s.snap('not found');
    },
  },
  {
    name: 'search fails',
    run: async (s) => {
      await s.open('?lang=ja');
      s.searchSource('fail');
      await s.search('松本');
      await s.snap('error');
    },
  },
  {
    name: 'same name while searching',
    run: async (s) => {
      await s.open('?lang=ja');
      s.hold(() => true);
      await s.search('長野');
      await s.search('長野');
      await s.release();
      await s.snap('sent once');
    },
  },
  {
    name: 'search en',
    locale: 'en-US',
    run: async (s) => {
      await s.open('?lang=en');
      await s.search('Mauna Kea');
      await s.snap('results');
    },
  },
];
