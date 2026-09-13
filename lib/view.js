'use strict';

const { formatTime } = require('./timers');
const { DEFAULTS } = require('./settings');

function getRows(state, settings = DEFAULTS) {
  return [
    { name: '明石', value: state.akashi, shown: settings.showAkashi, flagship: state.fleets.some(fleet => fleet.akashi) },
    { name: '野崎', value: state.nosaki, shown: settings.showNosaki, flagship: state.fleets.some(fleet => fleet.nosaki && fleet.ids[0] === fleet.nosaki.id) },
  ].filter(row => row.shown).map(row => {
    const { elapsed, target, ready, detail, warning, nextAt, nextIn } = row.value;
    const gap = target - elapsed;
    const active = !state.error && elapsed !== null;
    const targetClassName = !state.error && warning ? 'warning' : active && ready ? 'ready' : active && gap > 0 && gap <= 60000 ? 'soon' : 'idle';
    return {
      name: row.name,
      time: state.error ? '--:--' : formatTime(elapsed, false),
      target: state.error ? '--:--' : formatTime(target),
      next: active && ready && nextAt != null ? `+${formatTime(nextAt - target)}` : '',
      nextClassName: nextIn > 0 && nextIn <= 60000 ? 'soon' : 'idle',
      mark: targetClassName === 'ready' ? '√' : '',
      targetClassName,
      title: state.error || warning || `${detail || `${row.name}计时`}；${ready ? '当前编成满足条件，可回港触发' : '到时且编成满足条件才会显示 √'}`,
      className: !state.error && warning ? 'warning' : !state.error && row.flagship ? 'flagship' : 'not-flagship',
    };
  });
}

// Shared display model; this React wrapper is used by the development preview.
function createView(React, runtime, settings = {read: () => DEFAULTS, subscribe: () => () => {}}) {
  const h = React.createElement;
  return function ThiefAkashi() {
    const [state, setState] = React.useState(() => runtime.read());
    const [options, setOptions] = React.useState(settings.read);
    React.useEffect(() => {
      const refresh = () => setState(runtime.read());
      const unsubscribe = runtime.subscribe(refresh);
      const unsubscribeSettings = settings.subscribe(() => setOptions(settings.read()));
      const tick = setInterval(refresh, 1000);
      refresh();
      return () => { unsubscribe(); unsubscribeSettings(); clearInterval(tick); };
    }, []);
    return h('main', {style: {padding:12, display:'grid', gap:8, fontSize:options.fontSize, fontWeight:600, fontFamily:'system-ui', fontVariantNumeric:'tabular-nums'}},
      getRows(state, options).map(row => h('div', {
        key:row.name, role:'timer', 'aria-label':`${row.name}计时`, title:row.title,
        className:row.className, style:{display:'flex', gap:12, whiteSpace:'nowrap', color:{warning:'#ef6464',flagship:'#24b47e','not-flagship':'#dca923'}[row.className]},
      }, h('span', null, row.name), h('span', {style:{display:'flex',gap:8,alignItems:'baseline'}},
        h('span', null, row.time), h('span', {className:row.targetClassName,
          style:{color:{warning:'#ef6464',ready:'#24b47e',soon:'#ef6464',idle:'#9ba4ad'}[row.targetClassName]}},
        `/${row.target}${row.mark}`), row.next && h('span', {className:row.nextClassName,
          style:{color:row.nextClassName === 'soon' ? '#ef6464' : '#9ba4ad'}}, row.next)))));
  };
}

module.exports = { createView, getRows };
