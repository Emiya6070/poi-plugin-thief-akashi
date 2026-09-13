'use strict';

const React = require('react');
const { createRuntime } = require('./lib/runtime');

const runtime = createRuntime();
const { createSettings, createSettingsView } = require('./lib/settings');
const { createPopup } = require('./lib/popup');
const settings = createSettings();
let popup = null;

// handleClick without reactClass is poi's window-only plugin interface.
exports.settingsClass = createSettingsView(React, settings);
exports.handleClick = () => popup.open();
exports.pluginDidLoad = () => {
  // This config module is shared by poi 11 and 12.
  settings.start(require('views/env-parts/config').config);
  runtime.start(window);
  popup = createPopup(runtime, settings, require('@electron/remote').BrowserWindow);
};
exports.pluginWillUnload = () => {
  popup?.close();
  popup = null;
  runtime.stop();
};
