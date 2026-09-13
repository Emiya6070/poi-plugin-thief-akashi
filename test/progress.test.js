'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Timers, snapshot, AKASHI_MS, NOSAKI_MS } = require('../lib/timers');
const { getRows } = require('../lib/view');
const { game } = require('./fixtures');
const START = 1700000000000;
const PORT = '/kcsapi/api_port/port';
const MINUTE = 60000;

function setup() {
  const data = game();
  const timers = new Timers();
  const event = (path, elapsed, body = {}) => timers.update(path, body, snapshot(data.info, data.constants), START + elapsed);
  const port = elapsed => event(PORT, elapsed);
  const rows = elapsed => getRows(timers.read(START + elapsed));
  port(0);
  return { data, timers, port, event, rows };
}

test('elapsed counts up while the target stays fixed, including after the deadline', () => {
  const { rows } = setup();
  const row = rows(11 * MINUTE + 30000)[0];
  assert.equal(row.time, '11:30');
  assert.equal(row.target, '20:00');
  assert.equal(row.targetClassName, 'idle');
  for (const elapsed of [AKASHI_MS, 25 * MINUTE, 60 * MINUTE]) {
    assert.equal(rows(elapsed)[0].target, '20:00');
    assert.equal(rows(elapsed)[0].targetClassName, 'ready');
    assert.equal(rows(elapsed)[0].mark, '√');
  }
});

test('right side turns red at one minute, green at deadline; elapsed seconds round down', () => {
  const { rows } = setup();
  for (const [index, period] of [[0, AKASHI_MS], [1, NOSAKI_MS]]) {
    assert.equal(rows(period - MINUTE - 1)[index].targetClassName, 'idle');
    assert.equal(rows(period - MINUTE)[index].targetClassName, 'soon');
    assert.equal(rows(period - 1)[index].mark, '');
    assert.equal(rows(period - 1)[index].time, index === 0 ? '19:59' : '14:59');
    assert.equal(rows(period)[index].targetClassName, 'ready');
    assert.equal(rows(period)[index].mark, '√');
  }
});

test('Nosaki due port resets elapsed and all node offsets, independent of observed morale gains', () => {
  const { data, timers, port, rows } = setup();
  assert.match(rows(0)[1].title, /30:00（\+5cond）/);
  for (const id of [1, 3]) data.info.ships[id].api_cond = 52;
  port(17 * MINUTE);
  assert.equal(rows(17 * MINUTE)[1].time, '00:00');
  assert.equal(rows(17 * MINUTE)[1].next, '');
  assert.equal(rows(18 * MINUTE)[1].time, '01:00');
  assert.equal(rows(18 * MINUTE)[1].target, '15:00');
  assert.match(rows(18 * MINUTE)[1].title, /15:00（\+2cond）/);
  assert.equal(rows(31 * MINUTE)[1].targetClassName, 'soon');
  assert.equal(rows(32 * MINUTE)[1].mark, '√');
  for (const id of [1, 3]) data.info.ships[id].api_cond = 54;
  port(32 * MINUTE);
  assert.equal(rows(32 * MINUTE)[1].time, '00:00');
  assert.equal(rows(32 * MINUTE)[1].target, '15:00');
  assert.equal(rows(32 * MINUTE)[1].mark, '');
  assert.equal(timers.nosaki.startedAt, START + 32 * MINUTE);
});

