'use strict';

const { ipcRenderer } = require('electron');
const { getRows } = require('./view');

// The popup receives display data only; Node and IPC are not exposed to its page.
ipcRenderer.on('poi-plugin-thief-akashi:display', (_event, { state, settings }) => {
  const container = document.getElementById('timers');
  container.style.fontSize = `${settings.fontSize}px`;
  const rows = getRows(state, settings).map(row => {
    const element = document.createElement('div');
    element.className = `timer ${row.className}`;
    element.setAttribute('role', 'timer');
    element.setAttribute('aria-label', `${row.name}计时`);
    element.title = row.title;
    const label = document.createElement('span');
    label.textContent = row.name;
    const value = document.createElement('span');
    value.className = 'value';
    const time = document.createElement('span');
    time.textContent = row.time;
    const target = document.createElement('span');
    target.className = row.targetClassName;
    target.textContent = `/${row.target}${row.mark}`;
    value.append(time, target);
    if (row.next) {
      const next = document.createElement('span');
      next.className = row.nextClassName;
      next.textContent = row.next;
      value.append(next);
    }
    element.append(label, value);
    return element;
  });
  container.replaceChildren(...rows);
});
