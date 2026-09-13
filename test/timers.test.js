'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Timers, snapshot, inspect, formatTime, AKASHI_MS, NOSAKI_MS } = require('../lib/timers');
const { game } = require('./fixtures');

const PORT = '/kcsapi/api_port/port';
const CHANGE = '/kcsapi/api_req_hensei/change';
const PRESET = '/kcsapi/api_req_hensei/preset_select';
const START = 1700000000000;
function setup() {
  const data = game();
  const timers = new Timers();
  const event = (path, elapsed, body = {}) => timers.update(path, body, snapshot(data.info, data.constants), START + elapsed);
  event(PORT, 0);
  return { data, timers, event };
}

test('waits for live port instead of cached state; first clocks are explicitly estimated', () => {
  const { info, constants } = game();
  const timers = new Timers();
  timers.update(CHANGE, {}, snapshot(info, constants), START);
  assert.equal(timers.read(START).akashi.remaining, null);
  timers.update(PORT, {}, snapshot(info, constants), START);
  assert.equal(timers.read(START).akashi.remaining, AKASHI_MS);
  assert.equal(timers.read(START).nosaki.remaining, NOSAKI_MS);
  assert.equal(timers.akashi.estimated, true);
});

test('counts two independent clocks from timestamps, clamps at zero and never auto loops', () => {
  const { timers } = setup();
  assert.equal(timers.read(START + NOSAKI_MS).nosaki.remaining, 0);
  assert.equal(timers.read(START + NOSAKI_MS).akashi.remaining, 300000);
  assert.equal(timers.read(START + AKASHI_MS + 60000).akashi.remaining, 0);
  assert.equal(timers.read(START + AKASHI_MS + 60000).akashi.overdue, 60000);
});

test('port without HP change keeps an active Akashi clock, even after 20 minutes', () => {
  const { timers, event } = setup();
  event(PORT, AKASHI_MS + 1000);
  assert.equal(timers.akashi.startedAt, START);
});

test('port HP recovery resets Akashi and also settles an expired Nosaki cycle', () => {
  const { data, timers, event } = setup();
  data.info.ships[2].api_nowhp += 1;
  event(PORT, AKASHI_MS);
  assert.equal(timers.akashi.startedAt, START + AKASHI_MS);
  assert.equal(timers.akashi.estimated, false);
  assert.equal(timers.nosaki.startedAt, START + AKASHI_MS);
});

test('early port HP changes preserve Akashi even with a repair flagship', () => {
  const { data, timers, event } = setup();
  data.info.ships[5].api_nowhp = 30;
  event(PORT, 10000);
  assert.equal(timers.akashi.startedAt, START);
  data.info.ships[2].api_nowhp += 1;
  event(PORT, AKASHI_MS - 1);
  assert.equal(timers.akashi.startedAt, START);
  assert.equal(timers.read(START + AKASHI_MS - 1).akashi.remaining, 1);
});

test('unrelated HP changes cannot confirm Akashi repair or clear a failed-repair warning', () => {
  const { data, timers, event } = setup();
  data.info.ships[5].api_nowhp = 30;
  event(PORT, AKASHI_MS);
  assert.equal(timers.akashi.startedAt, START);
  event(PORT, AKASHI_MS + 1);
  assert.ok(timers.akashi.warning);
  data.info.ships[5].api_nowhp = 35;
  event(PORT, AKASHI_MS + 2000);
  assert.equal(timers.akashi.startedAt, START);
  assert.ok(timers.akashi.warning);
});

test('preset away preserves unfinished clocks; a later return only settles the expired one', () => {
  const { data, timers, event } = setup();
  const original = data.info.fleets[0].api_ship;
  data.info.fleets[0].api_ship = [3];
  event(PRESET, 1000);
  event('/kcsapi/api_req_map/start', 2000);
  data.info.ships[3].api_nowhp -= 1;
  data.info.ships[3].api_cond = 52;
  data.info.resources[0] -= 1;
  event(PORT, NOSAKI_MS - 1);
  assert.equal(timers.akashi.startedAt, START);
  assert.equal(timers.nosaki.startedAt, START);
  assert.equal(timers.read(START + NOSAKI_MS - 1).nosaki.remaining, 1);
  data.info.ships[3].api_nowhp -= 1;
  event(PORT, AKASHI_MS - 1);
  assert.equal(timers.akashi.startedAt, START);
  assert.equal(timers.nosaki.startedAt, START + AKASHI_MS - 1);
  data.info.fleets[0].api_ship = original;
  event(PRESET, AKASHI_MS);
  assert.equal(timers.akashi.startedAt, START);
  assert.equal(timers.nosaki.startedAt, START + AKASHI_MS - 1);
});

