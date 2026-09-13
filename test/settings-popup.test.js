'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSettings, DEFAULTS } = require('../lib/settings');
const { createPopup } = require('../lib/popup');
const { getRows } = require('../lib/view');

function configuredSettings() {
  const stored = new Map();
  const config = { get: (key, fallback) => stored.get(key) ?? fallback, set: (key, value) => stored.set(key, value) };
  const settings = createSettings();
  settings.start(config);
  return { settings, config };
}
const state = {
  akashi: { elapsed: 60000, target: 1200000, ready: false },
  nosaki: { elapsed: null, target: 900000, ready: false }, fleets: [],
};

test('settings persist font size and independently hide either countdown', () => {
  const { settings, config } = configuredSettings();
  assert.deepEqual(settings.read(), DEFAULTS);
  settings.set({ fontSize: 36, showNosaki: false });
  assert.deepEqual(getRows(state, settings.read()).map(row => [row.name, row.time, row.target]), [['明石', '01:00', '20:00']]);
  const restored = createSettings();
  restored.start(config);
  assert.equal(restored.read().fontSize, 36);
  restored.set({ showNosaki: true, showAkashi: false });
  assert.deepEqual(getRows(state, restored.read()).map(row => row.name), ['野崎']);
  restored.set({ showNosaki: false });
  assert.deepEqual(getRows(state, restored.read()), []);
  assert.throws(() => restored.set({ fontSize: 0 }), RangeError);
});

test('popup has compact defaults, reuses its window, pushes settings, and cleans up subscriptions', () => {
  const { settings } = configuredSettings();
  let subscription = null;
  let unsubscribed = false;
  const runtime = { read: () => state, subscribe: fn => { subscription = fn; return () => { unsubscribed = true; }; } };
  const windows = [];
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.messages = [];
      this.webContents = new EventEmitter();
      this.webContents.send = (...args) => this.messages.push(args);
      windows.push(this);
    }
    setMenu() {}
    isDestroyed() { return false; }
    isMinimized() { return false; }
    show() {}
    focus() {}
    loadFile(file) { this.file = file; return Promise.resolve(); }
    close() { this.emit('closed'); }
  }
  const controller = createPopup(runtime, settings, FakeWindow);
  try {
    controller.open(); controller.open();
    assert.equal(windows.length, 1);
    const win = windows[0];
    assert.equal(win.options.width, 440);
    assert.equal(win.options.height, 160);
    assert.equal(win.options.webPreferences.nodeIntegration, false);
    win.webContents.emit('did-finish-load');
    assert.equal(win.messages[0][1].settings.fontSize, 28);
    settings.set({ fontSize: 40, showAkashi: false });
    assert.equal(win.messages.at(-1)[1].settings.fontSize, 40);
    subscription();
    controller.close();
    assert.equal(unsubscribed, true);
    const count = win.messages.length;
    settings.set({ fontSize: 24 });
    assert.equal(win.messages.length, count);
    controller.open();
    assert.equal(windows.length, 2);
  } finally { controller.close(); }
});
