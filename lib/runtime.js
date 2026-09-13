'use strict';

const { Timers, snapshot } = require('./timers');

function createRuntime() {
  let timers = new Timers();
  let host = null;
  let error = null;
  const listeners = new Set();
  const emit = () => listeners.forEach(listener => listener());
  const onResponse = event => {
    const detail = event.detail;
    if (!detail || typeof detail.path !== 'string') return;
    try {
      const info = host.getStore('info');
      const constants = host.getStore('const');
      timers.update(detail.path, detail.postBody || {}, snapshot(info, constants), Date.now());
      error = null;
    } catch (cause) {
      error = `读取游戏数据失败：${cause.message}`;
      console.error('[poi-plugin-thief-akashi]', cause);
    }
    emit();
  };
  return {
    start(window) {
      if (host) return;
      host = window;
      host.addEventListener('game.response', onResponse);
    },
    stop() {
      if (host) host.removeEventListener('game.response', onResponse);
      host = null;
      timers = new Timers();
      error = null;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read: () => ({ ...timers.read(Date.now()), error }),
  };
}

module.exports = { createRuntime };
