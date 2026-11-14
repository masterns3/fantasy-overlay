// Node test: node test/engine.test.js
// Fixtures mirror the real Sleeper + ESPN responses observed for league "Utah Quakers" (week 10, 2026).
const assert = require('assert');
const { Engine } = require('../app/src/main/assets/engine.js');

const ME = '1250522603936829440';
const players = {
  '9758': { full_name: 'C.J. Stroud', last_name: 'Stroud', position: 'QB', team: 'HOU', number: 7 },
  '9221': { full_name: 'Jahmyr Gibbs', last_name: 'Gibbs', position: 'RB', team: 'DET', number: 0 },
  '8122': { full_name: 'Zonovan Knight', last_name: 'Knight', position: 'RB', team: 'ARI', number: 20 },
  '6794': { full_name: 'Justin Jefferson', last_name: 'Jefferson', position: 'WR', team: 'MIN', number: 18 },
  '8144': { full_name: 'Chris Olave', last_name: 'Olave', position: 'WR', team: 'NO', number: 12 },
  '8131': { full_name: 'Isaiah Likely', last_name: 'Likely', position: 'TE', team: 'NYG', number: 9, espn_id: null },
  '8146': { full_name: 'Garrett Wilson', last_name: 'Wilson', position: 'WR', team: 'NYJ', number: 5 },
  '5859': { full_name: 'A.J. Brown', last_name: 'Brown', position: 'WR', team: 'NE', number: 1 },
  '5995': { full_name: 'Justice Hill', last_name: 'Hill', position: 'RB', team: 'BAL', number: 43 },
  '7001': { full_name: 'Stefon Diggs', last_name: 'Diggs', position: 'WR', team: 'WAS', number: 14 },
};
const espnRosters = {
  nyg: [{ id: '4361050', fullName: 'Isaiah Likely', lastName: 'Likely', jersey: '9', position: { abbreviation: 'TE' } },
        { id: '4696981', fullName: 'Cam Skattebo', lastName: 'Skattebo', jersey: '44', position: { abbreviation: 'RB' } }],
  wsh: [{ id: '4426348', fullName: 'Jayden Daniels', lastName: 'Daniels', jersey: '5', position: { abbreviation: 'QB' } },
        { id: '2976212', fullName: 'Stefon Diggs', lastName: 'Diggs', jersey: '14', position: { abbreviation: 'WR' } }],
  det: [{ id: '4429795', fullName: 'Jahmyr Gibbs', lastName: 'Gibbs', jersey: '0', position: { abbreviation: 'RB' } }],
  hou: [{ id: '4432577', fullName: 'C.J. Stroud', lastName: 'Stroud', jersey: '7', position: { abbreviation: 'QB' } }],
};
const ath = (id, type) => ({ athlete: { $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/${id}?lang=en` }, type });
let plays = [
  { id: 'p1', type: { text: 'Coin Toss' }, text: 'GAME', scoringPlay: false, statYardage: 0 },
  { id: 'p2', type: { text: 'Pass Reception' }, text: '(Shotgun) J.Daniels pass deep right to S.Diggs for 30 yards.', statYardage: 30, participants: [ath(4426348, 'passer'), ath(2976212, 'receiver')] },
];
const liveExtra = [
  // Likely 66 yd TD catch -> TOUCHDOWN
  { id: 'p3', type: { text: 'Passing Touchdown' }, text: '(Shotgun) J.Dart pass deep middle to I.Likely for 66 yards, TOUCHDOWN.', scoringPlay: true, scoreValue: 6, statYardage: 66,
    participants: [ath(5000001, 'passer'), ath(4361050, 'receiver'), ath(4361050, 'scorer'), ath(5082424, 'kicker')] },
  // DPI penalty on a Likely target -> ignored
  { id: 'p4', type: { text: 'Penalty' }, text: 'J.Dart pass incomplete deep left to I.Likely. PENALTY on WAS, Defensive Pass Interference, 33 yards', statYardage: 33,
    participants: [ath(5000001, 'passer'), ath(4361050, 'receiver')] },
  // Likely 24 yd catch -> BIG PLAY
  { id: 'p5', type: { text: 'Pass Reception' }, text: 'J.Dart pass short right to I.Likely to WAS 20 for 24 yards (A.Guy).', statYardage: 24,
    participants: [ath(5000001, 'passer'), ath(4361050, 'receiver')] },
  // Likely 8 yd catch -> nothing
  { id: 'p6', type: { text: 'Pass Reception' }, text: 'J.Dart pass short to I.Likely for 8 yards.', statYardage: 8, participants: [ath(5000001, 'passer'), ath(4361050, 'receiver')] },
  // Skattebo TD (not mine) -> nothing
  { id: 'p7', type: { text: 'Rushing Touchdown' }, text: 'C.Skattebo right guard for 1 yard, TOUCHDOWN.', scoringPlay: true, statYardage: 1, participants: [ath(4696981, 'rusher'), ath(4696981, 'scorer')] },
  // Opponent's Diggs: 25 yd catch (no alert: opponent TDs only), then 32 yd TD (opponent alert)
  { id: 'p8', type: { text: 'Pass Reception' }, text: 'J.Daniels pass to S.Diggs for 25 yards.', statYardage: 25, participants: [ath(4426348, 'passer'), ath(2976212, 'receiver')] },
  { id: 'p9', type: { text: 'Passing Touchdown' }, text: '(No Huddle, Shotgun) J.Daniels pass short middle to S.Diggs for 32 yards, TOUCHDOWN.', scoringPlay: true, scoreValue: 6, statYardage: 32,
    participants: [ath(4426348, 'passer'), ath(2976212, 'receiver'), ath(2976212, 'scorer'), ath(5081335, 'kicker')] },
];

const scoreboard = { events: [
  { id: '401873052', shortName: 'WSH @ NYG', status: { period: 2, clock: 600, type: { state: 'in' } },
    competitions: [{ id: '401873052', competitors: [{ team: { abbreviation: 'WSH', color: '5a1414' } }, { team: { abbreviation: 'NYG', color: '0b2265', alternateColor: 'a71930' } }] }] },
  { id: '401873053', shortName: 'NE VS DET', status: { period: 0, clock: 0, type: { state: 'pre' } },
    competitions: [{ id: '401873053', competitors: [{ team: { abbreviation: 'NE', color: '002244' } }, { team: { abbreviation: 'DET', color: '0076b6' } }] }] },
] };

function makeFetch() {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const ok = (d) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(d)) });
    let m;
    if (url.endsWith('/state/nfl')) return ok({ season: '2026', league_season: '2026', week: 10, display_week: 10 });
    if (/\/user\/neils011$/i.test(url)) return ok({ user_id: ME, username: 'neils011' });
    if (/\/leagues\/nfl\/2026$/.test(url)) return ok([{ league_id: 'L1', name: 'Utah Quakers', scoring_settings: { rec: 0.5, pass_td: 4, rush_td: 6, rec_td: 6, rec_yd: 0.1, rush_yd: 0.1, pass_yd: 0.04 } }]);
    if (/\/league\/L1\/users$/.test(url)) return ok([{ user_id: ME, display_name: 'neils011', metadata: { team_name: 'ICU Recievers' } }, { user_id: 'U7', display_name: 'endubuque', metadata: { team_name: 'La Porta Potties' } }]);
    if (/\/league\/L1\/rosters$/.test(url)) return ok([{ roster_id: 2, owner_id: ME, players: Object.keys(players).filter((k) => k !== '7001') }, { roster_id: 7, owner_id: 'U7', players: ['7001'] }]);
    if (/\/matchups\/10$/.test(url)) return ok([
      { roster_id: 2, matchup_id: 4, points: 23.2, starters: ['9758', '9221', '8122', '6794', '8144', '8131', '8146', '5859'], players: Object.keys(players).filter((k) => k !== '7001') },
      { roster_id: 7, matchup_id: 4, points: 43.0, starters: ['7001'] }]);
    if ((m = /\/players\/nfl\/(\d+)$/.exec(url))) return players[m[1]] ? ok(players[m[1]]) : { ok: false, status: 404 };
    if (/\/projections\//.test(url)) return ok([{ player_id: '8131', stats: { pts_half_ppr: 9.1 } }, { player_id: '9221', stats: { pts_half_ppr: 17.5 } }, { player_id: '7001', stats: { pts_half_ppr: 12.0 } }]);
    if (/\/scoreboard$/.test(url)) return ok(scoreboard);
    if ((m = /\/teams\/(\w+)\/roster$/.exec(url))) return ok({ athletes: [{ position: 'offense', items: espnRosters[m[1]] || [] }] });
    if ((m = /\/plays\?limit=(\d+)(?:&page=(\d+))?$/.exec(url))) {
      const L = +m[1], page = +(m[2] || 1);
      return ok({ count: plays.length, pageCount: Math.ceil(plays.length / L), items: plays.slice((page - 1) * L, page * L) });
    }
    throw new Error('unmocked ' + url);
  };
  f.calls = calls;
  return f;
}

(async () => {
  let t = 1_000_000;
  const timers = [];
  const alerts = [];
  const eng = new Engine({
    config: { username: 'neils011', delaySec: 30 },
    fetch: makeFetch(), now: () => t,
    setTimeout: (fn, ms) => timers.push({ at: t + ms, fn }),
    onAlert: (p) => alerts.push(p), log: () => {},
  });
  await eng.init(); await eng.refreshScoreboard(); await eng.mapEspnIds(); await eng.refreshProjections(true);

  assert.strictEqual(eng.league.name, 'Utah Quakers');
  assert.strictEqual(eng.me.name, 'ICU Recievers');
  assert.strictEqual(eng.opp.name, 'La Porta Potties');
  assert.strictEqual(eng.players['8131'].espnId, '4361050', 'Likely mapped to ESPN by name');
  assert.deepStrictEqual(eng.liveGames().map((g) => g.name), ['WSH @ NYG'], 'only WSH@NYG is live with my players');

  // first poll: history only, no alerts
  const g = eng.liveGames()[0];
  assert.strictEqual((await eng.pollGame(g)).length, 0);
  // new plays arrive
  plays = plays.concat(liveExtra);
  const found = await eng.pollGame(g);
  assert.deepStrictEqual(found.map((a) => a.side + ':' + a.type + ':' + a.hero.name + ':' + a.desc), [
    'me:TOUCHDOWN:Isaiah Likely:66 yd pass from J. Dart',
    'me:BIG PLAY:Isaiah Likely:24 yd catch from J. Dart',
    'opp:TOUCHDOWN:Stefon Diggs:32 yd pass from J. Daniels',
  ]);
  assert.strictEqual(found[2].delta, 9.7, 'opponent TD: 6 + 3.2 + 0.5');
  assert.strictEqual(found[0].delta, 13.1, '6 TD + 6.6 yds + 0.5 rec');
  assert.strictEqual(found[1].delta, 2.9);
  // re-poll does not duplicate
  assert.strictEqual((await eng.pollGame(g)).length, 0);

  // spoiler delay + spacing
  found.forEach((a) => eng.enqueue(a));
  assert.strictEqual(timers.length, 3);
  assert.strictEqual(timers[0].at - t, 30000, '30s spoiler delay');
  assert.ok(timers[1].at - timers[0].at >= 10000, 'alerts spaced out');
  timers.sort((a, b) => a.at - b.at).forEach((x) => { t = x.at; x.fn(); });
  timers.length = 0;
  assert.strictEqual(alerts.length, 3);
  const o = alerts[2];
  assert.strictEqual(o.side, 'opp');
  assert.strictEqual(o.opp.before, 43); assert.strictEqual(o.opp.after, 52.7);
  assert.strictEqual(o.me.before, 39.2, 'my score includes my two earlier alerts');
  assert.ok(o.wp.after < o.wp.before, 'my win prob drops on opponent TD: ' + JSON.stringify(o.wp));
  const a0 = alerts[0];
  assert.strictEqual(a0.me.before, 23.2); assert.strictEqual(a0.me.after, 36.3);
  assert.strictEqual(a0.opp.name, 'La Porta Potties'); assert.strictEqual(a0.opp.score, 43);
  assert.strictEqual(a0.player.team, 'NYG'); assert.strictEqual(a0.player.c2, '#0b2265');
  assert.ok(a0.wp && a0.wp.after > a0.wp.before, 'win prob rises: ' + JSON.stringify(a0.wp));
  assert.strictEqual(alerts[1].me.before, 36.3, 'second alert builds on first (Sleeper lag)');

  // pick-six thrown by my QB is not celebrated; my QB TD pass is
  const qbG = { id: 'x', name: 'HOU @ CLE' };
  eng.players['9758'].espnId = '4432577'; eng.byEspn['4432577'] = eng.players['9758'];
  assert.strictEqual(eng.evaluate({ id: 'q1', type: { text: 'Interception Return Touchdown' }, scoringPlay: true, statYardage: 40, text: 'C.Stroud pass intercepted',
    participants: [ath(4432577, 'passer'), ath(999, 'interceptor'), ath(999, 'scorer')] }, qbG), null);
  const qb = eng.evaluate({ id: 'q2', type: { text: 'Passing Touchdown' }, scoringPlay: true, statYardage: 12, text: '(Shotgun) C.Stroud pass short left to N.Collins for 12 yards, TOUCHDOWN.',
    participants: [ath(4432577, 'passer'), ath(888, 'receiver'), ath(888, 'scorer')] }, qbG);
  assert.strictEqual(qb.desc, '12 yd TD pass to N. Collins'); assert.strictEqual(qb.delta, 4.5);
  // QB 25 yd completion is not big (threshold 40); 45 is
  assert.strictEqual(eng.evaluate({ id: 'q3', type: { text: 'Pass Reception' }, statYardage: 25, text: 'C.Stroud pass to X.Y for 25 yards', participants: [ath(4432577, 'passer'), ath(1, 'receiver')] }, qbG), null);
  assert.ok(eng.evaluate({ id: 'q4', type: { text: 'Pass Reception' }, statYardage: 45, text: 'C.Stroud pass to X.Y for 45 yards', participants: [ath(4432577, 'passer'), ath(1, 'receiver')] }, qbG));

  // bench player (Justice Hill) ignored unless benchAlerts
  eng.players['5995'].espnId = '777'; eng.byEspn['777'] = eng.players['5995'];
  const benchPlay = { id: 'b1', type: { text: 'Rushing Touchdown' }, scoringPlay: true, statYardage: 3, text: 'J.Hill up the middle for 3 yards, TOUCHDOWN.', participants: [ath(777, 'rusher'), ath(777, 'scorer')] };
  assert.strictEqual(eng.evaluate(benchPlay, qbG), null);
  eng.cfg.benchAlerts = true;
  assert.strictEqual(eng.evaluate(benchPlay, qbG).desc, '3 yd TD run');
  eng.cfg.benchAlerts = false;

  // replay in demo mode celebrates everyone's TDs/big plays in the game
  const demo = await eng.replay('401873052', true);
  assert.deepStrictEqual(demo.map((a) => a.hero.name), ['Stefon Diggs', 'Isaiah Likely', 'Isaiah Likely', 'Cam Skattebo', 'Stefon Diggs', 'Stefon Diggs']);
  const mineOnly = await eng.replay('401873052', false);
  assert.deepStrictEqual(mineOnly.map((a) => a.side + ':' + a.type), ['me:TOUCHDOWN', 'me:BIG PLAY', 'opp:TOUCHDOWN']);
  // opponent alerts can be turned off
  eng.cfg.oppAlerts = false;
  assert.deepStrictEqual((await eng.replay('401873052', false)).map((a) => a.side), ['me', 'me']);
  eng.cfg.oppAlerts = true;

  // test alert uses real league data
  alerts.length = 0; eng.testAlert();
  assert.strictEqual(alerts[0].league, 'Utah Quakers');
  assert.ok(eng.me.starters.map((id) => eng.players[id].name).includes(alerts[0].player.name));

  alerts.length = 0; eng.testAlert('opp');
  assert.strictEqual(alerts[0].side, 'opp'); assert.strictEqual(alerts[0].player.name, 'Stefon Diggs');
  console.log('All engine tests passed ✔');
  console.log('Opponent alert payload:', JSON.stringify(o));
  console.log('Sample alert payload:', JSON.stringify(a0, null, 1));
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
