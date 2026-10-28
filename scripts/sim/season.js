/* ------------------------------------------------------------------
   Pełny sezon PGE Ekstraligi przez PRAWDZIWE API aplikacji (server.js na atrapie bazy).
   Czas płynie według zegara symulacji (clock.js), więc blokady, przypomnienia i scraper
   działają tak, jak na produkcji - tylko szybciej.

   Typerzy klikają (submit-all) jak w telefonie, admin zatwierdza wyniki ze scrapera
   (dwa fikcyjne portale z wynikami), przekłada mecze po deszczu, wpisuje walkowery,
   rozstawia puchar, dodaje play-off i zamyka sezon. Po każdej kolejce symulacja
   NIEZALEŻNIE przelicza punkty, ranking, tabelę i puchar i porównuje z tym, co pokazuje API.
------------------------------------------------------------------- */
const { rngOf, TEAMS, simulateMatch, expectedTable, toScore } = require('./engine');
const { PERSONAS, predictFor, jokerPick, longTermPick, LUBLIN } = require('./personas');

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const Y = 2027;
const LOCK = 1 * MIN;
const PORTAL_A = 'https://wyniki-a.example/ekstraliga/wyniki';   // tabela całego sezonu
const PORTAL_B = 'https://zuzel-b.example/ostatnie-wyniki';      // lista z ostatnich 10 dni
const SC = { exact: 5, diff: 3, winner: 2, motrBonus: 1, jokerMultiplier: 2, longTermEach: 10 };
const SHORT_A = { Lublin: 'Motor Lublin', Wrocław: 'Sparta Wrocław', Toruń: 'KS Toruń', Częstochowa: 'Włókniarz Częstochowa', Gorzów: 'Stal Gorzów', Leszno: 'Unia Leszno', Grudziądz: 'GKM Grudziądz', 'Zielona Góra': 'Falubaz Zielona Góra' };
const SHORT_B = { Lublin: 'Motor', Wrocław: 'Sparta', Toruń: 'Apator', Częstochowa: 'Włókniarz', Gorzów: 'Stal', Leszno: 'Unia', Grudziądz: 'GKM', 'Zielona Góra': 'Falubaz' };
const cityOf = t => Object.keys(SHORT_A).find(c => t.endsWith(c));
const shortT = t => SHORT_A[cityOf(t)];