test('Akashi settlement starts from zero, clears old nodes and retains the 20-minute target even at full HP', () => {
  const { data, port, rows } = setup();
  data.info.ships[2].api_nowhp = 38;
  data.info.ships[2].api_ndock_time = 2 * 6 * MINUTE + 30000;
  port(21 * MINUTE);
  assert.equal(rows(21 * MINUTE)[0].time, '00:00');
  assert.equal(rows(21 * MINUTE)[0].next, '');
  assert.equal(rows(22 * MINUTE)[0].time, '01:00');
  assert.equal(rows(22 * MINUTE)[0].target, '20:00');
  assert.equal(rows(40 * MINUTE)[0].targetClassName, 'soon');
  assert.equal(rows(41 * MINUTE)[0].mark, '√');
  data.info.ships[2].api_nowhp = 40;
  port(41 * MINUTE);
  assert.equal(rows(41 * MINUTE)[0].time, '00:00');
  assert.equal(rows(41 * MINUTE)[0].target, '20:00');
  assert.equal(rows(41 * MINUTE)[0].mark, '');
});

test('readiness requires an eligible formation, independent of the left flagship color', () => {
  const { data, event, rows } = setup();
  assert.equal(rows(NOSAKI_MS)[1].className, 'not-flagship');
  assert.equal(rows(NOSAKI_MS)[1].mark, '√');
  data.info.ships[2].api_fuel = 5;
  data.info.ships[1].api_nowhp = 20;
  event('/kcsapi/api_get_member/ship3', 1000);
  assert.equal(rows(AKASHI_MS)[0].className, 'flagship');
  assert.equal(rows(AKASHI_MS)[0].mark, '');
  assert.equal(rows(AKASHI_MS)[1].mark, '');
  data.info.fleets[0].api_ship = [4, 5];
  event('/kcsapi/api_req_hensei/preset_select', 2000);
  assert.equal(rows(AKASHI_MS)[0].className, 'not-flagship');
  assert.equal(rows(AKASHI_MS)[0].target, '20:00');
  assert.equal(rows(AKASHI_MS)[0].targetClassName, 'idle');
});

test('early returns and presets preserve elapsed; manual formation edits and account changes restart it', () => {
  const { data, event, port, rows } = setup();
  const original = data.info.fleets[0].api_ship;
  data.info.fleets[0].api_ship = [4, 5];
  event('/kcsapi/api_req_hensei/preset_select', MINUTE);
  data.info.ships[5].api_nowhp = 30;
  port(5 * MINUTE);
  assert.equal(rows(5 * MINUTE)[0].time, '05:00');
  assert.equal(rows(5 * MINUTE)[1].time, '05:00');
  data.info.fleets[0].api_ship = original;
  event('/kcsapi/api_req_hensei/preset_select', 6 * MINUTE);
  event('/kcsapi/api_req_hensei/change', 7 * MINUTE, { api_id: '1', api_ship_id: '3' });
  assert.equal(rows(7 * MINUTE)[0].time, '00:00');
  assert.equal(rows(7 * MINUTE)[1].time, '00:00');
  assert.equal(rows(7 * MINUTE)[1].target, '15:00');
  data.info.basic.api_member_id = 'another-admiral';
  port(8 * MINUTE);
  assert.equal(rows(8 * MINUTE)[0].time, '00:00');
});

test('unknown data and read errors never display a ready check', () => {
  const empty = getRows(new Timers().read(START));
  assert.equal(empty[0].time, '--:--');
  assert.equal(empty[0].target, '20:00');
  assert.equal(empty[1].target, '15:00');
  assert.ok(empty.every(row => row.mark === '' && row.targetClassName === 'idle'));
  const { timers } = setup();
  const failed = getRows({ ...timers.read(START + AKASHI_MS), error: '读取失败' });
  assert.ok(failed.every(row => row.time === '--:--' && row.target === '--:--' && row.mark === ''));
});