test('docking completion HP gain does not reset the Akashi clock', () => {
  const { data, timers, event } = setup();
  data.info.repairs = [{ api_ship_id: 3 }];
  event('/kcsapi/api_req_nyukyo/start', 1000);
  data.info.ships[3].api_nowhp = 40;
  data.info.repairs = [];
  event(PORT, AKASHI_MS);
  assert.equal(timers.akashi.startedAt, START);
});

test('no repair formation: port recalibrates after, but not at, 20 minutes per logbook', () => {
  const { data, timers, event } = setup();
  data.info.fleets[0].api_ship = [4, 5];
  event(PRESET, 1000);
  event(PORT, AKASHI_MS);
  assert.equal(timers.akashi.startedAt, START);
  event(PORT, AKASHI_MS + 1);
  assert.equal(timers.akashi.startedAt, START + AKASHI_MS + 1);
  assert.equal(timers.akashi.estimated, true);
});

test('normal composition changes reset clocks in affected fleets', () => {
  const { timers, event } = setup();
  event(CHANGE, 60000, { api_id: '1', api_ship_id: '3' });
  assert.equal(timers.akashi.startedAt, START + 60000);
  assert.equal(timers.nosaki.startedAt, START + 60000);
});

test('source fleet of cross-fleet swaps is included', () => {
  const { data, timers, event } = setup();
  data.info.fleets[0].api_ship[2] = 5;
  data.info.fleets[1].api_ship[1] = 3;
  event(CHANGE, 60000, { api_id: '2', api_ship_id: '3' });
  assert.equal(timers.akashi.startedAt, START + 60000);
  assert.equal(timers.nosaki.startedAt, START + 60000);
});

test('unrelated fleet change does not reset either timer', () => {
  const { timers, event } = setup();
  event(CHANGE, 60000, { api_id: '2', api_ship_id: '5' });
  assert.equal(timers.akashi.startedAt, START);
  assert.equal(timers.nosaki.startedAt, START);
});

test('preset away and back preserves both global clocks', () => {
  const { data, timers, event } = setup();
  const original = data.info.fleets[0].api_ship;
  data.info.fleets[0].api_ship = [4, 5];
  event(PRESET, 1000);
  data.info.fleets[0].api_ship = original;
  event(PRESET, 60000);
  assert.equal(timers.akashi.startedAt, START);
  assert.equal(timers.nosaki.startedAt, START);
});

test('bulk escort removal preserves both clocks even if Nosaki is removed', () => {
  const { data, timers, event } = setup();
  data.info.fleets[0].api_ship = [1, -1, -1, -1, -1, -1];
  event(CHANGE, 60000, { api_id: '1', api_ship_id: '-2' });
  assert.equal(timers.akashi.startedAt, START);
  assert.equal(timers.nosaki.startedAt, START);
});

test('sortie, expedition result, supply and remodeling do not themselves reset', () => {
  const { timers, event } = setup();
  for (const path of ['api_req_map/start', 'api_req_mission/result', 'api_req_hokyu/charge', 'api_req_kaisou/remodeling']) {
    event(`/kcsapi/${path}`, 60000);
  }
  assert.equal(timers.akashi.startedAt, START);
  assert.equal(timers.nosaki.startedAt, START);
});

test('Nosaki effect at 15 minutes resets only her clock; ship fuel stays full', () => {
  const { data, timers, event } = setup();
  data.info.ships[1].api_cond = 52;
  data.info.resources[0] -= 1;
  event(PORT, NOSAKI_MS);
  assert.equal(timers.nosaki.startedAt, START + NOSAKI_MS);
  assert.equal(timers.nosaki.estimated, false);
  assert.equal(timers.akashi.startedAt, START);
  assert.equal(data.info.ships[2].api_fuel, 10);
});

test('natural morale recovery before the deadline preserves Nosaki; a due port settles it', () => {
  const { data, timers, event } = setup();
  data.info.ships[1].api_cond = 40;
  event('/kcsapi/api_get_member/ship3', 1000);
  data.info.ships[1].api_cond = 49;
  event(PORT, NOSAKI_MS - 1);
  assert.equal(timers.nosaki.startedAt, START);
  event(PORT, NOSAKI_MS);
  assert.equal(timers.nosaki.startedAt, START + NOSAKI_MS);
});

test('due port settles Nosaki even when morale remains below 49', () => {
  const { data, timers, event } = setup();
  data.info.ships[1].api_cond = 40;
  event('/kcsapi/api_get_member/ship3', 1000);
  data.info.ships[1].api_cond = 43;
  data.info.resources[0] -= 1;
  event(PORT, NOSAKI_MS);
  assert.equal(timers.nosaki.startedAt, START + NOSAKI_MS);
});

