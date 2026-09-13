'use strict';

const AKASHI_MS = 20 * 60 * 1000;
const NOSAKI_MS = 15 * 60 * 1000;
const AKASHI_IDS = [182, 187];
const NOSAKI_IDS = [996, 1002];
const PORT = '/kcsapi/api_port/port';
const CHANGE = '/kcsapi/api_req_hensei/change';

function clock() {
  return { startedAt: null, estimated: false, reason: '等待母港数据', warning: null };
}

function reset(timer, now, reason, estimated = false) {
  Object.assign(timer, { startedAt: now, estimated, reason, warning: null });
}

// Copy only the game fields we use. A previous snapshot must not change when
// poi updates its store; never retain API tokens or complete response bodies.
function snapshot(info, constants) {
  return {
    memberId: info.basic?.api_member_id,
    fuel: info.resources?.[0],
    fleets: (info.fleets || []).map(fleet => ({
      id: fleet.api_id,
      name: fleet.api_name,
      ids: [...fleet.api_ship],
      expedition: Boolean(fleet.api_mission?.[0]),
    })),
    ships: Object.fromEntries(Object.entries(info.ships || {}).map(([id, ship]) => [id, {
      id: ship.api_id, masterId: ship.api_ship_id,
      hp: ship.api_nowhp, maxHp: ship.api_maxhp,
      dockTime: ship.api_ndock_time,
      name: constants.$ships?.[ship.api_ship_id]?.api_name || `舰船 #${ship.api_id}`,
      cond: ship.api_cond, fuel: ship.api_fuel, ammo: ship.api_bull,
      slots: [...ship.api_slot],
    }])),
    docked: new Set((info.repairs || []).map(dock => dock.api_ship_id).filter(id => id > 0)),
    facilities: new Set(Object.values(info.equips || {})
      .filter(item => item.api_slotitem_id === 86).map(item => item.api_id)),
    masters: Object.fromEntries(Object.entries(constants.$ships || {}).map(([id, ship]) => [id, {
      fuel: ship.api_fuel_max, ammo: ship.api_bull_max,
    }])),
  };
}

function inspect(state) {
  return state.fleets.map(fleet => {
    const flagship = state.ships[fleet.ids[0]];
    const akashi = flagship && AKASHI_IDS.includes(flagship.masterId);
    const repairReasons = [];
    let repairShips = [];
    let repairTargets = [];
    if (akashi) {
      if (fleet.expedition) repairReasons.push('远征中');
      if (state.docked.has(flagship.id)) repairReasons.push('明石入渠中');
      if (flagship.hp <= flagship.maxHp / 2) repairReasons.push('明石中破及以上');
      const capacity = 2 + flagship.slots.filter(id => state.facilities.has(id)).length;
      repairShips = fleet.ids.slice(0, capacity).map(id => state.ships[id]).filter(Boolean);
      repairTargets = repairShips.filter(ship =>
        ship && !state.docked.has(ship.id) && ship.hp > ship.maxHp / 2 && ship.hp < ship.maxHp);
      if (!repairTargets.length) repairReasons.push('修理范围内无可修理舰');
    }

    const nosaki = fleet.ids.slice(0, 2).map(id => state.ships[id])
      .find(ship => ship && NOSAKI_IDS.includes(ship.masterId));
    const moraleReasons = [];
    let moraleShips = [];
    let moraleTargets = [];
    if (nosaki) {
      const master = state.masters[nosaki.masterId];
      if (!master) moraleReasons.push('等待舰船基础数据');
      else if (nosaki.fuel !== master.fuel || nosaki.ammo !== master.ammo) moraleReasons.push('野埼未补满');
      if (nosaki.hp <= nosaki.maxHp * 0.75) moraleReasons.push('野埼小破及以上');
      if (nosaki.cond < 30) moraleReasons.push('野埼士气低于 30');
      if (fleet.expedition) moraleReasons.push('远征中');
      if (state.docked.has(nosaki.id)) moraleReasons.push('野埼入渠中');
      if (state.fuel === 0) moraleReasons.push('母港燃料不足');
      moraleShips = fleet.ids.map(id => state.ships[id]).filter(ship => ship && ship.id !== nosaki.id);
      moraleTargets = moraleShips.filter(ship => !state.docked.has(ship.id) && ship.cond < 54);
      if (!moraleTargets.length) moraleReasons.push('无可提升士气的随伴舰');
    }
    return {
      ...fleet, akashi: Boolean(akashi), repairReasons, repairShips, repairTargets,
      canRepair: Boolean(akashi) && !repairReasons.length,
      nosaki, moraleReasons, moraleShips, moraleTargets,
      canBoost: Boolean(nosaki) && !moraleReasons.length,
    };
  });
}

