'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { pathToFileURL } = require('node:url');
const { createRuntime } = require('../lib/runtime');
const { createView } = require('../lib/view');
const { game } = require('./fixtures');

test('poi 12 entry provides settings and a window-only click handler', async () => {
  const plugin = await import(pathToFileURL(require.resolve('../index.js')).href);
  assert.equal(plugin.reactClass, undefined);
  assert.equal(typeof plugin.settingsClass, 'function');
  assert.equal(typeof plugin.handleClick, 'function');
  assert.equal(typeof plugin.pluginDidLoad, 'function');
  assert.equal(typeof plugin.pluginWillUnload, 'function');
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
