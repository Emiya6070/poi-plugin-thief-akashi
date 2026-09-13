'use strict';

const KEY = 'plugin.poi-plugin-thief-akashi.display';
const DEFAULTS = Object.freeze({ fontSize: 28, showAkashi: true, showNosaki: true });

function createSettings() {
  let config = null;
  let value = { ...DEFAULTS };
  const listeners = new Set();
  const emit = () => listeners.forEach(listener => listener());
  return {
    start(poiConfig) {
      config = poiConfig;
      value = { ...DEFAULTS, ...config.get(KEY, {}) };
      emit();
    },
    read: () => ({ ...value }),
    set(patch) {
      const next = { ...value, ...patch };
      if (!Number.isInteger(next.fontSize) || next.fontSize < 12 || next.fontSize > 72) {
        throw new RangeError('字号须为 12–72 的整数');
      }
      if (typeof next.showAkashi !== 'boolean' || typeof next.showNosaki !== 'boolean') {
        throw new TypeError('计时显示设置须为布尔值');
      }
      config.set(KEY, next);
      value = next;
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function createSettingsView(React, settings) {
  const h = React.createElement;
  return function Settings() {
    const [value, setValue] = React.useState(settings.read);
    React.useEffect(() => settings.subscribe(() => setValue(settings.read())), []);
    return h('div', { style: { display: 'grid', gap: 12, padding: '8px 0' } },
      h('label', null, '字号 ', h('input', {
        type: 'range', min: 12, max: 72, step: 1, value: value.fontSize,
        'aria-label': '字号', onChange: e => settings.set({ fontSize: Number(e.target.value) }),
      }), ` ${value.fontSize}px`),
      h('label', null, h('input', {
        type: 'checkbox', checked: value.showAkashi,
        onChange: e => settings.set({ showAkashi: e.target.checked }),
      }), ' 显示明石计时'),
      h('label', null, h('input', {
        type: 'checkbox', checked: value.showNosaki,
        onChange: e => settings.set({ showNosaki: e.target.checked }),
      }), ' 显示野崎计时'));
  };
}

module.exports = { createSettings, createSettingsView, DEFAULTS };