// A timeline records cumulative gains if no port settlement intervenes.
// All gains below the minimum wait collapse into the first guaranteed point.
function timeline(ship, damage, pointAt) {
  const points = [];
  for (let gain = 1; gain <= damage; gain++) {
    const at = pointAt(gain);
    if (points.length && points[points.length - 1].at === at) points[points.length - 1].gain = gain;
    else points.push({ at, gain });
  }
  return { shipId: ship.id, name: ship.name, points };
}

function progress(timelines, elapsed, period, detail, unit, missing = []) {
  const nextPoints = timelines.flatMap(ship => ship.points.filter(point => elapsed !== null && point.at > elapsed));
  const nextAt = elapsed !== null && elapsed >= period && nextPoints.length
    ? Math.min(...nextPoints.map(point => point.at)) : null;
  const lines = timelines.map(ship => `${ship.name}：${ship.points.map(point => `${formatTime(point.at)}（+${point.gain}${unit}）`).join(' → ')}`);
  if (missing.length) lines.push(`${missing.join('、')}：缺少有效入渠时间，无法估算后续节点`);
  return { timelines, nextAt, nextIn: nextAt === null ? null : nextAt - elapsed, detail: [detail, ...lines].join('\n') };
}

function repairProgress(fleets, elapsed) {
  const missing = [];
  const timelines = fleets.filter(fleet => fleet.canRepair).flatMap(fleet => fleet.repairTargets.flatMap(ship => {
    const damage = ship.maxHp - ship.hp;
    // api_ndock_time includes a fixed 30 seconds. Anchorage repair does not;
    // derive each HP interval, then round its node up to a whole second.
    if (!Number.isFinite(ship.dockTime) || ship.dockTime <= 30000) {
      missing.push(ship.name);
      return [];
    }
    const perHp = (ship.dockTime - 30000) / damage;
    return [timeline(ship, damage, gain => Math.max(AKASHI_MS, Math.ceil(perHp * gain / 1000) * 1000))];
  }));
  // The first HP is guaranteed at 20 minutes, including slow-repair ships.
  for (const ship of timelines) {
    if (ship.points[0].at > AKASHI_MS) ship.points[0].at = AKASHI_MS;
  }
  return progress(timelines, elapsed, AKASHI_MS,
    '本轮修理量估计（以回港结果为准）；+时间为下一修理节点相对 20:00 的偏移，已满或预计修满的舰不再提供节点', 'HP', missing);
}

function moraleProgress(fleets, elapsed) {
  const timelines = fleets.filter(fleet => fleet.canBoost).flatMap(fleet => {
    const step = fleet.nosaki.masterId === 1002 ? 3 : 2;
    return fleet.moraleTargets.map(ship => timeline(ship, 54 - ship.cond, gain => Math.ceil(gain / step) * NOSAKI_MS));
  });
  return progress(timelines, elapsed, NOSAKI_MS,
    '本轮给粮量估计：野崎每 15 分钟 +2，改 +3，上限 cond 54；未计自然恢复。+时间为下一节点相对 15:00 的偏移。到期回港即重新计时，不判断给粮成功或失败', 'cond');
}

class Timers {
  constructor() {
    this.akashi = clock();
    this.nosaki = clock();
    this.previous = null;
    this.fleets = [];
    this.lastResponseAt = null;
    this.memberId = null;
  }

