/*
 * Fantasy Overlay engine
 * Watches your Sleeper roster + ESPN live play-by-play and emits celebration alerts.
 * Runs inside the TV app's WebView, and in Node for tests (inject `fetch`, `now`, `setTimeout`).
 */
(function (root) {
  'use strict';

  const SLEEPER = 'https://api.sleeper.app/v1';
  const SLEEPER_COM = 'https://api.sleeper.com';
  const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
  const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

  const TO_ESPN = { WAS: 'WSH' };                       // Sleeper abbr -> ESPN abbr where they differ
  const FROM_ESPN = { WSH: 'WAS' };
  const toEspn = (t) => TO_ESPN[t] || t;
  const fromEspn = (t) => FROM_ESPN[t] || t;

  const DEFAULTS = {
    username: '', leagueId: '',
    bigPlayYards: 20,      // RB/WR/TE run or catch of this many yards = BIG PLAY
    qbBigPlayYards: 40,    // QB completion of this many yards = BIG PLAY
    delaySec: 30,          // spoiler delay: wait this long after ESPN reports the play
    benchAlerts: false,    // also celebrate bench players
    oppAlerts: true,       // show a (sad) alert when your opponent's starters score a TD
    sound: true,
    pollMs: 8000,
  };

  // ---------- helpers ----------
  const r1 = (n) => Math.round(n * 10) / 10;
  function normName(n) {
    return String(n || '').toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
      .replace(/[^a-z]/g, '');
  }
  function athleteId(ref) {
    const m = /athletes\/(\d+)/.exec(String(ref || ''));
    return m ? m[1] : (/^\d+$/.test(String(ref || '')) ? String(ref) : null);
  }
  function erf(x) { // Abramowitz-Stegun 7.1.26
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  function shade(hex, amt) { // amt -1..1
    const h = String(hex || '#334').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    r = f(r); g = f(g); b = f(b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  const spaceAbbr = (a) => (a ? a.replace(/^([A-Z][a-z]?)\.(?=\S)/, '$1. ') : a);

  class Engine {
    constructor(opts = {}) {
      this.cfg = Object.assign({}, DEFAULTS, opts.config || {});
      this._fetch = opts.fetch || ((u) => fetch(u));
      this.onAlert = opts.onAlert || (() => {});
      this.onStatus = opts.onStatus || (() => {});
      this.log = opts.log || (() => {});
      this.now = opts.now || (() => Date.now());
      this.setTimer = opts.setTimeout || ((f, ms) => setTimeout(f, ms));

      this.players = {};       // sleeperId -> {id,name,last,pos,team,num,espnId}
      this.byEspn = {};        // espnId -> player (my roster)
      this.oppByEspn = {};     // espnId -> player (opponent starters)
      this.espnRosters = {};   // ESPN abbr -> {at, byName, byLastNum, byId}
      this.teamColors = {};    // Sleeper abbr -> {c1,c2}
      this.games = {};         // eventId -> game
      this.teamFrac = {};      // Sleeper abbr -> fraction of game remaining
      this.cursor = {};        // eventId -> plays already processed
      this.seen = new Set();   // alert keys already emitted
      this.projections = {}; this.projAt = 0;
      this.localAdj = 0;       // points from alerts that Sleeper hasn't reflected yet
      this.oppAdj = 0;
      this.lastQueuedAt = 0;
      this.status = { phase: 'idle' };
      this.running = false;
    }

    async j(url) {
      const r = await this._fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.replace(/\?.*/, ''));
      return r.json();
    }
    setStatus(p) { Object.assign(this.status, p); try { this.onStatus(this.status); } catch (e) { /* ignore */ } }

    // ---------- Sleeper ----------
    async init() {
      this.setStatus({ phase: 'connecting', error: null });
      const st = await this.j(SLEEPER + '/state/nfl');
      this.season = st.league_season || st.season;
      this.week = st.display_week || st.week;
      const uname = String(this.cfg.username || '').trim();
      if (!uname) throw new Error('Enter your Sleeper username');
      const user = await this.j(SLEEPER + '/user/' + encodeURIComponent(uname));
      if (!user || !user.user_id) throw new Error('Sleeper user "' + uname + '" not found');
      this.userId = user.user_id;
      const leagues = await this.j(SLEEPER + '/user/' + this.userId + '/leagues/nfl/' + this.season);
      if (!leagues || !leagues.length) throw new Error('No Sleeper leagues found for ' + this.season);
      this.leagues = leagues.map((l) => ({ id: l.league_id, name: l.name }));
      const lg = leagues.find((l) => l.league_id === this.cfg.leagueId) || leagues[0];
      this.league = lg;
      this.scoring = lg.scoring_settings || {};
      const rec = this.scoring.rec || 0;
      this.projKey = rec >= 1 ? 'pts_ppr' : rec > 0 ? 'pts_half_ppr' : 'pts_std';
      const [users, rosters] = await Promise.all([
        this.j(SLEEPER + '/league/' + lg.league_id + '/users'),
        this.j(SLEEPER + '/league/' + lg.league_id + '/rosters'),
      ]);
      this.teamNames = {};
      users.forEach((u) => { this.teamNames[u.user_id] = (u.metadata && u.metadata.team_name) || u.display_name; });
      this.rosterOwner = {};
      rosters.forEach((r) => { this.rosterOwner[r.roster_id] = r.owner_id; });
      const mine = rosters.find((r) => r.owner_id === this.userId || (r.co_owners || []).includes(this.userId));
      if (!mine) throw new Error('Could not find your team in ' + lg.name);
      this.myRosterId = mine.roster_id;
      this.myRoster = mine.players || [];
      await this.refreshMatchup();
      this.setStatus({ phase: 'ready', league: lg.name, leagueId: lg.league_id, leagues: this.leagues, week: this.week });
    }

    async refreshMatchup() {
      const ms = await this.j(SLEEPER + '/league/' + this.league.league_id + '/matchups/' + this.week);
      const me = ms.find((m) => m.roster_id === this.myRosterId);
      const opp = me && me.matchup_id != null ? ms.find((m) => m.matchup_id === me.matchup_id && m.roster_id !== me.roster_id) : null;
      const prev = this.me ? this.me.points : null;
      const prevOpp = this.opp ? this.opp.points : null;
      const clean = (a) => (a || []).filter((x) => x && x !== '0');
      this.me = {
        name: this.teamNames[this.userId] || 'My Team',
        points: me ? (me.points || 0) : 0,
        starters: clean(me && me.starters),
        roster: clean((me && me.players) || this.myRoster),
      };
      this.opp = opp ? {
        name: this.teamNames[this.rosterOwner[opp.roster_id]] || 'Opponent',
        points: opp.points || 0,
        starters: clean(opp.starters),
      } : null;
      if (prev !== null && this.me.points !== prev) this.localAdj = 0; // Sleeper caught up
      if (prevOpp !== null && this.opp && this.opp.points !== prevOpp) this.oppAdj = 0;
      await this.loadPlayers(this.me.roster.concat(this.opp ? this.opp.starters : []));
      this.setStatus({
        team: this.me.name,
        me: { name: this.me.name, points: this.me.points },
        opp: this.opp && { name: this.opp.name, points: this.opp.points },
        starters: this.me.starters.map((id) => this.players[id] && this.players[id].name).filter(Boolean),
      });
    }

    async loadPlayers(ids) {
      const need = [...new Set(ids)].filter((id) => id && !this.players[id]);
      await Promise.all(need.map(async (id) => {
        if (!/^\d+$/.test(id)) { this.players[id] = { id, name: id + ' D/ST', last: id, pos: 'DEF', team: id, num: '' }; return; }
        try {
          const p = await this.j(SLEEPER_COM + '/players/nfl/' + id);
          this.players[id] = {
            id, name: p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
            last: p.last_name || '', pos: p.position, team: p.team, num: p.number != null ? String(p.number) : '',
            espnId: p.espn_id ? String(p.espn_id) : null,
          };
        } catch (e) { this.log('player ' + id + ': ' + e.message); }
      }));
    }

    async refreshProjections(force) {
      if (!force && this.now() - this.projAt < 30 * 60e3) return;
      const pos = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => 'position[]=' + p).join('&');
      const arr = await this.j(SLEEPER_COM + '/projections/nfl/' + this.season + '/' + this.week + '?season_type=regular&' + pos);
      const m = {};
      (arr || []).forEach((p) => { if (p && p.player_id && p.stats) m[p.player_id] = p.stats[this.projKey] || 0; });
      this.projections = m; this.projAt = this.now();
    }

    // ---------- ESPN ----------
    async espnRoster(abbr) {
      const c = this.espnRosters[abbr];
      if (c && this.now() - c.at < 6 * 3600e3) return c;
      const d = await this.j(ESPN_SITE + '/teams/' + abbr.toLowerCase() + '/roster');
      const byName = {}, byLastNum = {}, byId = {};
      (d.athletes || []).forEach((g) => (g.items || []).forEach((a) => {
        const name = a.fullName || a.displayName || '';
        byName[normName(name)] = a.id;
        byLastNum[normName(a.lastName || name.split(' ').slice(-1)[0]) + '#' + a.jersey] = a.id;
        byId[a.id] = { name, num: a.jersey || '', pos: (a.position && a.position.abbreviation) || '', team: fromEspn(abbr) };
      }));
      return (this.espnRosters[abbr] = { at: this.now(), byName, byLastNum, byId });
    }

    async mapEspnIds() {
      const oppIds = this.opp ? this.opp.starters : [];
      for (const id of this.me.roster.concat(oppIds)) {
        const p = this.players[id];
        if (!p || p.espnId || !p.team || p.pos === 'DEF') continue;
        try {
          const r = await this.espnRoster(toEspn(p.team));
          p.espnId = r.byName[normName(p.name)] || r.byLastNum[normName(p.last) + '#' + p.num] || null;
          if (!p.espnId) this.log('No ESPN match for ' + p.name + ' (' + p.team + ')');
        } catch (e) { this.log('roster ' + p.team + ': ' + e.message); }
      }
      this.byEspn = {};
      this.me.roster.forEach((id) => { const p = this.players[id]; if (p && p.espnId) this.byEspn[p.espnId] = p; });
      this.oppByEspn = {};
      oppIds.forEach((id) => { const p = this.players[id]; if (p && p.espnId) this.oppByEspn[p.espnId] = p; });
      const unmatched = this.me.roster.map((id) => this.players[id]).filter((p) => p && p.pos !== 'DEF' && !p.espnId).map((p) => p.name);
      this.setStatus({ unmatched });
    }

    async refreshScoreboard() {
      const d = await this.j(ESPN_SITE + '/scoreboard');
      const games = {};
      for (const ev of d.events || []) {
        const comp = (ev.competitions || [])[0];
        if (!comp) continue;
        const s = ev.status || comp.status || {};
        const st = s.type || {};
        const teams = (comp.competitors || []).map((c) => {
          const t = c.team || {};
          const ab = fromEspn(t.abbreviation);
          if (t.color) this.teamColors[ab] = { c2: '#' + t.color, c1: shade('#' + t.color, -0.55) };
          return ab;
        });
        games[ev.id] = { id: ev.id, compId: comp.id || ev.id, name: ev.shortName || ev.name, teams,
          state: st.state, period: s.period || 0, clock: s.clock || 0 };
      }
      this.games = games;
      this.teamFrac = {};
      Object.values(games).forEach((g) => {
        const f = g.state === 'pre' ? 1 : g.state === 'post' ? 0
          : g.period > 4 ? 0.02 : Math.max(0, ((4 - g.period) * 900 + g.clock) / 3600);
        g.teams.forEach((t) => { this.teamFrac[t] = f; });
      });
      const rosterTeams = new Set(this.me ? this.me.roster.map((id) => this.players[id] && this.players[id].team) : []);
      this.setStatus({
        replayGames: Object.values(games).filter((g) => g.state !== 'pre')
          .map((g) => ({ id: g.id, name: g.name, state: g.state, mine: g.teams.some((t) => rosterTeams.has(t)) })),
      });
    }

    watchedIds(all) {
      return (all || this.cfg.benchAlerts ? this.me.roster : this.me.starters);
    }
    liveGames() {
      const ids = this.watchedIds().concat(this.cfg.oppAlerts && this.opp ? this.opp.starters : []);
      const teams = new Set(ids.map((id) => this.players[id] && this.players[id].team).filter(Boolean));
      return Object.values(this.games).filter((g) => g.state === 'in' && g.teams.some((t) => teams.has(t)));
    }

    async fetchPlays(g, from) {
      const base = ESPN_CORE + '/events/' + g.id + '/competitions/' + g.compId + '/plays';
      const head = await this.j(base + '?limit=1');
      const count = head.count || 0;
      const L = 25, items = [];
      if (count > from) {
        for (let page = Math.floor(from / L) + 1; page <= Math.ceil(count / L); page++) {
          const d = await this.j(base + '?limit=' + L + '&page=' + page);
          const start = (page - 1) * L;
          (d.items || []).forEach((it, i) => { if (start + i >= from) items.push(it); });
        }
      }
      return { count, items };
    }

    async pollGame(g) {
      if (!(g.id in this.cursor)) {              // first sight of this game: don't alert on history
        const { count } = await this.fetchPlays(g, Infinity);
        this.cursor[g.id] = count;
        return [];
      }
      const from = Math.max(0, this.cursor[g.id] - 3);   // re-check last few plays (reviews, late TD flags)
      const { count, items } = await this.fetchPlays(g, from);
      this.cursor[g.id] = count;
      return this.evaluateBoth(items, g, {});
    }

    // ---------- play detection ----------
    evaluate(play, g, opts = {}) {
      if (!play || !play.id) return null;
      const type = (play.type && play.type.text) || '';
      const text = play.text || '';
      if (/penalty|kickoff|punt|timeout|end (of )?(period|quarter|half|game)|two-minute|coin toss|extra point|two-point/i.test(type)) return null;
      if (/no play/i.test(text)) return null;

      const parts = (play.participants || []).map((p) => ({
        id: athleteId(p.athlete && (p.athlete.$ref || p.athlete.id)), type: p.type,
      })).filter((p) => p.id);

      const opp = opts.side === 'opp';
      let lookup;
      if (opp) {
        const watch = new Set((this.opp ? this.opp.starters : []).map((id) => this.players[id] && this.players[id].espnId).filter(Boolean));
        lookup = (eid) => (watch.has(eid) ? this.oppByEspn[eid] : null);
      } else if (opts.everyone) {
        lookup = (eid) => opts.everyone[eid] || null;
      } else {
        const watch = new Set(this.watchedIds(opts.all).map((id) => this.players[id] && this.players[id].espnId).filter(Boolean));
        lookup = (eid) => (watch.has(eid) ? this.byEspn[eid] : null);
      }
      const mine = parts.filter((p) => /^(passer|receiver|rusher|scorer)$/.test(p.type) && lookup(p.id));
      if (!mine.length) return null;

      const isTD = !!play.scoringPlay && /touchdown/i.test(type);
      if (isTD && /interception|fumble/i.test(type) && !mine.some((m) => m.type === 'scorer')) return null; // pick-six against your QB
      const yds = Number(play.statYardage) || 0;
      const roles = {};
      mine.forEach((m) => { (roles[m.id] = roles[m.id] || new Set()).add(m.type); });
      if (opp && !isTD) return null;               // opponent: touchdowns only
      const big = !isTD && Object.values(roles).some((r) =>
        ((r.has('rusher') || r.has('receiver')) && yds >= this.cfg.bigPlayYards) ||
        (r.has('passer') && yds >= this.cfg.qbBigPlayYards));
      if (!isTD && !big) return null;
      if (/interception|fumble|sack/i.test(type) && !isTD) return null;

      const pre = (opp ? 'opp:' : '') + play.id;
      const key = pre + (isTD ? ':td' : ':big');
      if (this.seen.has(key) || (!isTD && this.seen.has(pre + ':td'))) return null;
      this.seen.add(key);
      if (isTD) this.seen.add(pre + ':big');

      const heroId = (mine.find((m) => m.type === 'scorer') || mine.find((m) => m.type === 'receiver' || m.type === 'rusher') || mine[0]).id;
      const hero = lookup(heroId);
      const hr = roles[heroId];

      // fantasy points for everyone on your team involved in the play
      const S = this.scoring || {};
      let delta = 0;
      Object.entries(roles).forEach(([eid, r]) => {
        const pl = lookup(eid) || {};
        if (r.has('passer')) delta += yds * (S.pass_yd || 0) + (isTD ? (S.pass_td || 0) : 0);
        if (r.has('receiver')) delta += (S.rec || 0) + yds * (S.rec_yd || 0) + (isTD ? (S.rec_td || 0) : 0) + (pl.pos === 'TE' ? (S.bonus_rec_te || 0) : 0);
        if (r.has('rusher')) delta += yds * (S.rush_yd || 0) + (isTD ? (S.rush_td || 0) : 0);
      });

      const passer = (/([A-Z][a-z]?\.\s?[A-Z][\w'-]+)\s+pass\b/.exec(text) || [])[1];
      const target = (/\bpass\b[^.]*?\bto\s+([A-Z][a-z]?\.\s?[A-Z][\w'-]+)/.exec(text) || [])[1];
      let desc;
      if (hr.has('receiver') || (hr.has('scorer') && /pass/i.test(type) && !hr.has('passer'))) desc = yds + ' yd ' + (isTD ? 'pass' : 'catch') + (passer ? ' from ' + spaceAbbr(passer) : '');
      else if (hr.has('rusher')) desc = yds + ' yd ' + (isTD ? 'TD run' : 'run');
      else if (hr.has('passer')) desc = yds + ' yd ' + (isTD ? 'TD pass' : 'pass') + (target ? ' to ' + spaceAbbr(target) : '');
      else desc = type;

      return { key, side: opp ? 'opp' : 'me', type: isTD ? 'TOUCHDOWN' : 'BIG PLAY', hero, desc, delta: r1(delta), game: g && g.name, playId: play.id };
    }

    evaluateBoth(items, g, opts) {
      const out = [];
      items.forEach((p) => {
        const a = this.evaluate(p, g, opts); if (a) out.push(a);
        if (this.cfg.oppAlerts && this.opp && !opts.everyone) { const b = this.evaluate(p, g, Object.assign({}, opts, { side: 'opp' })); if (b) out.push(b); }
      });
      return out;
    }

    // ---------- projections / win probability ----------
    lineupProj(points, starters) {
      let rem = 0, fr = 0;
      starters.forEach((id) => {
        const p = this.players[id];
        const f = this.teamFrac[p ? p.team : id] || 0;
        rem += (this.projections[id] || 0) * f; fr += f;
      });
      return { proj: points + rem, frac: starters.length ? fr / starters.length : 0 };
    }
    winProb(myPts, oppPts) {
      if (!this.opp || !Object.keys(this.projections).length) return null;
      const a = this.lineupProj(myPts, this.me.starters);
      const b = this.lineupProj(oppPts, this.opp.starters);
      const frac = (a.frac + b.frac) / 2;
      const diff = a.proj - b.proj;
      let wp = frac <= 0 ? (diff > 0 ? 100 : diff < 0 ? 0 : 50) : Math.round(phi(diff / Math.max(3, 26 * Math.sqrt(frac))) * 100);
      if (frac > 0) wp = Math.min(99, Math.max(1, wp));
      return { proj: a.proj, oppProj: b.proj, wp };
    }

    // ---------- alert delivery ----------
    enqueue(a, delayMs) {
      const d = delayMs != null ? delayMs : this.cfg.delaySec * 1000;
      const fireAt = Math.max(this.now() + d, this.lastQueuedAt + 13000);
      this.lastQueuedAt = fireAt;
      this.setTimer(() => this.fire(a), fireAt - this.now());
    }

    buildPayload(a) {
      const live = !(a.test || a.replay);
      const p = a.hero || {};
      const col = this.teamColors[p.team] || { c1: '#0b2a6e', c2: '#2f66d6' };
      const player = { name: p.name || '', pos: p.pos || '', team: p.team || '', num: p.num || '', c1: col.c1, c2: col.c2 };
      const myNow = r1(this.me.points + (live ? this.localAdj : 0));
      const oppNow = this.opp ? r1(this.opp.points + (live ? this.oppAdj : 0)) : null;
      const base = { type: a.type, side: a.side || 'me', league: this.league ? this.league.name : '', desc: a.desc, player, test: !!a.test };
      if (a.side === 'opp') {
        const oppAfter = r1(oppNow + a.delta);
        const w0 = this.winProb(myNow, oppNow), w1 = this.winProb(myNow, oppAfter);
        return Object.assign(base, {
          me: { name: this.me.name, before: myNow, after: myNow },
          opp: { name: this.opp.name, score: oppNow, before: oppNow, after: oppAfter },
          proj: w0 ? { before: r1(w0.oppProj), after: r1(w1.oppProj) } : null,
          wp: w0 ? { before: w0.wp, after: w1.wp } : null,
        });
      }
      const after = r1(myNow + a.delta);
      const w0 = this.winProb(myNow, oppNow || 0), w1 = this.winProb(after, oppNow || 0);
      return Object.assign(base, {
        me: { name: this.me.name, before: myNow, after },
        opp: this.opp ? { name: this.opp.name, score: oppNow } : null,
        proj: w0 ? { before: r1(w0.proj), after: r1(w1.proj) } : null,
        wp: w0 ? { before: w0.wp, after: w1.wp } : null,
      });
    }

    fire(a) {
      const payload = this.buildPayload(a);
      if (!a.test && !a.replay) { if (a.side === 'opp') this.oppAdj += a.delta; else this.localAdj += a.delta; }
      this.setStatus({ lastAlert: { at: this.now(), type: a.type, player: payload.player.name, desc: a.desc } });
      this.onAlert(payload);
    }

    // ---------- main loop ----------
    async start() {
      this.running = true;
      try {
        await this.init();
        await this.refreshScoreboard();
        await this.mapEspnIds();
        await this.refreshProjections(true).catch((e) => this.log('projections: ' + e.message));
      } catch (e) {
        this.setStatus({ phase: 'error', error: e.message });
        this.setTimer(() => { if (this.running) this.start(); }, 60e3);
        return;
      }
      this.setStatus({ phase: 'running' });
      this.loop();
    }
    stop() { this.running = false; }

    loop() {
      let lastSlow = this.now(), lastState = this.now();
      const tick = async () => {
        if (!this.running) return;
        try {
          if (this.now() - lastState > 30 * 60e3) {           // new week?
            lastState = this.now();
            const st = await this.j(SLEEPER + '/state/nfl');
            const wk = st.display_week || st.week;
            if (wk !== this.week) { this.week = wk; this.cursor = {}; this.seen = new Set(); this.projAt = 0; this.localAdj = 0; this.oppAdj = 0; }
          }
          if (this.now() - lastSlow > 60e3) {
            lastSlow = this.now();
            await this.refreshScoreboard();
            await this.refreshMatchup();
            await this.mapEspnIds();
            this.refreshProjections().catch(() => {});
          }
          const live = this.liveGames();
          for (const g of live) (await this.pollGame(g)).forEach((a) => this.enqueue(a));
          this.setStatus({ phase: 'running', live: live.map((g) => g.name), lastPoll: this.now(), error: null });
        } catch (e) {
          this.setStatus({ error: e.message }); this.log(e.message);
        }
        this.setTimer(tick, this.liveGames().length ? this.cfg.pollMs : 60e3);
      };
      tick();
    }

    // ---------- test + replay ----------
    testAlert(side) {
      if (!this.me) throw new Error('Not connected to Sleeper yet');
      const opp = side === 'opp' && this.opp;
      const ids = (opp ? this.opp.starters : this.me.starters).filter((id) => this.players[id] && !/DEF|K/.test(this.players[id].pos));
      const p = this.players[ids[Math.floor(Math.random() * ids.length)]] || { name: 'Test Player', pos: 'WR', team: '', num: '' };
      const S = this.scoring || {};
      const yds = 15 + Math.floor(Math.random() * 55);
      const delta = p.pos === 'QB' ? yds * (S.pass_yd || 0.04) + (S.pass_td || 4)
        : p.pos === 'RB' ? yds * (S.rush_yd || 0.1) + (S.rush_td || 6)
          : (S.rec || 0) + yds * (S.rec_yd || 0.1) + (S.rec_td || 6);
      const desc = p.pos === 'QB' ? yds + ' yd TD pass' : p.pos === 'RB' ? yds + ' yd TD run' : yds + ' yd pass';
      this.fire({ type: 'TOUCHDOWN', side: opp ? 'opp' : 'me', hero: p, desc: desc + ' · test', delta: r1(delta), test: true });
    }

    // Run every play of a game (finished or live) through the detector, firing alerts back to back.
    // everyone=true celebrates every offensive TD/big play in the game (demo mode).
    async replay(eventId, everyone) {
      await this.refreshScoreboard();
      const g = this.games[eventId] || { id: eventId, compId: eventId, name: 'Replay', teams: [] };
      let opts = { all: true };
      if (everyone) {
        const map = {};
        for (const t of g.teams) {
          try { const r = await this.espnRoster(toEspn(t)); Object.assign(map, r.byId); } catch (e) { this.log(e.message); }
        }
        opts = { everyone: map };
      }
      const { items } = await this.fetchPlays(g, 0);
      const saved = this.seen; this.seen = new Set();
      const alerts = this.evaluateBoth(items, g, opts);
      this.seen = saved;
      this.lastQueuedAt = 0;
      alerts.forEach((a, i) => { a.replay = true; this.setTimer(() => this.fire(a), 500 + i * 14000); });
      this.setStatus({ replay: { game: g.name, alerts: alerts.length, everyone: !!everyone } });
      return alerts;
    }
  }

  const api = { Engine, DEFAULTS, normName, athleteId, shade };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FantasyEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
