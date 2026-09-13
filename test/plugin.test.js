'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { pathToFileURL } = require('node:url');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { runInNewContext } = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRuntime } = require('../lib/runtime');
const { createView } = require('../lib/view');
const { game } = require('./fixtures');

test('entry provides settings and a window-only click handler', async () => {
  const plugin = await import(pathToFileURL(require.resolve('../index.js')).href);
  assert.equal(plugin.reactClass, undefined);
  assert.equal(typeof plugin.settingsClass, 'function');
  assert.equal(typeof plugin.handleClick, 'function');
  assert.equal(typeof plugin.pluginDidLoad, 'function');
  assert.equal(typeof plugin.pluginWillUnload, 'function');
});

test('poi 11/12 shared config supports loading, popup updates, unloading and reloading', () => {
  const key = 'plugin.poi-plugin-thief-akashi.display';
  const stored = new Map([[key, { fontSize: 36, showAkashi: true, showNosaki: false }]]);
  const config = { get: (key, fallback) => stored.get(key) ?? fallback, set: (key, value) => stored.set(key, value) };
  const data = game();
  const host = new EventTarget();
  let reads = 0;
  host.getStore = key => { reads++; return key === 'info' ? data.info : data.constants; };
  const windows = [];
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.messages = [];
      this.webContents = new EventEmitter();
      this.webContents.send = (_channel, message) => this.messages.push(message);
      windows.push(this);
    }
    setMenu() {}
    isDestroyed() { return this.closed === true; }
    isMinimized() { return false; }
    show() {}
    focus() {}
    loadFile() { return Promise.resolve(); }
    close() { this.closed = true; this.emit('closed'); }
  }
  const entry = require.resolve('../index.js');
  const entryRequire = createRequire(entry);
  const plugin = {};
  runInNewContext(readFileSync(entry, 'utf8'), {
    exports: plugin, window: host,
    require(id) {
      if (id === 'views/env-parts/config') return { config };
      // poi 11 does not re-export config from views/env.
      if (id === 'views/env') return {};
      if (id === '@electron/remote') return { BrowserWindow: FakeWindow };
      return entryRequire(id);
    },
  }, { filename: entry });
  const respond = () => host.dispatchEvent(new CustomEvent('game.response', {
    detail: { path: '/kcsapi/api_port/port' },
  }));
  try {
    plugin.pluginDidLoad();
    const html = renderToStaticMarkup(React.createElement(plugin.settingsClass));
    assert.match(html, /value="36"/);
    plugin.handleClick();
    windows[0].webContents.emit('did-finish-load');
    assert.equal(windows[0].messages.at(-1).settings.showNosaki, false);
    respond();
    assert.equal(reads, 2);
    assert.equal(windows[0].messages.at(-1).state.error, null);
    assert.notEqual(windows[0].messages.at(-1).state.akashi.startedAt, null);
    plugin.pluginWillUnload();
    assert.equal(windows[0].closed, true);
    respond();
    assert.equal(reads, 2);
    stored.set(key, { fontSize: 40, showAkashi: false, showNosaki: true });
    plugin.pluginDidLoad();
    plugin.handleClick();
    windows[1].webContents.emit('did-finish-load');
    assert.equal(windows[1].messages.at(-1).settings.fontSize, 40);
    assert.equal(windows[1].messages.at(-1).state.akashi.startedAt, null);
    respond();
    assert.equal(reads, 4);
  } finally {
    plugin.pluginWillUnload();
  }
});

test('runtime observes events without a mounted view and unsubscribes cleanly on unload', t => {
  let now = 1700000000000;
  t.mock.method(Date, 'now', () => now);
  const data = game();
  const host = new EventTarget();
  let calls = 0;
  host.getStore = key => { calls++; return key === 'info' ? data.info : data.constants; };
  const runtime = createRuntime();
  runtime.start(host);
  runtime.start(host);
  const event = () => host.dispatchEvent(new CustomEvent('game.response', { detail: { path: '/kcsapi/api_port/port' } }));
  event();
  assert.equal(calls, 2);
  const before = runtime.read().akashi.startedAt;
  let renders = 0;
  const unsubscribe = runtime.subscribe(() => renders++);
  unsubscribe(); // Popup closed; game observation must still continue.
  now += 20 * 60 * 1000;
  data.info.ships[2].api_nowhp += 1;
  event();
  assert.equal(renders, 0);
  assert.equal(runtime.read().akashi.estimated, false);
  assert.equal(runtime.read().akashi.startedAt, before + 20 * 60 * 1000);
  runtime.stop();
  const count = calls;
  event();
  assert.equal(calls, count);
  assert.equal(runtime.read().akashi.remaining, null);
  runtime.start(host);
  event();
  assert.equal(runtime.read().akashi.estimated, true);
  runtime.stop();
});

test('compact view contains two named elapsed timers and trigger targets', () => {
  const runtime = createRuntime();
  const View = createView(React, runtime);
  const html = renderToStaticMarkup(React.createElement(View));
  assert.equal((html.match(/role="timer"/g) || []).length, 2);
  assert.ok(html.includes('--:--'));
  assert.ok(html.includes('aria-label="明石计时"'));
  assert.ok(html.includes('aria-label="野崎计时"'));
  assert.equal(html.replace(/<[^>]+>/g, ''), '明石--:--/20:00野崎--:--/15:00');
});

test('colors depend only on flagship position, including Nosaki in second position', () => {
  const state = {
    akashi: { elapsed: 0, target: 1200000, ready: false }, nosaki: { elapsed: 0, target: 900000, ready: false },
    fleets: [{ akashi: true, canRepair: false, nosaki: { id: 2 }, ids: [1, 2] }],
  };
  const View = createView(React, { read: () => state });
  let html = renderToStaticMarkup(React.createElement(View));
  assert.match(html, /aria-label="明石计时"[^>]+class="flagship"/);
  assert.match(html, /aria-label="野崎计时"[^>]+class="not-flagship"/);
  state.fleets.push({ akashi: false, nosaki: { id: 3 }, ids: [3] });
  html = renderToStaticMarkup(React.createElement(View));
  assert.match(html, /aria-label="野崎计时"[^>]+class="flagship"/);
});