async function runSeason({ seed = 2027, clock, log = () => {} }) {
    process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'symulacja';
    process.env.ENABLE_SCHEDULER = 'false';
    process.env.CRON_SECRET = '';
    delete process.env.VAPID_PUBLIC_KEY;

    const { useFakeDb } = require('../demo');
    const db = useFakeDb();
    const app = require('../../server');
    const jobs = require('../../services/jobs');
    const push = require('../../services/push');
    const cache = require('../../services/cache');

    const rng = rngOf(seed);
    const E = expectedTable(300, seed + 1);
    const fmt = t => new Date(t).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const fmtDay = t => new Date(t).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long' });

    /* ---------------- niezmienniki ---------------- */
    const INV = {
        I1: 'Suma punktów w rankingu = punkty za mecze + typy sezonowe',
        I2: 'Kolejność i miejsca w rankingu według regulaminu (punkty → dokładne → różnica, ex aequo tylko przy pełnym remisie)',
        I3: 'Punkty każdego typu zgodne z niezależnym przeliczeniem (5/3/2/0, Złoty Kask, Joker)',
        I4: 'Joker: najwyżej jeden aktywny na gracza, przenoszenie zgodne z regulaminem, wraca po walkowerze',
        I5: 'Blokada: typ po blokadzie odrzucony, wcześniejszy typ nietknięty; zapisane dokładnie to, co gracz wysłał',
        I6: 'Cudze typy ukryte przed blokadą (strona główna), jawne po blokadzie',
        I7: 'Tabela ligi zgodna z niezależnym przeliczeniem (2/1/0, bonus za dwumecz, bez play-off)',
        I8: 'Przełożenie przed blokadą = typy otwarte, po blokadzie = zamrożone',
        I9: 'Walkower: typy anulowane (także po rozliczeniu), mecz liczy się do tabeli',
        I10: 'Zwycięzca kolejki = najwięcej punktów w kolejce (remis = kilku), ostateczny po całej kolejce',
        I11: 'Puchar: zwycięzca według punktów w kolejce, potem dokładnych, mniejszej łącznej pomyłki, rozstawienia',
        I12: 'Przypomnienia push: tylko do graczy bez typu, każdy mecz raz',
        I13: 'Wyniki ze scrapera trafiają do meczu dopiero po zatwierdzeniu i są zgodne z oficjalnym wynikiem; mecz w trakcie jest ignorowany',
        I14: 'Typy sezonowe: zakryte do startu, jawne potem, +10 pkt za każde trafienie po zamknięciu sezonu',
        I15: 'Mistrz Typera i niespodzianka: tylko po zamknięciu sezonu, tylko dla zwycięzcy, nagroda tajna dla innych'
    };
    const inv = Object.fromEntries(Object.keys(INV).map(k => [k, { checks: 0, fails: 0 }]));
    const problems = [];
    const check = (id, ok, msg) => {
        inv[id].checks++;
        if (!ok) { inv[id].fails++; if (problems.length < 200) problems.push(`${id} [${fmt(clock.now)}] ${msg}`); }
        return ok;
    };
    const stats = {
        submits: 0, saved: 0, lateRejected: 0, cleared: 0, jokerMoves: 0, jokerRejected: 0, reminders: 0, pushes: 0,
        scrapes: 0, draftsCreated: 0, approvedAll: 0, approvedManual: 0, rejected: 0, manualResults: 0,
        postponedBefore: 0, postponedAfter: 0, frozenTried: 0, walkovers: 0, corrections: 0, peeks: 0, adminTips: 0,
        pausedTried: 0, ltRejected: 0, ltWarnings: 0
    };
    const story = [];
    const tell = (round, text) => { story.push({ at: clock.now, round, text }); log(`  ${fmt(clock.now)} · ${text}`); };

    /* ---------------- serwer i API ---------------- */
    const pushes = [];
    push._setSenderForTests(async (sub, body) => { pushes.push({ at: clock.now, endpoint: sub.endpoint, body: JSON.parse(body) }); });
    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    let adminToken = '';
    async function call(method, url, body, headers = {}) {
        const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await res.text();
        let json = {};
        try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
        return { status: res.status, body: json, text };
    }
    const get = url => call('GET', url);
    const post = (url, body) => call('POST', url, body);
    // Sesja admina wygasa po 8 h bezczynności - w symulacji mijają dni, więc admin loguje się ponownie (jak w życiu)
    let logins = 0;
    async function login() { adminToken = (await post('/api/admin/login', { password: process.env.ADMIN_PASSWORD })).body.token; logins++; }
    async function adminCall(method, url, body) {
        let r = await call(method, `/api/admin${url}`, body, { 'x-admin-token': adminToken });
        if (r.status === 401) { await login(); r = await call(method, `/api/admin${url}`, body, { 'x-admin-token': adminToken }); }
        return r;
    }
    const A = async (url, body = {}) => {
        const r = await adminCall('POST', url, { season: Y, ...body });
        if (r.status >= 400) throw new Error(`admin ${url}: ${r.status} ${r.body.error || r.text}`);
        return r;
    };
    const AG = url => adminCall('GET', url);

    /* ---------------- kolejka zdarzeń ---------------- */
    const queue = [];
    let seq = 0;
    const at = (t, fn) => {
        const ev = { at: Math.max(t, clock.now), seq: seq++, fn };
        let i = queue.length;
        while (i > 0 && (queue[i - 1].at > ev.at || (queue[i - 1].at === ev.at && queue[i - 1].seq > ev.seq))) i--;
        queue.splice(i, 0, ev);
    };

    /* ---------------- sezon, gracze, terminarz ---------------- */
    clock.set(Date.parse('2027-03-01T09:00:00Z'));
    await A('/season', { year: Y, label: 'PGE Ekstraliga 2027 · symulacja', teams: TEAMS, lockMinutes: 1, activate: true });
    await A('/season/settings', { teamAliases: { 'PRES Grupa Deweloperska Toruń': ['Apator'] }, scraperUrls: [PORTAL_A, PORTAL_B] });
    const players = PERSONAS.map((p, i) => ({ ...p, rng: rngOf(seed * 31 + i), ledger: {}, joker: null, paused: false, lt: null, token: null, active: false }));
    const P = nick => players.find(p => p.nick === nick);
    async function join(p) {
        const r = await A('/player', { nickname: p.nick, fullName: '' });
        p.token = r.body.token;
        p.active = true;
    }
    for (const p of players) if (!p.joinRound) await join(p);
    const SUBSCRIBED = ['Ekspert', 'KibicMotoru', 'Losowy', 'Spóźnialski', 'Zapominalski', 'Poprawiacz', 'Remisiarz'];
    for (const nick of SUBSCRIBED) {
        await post('/api/public/push/subscribe', { token: P(nick).token, subscription: { endpoint: `https://push.example/${encodeURIComponent(nick)}`, keys: { p256dh: 'p', auth: 'a' } } });
    }
    const slots = [{ dayOffset: 4, time: '18:00' }, { dayOffset: 4, time: '20:30' }, { dayOffset: 6, time: '16:00' }, { dayOffset: 6, time: '19:15' }];
    await A('/generate-schedule', { season: Y, teams: TEAMS, startDate: '2027-04-05', slots, skipWeeks: [5, 10], doubleRound: true });

    /* ---------------- świat symulacji (prawda o meczach) ---------------- */
    const W = {};          // matchId -> lustro meczu + przebieg (attempts)
    const lockSnap = {};   // matchId -> typy w chwili blokady (nick -> "h:a:j")
    const remindedSeen = new Set();
    const label = m => `${shortT(m.homeTeam)} – ${shortT(m.awayTeam)}`;
    async function sync() {
        const d = (await get('/api/public/data')).body;
        for (const x of d.matches) {
            const m = W[x._id] = W[x._id] || { id: x._id, attempts: [], ver: 0, scenario: null, applied: null };
            Object.assign(m, {
                round: x.round, homeTeam: x.homeTeam, awayTeam: x.awayTeam, date: new Date(x.matchDate).getTime(),
                postponed: x.isPostponed, frozen: x.predictionsFrozen, void: x.voidPredictions, walkover: x.isWalkover,
                motr: x.isMatchOfTheRound, result: x.homeScore === null ? null : { h: x.homeScore, a: x.awayScore }
            });
        }
        return d;
    }
    let D = await sync();
    const matchesOf = r => Object.values(W).filter(m => m.round === r).sort((a, b) => a.date - b.date);
    const isLocked = m => m.frozen || !!m.result || (!m.postponed && clock.now >= m.date - LOCK);
    const settled = m => !!m.result && !m.void;
    const regularRounds = [...new Set(Object.values(W).map(m => m.round))].sort((a, b) => a - b);
    const firstLockOf = r => Math.min(...matchesOf(r).map(m => m.date)) - LOCK;

    /* ---------------- scenariusze sytuacji żużlowych ---------------- */
    const pickMatch = (r, f = () => true) => matchesOf(r).find(f);
    const notLublin = m => m.homeTeam !== LUBLIN && m.awayTeam !== LUBLIN;
    const SCEN = {};
    const setScen = (m, s) => { if (m && !m.scenario) { m.scenario = s; SCEN[s.type] = m; } };
    setScen(pickMatch(3, m => !notLublin(m)), { type: 'walkover' });                       // Joker KibicaMotoru wróci
    setScen(pickMatch(2), { type: 'typoA' });                                               // literówka na portalu A
    setScen(pickMatch(4, notLublin), { type: 'rainUnknown' });                              // deszcz przed blokadą, termin nieznany
    setScen(pickMatch(5, notLublin), { type: 'missing' });                                  // portale nie mają wyniku
    setScen(matchesOf(6)[2], { type: 'sourcesDiffer' });                                    // portale podają różne wyniki
    setScen(pickMatch(7, notLublin), { type: 'rainAfterLock' });                            // deszcz w dniu meczu, po blokadzie
    setScen(matchesOf(8)[1], { type: 'rainBefore' });                                       // przełożony przed blokadą od razu z datą
    setScen(matchesOf(8)[3], { type: 'correction' });                                       // korekta wyniku przez ligę
    setScen(pickMatch(9, notLublin), { type: 'abandonedValid', heats: 11 });                // przerwany po 11 biegach - wynik zalicza się
    setScen(matchesOf(10)[0], { type: 'portalBDown' });
    setScen(pickMatch(11, m => m.scenario === null), { type: 'rainAfterLock' });
    setScen(pickMatch(12, notLublin), { type: 'abandonedInvalid', heats: 7 });              // przerwany po 7 biegach - powtórka
    setScen(matchesOf(13)[1], { type: 'protest' });                                         // walkower po rozliczeniu (protest)

    /* ---------------- portale z wynikami (dla scrapera) ---------------- */
    const portalLagA = new Set();      // mecze, których wynik pojawia się na portalu A z opóźnieniem
    const bDownDays = new Set();
    const lastAttempt = m => m.attempts[m.attempts.length - 1] || null;
    function portalHtml(url) {
        const day = new Date(clock.now).toISOString().slice(0, 10);
        if (url === PORTAL_B && bDownDays.has(day)) throw new Error('HTTP 503 Service Unavailable');
        const rows = [];
        for (const m of Object.values(W).sort((a, b) => a.date - b.date)) {
            for (const t of m.attempts) {
                if (clock.now < t.start) continue;
                if (m.scenario && m.scenario.type === 'missing' && t === lastAttempt(m)) continue;
                const finishedAt = t.start + (t.heats.length < 15 ? 75 * MIN : 2 * HOUR);
                const live = clock.now < finishedAt;
                const heatsSoFar = live ? Math.min(t.heats.length, Math.floor((clock.now - t.start) / (7 * MIN))) : t.heats.length;
                const sum = (k) => t.heats.slice(0, heatsSoFar).reduce((s, x) => s + x[k], 0);
                let h = live ? sum(0) : t.h, a = live ? sum(1) : t.a;
                if (url === PORTAL_A && !live && t.typoA) [h, a] = t.typoA;
                if (url === PORTAL_A && !live && portalLagA.has(m.id) && clock.now < finishedAt + 6 * HOUR) continue;
                if (url === PORTAL_B && clock.now - t.start > 10 * DAY) continue;
                const note = live ? `NA ŻYWO · po ${heatsSoFar} biegach` : t.heats.length < 15 ? `przerwany po ${t.heats.length} biegach` : 'koniec';
                if (url === PORTAL_A) {
                    rows.push(`<tr><td>${new Date(t.start).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' })} ${new Date(t.start).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })}</td><td>${shortT(m.homeTeam)}</td><td>${h} : ${a}</td><td>${shortT(m.awayTeam)}</td><td>${note}</td></tr>`);
                } else {
                    rows.push(`<li><a href="/mecz/${m.id}">${SHORT_B[cityOf(m.homeTeam)]} - ${SHORT_B[cityOf(m.awayTeam)]} ${h}:${a}</a> <small>${note}</small></li>`);
                }
            }
        }
        return url === PORTAL_A
            ? `<html><body><h1>PGE Ekstraliga - wyniki</h1><table>${rows.join('')}</table></body></html>`
            : `<html><body><ul class="wyniki">${rows.join('')}</ul></body></html>`;
    }

    /* ---------------- niezależne przeliczenie ---------------- */
    function indep(p, m) {
        if (!m || !m.result || m.void) return null;
        const { h, a } = m.result;
        let pts;
        if (p.homePred === h && p.awayPred === a) pts = SC.exact;
        else if (Math.sign(p.homePred - p.awayPred) !== Math.sign(h - a)) pts = 0;
        else if (p.homePred - p.awayPred === h - a) pts = SC.diff;
        else pts = SC.winner;
        if (m.motr && pts >= SC.diff && pts > 0) pts += SC.motrBonus;
        if (p.usedJoker) pts *= SC.jokerMultiplier;
        return pts;
    }
    const isExact = (p, m) => m && m.result && !m.void && p.homePred === m.result.h && p.awayPred === m.result.a;
    const isDiff = (p, m) => m && m.result && !m.void && !isExact(p, m) && p.homePred - p.awayPred === m.result.h - m.result.a;
    let ltResults = null;

    async function allPredictions() { return (await AG(`/predictions?season=${Y}`)).body; }

    function ownTable(rounds) {
        const t = {};
        TEAMS.forEach(n => { t[n] = { name: n, matches: 0, points: 0, bonus: 0, diff: 0 }; });
        const played = Object.values(W).filter(m => rounds.includes(m.round) && m.result);
        played.forEach(m => {
            const H = t[m.homeTeam], Aw = t[m.awayTeam];
            H.matches++; Aw.matches++;
            H.diff += m.result.h - m.result.a; Aw.diff += m.result.a - m.result.h;
            if (m.result.h > m.result.a) H.points += 2; else if (m.result.h < m.result.a) Aw.points += 2; else { H.points++; Aw.points++; }
        });
        const pairs = {};
        played.forEach(m => { const k = [m.homeTeam, m.awayTeam].sort().join('|'); (pairs[k] = pairs[k] || []).push(m); });
        Object.values(pairs).forEach(g => {
            if (g.length !== 2) return;
            const [x, y] = [g[0].homeTeam, g[0].awayTeam];
            const sum = team => g.reduce((s, m) => s + (m.homeTeam === team ? m.result.h : m.result.a), 0);
            if (sum(x) > sum(y)) { t[x].points++; t[x].bonus++; } else if (sum(y) > sum(x)) { t[y].points++; t[y].bonus++; }
        });
        return Object.values(t).sort((a, b) => b.points - a.points || b.diff - a.diff);
    }

    /** Pełna kontrola stanu aplikacji (po każdej kolejce i na końcu). */
    async function verifyAll(tag) {
        cache.invalidate();
        D = await sync();
        const preds = await allPredictions();
        const pts = {}, exact = {}, diffs = {};
        for (const p of preds) {
            const m = W[p.matchId];
            const exp = indep(p, m);
            check('I3', (p.pointsEarned ?? null) === exp, `${tag}: ${p.nickname} ${m ? label(m) : p.matchId} typ ${p.homePred}:${p.awayPred}${p.usedJoker ? ' (J)' : ''} = ${p.pointsEarned}, oczekiwano ${exp}`);
            pts[p.nickname] = (pts[p.nickname] || 0) + (exp || 0);
            if (isExact(p, m)) exact[p.nickname] = (exact[p.nickname] || 0) + 1;
            if (isDiff(p, m)) diffs[p.nickname] = (diffs[p.nickname] || 0) + 1;
            if (m && m.void) check('I9', p.pointsEarned === null, `${tag}: typ na anulowany mecz ${label(m)} ma punkty`);
        }
        // I1 + I2
        const lt = nick => {
            if (!ltResults) return 0;
            const pick = P(nick) && P(nick).lt;
            if (!pick) return 0;
            return ['champion', 'bronze', 'relegation'].filter(k => pick[k] && pick[k] === ltResults[k]).length * SC.longTermEach;
        };
        for (const r of D.ranking) {
            check('I1', r.points === (pts[r.nickname] || 0) + lt(r.nickname), `${tag}: ${r.nickname} ma ${r.points} pkt, niezależnie ${(pts[r.nickname] || 0)} + ${lt(r.nickname)}`);
            check('I14', r.longTermPoints === lt(r.nickname), `${tag}: ${r.nickname} typy sezonowe ${r.longTermPoints}, oczekiwano ${lt(r.nickname)}`);
            check('I2', r.perfects === (exact[r.nickname] || 0) && r.diffs === (diffs[r.nickname] || 0), `${tag}: ${r.nickname} dokładne/różnice ${r.perfects}/${r.diffs} zamiast ${exact[r.nickname] || 0}/${diffs[r.nickname] || 0}`);
        }
        for (let i = 1; i < D.ranking.length; i++) {
            const a = D.ranking[i - 1], b = D.ranking[i];
            const key = x => [x.points, x.perfects, x.diffs];
            const cmp = key(a).map((v, k) => v - key(b)[k]).find(v => v !== 0) || 0;
            check('I2', cmp >= 0, `${tag}: ${a.nickname} przed ${b.nickname} mimo gorszych kryteriów`);
            check('I2', cmp === 0 ? a.position === b.position : b.position === i + 1, `${tag}: miejsca ${a.nickname} ${a.position}, ${b.nickname} ${b.position}`);
        }
        // I4: jeden Joker
        const jokers = {};
        preds.filter(p => p.usedJoker && !(W[p.matchId] || {}).void).forEach(p => { jokers[p.nickname] = (jokers[p.nickname] || 0) + 1; });
        Object.entries(jokers).forEach(([n, c]) => check('I4', c <= 1, `${tag}: ${n} ma ${c} aktywne Jokery`));
        // I5: typy z chwili blokady bez zmian
        for (const [mid, snap] of Object.entries(lockSnap)) {
            const now = {};
            preds.filter(p => p.matchId === mid).forEach(p => { now[p.nickname] = `${p.homePred}:${p.awayPred}:${p.usedJoker && !W[mid].void ? 'J' : ''}`; });
            for (const [n, v] of Object.entries(snap)) check('I5', now[n] === v || (W[mid].void && now[n] && now[n].startsWith(v.replace(/J$/, ''))), `${tag}: typ ${n} na ${label(W[mid])} zmienił się po blokadzie: ${v} → ${now[n]}`);
            for (const n of Object.keys(now)) if (!(n in snap)) check('I5', false, `${tag}: ${n} ma typ na ${label(W[mid])} dodany po blokadzie`);
        }
        // I7: tabela (tylko runda zasadnicza)
        const own = ownTable(regularRounds);
        for (const t of own) {
            const api = D.standings.find(s => s.name === t.name);
            check('I7', api && api.points === t.points && api.matches === t.matches && api.bonus === t.bonus,
                `${tag}: ${shortT(t.name)} w API ${api && `${api.points} pkt/${api.matches} m/${api.bonus} b`}, niezależnie ${t.points}/${t.matches}/${t.bonus}`);
        }
        // I10: zwycięzcy kolejek
        const byRound = {};
        preds.forEach(p => { const m = W[p.matchId]; const v = indep(p, m); if (v === null) return; byRound[m.round] = byRound[m.round] || {}; byRound[m.round][p.nickname] = (byRound[m.round][p.nickname] || 0) + v; });
        for (const rw of D.roundWinners) {
            const sc = byRound[rw.round] || {};
            const top = Math.max(...Object.values(sc));
            const exp = Object.keys(sc).filter(n => sc[n] === top).sort();
            check('I10', JSON.stringify([...rw.winners].sort()) === JSON.stringify(exp) && rw.points === top, `${tag}: R${rw.round} zwycięzcy ${rw.winners} (${rw.points}), oczekiwano ${exp} (${top})`);
            const complete = matchesOf(rw.round).every(m => m.void || m.result);
            check('I10', rw.complete === complete, `${tag}: R${rw.round} complete=${rw.complete}, oczekiwano ${complete}`);
        }
        // I11: puchar
        for (const c of D.cupMatches || []) {
            if (!c.finished) continue;
            const s1 = (byRound[c.roundNumber] || {})[c.player1] || 0, s2 = (byRound[c.roundNumber] || {})[c.player2] || 0;
            const ex = n => preds.filter(p => p.nickname === n && W[p.matchId] && W[p.matchId].round === c.roundNumber && isExact(p, W[p.matchId])).length;
            // łączna pomyłka w kolejce: |typ - wynik| gospodarzy i gości, mecz bez typu = 90
            const err = n => matchesOf(c.roundNumber).filter(m => m.result && !m.void).reduce((sum, m) => {
                const p = preds.find(x => x.nickname === n && x.matchId === m.id);
                return sum + (p ? Math.abs(p.homePred - m.result.h) + Math.abs(p.awayPred - m.result.a) : 90);
            }, 0);
            const [e1, e2, x1, x2] = [err(c.player1), err(c.player2), ex(c.player1), ex(c.player2)];
            const by = s1 !== s2 ? 'points' : x1 !== x2 ? 'exact' : e1 !== e2 ? 'error' : 'seed';
            const w = by === 'points' ? (s1 > s2 ? c.player1 : c.player2) : by === 'exact' ? (x1 > x2 ? c.player1 : c.player2)
                : by === 'error' ? (e1 < e2 ? c.player1 : c.player2) : c.player1;
            check('I11', c.score1 === s1 && c.score2 === s2 && c.winner === w && c.decidedBy === by, `${tag}: puchar ${c.stage} ${c.player1}–${c.player2} ${c.score1}:${c.score2} → ${c.winner}/${c.decidedBy}, oczekiwano ${s1}:${s2} → ${w}/${by}`);
        }
        return D;
    }

    /* ---------------- typowanie (jak w telefonie) ---------------- */
    const ctx = () => ({ E, table: D.standings, luckyRound: nick => 2 + (nick.length * 7) % 11 });

    /** Stan Jokera po zapisie - według regulaminu (niezależnie od kodu serwera). */
    function expectJoker(p, items) {
        const cur = p.joker && W[p.joker] && !W[p.joker].void ? p.joker : null;
        const curFrozen = cur && isLocked(W[cur]);
        const req = items.find(i => i.joker && !i.clear);
        let next = cur;
        if (req) {
            const t = req.m;
            const valid = !isLocked(t) && !t.postponed && !t.void;
            const hasTyp = Number.isInteger(req.h) || !!p.ledger[t.id];
            if (curFrozen && cur !== t.id) { next = cur; stats.jokerRejected++; } else if (valid && hasTyp) next = t.id;
        } else if (cur && !curFrozen && items.some(i => i.m.id === cur)) next = null;
        if (next && items.some(i => i.clear && i.m.id === next) && !(curFrozen && cur === next)) next = null;
        return next;
    }

    async function submit(p, items, { longTerm = null } = {}) {
        const body = {
            token: p.token, season: Y,
            predictions: items.map(i => (i.clear ? { matchId: i.m.id, clear: true } : { matchId: i.m.id, homePred: i.h, awayPred: i.a, usedJoker: !!i.joker }))
        };
        if (longTerm) body.longTerm = longTerm;
        const expLocked = new Set(items.filter(i => isLocked(i.m)).map(i => i.m.id));
        const expJoker = expectJoker(p, items);
        const before = p.joker;
        const r = await post('/api/public/submit-all', body);
        stats.submits++;
        if (p.paused) {
            stats.pausedTried++;
            check('I5', r.status === 403, `${p.nick} jest wstrzymany, a zapis zwrócił ${r.status}`);
            return r;
        }
        check('I5', r.status === 200, `${p.nick}: zapis zwrócił ${r.status} ${r.text.slice(0, 80)}`);
        const skipped = new Set((r.body.skippedMatches || []).filter(s => s.reason === 'locked').map(s => s.matchId));
        check('I5', [...skipped].sort().join() === [...expLocked].sort().join(),
            `${p.nick}: serwer pominął ${[...skipped].map(id => label(W[id]))}, oczekiwano ${[...expLocked].map(id => label(W[id]))}`);
        stats.lateRejected += skipped.size;
        for (const i of items) {
            if (expLocked.has(i.m.id)) continue;
            if (i.clear) { delete p.ledger[i.m.id]; stats.cleared++; } else { p.ledger[i.m.id] = { h: i.h, a: i.a }; stats.saved++; }
        }
        p.joker = expJoker;
        if (before !== expJoker && expJoker) stats.jokerMoves++;
        const pd = (await get(`/api/public/player-data?token=${p.token}`)).body;
        const mine = Object.fromEntries(pd.predictions.map(x => [x.matchId, x]));
        for (const [id, v] of Object.entries(p.ledger)) {
            const s = mine[id];
            check('I5', s && s.homePred === v.h && s.awayPred === v.a, `${p.nick}: ${label(W[id])} na serwerze ${s ? `${s.homePred}:${s.awayPred}` : 'brak'}, oczekiwano ${v.h}:${v.a}`);
        }
        check('I5', pd.predictions.length === Object.keys(p.ledger).length, `${p.nick}: ${pd.predictions.length} typów na serwerze, oczekiwano ${Object.keys(p.ledger).length}`);
        const sj = pd.predictions.filter(x => x.usedJoker && !W[x.matchId].void).map(x => x.matchId);
        check('I4', sj.length <= 1 && (sj[0] || null) === p.joker, `${p.nick}: Joker na serwerze ${sj.map(id => label(W[id]))}, oczekiwano ${p.joker ? label(W[p.joker]) : 'brak'}`);
        return r;
    }

    function typFor(p, m, noise = 0) {
        const t = predictFor(p.kind, m, ctx(), p.rng);
        return noise ? toScore(t[0] + p.rng.normal(0, noise)) : t;
    }

    /** Zwykła sesja typowania całej kolejki (otwarte mecze). */
    async function session(p, round, { noise = 0, final = false } = {}) {
        if (!p.active) return;
        const open = matchesOf(round).filter(m => !isLocked(m) && !m.void);
        if (!open.length) return;
        const items = [];
        for (const m of open) {
            if (p.kind === 'zapominalski' && p.rng.chance(0.35)) continue;
            const [h, a] = typFor(p, m, noise);
            items.push({ m, h, a });
        }
        if (!items.length) return;
        let target = p.joker && W[p.joker] && !W[p.joker].void ? p.joker : null;
        if (!target && !p.noAutoJoker) {
            const pick = jokerPick(p.kind, round, items.map(i => i.m), ctx(), p.rng, p.nick);
            if (pick) target = pick.id;
        }
        items.forEach(i => { i.joker = i.m.id === target; });
        if (final && p.kind === 'poprawiacz' && p.rng.chance(0.25)) {
            const victim = items.find(i => !i.joker);
            if (victim && p.ledger[victim.m.id]) { victim.clear = true; tell(round, `${p.nick} czyści typ na ${label(victim.m)} (rezygnacja)`); }
        }
        await submit(p, items);
    }

    /* ---------------- typy sezonowe ---------------- */
    const ltLock = firstLockOf(1);
    async function longTermSession(p) {
        if (p.kind === 'zapominalski' || p.kind === 'nowy' || p.kind === 'spoznialski') return;
        let pick = longTermPick(p.kind, TEAMS, p.rng);
        if (p.kind === 'podgladacz') {
            stats.peeks++;
            const d = (await get('/api/public/data')).body;
            check('I14', d.longTermOpen === true && d.longTerms.every(l => l.hidden && !l.champion), 'typy sezonowe innych widoczne przed startem sezonu');
        }
        if (p.kind === 'poprawiacz') {
            // najpierw błąd: ta sama drużyna jako mistrz i brąz
            const r = await submit(p, [], { longTerm: { champion: pick.champion, bronze: pick.champion, relegation: pick.relegation } });
            stats.ltWarnings += (r.body.warnings || []).length;
            check('I14', (r.body.warnings || []).some(w => /brązowy/.test(w)), 'brak ostrzeżenia o powtórzonej drużynie w typach sezonowych');
        }
        await submit(p, [], { longTerm: pick });
        p.lt = pick;
    }

    /* ---------------- zdarzenia meczu ---------------- */
    function scheduleMatch(m) {
        const v = ++m.ver;
        const lock = m.date - LOCK;
        const g = fn => async () => { if (m.ver === v) await fn(); };
        at(lock - 115 * MIN, g(cronReminders));
        at(lock - 80 * MIN, g(cronReminders));
        at(lock - 10 * MIN, g(() => copycat(m)));
        // Spóźnialski: zwykle 5 min przed blokadą, ale co trzeci raz 30 s przed pierwszym biegiem (już po blokadzie)
        const tooLate = P('Spóźnialski').rng.chance(0.3);
        at(tooLate ? lock + 30e3 : lock - 5 * MIN, g(() => lateSubmit(m, tooLate)));
        at(lock + 1000, g(() => onLock(m)));
        at(m.date, g(() => onStart(m)));
        at(m.date + 155 * MIN, g(cronScrape));
        at(m.date + 215 * MIN, g(cronScrape));
        at(m.date + 230 * MIN, g(adminReview));
        const next = new Date(m.date + DAY); next.setUTCHours(9, 30, 0, 0);
        at(next.getTime(), g(() => adminManual(m)));
    }

    async function cronReminders() {
        const before = pushes.length;
        await jobs.reminderJob();
        cache.invalidate();
        const fresh = pushes.slice(before).filter(x => /blokada/.test(x.body.title));
        stats.reminders += fresh.length;
        for (const row of db.NotificationLog._rows) {
            const mm = /^remind:([^:]+):(.+)$/.exec(row.key);
            if (!mm || remindedSeen.has(row.key)) continue;
            remindedSeen.add(row.key);
            const [, mid, nick] = mm;
            const p = P(nick);
            check('I12', p && !p.ledger[mid] && !p.paused && SUBSCRIBED.includes(nick), `przypomnienie do ${nick} o ${W[mid] ? label(W[mid]) : mid}, choć ${p && p.ledger[mid] ? 'ma typ' : 'nie powinien go dostać'}`);
        }
        const per = {};
        pushes.filter(x => /blokada/.test(x.body.title)).forEach(x => { const k = `${x.endpoint}|${x.body.tag}`; per[k] = (per[k] || 0) + 1; });
        check('I12', Object.values(per).every(c => c === 1), `to samo przypomnienie wysłane dwa razy: ${Object.keys(per).filter(k => per[k] > 1).join(', ')}`);
    }

    async function copycat(m) {
        const p = P('Podglądacz');
        if (!p.active || isLocked(m) || m.void) return;
        stats.peeks++;
        const d = (await get('/api/public/data')).body;
        const others = d.predictions.filter(x => x.nickname !== p.nick && !isLocked(W[x.matchId] || m));
        check('I6', others.every(x => x.hidden === true && x.homePred === null && x.awayPred === null && x.pointsEarned === null),
            `Podglądacz widzi cudze typy przed blokadą (${others.filter(x => !x.hidden).length})`);
        const peekT = clock.now;
        at(peekT + MIN, async () => {
            if (isLocked(m)) return;
            let target = p.joker && W[p.joker] && !W[p.joker].void ? p.joker : null;
            if (!target) { const pick = jokerPick(p.kind, m.round, [m], ctx(), p.rng, p.nick); if (pick) target = pick.id; }
            const [h, a] = typFor(p, m);
            await submit(p, [{ m, h, a, joker: target === m.id }]);
        });
    }

    async function lateSubmit(m, tooLate) {
        const p = P('Spóźnialski');
        if (!p.active || m.void) return;
        if (!tooLate && isLocked(m)) return;
        const [h, a] = typFor(p, m);
        let target = p.joker && W[p.joker] && !W[p.joker].void ? p.joker : null;
        if (!target) { const pick = jokerPick(p.kind, m.round, [m], ctx(), p.rng, p.nick); if (pick) target = pick.id; }
        await submit(p, [{ m, h, a, joker: target === m.id }]);
    }

    async function onLock(m) {
        if (m.postponed || m.void) return;
        if (m.frozen && lockSnap[m.id]) return;
        cache.invalidate();
        const d = (await get('/api/public/data')).body;
        const visible = d.predictions.filter(x => x.matchId === m.id);
        check('I6', visible.every(x => x.hidden === false && Number.isInteger(x.homePred)), `po blokadzie ${label(m)} typy nadal ukryte`);
        const preds = (await allPredictions()).filter(x => x.matchId === m.id);
        lockSnap[m.id] = Object.fromEntries(preds.map(x => [x.nickname, `${x.homePred}:${x.awayPred}:${x.usedJoker ? 'J' : ''}`]));
        for (const pl of players) {
            const s = preds.find(x => x.nickname === pl.nick);
            const l = pl.ledger[m.id];
            check('I5', (!s && !l) || (s && l && s.homePred === l.h && s.awayPred === l.a), `blokada ${label(m)}: ${pl.nick} serwer ${s ? `${s.homePred}:${s.awayPred}` : '-'} vs ${l ? `${l.h}:${l.a}` : '-'}`);
        }
    }

    /** Pierwszy bieg: mecz się odbywa (albo nie - deszcz). */
    async function onStart(m) {
        const s = m.scenario || {};
        if (m.void || m.result || m.postponed) return;
        if (s.type === 'rainAfterLock' && !s.done) {
            s.done = true;
            at(clock.now + 20 * MIN, () => postpone(m, { unknown: true, note: 'Deszcz — mecz przełożony (tor nie nadaje się do jazdy)' }));
            at(clock.now + DAY + 2 * HOUR, () => postpone(m, { newDate: m.date + 4 * DAY + 2 * HOUR }));
            return;
        }
        const heats = s.type === 'abandonedValid' && !s.done ? s.heats : s.type === 'abandonedInvalid' && !s.done ? s.heats : 15;
        const r = simulateMatch(m.homeTeam, m.awayTeam, rng, { maxHeats: heats });
        const t = { start: clock.now, heats: r.heats, h: r.home, a: r.away };
        // literówka na portalu A: zamienione cyfry wyniku gości (np. 38 -> 83)
        if (s.type === 'typoA' && !s.done) { t.typoA = [r.home, Number(String(r.away).padStart(2, '0').split('').reverse().join(''))]; s.done = true; }
        if (s.type === 'sourcesDiffer' && !s.done) { t.typoA = [r.home + 1, r.away - 1]; s.done = true; }
        m.attempts.push(t);
        if (s.type === 'abandonedValid' && !s.done) { s.done = true; tell(m.round, `${label(m)} przerwany po ${heats} biegach (deszcz) przy stanie ${r.home}:${r.away} — wynik zaliczony`); }
        if (s.type === 'abandonedInvalid' && !s.done) {
            s.done = true;
            tell(m.round, `${label(m)} przerwany po ${heats} biegach (${r.home}:${r.away}) — za mało biegów, powtórka`);
            at(clock.now + 4 * HOUR, () => postpone(m, { unknown: true, note: `Przerwany po ${heats} biegach — powtórka` }));
            at(clock.now + 3 * DAY, () => postpone(m, { newDate: m.date + 6 * DAY }));
        }
        if (s.type === 'portalBDown') bDownDays.add(new Date(clock.now).toISOString().slice(0, 10));
    }

    async function postpone(m, { unknown = false, newDate = null, note = undefined }) {
        const lockedBefore = isLocked(m);
        const frozenBefore = m.frozen;
        const body = { matchId: m.id };
        if (unknown) body.isPostponed = true;
        if (newDate) body.matchDate = new Date(newDate).toISOString();
        if (note !== undefined) body.note = note;
        await A('/match-edit', body);
        D = await sync();
        const expFrozen = frozenBefore || (lockedBefore && !m.result);
        check('I8', m.frozen === expFrozen, `${label(m)}: po przełożeniu frozen=${m.frozen}, oczekiwano ${expFrozen}`);
        if (unknown) {
            if (lockedBefore) stats.postponedAfter++; else stats.postponedBefore++;
            tell(m.round, `${label(m)}: ${note || 'przełożony'} — ${lockedBefore ? `po blokadzie, typy zamrożone (${Object.keys(lockSnap[m.id] || {}).length})` : 'przed blokadą, typy nadal otwarte i ukryte'}`);
            // przełożony po blokadzie: Poprawiacz próbuje zmienić typ - ma się nie udać
            if (lockedBefore) {
                const p = P('Poprawiacz');
                if (p.ledger[m.id]) { stats.frozenTried++; await submit(p, [{ m, h: p.ledger[m.id].h + 1, a: p.ledger[m.id].a - 1, joker: p.joker === m.id }]); }
            }
        }
        if (newDate) {
            tell(m.round, `${label(m)}: nowy termin ${fmt(m.date)}${m.frozen ? ' (typy zamrożone)' : ''}`);
            scheduleMatch(m);
            if (!m.frozen) {
                // typy otwarte: Poprawiacz poprawia, a kto nie miał typu, może go dopisać
                at(m.date - DAY, () => session(P('Poprawiacz'), m.round, { noise: 1 }));
            } else {
                at(m.date - 3 * HOUR, async () => { const p = P('Poprawiacz'); if (p.ledger[m.id]) { stats.frozenTried++; await submit(p, [{ m, h: p.ledger[m.id].h, a: p.ledger[m.id].a + 2 }]); } });
            }
        }
    }

    async function cronScrape() {
        const before = (await AG('/drafts?status=all')).body.length;
        const out = await jobs.scrapeJob({ fetchHtml: async url => portalHtml(url) });
        if (process.env.SIM_DEBUG) log(`    scraper ${fmt(clock.now)}: ${out.summary}${out.missing && out.missing.length ? ` · brak: ${out.missing.join(', ')}` : ''}`);
        cache.invalidate();
        stats.scrapes++;
        const all = (await AG('/drafts?status=all')).body;
        stats.draftsCreated += Math.max(0, all.length - before);
        D = await sync();
        for (const d of all.filter(x => x.status === 'draft')) {
            const m = W[d.matchId];
            check('I13', m.date <= clock.now - 150 * MIN, `draft dla meczu, który zaczął się ${Math.round((clock.now - m.date) / MIN)} min temu (${label(m)})`);
        }
        for (const m of Object.values(W)) {
            const ok = !m.result || (m.applied && m.applied.h === m.result.h && m.applied.a === m.result.a);
            check('I13', ok, `${label(m)} ma wynik ${m.result && `${m.result.h}:${m.result.a}`}, którego admin nie zatwierdził`);
        }
        return out;
    }

    const official = m => { const t = lastAttempt(m); return t ? { h: t.h, a: t.a } : null; };

    async function adminReview() {
        let drafts = (await AG('/drafts')).body;
        if (!drafts.length) return;
        // zabiegany admin: najpierw "Zatwierdź wszystkie bez uwag"
        const r = await A('/drafts/approve-all', { notify: true });
        const approvedIds = new Set(drafts.map(d => d.matchId));
        D = await sync();
        for (const id of approvedIds) {
            const m = W[id];
            const changed = m.result && (!m.applied || m.applied.h !== m.result.h || m.applied.a !== m.result.a);
            if (changed) {
                stats.approvedAll++;
                const o = official(m);
                check('I13', o && m.result.h === o.h && m.result.a === o.a, `„Zatwierdź wszystkie bez uwag” wpisało ${label(m)} ${m.result.h}:${m.result.a}, a oficjalnie było ${o && `${o.h}:${o.a}`}`);
                m.applied = { ...m.result };
            }
        }
        // pozostałe: admin sprawdza protokół meczu i decyduje
        drafts = (await AG('/drafts')).body;
        for (const d of drafts) {
            const m = W[d.matchId];
            const t = lastAttempt(m);
            if (!t || t.heats.length < 8) { await A('/drafts/reject', { id: d._id }); stats.rejected++; continue; }
            await A('/drafts/approve', { id: d._id, homeScore: t.h, awayScore: t.a, force: true, notify: true });
            stats.approvedManual++;
            if (d.homeScore !== t.h || d.awayScore !== t.a) tell(m.round, `admin poprawia wynik ze scrapera ${label(m)}: ${d.homeScore}:${d.awayScore} → ${t.h}:${t.a} (${(d.blockers || []).concat(d.warnings || []).slice(0, 1).join('') || 'sprawdzony protokół'})`);
            D = await sync();
            m.applied = { ...m.result };
        }
        D = await sync();
        if (r.body.message) log(`    admin: ${r.body.message}`);
        await afterResults();
    }

    async function adminManual(m) {
        if (m.result || m.void || m.postponed) return;
        const t = lastAttempt(m);
        if (!t || t.heats.length < 8 || t.start !== m.date) return;
        await A('/results-bulk', { results: [{ matchId: m.id, homeScore: t.h, awayScore: t.a }], notify: true });
        stats.manualResults++;
        D = await sync();
        m.applied = { ...m.result };
        tell(m.round, `brak wyniku ${label(m)} w źródłach — admin wpisuje ręcznie ${t.h}:${t.a}`);
        await afterResults();
    }

    async function adminResult(m, h, a, { walkover = false, note } = {}) {
        await A('/result', { matchId: m.id, homeScore: h, awayScore: a, walkover, notify: true });
        if (note) await A('/match-edit', { matchId: m.id, note });
        D = await sync();
        m.applied = { ...m.result };
        await afterResults();
    }

    /* ---------------- kolejki, puchar, play-off ---------------- */
    const roundDone = new Set();
    const roundLog = [];
    const hooks = new Set();
    const once = (key, fn) => { if (hooks.has(key)) return null; hooks.add(key); return fn(); };
    const complete = rounds => rounds.every(r => matchesOf(r).length && matchesOf(r).every(m => m.void || m.result));
    async function afterResults() {
        for (const r of [...new Set(Object.values(W).map(m => m.round))].sort((a, b) => a - b)) {
            if (roundDone.has(r)) continue;
            const ms = matchesOf(r);
            if (!ms.length || !ms.every(m => m.void || m.result)) continue;
            roundDone.add(r);
            const d = await verifyAll(`po kolejce ${r}`);
            const rw = d.roundWinners.find(x => x.round === r);
            const old = roundLog.findIndex(x => x.round === r);
            if (old >= 0) roundLog.splice(old, 1);
            roundLog.push({
                round: r, name: roundTitle(r), from: ms[0].date, to: ms[ms.length - 1].date,
                results: ms.map(m => `${label(m)} ${m.result.h}:${m.result.a}${m.walkover ? ' (wo)' : ''}`),
                winners: rw ? rw.winners : [], winnerPoints: rw ? rw.points : 0,
                top: d.ranking.slice(0, 3).map(x => `${x.nickname} ${x.points}`),
                leaderTable: d.standings[0] ? shortT(d.standings[0].name) : ''
            });
            roundLog.sort((a, b) => a.round - b.round);
            log(`R${r} rozliczona · zwycięzca kolejki: ${rw ? `${rw.winners.join(', ')} (${rw.points})` : '—'} · ranking: ${d.ranking.slice(0, 3).map(x => `${x.nickname} ${x.points}`).join(', ')}`);
            await onRoundDone(r);
        }
        if (complete(regularRounds)) await once('playoffs', setupPlayoffs);
        if (seeds && complete([15, 16, 17, 18])) await once('finals', setupFinals);
        if (sfWinners && complete([19, 20])) await once('finish', () => at(clock.now + DAY, finishSeason));
    }
    const roundTitle = r => ({ 15: 'Mecze o 5. miejsce', 16: 'Mecze o 5. miejsce (rewanże)', 17: 'Półfinały', 18: 'Półfinały (rewanże)', 19: 'Finał i mecz o 3. miejsce', 20: 'Finał i mecz o 3. miejsce (rewanże)' }[r] || `Runda ${r}`);

    const cupPlan = { 5: { stage: 'Ćwierćfinał', play: 6 }, 6: { stage: 'Półfinał', play: 9, from: 'Ćwierćfinał' }, 9: { stage: 'Finał', play: 12, from: 'Półfinał' } };
    async function onRoundDone(r) {
        if (hooks.has(`round:${r}`)) return;
        hooks.add(`round:${r}`);
        if (r === 5) {
            const nowy = P('Nowy');
            await join(nowy);
            tell(6, 'do gry dołącza Nowy (typy sezonowe już zamknięte)');
            for (const rr of regularRounds.filter(x => x >= 6)) at(firstLockOf(rr) - nowy.rng.int(4, 50) * HOUR, () => session(nowy, rr));
        }
        if (cupPlan[r]) {
            const plan = cupPlan[r];
            if (!plan.from) {
                await A('/cup-generate', { stage: plan.stage, roundNumber: plan.play, count: 8 });
            } else {
                const prev = (D.cupMatches || []).filter(c => c.stage === plan.from);
                const winners = prev.map(c => c.winner);
                if (winners.some(w => !w)) { tell(plan.play, `puchar: ${plan.from} nierozstrzygnięty — ${plan.stage} czeka`); return; }
                for (let i = 0; i < winners.length / 2; i++) {
                    await A('/cup-match', { stage: plan.stage, roundNumber: plan.play, player1: winners[i], player2: winners[winners.length - 1 - i], autoScore: true });
                }
            }
            D = await sync();
            const pairs = (D.cupMatches || []).filter(c => c.stage === plan.stage);
            tell(plan.play, `Puchar Typerów — ${plan.stage} (R${plan.play}): ${pairs.map(c => `${c.player1} vs ${c.player2}`).join(', ')}`);
        }
    }

    let seeds = null, sfWinners = null, sfLosers = null;
    const playoffMatches = [];
    async function addMatch(round, home, away, date, motr = false) {
        await A('/match-add', { round, homeTeam: home, awayTeam: away, matchDate: new Date(date).toISOString(), isMatchOfTheRound: motr });
        D = await sync();
        const m = Object.values(W).find(x => x.round === round && x.homeTeam === home && x.awayTeam === away);
        playoffMatches.push(m);
        scheduleMatch(m);
        return m;
    }
    function weekend(offsetWeeks, dayOffset, hhmm) {
        const last = Math.max(...Object.values(W).filter(m => m.round <= 14).map(m => m.date));
        const monday = new Date(last); monday.setUTCHours(0, 0, 0, 0);
        while (monday.getUTCDay() !== 1) monday.setTime(monday.getTime() + DAY);
        const d = new Date(monday.getTime() + offsetWeeks * 7 * DAY + dayOffset * DAY);
        const [h, mi] = hhmm.split(':').map(Number);
        d.setUTCHours(h - 2, mi, 0, 0); // CEST
        return d.getTime();
    }
    async function setupPlayoffs() {
        const d = await verifyAll('po rundzie zasadniczej');
        seeds = d.standings.map(s => s.name);
        tell(15, `koniec rundy zasadniczej: 1. ${shortT(seeds[0])}, 2. ${shortT(seeds[1])}, 3. ${shortT(seeds[2])}, 4. ${shortT(seeds[3])} · spadek: ${shortT(seeds[7])}`);
        await addMatch(15, seeds[5], seeds[4], weekend(0, 4, '18:00'));
        await addMatch(17, seeds[3], seeds[0], weekend(0, 6, '16:00'));
        await addMatch(17, seeds[2], seeds[1], weekend(0, 6, '19:15'));
        await addMatch(16, seeds[4], seeds[5], weekend(1, 4, '18:00'));
        await addMatch(18, seeds[0], seeds[3], weekend(1, 6, '16:00'), true);
        await addMatch(18, seeds[1], seeds[2], weekend(1, 6, '19:15'));
        // wynik pierwszego półfinału pojawi się na portalu A z opóźnieniem (portal A ma też wynik z rundy zasadniczej)
        portalLagA.add(playoffMatches[1].id);
        for (const rr of [15, 16, 17, 18]) for (const p of players) if (!['spoznialski', 'podgladacz'].includes(p.kind)) at(firstLockOf(rr) - p.rng.int(3, 60) * HOUR, () => session(p, rr));
    }
    const aggregate = (x, y, rounds) => {
        const ms = Object.values(W).filter(m => rounds.includes(m.round) && [m.homeTeam, m.awayTeam].sort().join() === [x, y].sort().join());
        const sum = t => ms.reduce((s, m) => s + (m.homeTeam === t ? m.result.h : m.result.a), 0);
        return { [x]: sum(x), [y]: sum(y) };
    };
    function decide(x, y, rounds, what) {
        const s = aggregate(x, y, rounds);
        if (s[x] !== s[y]) return s[x] > s[y] ? [x, y, s] : [y, x, s];
        const w = rng.chance(0.5) ? x : y;
        tell(19, `${what}: remis w dwumeczu ${s[x]}:${s[y]} — bieg dodatkowy wygrywa ${shortT(w)}`);
        return w === x ? [x, y, s] : [y, x, s];
    }
    let fifth = null;
    async function setupFinals() {
        const [w1, l1] = decide(seeds[0], seeds[3], [17, 18], 'Półfinał 1');
        const [w2, l2] = decide(seeds[1], seeds[2], [17, 18], 'Półfinał 2');
        fifth = decide(seeds[4], seeds[5], [15, 16], 'Mecz o 5. miejsce')[0];
        sfWinners = [w1, w2]; sfLosers = [l1, l2];
        tell(19, `finał: ${shortT(w1)} – ${shortT(w2)}, o brąz: ${shortT(l1)} – ${shortT(l2)}`);
        const lowerFirst = (a, b) => (seeds.indexOf(a) > seeds.indexOf(b) ? [a, b] : [b, a]);
        const [fh, fa] = lowerFirst(w1, w2), [bh, ba] = lowerFirst(l1, l2);
        await addMatch(19, fh, fa, weekend(2, 6, '19:15'), true);
        await addMatch(19, bh, ba, weekend(2, 6, '16:00'));
        await addMatch(20, fa, fh, weekend(3, 6, '19:15'), true);
        await addMatch(20, ba, bh, weekend(3, 6, '16:00'));
        for (const rr of [19, 20]) for (const p of players) if (!['spoznialski', 'podgladacz'].includes(p.kind)) at(firstLockOf(rr) - p.rng.int(3, 60) * HOUR, () => session(p, rr));
    }

    /* ---------------- koniec sezonu ---------------- */
    const PRIZE = 'Złoty kask z autografami całej drużyny mistrza + 2 bilety na finał w przyszłym sezonie';
    const NOTE = 'Gratulacje! Wręczenie nagrody przy grillu na otwarcie sezonu 2028.';
    let finale = null;
    async function finishSeason() {
        const [champ, vice] = decide(sfWinners[0], sfWinners[1], [19, 20], 'Finał');
        const [bronze] = decide(sfLosers[0], sfLosers[1], [19, 20], 'Mecz o 3. miejsce');
        ltResults = { champion: champ, bronze, relegation: seeds[7] };
        tell(20, `🏆 Mistrz Polski: ${shortT(champ)} (finał z ${shortT(vice)}), brąz: ${shortT(bronze)}, spadek: ${shortT(seeds[7])}`);
        await A('/season/settings', { winnerSurprise: { prize: PRIZE, message: NOTE } });
        const pubBefore = (await get('/api/public/data')).text;
        check('I15', !pubBefore.includes(PRIZE) && JSON.parse(pubBefore).finale === null, 'niespodzianka lub mistrz widoczni przed zamknięciem sezonu');
        const before = pushes.length;
        const r = await A('/season/finish', { ...ltResults, markFinished: true });
        tell(20, `admin zamyka sezon: ${r.body.message}`);
        const d = await verifyAll('po zamknięciu sezonu');
        finale = d.finale;
        const topKey = x => `${x.points}|${x.perfects}|${x.diffs}`;
        const expChamps = d.ranking.filter(x => topKey(x) === topKey(d.ranking[0]) && x.points > 0).map(x => x.nickname).sort();
        check('I15', finale && JSON.stringify([...finale.champions].sort()) === JSON.stringify(expChamps), `mistrz ${finale && finale.champions}, oczekiwano ${expChamps}`);
        const fresh = pushes.slice(before);
        for (const c of expChamps) {
            const toChamp = fresh.filter(x => x.endpoint.endsWith(encodeURIComponent(c)));
            if (SUBSCRIBED.includes(c)) check('I15', toChamp.some(x => /Mistrzem/.test(x.body.title)), `mistrz ${c} nie dostał powiadomienia`);
        }
        check('I15', !JSON.stringify(d).includes(PRIZE), 'nagroda widoczna na stronie publicznej');
        for (const p of players.filter(x => x.active)) {
            const pd = await get(`/api/public/player-data?token=${p.token}`);
            const isChamp = expChamps.includes(p.nick);
            check('I15', isChamp ? pd.body.champion && pd.body.champion.prize === PRIZE : pd.body.champion === null && !pd.text.includes(PRIZE), `${p.nick}: niespodzianka ${isChamp ? 'niewidoczna dla mistrza' : 'widoczna dla nie-mistrza'}`);
            if (!isChamp) {
                const rv = await post('/api/public/champion/reveal', { token: p.token, season: Y });
                check('I15', rv.status === 403, `${p.nick} (nie mistrz) odkrył niespodziankę`);
            }
        }
        at(clock.now + 8 * HOUR, async () => {
            for (const c of expChamps) {
                const rv = await post('/api/public/champion/reveal', { token: P(c).token, season: Y });
                check('I15', rv.status === 200 && rv.body.prize === PRIZE, `mistrz ${c} nie mógł odkryć niespodzianki`);
                tell(20, `🎁 ${c} zdrapuje kartę: „${rv.body.prize}”`);
            }
            const info = (await AG('/seasons')).body.find(s => s.year === Y);
            check('I15', JSON.stringify(info.winnerSurprise.revealedBy.sort()) === JSON.stringify(expChamps), 'admin nie widzi, kto odkrył niespodziankę');
        });
    }

    /* ---------------- scenariusze "z przygodami" ---------------- */
    function scheduleSpecials() {
        // KibicMotoru: Joker na mecz Motoru w R3, który kończy się walkowerem -> Joker wraca
        const wo = SCEN.walkover;
        at(wo.date - 20 * HOUR, async () => {
            const lublinHome = wo.homeTeam === LUBLIN;
            const opp = lublinHome ? wo.awayTeam : wo.homeTeam;
            const k = P('KibicMotoru');
            const hadJoker = k.joker === wo.id;
            await adminResult(wo, lublinHome ? 40 : 0, lublinHome ? 0 : 40, { walkover: true, note: `${shortT(opp)} nie przyjechał — walkower` });
            stats.walkovers++;
            if (k.joker === wo.id) k.joker = null;
            check('I9', W[wo.id].void && W[wo.id].walkover, 'walkower nie anulował typów');
            tell(3, `walkower: ${shortT(opp)} nie przyjeżdża do meczu ${label(wo)} — typy anulowane${hadJoker ? ', Joker KibicaMotoru wraca' : ''}`);
            const pd = (await get(`/api/public/player-data?token=${k.token}`)).body;
            check('I4', !pd.predictions.some(x => x.usedJoker && !W[x.matchId].void), 'Joker z walkowera nie wrócił');
        });
        // Zapominalski podaje typ SMS-em - admin wpisuje go po blokadzie (pierwszy mecz od R4, na który nie ma typu)
        let smsDone = false;
        for (const r of [4, 5, 6, 7, 8]) for (const sms of matchesOf(r).filter(m => !m.scenario)) at(sms.date + 5 * MIN, async () => {
            const p = P('Zapominalski');
            if (smsDone || p.ledger[sms.id] || !isLocked(sms) || sms.void || sms.result || p.paused) return;
            smsDone = true;
            const [h, a] = typFor(p, sms);
            await A('/predict', { nickname: p.nick, matchId: sms.id, homePred: h, awayPred: a });
            p.ledger[sms.id] = { h, a };
            lockSnap[sms.id] = lockSnap[sms.id] || {};
            lockSnap[sms.id][p.nick] = `${h}:${a}:`;
            stats.adminTips++;
            tell(sms.round, `Zapominalski podaje typ ${h}:${a} SMS-em przed meczem ${label(sms)} — admin wpisuje go po blokadzie`);
        });
        // deszcz przed blokadą, termin nieznany -> po 2 dniach nowa data
        const ru = SCEN.rainUnknown;
        at(ru.date - 6 * HOUR, () => postpone(ru, { unknown: true, note: 'Prognoza: ulewa — mecz przełożony, termin wkrótce' }));
        at(ru.date + 2 * DAY, () => postpone(ru, { newDate: ru.date + 5 * DAY }));
        // przełożony przed blokadą od razu z nową datą
        const rb = SCEN.rainBefore;
        at(rb.date - 3 * HOUR, async () => { stats.postponedBefore++; await postpone(rb, { newDate: rb.date + 2 * DAY + 3 * HOUR, note: 'Przełożony — zalany tor' }); });
        // korekta wyniku przez ligę (zabrane punkty zawodnika)
        const co = SCEN.correction;
        at(co.date + 2 * DAY, async () => {
            if (!co.result) return;
            const t = lastAttempt(co);
            const nh = Math.max(0, t.h - 3);
            t.h = nh;
            await adminResult(co, nh, t.a, { note: 'Korekta: zawodnik gości startował nieprawidłowo — liga odjęła punkty gospodarzom' });
            stats.corrections++;
            tell(co.round, `korekta wyniku ${label(co)} po decyzji ligi → ${nh}:${t.a}, punkty przeliczone`);
            roundDone.delete(co.round);
            await afterResults();
        });
        // protest: mecz rozliczony, potem walkower dla gości
        const pr = SCEN.protest;
        at(pr.date + 3 * DAY, async () => {
            if (!pr.result) return;
            const before = (await allPredictions()).filter(x => x.matchId === pr.id && x.pointsEarned > 0).length;
            const t = lastAttempt(pr);
            t.h = 0; t.a = 40;
            await adminResult(pr, 0, 40, { walkover: true, note: 'Weryfikacja po proteście: walkower dla gości' });
            stats.walkovers++;
            for (const p of players) if (p.joker === pr.id) p.joker = null;
            const after = (await allPredictions()).filter(x => x.matchId === pr.id);
            check('I9', after.every(x => x.pointsEarned === null), 'po walkowerze z protestu typy nadal mają punkty');
            tell(pr.round, `protest: ${label(pr)} zweryfikowany jako walkower 0:40 — ${before} graczy traci punkty za ten mecz`);
            roundDone.delete(pr.round);
            await afterResults();
        });
        // Jokerowiec: Joker przeskakuje między meczami kolejki 5
        const r5 = matchesOf(5);
        const jw = P('Jokerowiec');
        jw.noAutoJoker = true;
        at(firstLockOf(5) - 3 * DAY, async () => {
            const items = r5.filter(m => !isLocked(m)).map(m => { const [h, a] = typFor(jw, m); return { m, h, a, joker: m === r5[3] }; });
            await submit(jw, items);
            tell(5, `Jokerowiec stawia Jokera na ${label(r5[3])}`);
        });
        at(firstLockOf(5) - DAY, async () => {
            const items = r5.filter(m => !isLocked(m)).map(m => ({ m, h: jw.ledger[m.id].h, a: jw.ledger[m.id].a, joker: m === r5[0] }));
            await submit(jw, items);
            tell(5, `Jokerowiec przenosi Jokera na ${label(r5[0])}`);
        });
        at(r5[0].date + 30 * MIN, async () => {
            const m = r5[3];
            if (isLocked(m)) return;
            const r = await submit(jw, [{ m, h: jw.ledger[m.id].h, a: jw.ledger[m.id].a, joker: true }]);
            check('I4', (r.body.warnings || []).some(w => /Joker/.test(w)), 'brak ostrzeżenia przy próbie przeniesienia zablokowanego Jokera');
            tell(5, `Jokerowiec próbuje przenieść Jokera z rozpoczętego meczu — odmowa: „${(r.body.warnings || [])[0]}”`);
            jw.noAutoJoker = false;
        });
        // Poprawiacz: Joker na R6, potem czyści ten typ (Joker przepada), wpisuje bez Jokera
        const pp = P('Poprawiacz');
        at(firstLockOf(6) - 2 * HOUR - 30 * MIN, async () => {
            if (!pp.joker || W[pp.joker].round !== 6 || isLocked(W[pp.joker])) return;
            const m = W[pp.joker];
            await submit(pp, [{ m, clear: true }]);
            check('I4', pp.joker === null, 'Joker nie przepadł razem z wyczyszczonym typem');
            tell(6, `Poprawiacz czyści typ z Jokerem (${label(m)}) — Joker wraca do puli`);
            const [h, a] = typFor(pp, m);
            pp.noAutoJoker = true;
            await submit(pp, [{ m, h, a, joker: false }]);
            pp.noAutoJoker = false;
        });
        // Zapominalski wstrzymany na kolejki 10-11 (nie zapłacił wpisowego)
        at(firstLockOf(10) - 4 * DAY, async () => { await A('/player/toggle', { nickname: 'Zapominalski' }); P('Zapominalski').paused = true; tell(10, 'admin wstrzymuje konto Zapominalskiego (wpisowe)'); });
        at(firstLockOf(12) - 4 * DAY, async () => { await A('/player/toggle', { nickname: 'Zapominalski' }); P('Zapominalski').paused = false; tell(12, 'Zapominalski znów aktywny'); });
        // Spóźnialski próbuje wysłać typy sezonowe po starcie ligi
        at(ltLock + 40 * MIN, async () => {
            const p = P('Spóźnialski');
            const r = await submit(p, [], { longTerm: longTermPick('spoznialski', TEAMS, p.rng) });
            stats.ltRejected++;
            check('I14', (r.body.warnings || []).some(w => /zablokowane/.test(w)), 'typy sezonowe przyjęte po blokadzie');
            const d = (await get('/api/public/data')).body;
            check('I14', d.longTermOpen === false && d.longTerms.every(l => !l.hidden), 'typy sezonowe nadal zakryte po starcie sezonu');
            tell(1, 'Spóźnialski wysyła typy sezonowe 40 min po starcie ligi — odrzucone');
        });
    }

    /* ---------------- start ---------------- */
    for (const m of Object.values(W)) scheduleMatch(m);
    for (const p of players.filter(x => !x.joinRound)) at(Date.parse('2027-03-10T17:00:00Z') + p.rng.int(0, 20 * 24) * HOUR, () => longTermSession(p));
    for (const r of regularRounds) {
        const prevEnd = r === 1 ? Date.parse('2027-03-20T08:00:00Z') : Math.max(...matchesOf(r - 1).map(m => m.date)) + 3 * HOUR;
        const lock = firstLockOf(r);
        for (const p of players.filter(x => !x.joinRound && !['spoznialski', 'podgladacz'].includes(x.kind))) {
            if (p.kind === 'poprawiacz') {
                at(prevEnd + p.rng.int(1, 20) * HOUR, () => session(p, r, { noise: 5 }));
                at(lock - p.rng.int(20, 30) * HOUR, () => session(p, r, { noise: 2 }));
                at(lock - 3 * HOUR, () => session(p, r, { final: true }));
            } else if (p.kind === 'zapominalski') {
                at(lock - p.rng.int(6, 30) * HOUR, () => session(p, r));
            } else {
                at(prevEnd + p.rng.next() * Math.max(HOUR, lock - 2 * HOUR - prevEnd), () => session(p, r));
            }
        }
    }
    scheduleSpecials();

    // pętla zdarzeń
    let events = 0;
    while (queue.length) {
        const ev = queue.shift();
        clock.set(ev.at);
        await ev.fn();
        events++;
    }
    await verifyAll('koniec symulacji');

    const result = {
        seed, events, inv, INV, problems, stats, story, roundLog,
        ranking: D.ranking, standings: ownTable(regularRounds), apiStandings: D.standings, finale, ltResults,
        cup: D.cupMatches, players: players.map(p => ({ nick: p.nick, kind: p.kind, desc: p.desc, lt: p.lt })),
        pushes: pushes.length, pushLog: pushes, fifth, seeds, base, server, PRIZE, logins,
        links: players.filter(p => p.active).map(p => ({ nick: p.nick, token: p.token, champion: !!(finale && finale.champions.includes(p.nick)) }))
    };
    return result;
}

module.exports = { runSeason };
