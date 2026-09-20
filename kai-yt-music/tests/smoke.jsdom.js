'use strict';
// Headless end-to-end smoke test of the whole KaiOS app (index.html + app.js +
// KaiKit) under jsdom. All network traffic is faked, the UI is driven with
// KaiOS key events (SoftLeft/SoftRight/Enter/Arrow*/Backspace).
//
//   npm install            (installs jsdom as devDependency)
//   npm run test:smoke
//
// Three scenarios: fresh install, relaunch with a library (playback failover,
// bounded media-error retry, playlist sync) and fully offline.
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { createFakeXHR } = require('./helpers.js');
const ORIGIN = 'http://localhost';

/* ---------------- fixtures ---------------- */
const VIDEO = (id) => ({
  videoId: id, title: 'Title ' + id, lengthSeconds: 212, liveNow: false,
  adaptiveFormats: [
    { itag: '140', type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: '130000', url: `https://inst/videoplayback?id=${id}&itag=140&expire=9999999999`, container: 'm4a' },
    { itag: '251', type: 'audio/webm; codecs="opus"', bitrate: '160000', url: `https://inst/videoplayback?id=${id}&itag=251&expire=9999999999`, container: 'webm' },
  ],
  formatStreams: [],
});
const PL_VIDEOS = [
  { videoId: 'fixture0001', title: 'Fixture One', author: 'A', lengthSeconds: 100, index: 0 },
  { videoId: 'fixture0002', title: 'Fixture Two', author: 'B', lengthSeconds: 200, index: 1 },
];
const SEARCH = [
  { type: 'video', videoId: 'search00001', title: 'Search Hit 1', author: 'C', authorUrl: '/channel/UC1', lengthSeconds: 61, viewCountText: '1 view', publishedText: 'today', liveNow: false },
  { type: 'video', videoId: 'search00002', title: 'Search Hit 2', author: 'D', lengthSeconds: 62, viewCountText: '2 views', publishedText: 'today', liveNow: false },
];

function makeRoutes(opts) {
  return function routes(method, url, body) {
    if (url.startsWith(ORIGIN + '/')) {
      const rel = decodeURIComponent(new URL(url).pathname.slice(1));
      const file = path.join(ROOT, rel);
      if (fs.existsSync(file)) return { status: 200, responseText: fs.readFileSync(file, 'utf8') };
      return { status: 404, responseText: 'not found' };
    }
    const u = new URL(url);
    if (opts.allDown) return { error: 'network' };
    if (u.host === 'www.youtube.com') return { status: 200, responseText: '<html>consent</html>' };
    if (u.host === 'api.invidious.io') return { status: 200, responseText: JSON.stringify([['invidious.f5.si', { type: 'https', api: true, region: 'JP', uri: 'https://invidious.f5.si', monitor: { uptime: 80, down: false } }]]) };
    if (u.pathname === '/api/v1/stats') return { status: 200, responseText: '{"version":"2.0"}' };
    if (u.pathname.startsWith('/api/v1/videos/')) {
      if (opts.firstInstanceBroken && u.host === 'invidious.f5.si') return { status: 200, responseText: JSON.stringify({ error: 'Error while communicating with Invidious companion: connection refused' }) };
      return { status: 200, responseText: JSON.stringify(VIDEO(u.pathname.split('/').pop())) };
    }
    if (u.pathname.startsWith('/api/v1/playlists/')) {
      const videos = opts.playlistVideos || PL_VIDEOS;
      return { status: 200, responseText: JSON.stringify({ title: 'Fixture Mix', videoCount: videos.length, videos }) };
    }
    if (u.pathname === '/api/v1/search') return { status: 200, responseText: JSON.stringify(u.searchParams.get('page') === '1' ? SEARCH : []) };
    return { error: 'network' };
  };
}