test('overdue port without HP changes latches a red Akashi row until a real timer restart', () => {
  const { timers, port, event, rows } = setup();
  port(AKASHI_MS - 1);
  assert.equal(timers.akashi.warning, null);
  port(AKASHI_MS);
  assert.equal(timers.akashi.warning, null);
  port(AKASHI_MS + 5000);
  assert.equal(timers.akashi.startedAt, START);
  assert.equal(rows(AKASHI_MS + 5000)[0].className, 'warning');
  assert.equal(rows(AKASHI_MS + 5000)[0].targetClassName, 'warning');
  assert.equal(rows(AKASHI_MS + 5000)[0].mark, '');
  assert.match(rows(AKASHI_MS + 5000)[0].title, /重新触发/);
  assert.equal(rows(AKASHI_MS + 5000)[1].targetClassName, 'idle');
  assert.equal(timers.nosaki.warning, null);
  port(30 * MINUTE);
  event('/kcsapi/api_req_hokyu/charge', 31 * MINUTE);
  assert.equal(rows(40 * MINUTE)[0].className, 'warning');
  event('/kcsapi/api_req_hensei/change', 40 * MINUTE, { api_id: '1', api_ship_id: '3' });
  assert.equal(timers.akashi.warning, null);
  assert.equal(rows(40 * MINUTE)[0].time, '00:00');
  assert.equal(rows(40 * MINUTE)[0].className, 'flagship');
});

test('full HP still latches the warning; preset-away and empty-formation recalibration cannot clear it', () => {
  const data = game();
  data.info.ships[2].api_nowhp = 40;
  const timers = new Timers();
  const event = (path, elapsed) => timers.update(path, {}, snapshot(data.info, data.constants), START + elapsed);
  event(PORT, 0);
  event(PORT, AKASHI_MS + 5000);
  let row = getRows(timers.read(START + AKASHI_MS + 5000))[0];
  assert.equal(row.target, '20:00');
  assert.equal(row.className, 'warning');
  data.info.fleets[0].api_ship = [4, 5];
  event('/kcsapi/api_req_hensei/preset_select', 21 * MINUTE);
  event(PORT, 22 * MINUTE);
  row = getRows(timers.read(START + 22 * MINUTE))[0];
  assert.equal(row.className, 'warning');
  assert.equal(timers.akashi.startedAt, START);
});

test('subsequently observed repair or account change clears the latched warning', () => {
  const { data, timers, port, rows } = setup();
  port(21 * MINUTE);
  data.info.ships[2].api_nowhp += 1;
  port(22 * MINUTE);
  assert.equal(timers.akashi.warning, null);
  assert.equal(rows(22 * MINUTE)[0].target, '20:00');
  assert.equal(rows(22 * MINUTE)[0].time, '00:00');
  assert.equal(rows(22 * MINUTE)[0].className, 'flagship');
  port(43 * MINUTE);
  assert.ok(timers.akashi.warning);
  data.info.basic.api_member_id = 'another-admiral';
  port(44 * MINUTE);
  assert.equal(timers.akashi.warning, null);
});

test('Nosaki absent at a due port starts a new cycle, including the reported 15:05 case', () => {
  for (const elapsed of [NOSAKI_MS, NOSAKI_MS + 5000]) {
    const { data, timers, event, port, rows } = setup();
    const original = data.info.fleets[0].api_ship;
    data.info.fleets[0].api_ship = [4, 5];
    event('/kcsapi/api_req_hensei/preset_select', MINUTE);
    port(NOSAKI_MS - 1);
    assert.equal(timers.nosaki.startedAt, START);
    port(elapsed);
    assert.equal(timers.nosaki.startedAt, START + elapsed);
    assert.equal(rows(elapsed)[1].time, '00:00');
    assert.equal(rows(elapsed)[1].target, '15:00');
    assert.equal(rows(elapsed)[1].next, '');
    assert.equal(rows(elapsed)[1].mark, '');
    port(elapsed + 1000);
    assert.equal(timers.nosaki.startedAt, START + elapsed);
    data.info.fleets[0].api_ship = original;
    event('/kcsapi/api_req_hensei/preset_select', elapsed + 2000);
    assert.equal(rows(elapsed + 2000)[1].mark, '');
    assert.equal(rows(elapsed + NOSAKI_MS)[1].mark, '√');
  }
});

