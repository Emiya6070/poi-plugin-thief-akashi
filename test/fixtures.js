'use strict';

function game() {
  const ship = (id, masterId, hp = 40, cond = 49) => ({
    api_id: id, api_ship_id: masterId, api_nowhp: hp, api_maxhp: 40,
    api_cond: cond, api_fuel: 10, api_bull: 10, api_slot: [-1, -1],
    api_ndock_time: (40 - hp) * 6 * 60000 + 30000,
  });
  return {
    info: {
      basic: { api_member_id: 'test-admiral' },
      fleets: [
        { api_id: 1, api_name: '第一舰队', api_ship: [1, 2, 3, -1, -1, -1], api_mission: [0, 0, 0] },
        { api_id: 2, api_name: '第二舰队', api_ship: [4, 5, -1, -1, -1, -1], api_mission: [0, 0, 0] },
      ],
      ships: { 1: ship(1, 187), 2: ship(2, 1002, 35), 3: ship(3, 9, 30), 4: ship(4, 10), 5: ship(5, 11) },
      repairs: [], equips: {}, resources: [1000, 1000, 1000, 1000],
    },
    constants: { $ships: { 1002: { api_fuel_max: 10, api_bull_max: 10 } } },
  };
}

module.exports = { game };