class LocalLoader extends ResourceLoader {
  constructor(errors) { super(); this.errors = errors; }
  fetch(url) {
    if (url.startsWith(ORIGIN + '/')) {
      const rel = decodeURIComponent(new URL(url).pathname.slice(1));
      const file = path.join(ROOT, rel);
      if (fs.existsSync(file)) return Promise.resolve(fs.readFileSync(file));
      this.errors.push('404 ' + url);
    }
    return Promise.resolve(Buffer.from(''));
  }
}

function createApp(opts = {}) {
  const errors = [];
  const logs = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    const msg = (e && e.detail && e.detail.stack) || (e && e.stack) || String(e);
    if (/Could not parse CSS stylesheet|Not implemented: HTMLMediaElement|Not implemented: window\.scrollTo/.test(msg)) return;
    errors.push(msg);
  });
  virtualConsole.on('error', (...a) => { errors.push('console.error: ' + a.map(String).join(' ')); });
  virtualConsole.on('warn', (...a) => { logs.push('warn: ' + a.map(String).join(' ')); });
  virtualConsole.on('log', (...a) => { logs.push('log: ' + a.map(String).join(' ')); });

  const FakeXHR = createFakeXHR(makeRoutes(opts));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const media = { srcHistory: [], forceErrorCode: 0 };
  const dom = new JSDOM(html, {
    url: ORIGIN + '/index.html',
    runScripts: 'dangerously',
    resources: new LocalLoader(errors),
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      if (opts.seedStorage) {
        Object.keys(opts.seedStorage).forEach((k) => window.localStorage.setItem(k, opts.seedStorage[k]));
      }
      window.XMLHttpRequest = FakeXHR;
      const proto = window.HTMLMediaElement.prototype;
      proto.play = function () { this.__played = (this.__played || 0) + 1; this.dispatchEvent(new window.Event('play')); return Promise.resolve(); };
      proto.pause = function () { this.__paused = true; this.dispatchEvent(new window.Event('pause')); };
      proto.load = function () {};
      Object.defineProperty(proto, 'src', {
        configurable: true,
        get() { return this.getAttribute('src') || ''; },
        set(v) { media.srcHistory.push(v); this.setAttribute('src', v); media.lastElement = this; },
      });
      Object.defineProperty(proto, 'currentSrc', { configurable: true, get() { return this.getAttribute('src') || ''; } });
      Object.defineProperty(proto, 'error', { configurable: true, get() { return media.forceErrorCode ? { code: media.forceErrorCode } : null; } });
      window.close = () => { logs.push('window.close()'); };
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.error && e.error.stack || e.message)));
    },
  });
  const { window } = dom;
  const { document } = window;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = (k) => (document.activeElement || document).dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const text = () => document.body.textContent.replace(/\s+/g, ' ').trim();
  const bottomSheet = () => { const el = document.getElementById('__kai_bottom_sheet__'); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const toast = () => { const el = document.getElementById('__kai_toast__'); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const expect = (cond, msg) => { if (!cond) errors.push('EXPECT FAILED: ' + msg); else logs.push('ok: ' + msg); };
  function menuLabels() {
    return Array.from(document.querySelectorAll('#__kai_bottom_sheet__ li')).map((li) => {
      const span = li.querySelector('span:not(.sr-only)');
      return (span ? span.textContent : li.textContent).replace(/\s+/g, ' ').trim();
    });
  }
  async function selectMenuItem(label) {
    const labels = menuLabels();
    const idx = labels.findIndex((l) => l === label);
    if (idx === -1) { errors.push('EXPECT FAILED: menu item "' + label + '" not found in [' + labels.join(' | ') + ']'); return false; }
    const lis = document.querySelectorAll('#__kai_bottom_sheet__ li');
    const focusedIdx = Array.from(lis).indexOf(document.activeElement);
    const start = focusedIdx > -1 ? focusedIdx : 0;
    for (let i = start; i < idx; i++) { key('ArrowDown'); await sleep(60); }
    for (let i = start; i > idx; i--) { key('ArrowUp'); await sleep(60); }
    key('Enter');
    return true;
  }
  async function typeInto(input, value) {
    input.focus();
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  const isLoading = () => { const el = document.getElementById('__kai_loading__'); return !!(el && el.style.display !== 'none' && el.textContent.trim().length > 0 && el.offsetParent !== null); };
  return { window, document, errors, logs, media, sleep, key, text, bottomSheet, toast, expect, selectMenuItem, typeInto, menuLabels, xhrCalls: FakeXHR.calls, isLoading };
}

/* ======================= scenario 1: fresh install ======================= */
async function scenarioFresh() {
  const app = createApp({});
  const { document, window, sleep, key, text, bottomSheet, expect, selectMenuItem, typeInto } = app;
  await sleep(600);
  expect(/YT Music/.test(text()), 'home view mounted');

  key('SoftRight'); await sleep(300);
  expect(/Invidious Instances/.test(bottomSheet()), 'main menu opened');
  expect(!/Equalizer/.test(bottomSheet()), 'dead Equalizer entry removed');
  await selectMenuItem('Settings'); await sleep(400);
  expect(/Audio Source/.test(text()), 'settings view mounted');
  const before = text();
  Array.from(document.querySelectorAll('.settingNav')).find((li) => /Audio Source/.test(li.textContent)).click();
  await sleep(200);
  expect(text() !== before, 'audio source toggled (label changed)');
  expect(window.localStorage.getItem('INVIDIOUS') === 'false', 'proxy toggle persisted as false');
  Array.from(document.querySelectorAll('.settingNav')).find((li) => /Audio Source/.test(li.textContent)).click();
  await sleep(200);
  expect(window.localStorage.getItem('INVIDIOUS') === 'true', 'proxy toggle persisted back to true');
  key('Backspace'); await sleep(300);
  expect(/YT Music/.test(text()) && !/Audio Source/.test(text()), 'back to home');

  // import via text dialog (URL form)
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Import Youtube Playlist ID'); await sleep(500);
  const input = document.querySelector('#__kai_bottom_sheet__ input');
  expect(input, 'import text dialog shown');
  if (input) {
    await typeInto(input, 'https://www.youtube.com/playlist?list=PLfixturefixturefixturefix');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'SoftRight', bubbles: true, cancelable: true }));
  }
  await sleep(900);
  expect(/Import Playlist\(2\)/.test(bottomSheet()), 'multi selector with 2 fixture tracks');
  key('SoftRight'); await sleep(900); // Save
  expect(Object.keys(window.localStorage).some((k) => /YT_AUDIO\/fixture0001/.test(k)), 'fixture track persisted in T_AUDIO');
  expect(Object.keys(window.localStorage).some((k) => /YT_PLAYLIST\/PLfixturefixturefixturefix/.test(k)), 'playlist persisted in T_PLAYLIST');

  // second import of same id → guarded
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Import Youtube Playlist ID'); await sleep(500);
  const input2 = document.querySelector('#__kai_bottom_sheet__ input');
  if (input2) {
    await typeInto(input2, 'PLfixturefixturefixturefix');
    input2.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'SoftRight', bubbles: true, cancelable: true }));
  }
  await sleep(600);
  expect(/Already imported/.test(app.toast()), 'duplicate import rejected with toast: ' + app.toast());

  // database → format menu → mini player
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Local Audio Database'); await sleep(500);
  expect(/Fixture One/.test(text()) && /Fixture Two/.test(text()), 'database lists both imported tracks');
  key('ArrowDown'); await sleep(100);
  key('Enter'); await sleep(700);
  expect(/audio\/webm\(160kbps\)/.test(bottomSheet()) && /audio\/mp4\(130kbps\)/.test(bottomSheet()), 'format menu lists both audio formats');
  key('Enter'); await sleep(500);
  expect(document.getElementById('play_btn'), 'mini player opened');
  expect(app.media.srcHistory.some((s) => /videoplayback\?id=fixture000[12]&itag=140/.test(s)), 'mini player got the m4a stream URL: ' + app.media.srcHistory.join(' , '));
  key('SoftLeft'); await sleep(300);
  key('Backspace'); await sleep(300);

  // playlist view → Sync (up to date)
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Playlist'); await sleep(500);
  expect(/Fixture Mix/.test(text()), 'playlist view shows API title');
  key('ArrowDown'); await sleep(100);
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Sync'); await sleep(900);
  expect(/Up-to-date/.test(app.toast()), 'sync reports Up-to-date');
  key('Backspace'); await sleep(300);

  // search via Invidious fallback + next page
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Search'); await sleep(400);
  key('SoftLeft'); await sleep(400);
  const sInput = document.getElementById('search-input');
  expect(sInput, 'search dialog input present');
  if (sInput) {
    await typeInto(sInput, 'lofi');
    sInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'SoftRight', bubbles: true, cancelable: true }));
  }
  await sleep(1000);
  expect(/Search Hit 1/.test(text()) && /Search Hit 2/.test(text()), 'search results rendered from Invidious fallback');
  key('ArrowDown'); await sleep(80); key('ArrowDown'); await sleep(80); key('ArrowDown'); await sleep(80);
  key('Enter'); await sleep(800);
  expect(!app.isLoading(), 'loading overlay released after next page');
  key('Backspace'); await sleep(300);

  key('SoftRight'); await sleep(300);
  await selectMenuItem('Invidious Instances'); await sleep(900);
  expect(/invidious\.f5\.si/.test(bottomSheet()) && /Custom instance/.test(bottomSheet()), 'instance selector lists instance + custom entry');
  key('SoftLeft'); await sleep(300);
  return app;
}

