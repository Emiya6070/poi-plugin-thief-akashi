'use strict';

// Local visual fixture only. This server is not included in the plugin package.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = {
  '/': ['scripts/preview.html', 'text/html'],
  '/react.js': ['node_modules/react/umd/react.development.js', 'text/javascript'],
  '/react-dom.js': ['node_modules/react-dom/umd/react-dom.development.js', 'text/javascript'],
};
const modules = { '/timers.js': ['lib/timers.js', './timers'], '/settings.js': ['lib/settings.js', './settings'], '/view.js': ['lib/view.js', './view'], '/fixtures.js': ['test/fixtures.js', './fixtures'] };
http.createServer((req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  if (modules[route]) {
    const [file, name] = modules[route];
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(`(() => { const module = {exports:{}}; const require = name => window.modules[name];\n${fs.readFileSync(path.join(root, file), 'utf8')}\nwindow.modules[${JSON.stringify(name)}] = module.exports; })();`);
  } else if (files[route]) {
    const [file, type] = files[route];
    res.setHeader('Content-Type', `${type}; charset=utf-8`);
    res.end(fs.readFileSync(path.join(root, file)));
  } else {
    res.writeHead(404).end();
  }
}).listen(4173, '127.0.0.1', () => console.log('Visual fixtures: http://127.0.0.1:4173 (synthetic game data)'));