test('due port settles Nosaki even when fuel stockpiles increase', () => {
  const { data, timers, event } = setup();
  data.info.resources[0] += 2;
  data.info.ships[1].api_cond = 52;
  event(PORT, NOSAKI_MS);
  assert.equal(timers.nosaki.startedAt, START + NOSAKI_MS);
});

test('HP and natural cond recovery can make Nosaki eligible on the same port response', () => {
  const { data, timers, event } = setup();
  data.info.ships[2].api_nowhp = 30;
  data.info.ships[2].api_cond = 29;
  event('/kcsapi/api_get_member/ship3', 1000);
  data.info.ships[2].api_nowhp = 31;
  data.info.ships[2].api_cond = 32;
  data.info.ships[1].api_cond = 52;
  event(PORT, AKASHI_MS);
  assert.equal(timers.nosaki.startedAt, START + AKASHI_MS);
});

test('unsupplied Nosaki still settles at a due port without becoming eligible', () => {
  const { data, timers, event } = setup();
  data.info.ships[2].api_fuel = 5;
  event('/kcsapi/api_req_map/start', 1000);
  event(PORT, NOSAKI_MS);
  assert.equal(timers.nosaki.startedAt, START + NOSAKI_MS);
  assert.ok(timers.fleets[0].moraleReasons.includes('野埼未补满'));
});

test('sortie return after the deadline settles the clock even with depleted fuel', () => {
  const { data, timers, event } = setup();
  data.info.ships[2].api_fuel = 5;
  data.info.ships[1].api_cond = 52;
  event(PORT, NOSAKI_MS);
  assert.equal(timers.nosaki.startedAt, START + NOSAKI_MS);
  assert.equal(timers.fleets[0].canBoost, false);
});

test('fleet qualifications: repair capacity, HP boundaries and docking', () => {
  const { info, constants } = game();
  let fleet = inspect(snapshot(info, constants))[0];
  assert.deepEqual(fleet.repairTargets.map(ship => ship.id), [2]);
  info.equips[11] = { api_id: 11, api_slotitem_id: 86 };
  info.ships[1].api_slot[0] = 11;
  fleet = inspect(snapshot(info, constants))[0];
  assert.deepEqual(fleet.repairTargets.map(ship => ship.id), [2, 3]);
  info.ships[2].api_nowhp = 20;
  info.repairs = [{ api_ship_id: 3 }];
  fleet = inspect(snapshot(info, constants))[0];
  assert.equal(fleet.canRepair, false);
  info.ships[1].api_nowhp = 20;
  assert.ok(inspect(snapshot(info, constants))[0].repairReasons.includes('明石中破及以上'));
});

test('Nosaki qualification boundaries, 54 cap and out-of-position exclusion', () => {
  const { info, constants } = game();
  info.ships[2].api_nowhp = 30;
  info.ships[2].api_cond = 29;
  info.ships[1].api_cond = info.ships[3].api_cond = 54;
  const fleet = inspect(snapshot(info, constants))[0];
  assert.equal(fleet.canBoost, false);
  assert.ok(fleet.moraleReasons.includes('野埼小破及以上'));
  assert.ok(fleet.moraleReasons.includes('野埼士气低于 30'));
  assert.equal(fleet.moraleTargets.length, 0);
  info.fleets[0].api_ship = [1, 3, 2];
  assert.equal(inspect(snapshot(info, constants))[0].nosaki, undefined);
});

test('expedition and docked support ships report blocked conditions', () => {
  const { info, constants } = game();
  info.fleets[0].api_mission[0] = 1;
  info.repairs = [{ api_ship_id: 1 }, { api_ship_id: 2 }];
  const fleet = inspect(snapshot(info, constants))[0];
  assert.equal(fleet.canRepair, false);
  assert.equal(fleet.canBoost, false);
  assert.ok(fleet.moraleReasons.includes('野埼入渠中'));
});

test('snapshots are detached and account switches discard previous clocks', () => {
  const { data, timers, event } = setup();
  const captured = timers.previous;
  data.info.fleets[0].api_ship[0] = 4;
  data.info.ships[1].api_nowhp = 30;
  assert.equal(captured.fleets[0].ids[0], 1);
  assert.equal(captured.ships[1].hp, 40);
  data.info.basic.api_member_id = 'another-admiral';
  event(PORT, 10000);
  assert.equal(timers.akashi.startedAt, START + 10000);
  assert.equal(timers.akashi.estimated, true);
});

test('countdown uses ceiling at second boundaries', () => {
  assert.equal(formatTime(null), '--:--');
  assert.equal(formatTime(1), '00:01');
  assert.equal(formatTime(60001), '01:01');
  assert.equal(formatTime(0), '00:00');
});