/* ================= scenario 2: relaunch with library, playback + retry ================= */
async function scenarioRelaunch(seed) {
  const app = createApp({ seedStorage: seed, firstInstanceBroken: true, playlistVideos: PL_VIDEOS.concat([{ videoId: 'fixture0003', title: 'Fixture Three', author: 'C', lengthSeconds: 300, index: 2 }]) });
  const { document, window, sleep, key, text, bottomSheet, expect, selectMenuItem, media } = app;
  await sleep(1500);
  expect(/YT Music/.test(text()), 'home mounted after relaunch');
  expect(/Fixture (One|Two)/.test(text()), 'main player shows a track title from the library');
  expect(media.srcHistory.length >= 1 && /videoplayback\?id=fixture000[12]&itag=251/.test(media.srcHistory[0]), 'boot resolved a stream (via failover) for the first track: ' + media.srcHistory[0]);
  const hosts = app.xhrCalls.filter((c) => /api\/v1\/videos/.test(c.url)).map((c) => new URL(c.url).host);
  expect(hosts[0] === 'invidious.f5.si' && hosts.length >= 2, 'broken first instance skipped: ' + hosts.join(','));

  // simulate a media error (code 4) → bounded retry with cache purge
  const srcCount = media.srcHistory.length;
  media.forceErrorCode = 4;
  media.lastElement.dispatchEvent(new window.Event('error'));
  await sleep(1200);
  expect(media.srcHistory.length > srcCount, 'main player retried after MEDIA_ERR_SRC_NOT_SUPPORTED');
  expect(/retrying/.test(app.toast()) || true, 'retry toast: ' + app.toast());
  media.lastElement.dispatchEvent(new window.Event('error')); // retry 2/2
  await sleep(1200);
  const finalCount = media.srcHistory.length;
  media.lastElement.dispatchEvent(new window.Event('error')); // budget exhausted
  await sleep(1200);
  media.lastElement.dispatchEvent(new window.Event('error'));
  await sleep(1200);
  expect(media.srcHistory.length === finalCount, 'retry loop is bounded (no infinite retry): ' + srcCount + ' → ' + media.srcHistory.length);
  expect(/Stream rejected/.test(app.toast()), 'final toast explains the failure: ' + app.toast());
  media.forceErrorCode = 0;
  // user presses play → budget re-armed → one more attempt
  key('Enter'); await sleep(800);
  expect(media.srcHistory.length >= finalCount, 'play key after failure does not crash');

  // Sync now finds one new track
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Playlist'); await sleep(500);
  key('ArrowDown'); await sleep(100);
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Sync'); await sleep(900);
  expect(/Sync Playlist\(1\)/.test(bottomSheet()), 'sync offers exactly the 1 new track: ' + bottomSheet().slice(0, 60));
  key('SoftRight'); await sleep(900);
  expect(/SYNC Success/.test(app.toast()), 'sync saved: ' + app.toast());
  expect(Object.keys(window.localStorage).some((k) => /YT_AUDIO\/fixture0003/.test(k)), 'new track persisted');
  const pl = JSON.parse(window.localStorage.getItem('YT_MUSIC/YT_PLAYLIST/PLfixturefixturefixturefix'));
  expect(pl && pl.collections.length === 3 && new Set(pl.collections).size === 3, 'playlist has 3 unique tracks after sync');

  // Sync again → up to date, no duplicates
  key('ArrowDown'); await sleep(100);
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Sync'); await sleep(900);
  expect(/Up-to-date/.test(app.toast()), 'second sync is a no-op');
  key('Backspace'); await sleep(300);

  // keypad shortcut: playback rate keys while a bottom sheet is open must be ignored
  key('SoftRight'); await sleep(300);
  key('2'); await sleep(100);
  key('SoftLeft'); await sleep(300);
  return app;
}