test('every expired port settles Nosaki regardless of why feeding cannot occur', () => {
  const cases = [
    ['unsupplied', info => { info.ships[2].api_fuel = 5; }],
    ['damaged', info => { info.ships[2].api_nowhp = 30; }],
    ['fatigued', info => { info.ships[2].api_cond = 29; }],
    ['docked', info => { info.repairs = [{ api_ship_id: 2 }]; }],
    ['expedition', info => { info.fleets[0].api_mission[0] = 1; }],
    ['no port fuel', info => { info.resources[0] = 0; }],
    ['full morale', info => { info.ships[1].api_cond = info.ships[3].api_cond = 54; }],
  ];
  for (const [name, change] of cases) {
    const { data, timers, event, port } = setup();
    change(data.info);
    event('/kcsapi/api_get_member/ship3', MINUTE);
    assert.equal(timers.fleets[0].canBoost, false, name);
    port(NOSAKI_MS);
    assert.equal(timers.nosaki.startedAt, START + NOSAKI_MS, name);
    assert.equal(timers.nosaki.reason, '母港给粮到期判定', name);
    assert.equal(timers.read(START + NOSAKI_MS).nosaki.ready, false, name);
  }
});

test('six-minute HP intervals yield 20(+3), 24(+4), 30(+5), with offsets anchored to 20', () => {
  const { timers, rows } = setup();
  assert.deepEqual(timers.read(START).akashi.timelines[0].points, [
    { at: 20 * MINUTE, gain: 3 }, { at: 24 * MINUTE, gain: 4 }, { at: 30 * MINUTE, gain: 5 },
  ]);
  assert.equal(rows(AKASHI_MS - 1)[0].next, '');
  for (const elapsed of [20, 22, 23]) {
    assert.equal(rows(elapsed * MINUTE)[0].next, '+04:00');
    assert.equal(rows(elapsed * MINUTE)[0].target, '20:00');
    assert.equal(rows(elapsed * MINUTE)[0].mark, '√');
  }
  assert.equal(rows(22 * MINUTE)[0].nextClassName, 'idle');
  assert.equal(rows(23 * MINUTE)[0].nextClassName, 'soon');
  assert.equal(rows(24 * MINUTE)[0].next, '+10:00');
  assert.equal(rows(30 * MINUTE)[0].next, '');
  assert.equal(rows(30 * MINUTE)[0].mark, '√'); // Estimated full repair still needs port settlement.
  assert.equal(timers.akashi.startedAt, START);
});

test('merges eligible ship timelines and advances to the nearest future node across ships', () => {
  const { data, timers, event, rows } = setup();
  data.info.equips[11] = { api_id: 11, api_slotitem_id: 86 };
  data.info.ships[1].api_slot[0] = 11;
  data.info.ships[3].api_ndock_time = 10 * 13 * MINUTE + 30000;
  event('/kcsapi/api_get_member/ship3', 1000);
  assert.deepEqual(timers.read(START).akashi.timelines.map(ship => ship.shipId), [2, 3]);
  assert.equal(rows(22 * MINUTE)[0].next, '+04:00'); // Ship 2, at 24.
  assert.equal(rows(24 * MINUTE)[0].next, '+06:00'); // Ship 3, at 26.
  assert.equal(rows(26 * MINUTE)[0].next, '+10:00'); // Ship 2, at 30.
  assert.equal(rows(30 * MINUTE)[0].next, '+19:00'); // Ship 2 is estimated full; ship 3 next at 39.
});

