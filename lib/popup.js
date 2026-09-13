'use strict';

const path = require('node:path');
const CHANNEL = 'poi-plugin-thief-akashi:display';

function createPopup(runtime, settings, BrowserWindow) {
  let popup = null;
  let tick = null;
  let unsubscribeRuntime = null;
  let unsubscribeSettings = null;
  const send = () => {
    if (popup && !popup.isDestroyed()) {
      popup.webContents.send(CHANNEL, { state: runtime.read(), settings: settings.read() });
    }
  };
  const cleanup = () => {
    clearInterval(tick);
    unsubscribeRuntime?.();
    unsubscribeSettings?.();
    tick = unsubscribeRuntime = unsubscribeSettings = null;
    popup = null;
  };
  return {
    open() {
      if (popup) {
        if (popup.isMinimized()) popup.restore();
        popup.show();
        popup.focus();
        return;
      }
      popup = new BrowserWindow({
        title: '明石小偷', width: 440, height: 160, minWidth: 280, minHeight: 90,
        show: false, autoHideMenuBar: true, backgroundColor: '#20262d',
        webPreferences: {
          preload: path.join(__dirname, 'popup-preload.js'),
          nodeIntegration: false, contextIsolation: true, sandbox: false,
        },
      });
      popup.setMenu(null);
      popup.webContents.on('did-finish-load', send);
      popup.once('ready-to-show', () => { popup?.show(); });
      popup.on('closed', cleanup);
      unsubscribeRuntime = runtime.subscribe(send);
      unsubscribeSettings = settings.subscribe(send);
      tick = setInterval(send, 1000);
      popup.loadFile(path.join(__dirname, 'popup.html')).catch(error => {
        console.error('[明石小偷] 窗口加载失败', error);
        popup?.close();
      });
    },
    close() { popup?.close(); },
  };
}

module.exports = { createPopup, CHANNEL };