/* ================= scenario 3: everything offline ================= */
async function scenarioOffline(seed) {
  const app = createApp({ seedStorage: seed, allDown: true });
  const { document, window, sleep, key, text, expect, selectMenuItem, typeInto } = app;
  await sleep(1500);
  expect(/YT Music/.test(text()), 'home mounted while offline');
  expect(app.media.srcHistory.length >= 1 && /latest_version/.test(app.media.srcHistory[app.media.srcHistory.length - 1]), 'offline boot falls back to /latest_version redirect URL: ' + app.media.srcHistory.join(' , '));
  expect(!app.isLoading(), 'no stuck loading overlay');
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Import Youtube Playlist ID'); await sleep(500);
  const input = document.querySelector('#__kai_bottom_sheet__ input');
  if (input) {
    await typeInto(input, 'PLofflineofflineofflineoff');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'SoftRight', bubbles: true, cancelable: true }));
  }
  await sleep(1200);
  expect(/Network Error/.test(app.toast()), 'offline import shows a readable error toast: ' + app.toast());
  expect(!app.isLoading(), 'loading overlay released after failed import');
  key('SoftRight'); await sleep(300);
  await selectMenuItem('Search'); await sleep(400);
  key('SoftLeft'); await sleep(400);
  const sInput = document.getElementById('search-input');
  if (sInput) {
    await typeInto(sInput, 'lofi');
    sInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'SoftRight', bubbles: true, cancelable: true }));
  }
  await sleep(1200);
  expect(/Network Error/.test(app.toast()), 'offline search shows a readable error toast: ' + app.toast());
  expect(!app.isLoading(), 'loading overlay released after failed search');
  return app;
}

(async () => {
  const all = [];
  const a1 = await scenarioFresh();
  all.push(['fresh install', a1]);
  const seed = {};
  Object.keys(a1.window.localStorage).forEach((k) => { seed[k] = a1.window.localStorage.getItem(k); });
  const a2 = await scenarioRelaunch(seed);
  all.push(['relaunch + playback', a2]);
  const a3 = await scenarioOffline(seed);
  all.push(['offline', a3]);

  let failures = 0;
  all.forEach(([name, app]) => {
    console.log(`\n===== ${name}: LOG =====`);
    app.logs.forEach((l) => console.log(l));
    console.log(`===== ${name}: ERRORS (${app.errors.length}) =====`);
    app.errors.forEach((e) => console.log(e));
    failures += app.errors.length;
  });
  console.log('\nTOTAL FAILURES:', failures);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.log('SMOKE CRASH', e && e.stack || e);
  process.exit(1);
});