test('timeline excludes middle damage, docks, full HP and ships outside facility coverage', () => {
  const cases = [
    ['capacity', () => {}],
    ['middle damage', info => { info.ships[1].api_slot[0] = 11; info.ships[3].api_nowhp = 20; }],
    ['docked', info => { info.ships[1].api_slot[0] = 11; info.repairs = [{ api_ship_id: 3 }]; }],
    ['full', info => { info.ships[1].api_slot[0] = 11; info.ships[3].api_nowhp = 40; }],
  ];
  for (const [name, change] of cases) {
    const { data, timers, event, rows } = setup();
    data.info.equips[11] = { api_id: 11, api_slotitem_id: 86 };
    data.info.ships[3].api_ndock_time = 10 * 10.5 * MINUTE + 30000; // Would introduce an earlier 21-minute node.
    change(data.info);
    event('/kcsapi/api_get_member/ship3', 1000);
    assert.deepEqual(timers.read(START).akashi.timelines.map(ship => ship.shipId), [2], name);
    assert.equal(rows(20 * MINUTE)[0].next, '+04:00', name);
  }
  for (const change of [
    info => { info.ships[1].api_nowhp = 20; },
    info => { info.repairs = [{ api_ship_id: 1 }]; },
    info => { info.fleets[0].api_mission[0] = 1; },
  ]) {
    const { data, timers, event, rows } = setup();
    change(data.info);
    event('/kcsapi/api_get_member/ship3', 1000);
    assert.deepEqual(timers.read(START).akashi.timelines, []);
    assert.equal(rows(22 * MINUTE)[0].next, '');
  }
});

test('slow ships retain the 20-minute one-HP guarantee; node times round up to seconds', () => {
  const { data, timers, event } = setup();
  data.info.ships[2].api_ndock_time = 5 * (25 * MINUTE + 100) + 30000;
  event('/kcsapi/api_get_member/ship3', 1000);
  const points = timers.read(START).akashi.timelines[0].points;
  assert.deepEqual(points.slice(0, 2), [{ at: 20 * MINUTE, gain: 1 }, { at: 50 * MINUTE + 1000, gain: 2 }]);
});

test('missing repair duration shows no fabricated extra node and warns in tooltip', () => {
  const { data, event, rows } = setup();
  delete data.info.ships[2].api_ndock_time;
  event('/kcsapi/api_get_member/ship3', 1000);
  assert.equal(rows(22 * MINUTE)[0].next, '');
  assert.match(rows(22 * MINUTE)[0].title, /缺少有效入渠时间/);
  assert.equal(rows(22 * MINUTE)[0].mark, '√');
});

test('Nosaki stages stay on a single unconsumed cycle, cap at 54, and reset at a due port without a failure warning', () => {
  for (const [masterId, lastAt] of [[1002, 30], [996, 45]]) {
    const { data, timers, event, port, rows } = setup();
    data.info.ships[2].api_ship_id = masterId;
    data.constants.$ships[996] = { api_fuel_max: 10, api_bull_max: 10 };
    event('/kcsapi/api_get_member/ship3', 1000);
    assert.equal(rows(14 * MINUTE)[1].next, '');
    assert.equal(rows(16 * MINUTE)[1].next, '+15:00');
    assert.equal(rows(29 * MINUTE)[1].nextClassName, 'soon');
    assert.equal(rows(30 * MINUTE)[1].next, masterId === 996 ? '+30:00' : '');
    assert.equal(rows(lastAt * MINUTE)[1].mark, '√');
    assert.equal(rows(lastAt * MINUTE)[1].next, '');
    port(lastAt * MINUTE); // No cond change at all.
    assert.equal(rows(lastAt * MINUTE)[1].time, '00:00');
    assert.equal(rows(lastAt * MINUTE)[1].target, '15:00');
    assert.equal(rows(lastAt * MINUTE)[1].next, '');
    assert.equal(timers.nosaki.warning, null);
  }
});

test('repair warnings and read errors suppress all later-node hints', () => {
  const { timers, port, rows } = setup();
  port(22 * MINUTE);
  assert.equal(rows(22 * MINUTE)[0].next, '');
  assert.equal(rows(22 * MINUTE)[0].mark, '');
  const failed = getRows({ ...timers.read(START + 40 * MINUTE), error: '读取失败' });
  assert.ok(failed.every(row => row.next === '' && row.mark === ''));
});