  update(path, postBody, current, now) {
    // Wait for a live port response; poi may initially expose cached account data.
    if (path === PORT && current.memberId !== this.memberId) {
      this.akashi = clock();
      this.nosaki = clock();
      this.previous = null;
      this.memberId = current.memberId;
    }
    if (!this.previous && path !== PORT) return;
    const previous = this.previous;
    const before = previous ? inspect(previous) : [];
    const after = inspect(current);

    if (path === PORT) {
      // Only a gain in the previous eligible repair range confirms repair.
      // Battle damage, unrelated ships and docking completions are not evidence.
      const repaired = before.some(fleet => fleet.canRepair && after.some(item => item.id === fleet.id && item.akashi) &&
        fleet.repairTargets.some(old => current.ships[old.id]?.hp > old.hp && !current.docked.has(old.id)));
      if (this.akashi.startedAt === null) {
        reset(this.akashi, now, '首次母港观测，起点估计', true);
      } else if (repaired && now - this.akashi.startedAt >= AKASHI_MS) {
        reset(this.akashi, now, '母港检测到修理范围内 HP 增加');
      } else if (now - this.akashi.startedAt > AKASHI_MS && after.some(fleet => fleet.akashi)) {
        // Keep this warning latched, even for full-HP fleets. An estimated port
        // recalibration must not silently restore a supposedly ready timer.
        this.akashi.warning = '超过 20 分钟回港未检测到 HP 变化，请重新触发明石计时';
      } else if (!this.akashi.warning && !before.some(fleet => fleet.canRepair) && now - this.akashi.startedAt > AKASHI_MS) {
        reset(this.akashi, now, '无可修理编成，母港校时', true);
      }

      if (this.nosaki.startedAt === null && after.some(fleet => fleet.nosaki)) {
        reset(this.nosaki, now, '首次观测野埼，起点估计', true);
      } else if (previous && this.nosaki.startedAt !== null && now - this.nosaki.startedAt >= NOSAKI_MS) {
        // A due port response consumes the global feeding cycle even when
        // Nosaki is absent or feeding conditions fail. Actual morale gains are
        // not the reset trigger; keep them separate from timer readiness.
        reset(this.nosaki, now, '母港给粮到期判定');
      }
    } else if (path === CHANGE && Number(postBody.api_ship_id) !== -2) {
      const targetId = Number(postBody.api_id);
      const sourceId = before.find(fleet => fleet.ids.includes(Number(postBody.api_ship_id)))?.id;
      const affected = after.filter(fleet => fleet.id === targetId || fleet.id === sourceId);
      if (affected.some(fleet => fleet.akashi)) reset(this.akashi, now, '明石舰队编成变更');
      if (affected.some(fleet => fleet.nosaki)) reset(this.nosaki, now, '野埼舰队编成变更');
    }
    // Presets, bulk removal, resupply, equipment changes, sorties and expedition
    // result screens do not by themselves reset these global observation clocks.
    // Removing a support ship keeps its clock, allowing preset-based operation.
    this.previous = current;
    this.fleets = after;
    this.lastResponseAt = now;
  }

  read(now) {
    // Both sides describe this cycle only. Later gain nodes do not move the
    // minimum threshold or consume a cycle; only a reset event can do that.
    const describe = (timer, period, canTrigger) => ({
      ...timer, period, detail: '', nextAt: null, nextIn: null, timelines: [],
      elapsed: timer.startedAt === null ? null : Math.max(0, now - timer.startedAt),
      target: period,
      ready: !timer.warning && timer.startedAt !== null && now - timer.startedAt >= period && canTrigger,
      remaining: timer.startedAt === null ? null : Math.max(0, period - (now - timer.startedAt)),
      overdue: timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt - period),
    });
    const akashi = describe(this.akashi, AKASHI_MS, this.fleets.some(fleet => fleet.canRepair));
    const nosaki = describe(this.nosaki, NOSAKI_MS, this.fleets.some(fleet => fleet.canBoost));
    return {
      akashi: { ...akashi, ...(this.akashi.warning ? {} : repairProgress(this.fleets, akashi.elapsed)) },
      nosaki: { ...nosaki, ...moraleProgress(this.fleets, nosaki.elapsed) },
      fleets: this.fleets,
      lastResponseAt: this.lastResponseAt,
    };
  }
}

function formatTime(ms, roundUp = true) {
  if (ms === null) return '--:--';
  const seconds = (roundUp ? Math.ceil : Math.floor)(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

module.exports = { Timers, snapshot, inspect, formatTime, AKASHI_MS, NOSAKI_MS };
