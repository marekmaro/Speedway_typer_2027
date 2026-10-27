/* ------------------------------------------------------------------
   Scenariusze end-to-end na poziomie API - cała aplikacja (server.js) na atrapie bazy.
   Każda grupa odpowiada sytuacji z życia typera: typowanie, joker, deszcz i przełożenia,
   walkowery, wyniki ze scrapera, gracze, sezony, powiadomienia, kopia zapasowa, PWA.
   Uruchom: npm test   (albo tylko ten plik: node test/scenarios.test.js)
------------------------------------------------------------------- */
process.env.ADMIN_PASSWORD = 'haslo-scenariuszy';
process.env.CRON_SECRET = '';
delete process.env.VAPID_PUBLIC_KEY;

const assert = require('assert');
const dbPath = require.resolve('../models/Database');
const db = require('./fake-db')();
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db, children: [], paths: [] };

const app = require('../server');
const jobs = require('../services/jobs');
const push = require('../services/push');
const cache = require('../services/cache');
const { warsawDate, generateSchedule } = require('../services/schedule');

const MIN = 60 * 1000;
const inMin = m => new Date(Date.now() + m * MIN);

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; failures.push(name); console.error(`  ❌ ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); process.exitCode = 1; }
}
const group = name => console.log(`\n${name}`);

let base, adminToken;
async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
    return { status: res.status, body: json, headers: res.headers, text };
}
const get = (url, h) => call('GET', url, undefined, h);
const post = (url, body, h) => call('POST', url, body || {}, h);
const admin = (url, body) => post(`/api/admin${url}`, body, { 'x-admin-token': adminToken });
const adminGet = url => get(`/api/admin${url}`, { 'x-admin-token': adminToken });
const submit = (token, predictions, extra = {}) => post('/api/public/submit-all', { token, predictions, ...extra });

const TOK = { Ala: 'a1a1a1a1a1a1a1a1a1a1a1a1', Bob: 'b2b2b2b2b2b2b2b2b2b2b2b2', Cyk: 'c3c3c3c3c3c3c3c3c3c3c3c3', Dex: 'd4d4d4d4d4d4d4d4d4d4d4d4' };
const TEAMS = ['Alfa Lublin', 'Beta Wrocław', 'Gamma Toruń', 'Delta Gorzów'];
let roundSeq = 20;
/** Nowy mecz w osobnej kolejce (żeby testy na siebie nie wpływały). */
async function mkMatch(minutesFromNow, extra = {}) {
    const [h, a] = extra.teams || [TEAMS[0], TEAMS[1]];
    delete extra.teams;
    return db.Match.create({ season: 2027, round: ++roundSeq, homeTeam: h, awayTeam: a, matchDate: inMin(minutesFromNow), ...extra });
}
const pred = (nick, m) => db.Prediction.findOne({ season: 2027, nickname: nick, matchId: String(m._id) });
const fresh = id => db.Match.findById(String(id));

(async () => {
    await db.Season.create({
        year: 2027, label: 'PGE Ekstraliga 2027', isActive: true, lockHours: 24, lockMinutes: 1, teams: TEAMS,
        stageNames: {}, scoring: { exact: 5, diff: 3, winner: 2, motrBonus: 1, jokerMultiplier: 2, longTermEach: 10 },
        standingsAdjustments: [], scraperUrls: [], teamAliases: {}
    });
    for (const [nick, token] of Object.entries(TOK)) {
        await db.Player.create({ nickname: nick, fullName: '', token, seasons: [2027], isActive: true });
    }
    // Mecz otwierający sezon daleko w przyszłości -> typy sezonowe otwarte
    await db.Match.create({ season: 2027, round: 1, homeTeam: TEAMS[2], awayTeam: TEAMS[3], matchDate: inMin(60 * 24 * 30) });

    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;

    const login = await post('/api/admin/login', { password: process.env.ADMIN_PASSWORD });
    adminToken = login.body.token;
    assert.ok(adminToken, 'logowanie admina');

    /* ============================================================ */
    group('A. Typowanie');

    await test('A1 typ przed blokadą zapisuje się, po blokadzie jest odrzucany i stary zostaje', async () => {
        const m = await mkMatch(30);
        let r = await submit(TOK.Ala, [{ matchId: String(m._id), homePred: 46, awayPred: 44 }]);
        assert.strictEqual(r.body.saved, 1);
        m.matchDate = inMin(0.5); // start za 30 s -> blokada (1 min) minęła
        r = await submit(TOK.Ala, [{ matchId: String(m._id), homePred: 30, awayPred: 60 }]);
        assert.strictEqual(r.body.saved, 0);
        assert.strictEqual(r.body.skipped, 1);
        assert.strictEqual(r.body.skippedMatches[0].reason, 'locked');
        assert.ok(r.body.warnings.some(w => /zablokowany/.test(w)), 'gracz dostaje ostrzeżenie');
        assert.strictEqual((await pred('Ala', m)).homePred, 46);
    });

    await test('A2 blokada 1 min: 2 min przed startem otwarte, 30 s przed zamknięte', async () => {
        const open = await mkMatch(2);
        const closed = await mkMatch(0.5);
        const r = await submit(TOK.Bob, [
            { matchId: String(open._id), homePred: 45, awayPred: 45 },
            { matchId: String(closed._id), homePred: 45, awayPred: 45 }
        ]);
        assert.strictEqual(r.body.saved, 1);
        assert.strictEqual(r.body.skipped, 1);
    });

    await test('A3 błędne wartości (puste, ułamek, tekst, ujemne, > 75) są odrzucane', async () => {
        const m = await mkMatch(120);
        const bad = [['', 44], [45.5, 44], ['abc', 44], [-1, 44], [76, 10], [null, 40]];
        for (const [h, a] of bad) {
            const r = await submit(TOK.Bob, [{ matchId: String(m._id), homePred: h, awayPred: a }]);
            assert.strictEqual(r.body.saved, 0, `typ ${h}:${a} nie powinien przejść`);
        }
        assert.strictEqual(await pred('Bob', m), null);
        const ok = await submit(TOK.Bob, [{ matchId: String(m._id), homePred: '47', awayPred: '43' }]);
        assert.strictEqual(ok.body.saved, 1, 'liczby jako tekst z formularza są OK');
    });

    await test('A4 wyczyszczenie obu pól usuwa typ przed blokadą, a po blokadzie nie', async () => {
        const m = await mkMatch(120);
        await submit(TOK.Cyk, [{ matchId: String(m._id), homePred: 50, awayPred: 40 }]);
        let r = await submit(TOK.Cyk, [{ matchId: String(m._id), clear: true }]);
        assert.strictEqual(r.body.deleted, 1);
        assert.strictEqual(await pred('Cyk', m), null);
        await submit(TOK.Cyk, [{ matchId: String(m._id), homePred: 50, awayPred: 40 }]);
        m.matchDate = inMin(0.5);
        r = await submit(TOK.Cyk, [{ matchId: String(m._id), clear: true }]);
        assert.strictEqual(r.body.deleted, 0);
        assert.ok(await pred('Cyk', m), 'zablokowany typ nie znika');
    });

    await test('A5 typ na mecz z innego sezonu jest pomijany', async () => {
        const other = await db.Match.create({ season: 2026, round: 1, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: inMin(500) });
        const r = await submit(TOK.Ala, [{ matchId: String(other._id), homePred: 45, awayPred: 45 }]);
        assert.strictEqual(r.body.saved, 0);
        assert.strictEqual(await db.Prediction.findOne({ nickname: 'Ala', matchId: String(other._id) }), null);
    });

    await test('A6 typy innych są ukryte przed blokadą: strona główna, profil i H2H', async () => {
        const m = await mkMatch(300);
        await submit(TOK.Ala, [{ matchId: String(m._id), homePred: 51, awayPred: 39 }]);
        await submit(TOK.Bob, [{ matchId: String(m._id), homePred: 39, awayPred: 51 }]);
        const data = await get('/api/public/data');
        const visible = data.body.predictions.filter(p => p.matchId === String(m._id));
        assert.strictEqual(visible.length, 2, 'widać, KTO wytypował');
        assert.ok(visible.every(p => p.hidden && p.homePred === null), 'ale nie widać typu');
        const prof = await get('/api/public/profile?nickname=Ala');
        assert.ok(!prof.body.history.some(h => h.matchId === String(m._id)), 'profil nie zdradza typu');
        assert.ok(!JSON.stringify(data.body).includes('"homePred":51'));
    });

    await test('A7 typy stają się jawne po blokadzie', async () => {
        const m = await mkMatch(300);
        await submit(TOK.Ala, [{ matchId: String(m._id), homePred: 52, awayPred: 38 }]);
        m.matchDate = inMin(0.5);
        cache.invalidate();
        const data = await get('/api/public/data');
        const p = data.body.predictions.find(x => x.matchId === String(m._id) && x.nickname === 'Ala');
        assert.strictEqual(p.hidden, false);
        assert.strictEqual(p.homePred, 52);
    });

    await test('A8 wstrzymany gracz widzi panel, ale nie może typować', async () => {
        const m = await mkMatch(300);
        await admin('/player/toggle', { nickname: 'Dex' });
        const view = await get(`/api/public/player-data?token=${TOK.Dex}`);
        assert.strictEqual(view.status, 200);
        assert.strictEqual(view.body.player.isActive, false);
        const r = await submit(TOK.Dex, [{ matchId: String(m._id), homePred: 45, awayPred: 45 }]);
        assert.strictEqual(r.status, 403);
        await admin('/player/toggle', { nickname: 'Dex' });
        assert.strictEqual((await submit(TOK.Dex, [{ matchId: String(m._id), homePred: 45, awayPred: 45 }])).body.saved, 1);
    });

    await test('A9 zły, pusty albo stary token', async () => {
        assert.strictEqual((await get('/api/public/player-data?token=zly')).status, 404);
        assert.strictEqual((await get('/api/public/player-data')).status, 400);
        assert.strictEqual((await submit('zly', [])).status, 403);
        assert.strictEqual((await submit(undefined, [])).status, 403);
    });

    await test('A10 gracz spoza sezonu: brak miejsca w rankingu (zamiast "7/6"), pierwszy typ dopisuje go do sezonu', async () => {
        await db.Player.create({ nickname: 'Nowy', fullName: '', token: 'e5e5e5e5e5e5e5e5e5e5e5e5', seasons: [], isActive: true });
        const view = await get('/api/public/player-data?token=e5e5e5e5e5e5e5e5e5e5e5e5');
        assert.strictEqual(view.body.ranking.position, null);
        const m = await mkMatch(300);
        await submit('e5e5e5e5e5e5e5e5e5e5e5e5', [{ matchId: String(m._id), homePred: 46, awayPred: 44 }]);
        assert.ok((await db.Player.findOne({ nickname: 'Nowy' })).seasons.includes(2027));
    });

    await test('A11 typy sezonowe: tylko drużyny z sezonu, zamykają się z pierwszym meczem', async () => {
        // osobny sezon, który jeszcze się nie zaczął
        await db.Season.create({ year: 2030, label: 'Test 2030', isActive: false, lockMinutes: 1, teams: TEAMS, stageNames: {}, scoring: {} });
        await db.Match.create({ season: 2030, round: 1, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: inMin(60 * 24 * 30) });
        let r = await submit(TOK.Ala, [], { season: 2030, longTerm: { champion: TEAMS[0], bronze: 'Drużyna Spoza Ligi', relegation: TEAMS[3] } });
        assert.strictEqual(r.body.longTerm, true);
        const lt = await db.LongTerm.findOne({ season: 2030, nickname: 'Ala' });
        assert.strictEqual(lt.champion, TEAMS[0]);
        assert.strictEqual(lt.bronze, '', 'nieznana drużyna nie przechodzi');
        await db.Match.create({ season: 2030, round: 2, homeTeam: TEAMS[2], awayTeam: TEAMS[3], matchDate: inMin(-60 * 24) });
        r = await submit(TOK.Ala, [], { season: 2030, longTerm: { champion: TEAMS[1] } });
        assert.strictEqual(r.body.longTerm, false, 'pierwszy mecz już był');
        assert.ok(r.body.warnings.length);
        assert.strictEqual((await db.LongTerm.findOne({ season: 2030, nickname: 'Ala' })).champion, TEAMS[0]);
    });

    /* ============================================================ */
    group('B. Joker');

    await test('B1 joker: postawienie, przeniesienie, rezygnacja', async () => {
        const m1 = await mkMatch(400), m2 = await mkMatch(400);
        await submit(TOK.Bob, [{ matchId: String(m1._id), homePred: 46, awayPred: 44, usedJoker: true }]);
        assert.strictEqual((await pred('Bob', m1)).usedJoker, true);
        await submit(TOK.Bob, [{ matchId: String(m2._id), homePred: 48, awayPred: 42, usedJoker: true }]);
        assert.strictEqual((await pred('Bob', m1)).usedJoker, false);
        assert.strictEqual((await pred('Bob', m2)).usedJoker, true);
        await submit(TOK.Bob, [{ matchId: String(m2._id), homePred: 48, awayPred: 42, usedJoker: false }]);
        assert.strictEqual((await db.Prediction.find({ season: 2027, nickname: 'Bob', usedJoker: true })).length, 0);
    });

    await test('B2 zmiana wyniku na meczu z jokerem nie zdejmuje jokera (klient wysyła usedJoker z serwera)', async () => {
        const m = await mkMatch(400);
        await submit(TOK.Cyk, [{ matchId: String(m._id), homePred: 46, awayPred: 44, usedJoker: true }]);
        const other = await mkMatch(400);
        await submit(TOK.Cyk, [{ matchId: String(other._id), homePred: 40, awayPred: 50, usedJoker: false }]);
        assert.strictEqual((await pred('Cyk', m)).usedJoker, true, 'typ na inny mecz nie rusza jokera');
        await submit(TOK.Cyk, [{ matchId: String(m._id), homePred: 47, awayPred: 43, usedJoker: true }]);
        assert.strictEqual((await pred('Cyk', m)).usedJoker, true);
    });

    await test('B3 joker na zablokowanym meczu nie da się przenieść', async () => {
        const locked = await mkMatch(400), open = await mkMatch(400);
        await submit(TOK.Dex, [{ matchId: String(locked._id), homePred: 46, awayPred: 44, usedJoker: true }]);
        locked.matchDate = inMin(0.2);
        const r = await submit(TOK.Dex, [{ matchId: String(open._id), homePred: 50, awayPred: 40, usedJoker: true }]);
        assert.ok(r.body.warnings.some(w => /Joker/.test(w)));
        assert.strictEqual((await pred('Dex', locked)).usedJoker, true);
        assert.strictEqual((await pred('Dex', open)).usedJoker, false);
    });

    await test('B4 joker nie trafi na mecz zablokowany, przełożony (termin nieznany) ani anulowany', async () => {
        const nick = 'Nowy', tok = 'e5e5e5e5e5e5e5e5e5e5e5e5';
        const postponed = await mkMatch(400, { isPostponed: true });
        const voided = await mkMatch(400, { voidPredictions: true });
        const lockedM = await mkMatch(0.3);
        for (const m of [postponed, voided, lockedM]) {
            await submit(tok, [{ matchId: String(m._id), homePred: 46, awayPred: 44, usedJoker: true }]);
        }
        const jokers = (await db.Prediction.find({ season: 2027, nickname: nick, usedJoker: true }));
        assert.strictEqual(jokers.length, 0);
    });

    await test('B5 joker wymaga typu - zaznaczenie na meczu bez typu nie kasuje obecnego jokera', async () => {
        const withJoker = await mkMatch(400), empty = await mkMatch(400);
        await submit(TOK.Ala, [{ matchId: String(withJoker._id), homePred: 46, awayPred: 44, usedJoker: true }]);
        const r = await submit(TOK.Ala, [{ matchId: String(empty._id), usedJoker: true }]);
        assert.ok(r.body.warnings.some(w => /wymaga/.test(w)));
        assert.strictEqual((await pred('Ala', withJoker)).usedJoker, true);
    });

    await test('B6 dwa jokery w jednym zapisie - zostaje jeden', async () => {
        const a = await mkMatch(400), b = await mkMatch(400);
        await submit(TOK.Bob, [
            { matchId: String(a._id), homePred: 46, awayPred: 44, usedJoker: true },
            { matchId: String(b._id), homePred: 46, awayPred: 44, usedJoker: true }
        ]);
        assert.strictEqual((await db.Prediction.find({ season: 2027, nickname: 'Bob', usedJoker: true })).length, 1);
    });

    await test('B7 joker na meczu z walkowerem wraca do gracza (można postawić nowy)', async () => {
        const wo = await mkMatch(400), next = await mkMatch(500);
        await submit(TOK.Dex, [{ matchId: String(wo._id), homePred: 46, awayPred: 44, usedJoker: true }]);
        await db.Prediction.updateMany({ season: 2027, nickname: 'Dex', matchId: { $ne: String(wo._id) } }, { $set: { usedJoker: false } });
        wo.matchDate = inMin(-180);
        await admin('/result', { matchId: String(wo._id), homeScore: 40, awayScore: 0, walkover: true });
        await submit(TOK.Dex, [{ matchId: String(next._id), homePred: 50, awayPred: 40, usedJoker: true }]);
        assert.strictEqual((await pred('Dex', next)).usedJoker, true);
    });

    await test('B8 punkty: Joker x Złoty Kask = 12 za dokładny wynik, 0 za pudło', async () => {
        const m = await mkMatch(400, { isMatchOfTheRound: true });
        await submit(TOK.Ala, [{ matchId: String(m._id), homePred: 47, awayPred: 43, usedJoker: true }]);
        await submit(TOK.Bob, [{ matchId: String(m._id), homePred: 40, awayPred: 50, usedJoker: true }]);
        m.matchDate = inMin(-180);
        await admin('/result', { matchId: String(m._id), homeScore: 47, awayScore: 43 });
        assert.strictEqual((await pred('Ala', m)).pointsEarned, 12);
        assert.strictEqual((await pred('Bob', m)).pointsEarned, 0);
    });

    /* ============================================================ */
    group('C. Deszcz, przełożenia, walkowery');

    await test('C1 przełożenie PRZED blokadą: typy zostają i dalej można je zmieniać', async () => {
        const m = await mkMatch(600);
        await submit(TOK.Ala, [{ matchId: String(m._id), homePred: 46, awayPred: 44 }]);
        const r = await admin('/match-edit', { matchId: String(m._id), matchDate: inMin(60 * 24 * 7).toISOString() });
        assert.strictEqual(r.status, 200);
        const after = await fresh(m._id);
        assert.strictEqual(after.predictionsFrozen, false);
        assert.ok(after.originalDate);
        assert.strictEqual((await submit(TOK.Ala, [{ matchId: String(m._id), homePred: 44, awayPred: 46 }])).body.saved, 1);
    });

    await test('C2 deszcz w dniu meczu (po blokadzie) + nowy termin: typy zamrożone i jawne', async () => {
        const m = await mkMatch(0.2);
        await db.Prediction.create({ season: 2027, nickname: 'Bob', matchId: String(m._id), homePred: 41, awayPred: 49 });
        const r = await admin('/match-edit', { matchId: String(m._id), matchDate: inMin(60 * 24 * 3).toISOString() });
        assert.ok(/zamrożone/.test(r.body.message));
        assert.strictEqual((await fresh(m._id)).predictionsFrozen, true);
        assert.strictEqual((await submit(TOK.Bob, [{ matchId: String(m._id), homePred: 50, awayPred: 40 }])).body.saved, 0);
        cache.invalidate();
        const p = (await get('/api/public/data')).body.predictions.find(x => x.matchId === String(m._id));
        assert.strictEqual(p.hidden, false);
    });

    await test('C3 "termin nieznany" PRZED blokadą: typy otwarte i ukryte, także gdy minie stara data', async () => {
        const m = await mkMatch(240);
        await submit(TOK.Cyk, [{ matchId: String(m._id), homePred: 46, awayPred: 44 }]);
        await admin('/match-edit', { matchId: String(m._id), isPostponed: true });
        const doc = await fresh(m._id);
        assert.strictEqual(doc.predictionsFrozen, false);
        doc.matchDate = inMin(-60); // stara data minęła, nowego terminu brak
        cache.invalidate();
        const p = (await get('/api/public/data')).body.predictions.find(x => x.matchId === String(m._id));
        assert.strictEqual(p.hidden, true, 'typ dalej ukryty');
        assert.strictEqual((await submit(TOK.Cyk, [{ matchId: String(m._id), homePred: 45, awayPred: 45 }])).body.saved, 1, 'i edytowalny');
        await admin('/match-edit', { matchId: String(m._id), matchDate: inMin(60 * 24 * 10).toISOString() });
        const after = await fresh(m._id);
        assert.strictEqual(after.isPostponed, false, 'nowa data kończy "termin nieznany"');
        assert.strictEqual(after.predictionsFrozen, false, 'nie zamrażamy, bo typy nie były jawne');
    });

    await test('C4 "termin nieznany" ustawiony PO blokadzie: typy zamrożone od razu', async () => {
        const m = await mkMatch(0.3);
        await admin('/match-edit', { matchId: String(m._id), isPostponed: true });
        const doc = await fresh(m._id);
        assert.strictEqual(doc.isPostponed, true);
        assert.strictEqual(doc.predictionsFrozen, true);
    });

    await test('C5 admin może świadomie odmrozić typy', async () => {
        const m = await mkMatch(0.3);
        await admin('/match-edit', { matchId: String(m._id), matchDate: inMin(60 * 24 * 5).toISOString() });
        assert.strictEqual((await fresh(m._id)).predictionsFrozen, true);
        await admin('/match-edit', { matchId: String(m._id), predictionsFrozen: false });
        assert.strictEqual((await fresh(m._id)).predictionsFrozen, false);
        assert.strictEqual((await submit(TOK.Bob, [{ matchId: String(m._id), homePred: 45, awayPred: 45 }])).body.saved, 1);
    });

    await test('C6 walkower: tabela liczy wynik, typy anulowane; cofnięcie walkowera przywraca punkty', async () => {
        const m = await mkMatch(400, { teams: [TEAMS[2], TEAMS[3]] });
        await submit(TOK.Ala, [{ matchId: String(m._id), homePred: 40, awayPred: 0 }]);
        m.matchDate = inMin(-200);
        await admin('/result', { matchId: String(m._id), homeScore: 40, awayScore: 0, walkover: true });
        assert.strictEqual((await pred('Ala', m)).pointsEarned, null);
        cache.invalidate();
        const table = (await get('/api/public/data')).body.standings;
        assert.ok(table.find(t => t.name === TEAMS[2]).matches >= 1);
        await admin('/result', { matchId: String(m._id), homeScore: 40, awayScore: 0, walkover: false });
        const doc = await fresh(m._id);
        assert.strictEqual(doc.isWalkover, false);
        assert.strictEqual(doc.voidPredictions, false);
        assert.strictEqual((await pred('Ala', m)).pointsEarned, 5);
    });

    await test('C7 wyczyszczenie wyniku walkowera zdejmuje walkower', async () => {
        const m = await mkMatch(-200);
        await admin('/result', { matchId: String(m._id), homeScore: 40, awayScore: 0, walkover: true });
        await admin('/result', { matchId: String(m._id), clear: true });
        const doc = await fresh(m._id);
        assert.strictEqual(doc.homeScore, null);
        assert.strictEqual(doc.isWalkover, false);
        assert.strictEqual(doc.voidPredictions, false);
    });

    await test('C8 mecz odwołany (typy anulowane) i przywrócony', async () => {
        const m = await mkMatch(-200);
        await db.Prediction.create({ season: 2027, nickname: 'Cyk', matchId: String(m._id), homePred: 46, awayPred: 44 });
        await admin('/result', { matchId: String(m._id), homeScore: 46, awayScore: 44 });
        assert.strictEqual((await pred('Cyk', m)).pointsEarned, 5);
        await admin('/match-edit', { matchId: String(m._id), voidPredictions: true });
        assert.strictEqual((await pred('Cyk', m)).pointsEarned, null);
        await admin('/match-edit', { matchId: String(m._id), voidPredictions: false });
        assert.strictEqual((await pred('Cyk', m)).pointsEarned, 5);
    });

    await test('C9 mecz przerwany po 11 biegach (40:26) liczy się normalnie', async () => {
        const m = await mkMatch(-200);
        await db.Prediction.create({ season: 2027, nickname: 'Dex', matchId: String(m._id), homePred: 44, awayPred: 30 });
        await admin('/result', { matchId: String(m._id), homeScore: 40, awayScore: 26 });
        assert.strictEqual((await pred('Dex', m)).pointsEarned, 3, 'zwycięzca + różnica 14');
    });

    await test('C10 przyznanie Złotego Kasku po wyniku przelicza punkty', async () => {
        const m = await mkMatch(-200);
        await db.Prediction.create({ season: 2027, nickname: 'Ala', matchId: String(m._id), homePred: 46, awayPred: 44 });
        await admin('/result', { matchId: String(m._id), homeScore: 46, awayScore: 44 });
        await admin('/match-edit', { matchId: String(m._id), isMatchOfTheRound: true });
        assert.strictEqual((await pred('Ala', m)).pointsEarned, 6);
    });

    await test('C11 przeniesienie meczu do kolejki, w której ta para już gra = czytelny błąd', async () => {
        const a = await mkMatch(400), b = await mkMatch(400);
        const r = await admin('/match-edit', { matchId: String(b._id), round: a.round });
        assert.strictEqual(r.status, 400);
        assert.ok(/już mecz/.test(r.body.error), r.body.error);
        const ok = await admin('/match-edit', { matchId: String(b._id), round: 77 });
        assert.strictEqual(ok.status, 200);
        assert.strictEqual((await fresh(b._id)).round, 77);
    });

    await test('C12 korekta tabeli (np. -2 pkt decyzją ligi) jest widoczna z powodem', async () => {
        await admin('/season/settings', { season: 2027, standingsAdjustments: [{ team: TEAMS[1], points: -2, reason: 'walkower R5' }] });
        cache.invalidate();
        const t = (await get('/api/public/data')).body.standings.find(x => x.name === TEAMS[1]);
        assert.strictEqual(t.adjustment, -2);
        assert.ok(t.adjustmentNotes[0].includes('walkower'));
        await admin('/season/settings', { season: 2027, standingsAdjustments: [] });
    });

    /* ============================================================ */
    group('D. Wyniki i scraper');

    await test('D1 wynik spoza zakresu / ułamek = 400', async () => {
        const m = await mkMatch(-200);
        for (const [h, a] of [[76, 14], [-1, 10], [45.5, 44.5], ['x', 1]]) {
            assert.strictEqual((await admin('/result', { matchId: String(m._id), homeScore: h, awayScore: a })).status, 400);
        }
    });

    await test('D2 wyniki kolejki: zapisuje zmienione, pomija niezmienione i zgłasza błędne', async () => {
        const a = await mkMatch(-200), b = await mkMatch(-200), c = await mkMatch(-200);
        await admin('/result', { matchId: String(a._id), homeScore: 46, awayScore: 44 });
        const r = await admin('/results-bulk', { results: [
            { matchId: String(a._id), homeScore: 46, awayScore: 44 },
            { matchId: String(b._id), homeScore: 50, awayScore: 40 },
            { matchId: String(c._id), homeScore: 99, awayScore: 0 }
        ] });
        assert.strictEqual(r.body.saved, 1);
        assert.strictEqual(r.body.unchanged, 1);
        assert.strictEqual(r.body.invalid.length, 1);
        assert.strictEqual((await fresh(c._id)).homeScore, null);
    });

    // Scraper: drużyny rozpoznawane po miastach z nazw (Lublin, Wrocław...)
    const scrapeWith = (html, urls = ['https://wyniki.test/a']) => jobs.scrapeJob({ season: db.Season._rows.find(s => s.year === 2027), urls, fetchHtml: async () => html });

    await test('D3 scraper nie bierze meczu trwającego (start < 150 min temu)', async () => {
        const live = await mkMatch(-60, { teams: [TEAMS[1], TEAMS[0]] });
        await scrapeWith('<p>Wrocław 30:24 Lublin</p>');
        assert.strictEqual(await db.ResultDraft.findOne({ matchId: String(live._id) }), null);
    });

    let scraped;
    await test('D4 scraper tworzy draft z kontrolą sensowności, wynik nie trafia do meczu', async () => {
        scraped = await mkMatch(-200, { teams: [TEAMS[3], TEAMS[2]] });
        await db.Prediction.create({ season: 2027, nickname: 'Ala', matchId: String(scraped._id), homePred: 47, awayPred: 43 });
        const out = await scrapeWith('<table><tr><td>Delta Gorzów</td><td>47 : 43</td><td>Gamma Toruń</td></tr></table>');
        assert.ok(out.created >= 1, out.summary);
        const d = await db.ResultDraft.findOne({ matchId: String(scraped._id), status: 'draft' });
        assert.strictEqual(d.homeScore, 47);
        assert.strictEqual((await fresh(scraped._id)).homeScore, null);
    });

    await test('D5 zmiana wyniku w źródle aktualizuje draft z adnotacją', async () => {
        await scrapeWith('<table><tr><td>Delta Gorzów</td><td>48 : 42</td><td>Gamma Toruń</td></tr></table>');
        const d = await db.ResultDraft.findOne({ matchId: String(scraped._id), status: 'draft' });
        assert.strictEqual(d.homeScore, 48);
        assert.ok(d.warnings.some(w => /zmienił się/.test(w)));
    });

    await test('D6 ręczny wynik odrzuca oczekujący draft', async () => {
        await admin('/result', { matchId: String(scraped._id), homeScore: 47, awayScore: 43 });
        assert.strictEqual(await db.ResultDraft.findOne({ matchId: String(scraped._id), status: 'draft' }), null);
        assert.strictEqual((await pred('Ala', scraped)).pointsEarned, 5);
    });

    await test('D7 inny wynik w źródle niż zatwierdzony = draft z ostrzeżeniem o korekcie', async () => {
        await scrapeWith('<table><tr><td>Delta Gorzów</td><td>46 : 44</td><td>Gamma Toruń</td></tr></table>');
        const d = await db.ResultDraft.findOne({ matchId: String(scraped._id), status: 'draft' });
        assert.ok(d, 'draft korekty');
        assert.ok(d.warnings.some(w => /różni się od zatwierdzonego/.test(w)));
        await admin('/drafts/reject', { id: String(d._id) });
    });

    await test('D8 wynik niemożliwy (suma > 90) wymaga korekty albo świadomego "force"', async () => {
        const m = await mkMatch(-200, { teams: [TEAMS[0], TEAMS[3]] });
        await scrapeWith('<p>Lublin 61:39 Gorzów</p>');
        const d = await db.ResultDraft.findOne({ matchId: String(m._id), status: 'draft' });
        assert.ok(d.blockers.length);
        assert.strictEqual((await admin('/drafts/approve', { id: String(d._id), notify: false })).status, 409);
        assert.strictEqual((await admin('/drafts/approve', { id: String(d._id), force: true, notify: false })).status, 200);
        assert.strictEqual((await fresh(m._id)).homeScore, 61);
    });

    await test('D9 "zatwierdź wszystkie" pomija drafty z blokerami', async () => {
        const ok = await mkMatch(-300, { teams: [TEAMS[1], TEAMS[2]] });
        const bad = await mkMatch(-300, { teams: [TEAMS[2], TEAMS[1]] });
        await scrapeWith('<ul><li>Wrocław 50:40 Toruń</li><li>Toruń 70:30 Wrocław</li></ul>');
        const r = await admin('/drafts/approve-all', { notify: false });
        assert.ok(/pominięto 1/.test(r.body.message), r.body.message);
        assert.strictEqual((await fresh(ok._id)).homeScore, 50);
        assert.strictEqual((await fresh(bad._id)).homeScore, null);
        await admin('/drafts/reject', { id: String((await db.ResultDraft.findOne({ matchId: String(bad._id), status: 'draft' }))._id) });
    });

    await test('D10 źródło nie odpowiada: inne źródła działają, błąd trafia do podsumowania', async () => {
        const m = await mkMatch(-300, { teams: [TEAMS[3], TEAMS[0]] });
        const out = await jobs.scrapeJob({
            season: db.Season._rows.find(s => s.year === 2027), urls: ['https://pada.test', 'https://dziala.test'],
            fetchHtml: async url => { if (url.includes('pada')) throw new Error('HTTP 503'); return '<p>Gorzów 44:46 Lublin</p>'; }
        });
        assert.ok(out.sourceErrors.some(e => /503/.test(e)));
        assert.ok(await db.ResultDraft.findOne({ matchId: String(m._id), status: 'draft' }));
    });

    await test('D11 usunięcie meczu i zastąpienie terminarza usuwa jego drafty', async () => {
        const m = await mkMatch(-300, { teams: [TEAMS[0], TEAMS[2]] });
        await scrapeWith('<p>Lublin 45:45 Toruń</p>');
        assert.ok(await db.ResultDraft.findOne({ matchId: String(m._id) }));
        await admin('/match-delete', { matchId: String(m._id) });
        assert.strictEqual(await db.ResultDraft.findOne({ matchId: String(m._id) }), null);
    });

    /* ============================================================ */
    group('E. Gracze');

    await test('E1 dodanie gracza: pusty / za długi pseudonim = 400, ponowne dodanie = aktualizacja', async () => {
        assert.strictEqual((await admin('/player', { nickname: '   ', season: 2027 })).status, 400);
        assert.strictEqual((await admin('/player', { nickname: 'x'.repeat(31), season: 2027 })).status, 400);
        const r1 = await admin('/player', { nickname: 'Ewa', fullName: 'Ewa K.', season: 2027 });
        const r2 = await admin('/player', { nickname: 'Ewa', season: 2027 });
        assert.strictEqual(r1.body.token, r2.body.token, 'ponowne dodanie nie zmienia linku');
        assert.strictEqual((await db.Player.find({ nickname: 'Ewa' })).length, 1);
    });

    await test('E2 nowy link unieważnia stary (reset "hasła")', async () => {
        const before = (await db.Player.findOne({ nickname: 'Ewa' })).token;
        await admin('/player/token', { nickname: 'Ewa' });
        assert.strictEqual((await get(`/api/public/player-data?token=${before}`)).status, 404);
    });

    await test('E3 zmiana pseudonimu przenosi typy, typy sezonowe, puchar i push; zajęty = 409', async () => {
        const m = await mkMatch(500);
        const tok = (await db.Player.findOne({ nickname: 'Ewa' })).token;
        await submit(tok, [{ matchId: String(m._id), homePred: 46, awayPred: 44 }]);
        await db.LongTerm.create({ season: 2027, nickname: 'Ewa', champion: TEAMS[0] });
        await db.CupMatch.create({ season: 2027, stage: 'Test', roundNumber: 3, player1: 'Ewa', player2: 'Ala' });
        await db.PushSubscription.create({ endpoint: 'https://push.test/ewa', keys: { p256dh: 'k', auth: 'a' }, nickname: 'Ewa' });
        assert.strictEqual((await admin('/player/rename', { nickname: 'Ewa', newNickname: 'Ala' })).status, 409);
        const r = await admin('/player/rename', { nickname: 'Ewa', newNickname: 'Ewelina', fullName: 'Ewelina K.' });
        assert.strictEqual(r.status, 200, r.body.error);
        assert.ok(await db.Prediction.findOne({ nickname: 'Ewelina', matchId: String(m._id) }));
        assert.strictEqual(await db.Prediction.findOne({ nickname: 'Ewa' }), null);
        assert.ok(await db.LongTerm.findOne({ nickname: 'Ewelina' }));
        assert.ok(await db.CupMatch.findOne({ player1: 'Ewelina' }));
        assert.strictEqual((await db.PushSubscription.findOne({ endpoint: 'https://push.test/ewa' })).nickname, 'Ewelina');
        assert.strictEqual((await get(`/api/public/player-data?token=${tok}`)).body.player.nickname, 'Ewelina', 'link działa dalej');
    });

    await test('E4 wypisanie z sezonu i usunięcie z sezonu (historia innych sezonów zostaje)', async () => {
        await db.Prediction.create({ season: 2026, nickname: 'Ewelina', matchId: 'stary', homePred: 1, awayPred: 2 });
        await admin('/delete-player', { nickname: 'Ewelina', onlySeason: 2027 });
        assert.strictEqual((await db.Prediction.find({ season: 2027, nickname: 'Ewelina' })).length, 0);
        assert.strictEqual((await db.Prediction.find({ season: 2026, nickname: 'Ewelina' })).length, 1);
        assert.ok(!(await db.Player.findOne({ nickname: 'Ewelina' })).seasons.includes(2027));
        await admin('/delete-player', { nickname: 'Ewelina' });
        assert.strictEqual(await db.Player.findOne({ nickname: 'Ewelina' }), null);
        assert.strictEqual((await db.Prediction.find({ nickname: 'Ewelina' })).length, 0);
    });

    await test('E5 admin wpisuje typ za gracza (omija blokadę); nieistniejący gracz = 404', async () => {
        const m = await mkMatch(0.2);
        const ok = await admin('/predict', { season: 2027, nickname: 'Bob', matchId: String(m._id), homePred: 45, awayPred: 45 });
        assert.strictEqual(ok.status, 200);
        assert.strictEqual((await pred('Bob', m)).source, 'admin');
        const bad = await admin('/predict', { season: 2027, nickname: 'Duch', matchId: String(m._id), homePred: 45, awayPred: 45 });
        assert.strictEqual(bad.status, 404);
    });

    /* ============================================================ */
    group('F. Sezony i terminarz');

    await test('F1 nowy sezon: domyślnie blokada 1 min, nieaktywny, gracze przepisani', async () => {
        const r = await admin('/season', { year: 2028, label: 'PGE Ekstraliga 2028', teams: TEAMS, copyPlayers: true });
        assert.strictEqual(r.status, 200);
        const s = await db.Season.findOne({ year: 2028 });
        assert.strictEqual(s.lockMinutes, 1);
        assert.strictEqual(s.isActive, false);
        assert.ok((await db.Player.findOne({ nickname: 'Ala' })).seasons.includes(2028));
        assert.strictEqual((await get('/api/public/data')).body.season.year, 2027, 'strona główna nadal na 2027');
    });

    await test('F2 pusty sezon (bez meczów) - strona główna i panel gracza działają', async () => {
        const d = await get('/api/public/data?season=2028');
        assert.strictEqual(d.status, 200);
        assert.strictEqual(d.body.matches.length, 0);
        assert.strictEqual(d.body.longTermOpen, true);
        const p = await get(`/api/public/player-data?token=${TOK.Ala}&season=2028`);
        assert.strictEqual(p.status, 200);
    });

    await test('F3 bzdurny parametr sezonu = sezon aktywny', async () => {
        assert.strictEqual((await get('/api/public/data?season=abc')).body.season.year, 2027);
        assert.strictEqual((await get('/api/public/data?season=1900')).body.season.year, 2027);
    });

    await test('F4 generator terminarza: godziny w czasie polskim niezależnie od strefy serwera (także przy zmianie czasu)', async () => {
        assert.strictEqual(warsawDate(2027, 3, 26, 18, 0).toISOString(), '2027-03-26T17:00:00.000Z', 'zima: UTC+1');
        assert.strictEqual(warsawDate(2027, 4, 2, 18, 0).toISOString(), '2027-04-02T16:00:00.000Z', 'lato: UTC+2');
        const sched = generateSchedule({ teams: TEAMS, startDate: '2027-03-22' });
        const r1 = sched.filter(m => m.round === 1).map(m => new Date(m.matchDate).toISOString());
        assert.ok(r1.includes('2027-03-26T17:00:00.000Z'), `piątek 18:00 — ${r1}`);
        const r2 = sched.filter(m => m.round === 2).map(m => new Date(m.matchDate).toISOString());
        assert.ok(r2.includes('2027-04-02T16:00:00.000Z'), `piątek 18:00 po zmianie czasu — ${r2}`);
    });

    await test('F5 generator: zła data / nieparzysta liczba drużyn = 400; podgląd nic nie zapisuje', async () => {
        assert.strictEqual((await admin('/generate-schedule', { season: 2028, teams: TEAMS, startDate: '02.04.2027' })).status, 400);
        assert.strictEqual((await admin('/generate-schedule', { season: 2028, teams: TEAMS.slice(0, 3), startDate: '2028-04-03' })).status, 400);
        const prev = await admin('/generate-schedule', { season: 2028, teams: TEAMS, startDate: '2028-04-03', dryRun: true });
        assert.strictEqual(prev.body.schedule.length, 12);
        assert.strictEqual((await db.Match.find({ season: 2028 })).length, 0);
    });

    await test('F6 import JSON: błędne wiersze pominięte, poprawne dodane', async () => {
        const r = await admin('/load-schedule', { season: 2028, schedule: [
            { round: 1, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: '2028-04-07T18:00:00+02:00' },
            { round: 1, homeTeam: TEAMS[2], awayTeam: TEAMS[3], matchDate: 'kiedyś' },
            { homeTeam: 'X', awayTeam: 'Y', matchDate: '2028-04-07T18:00:00+02:00' }
        ] });
        assert.ok(/dodano 1/.test(r.body.message) && /pominięto błędnych: 2/.test(r.body.message), r.body.message);
    });

    await test('F7 dodanie meczu ręcznie: walidacja i brak duplikatów', async () => {
        assert.strictEqual((await admin('/match-add', { season: 2028, round: 2, homeTeam: TEAMS[0], awayTeam: TEAMS[0], matchDate: '2028-04-14T18:00:00Z' })).status, 400);
        assert.strictEqual((await admin('/match-add', { season: 2028, round: 2, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: 'zła' })).status, 400);
        assert.strictEqual((await admin('/match-add', { season: 2028, round: 2, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: '2028-04-14T18:00:00Z' })).status, 200);
        assert.strictEqual((await admin('/match-add', { season: 2028, round: 2, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: '2028-04-15T18:00:00Z' })).status, 400);
    });

    await test('F8 zmiana punktacji przelicza cały sezon', async () => {
        const m = await mkMatch(-300);
        await db.Prediction.create({ season: 2027, nickname: 'Cyk', matchId: String(m._id), homePred: 46, awayPred: 44 });
        await admin('/result', { matchId: String(m._id), homeScore: 46, awayScore: 44 });
        assert.strictEqual((await pred('Cyk', m)).pointsEarned, 5);
        await admin('/season/settings', { season: 2027, scoring: { exact: 6 } });
        assert.strictEqual((await pred('Cyk', m)).pointsEarned, 6);
        await admin('/season/settings', { season: 2027, scoring: { exact: 5 } });
    });

    await test('F9 blokada w minutach: 0 = do samego startu, wartość ujemna/tekst nie psuje sezonu', async () => {
        const m = await mkMatch(0.5);
        await admin('/season/settings', { season: 2027, lockMinutes: 0 });
        assert.strictEqual((await submit(TOK.Ala, [{ matchId: String(m._id), homePred: 45, awayPred: 45 }])).body.saved, 1);
        await admin('/season/settings', { season: 2027, lockMinutes: -5 });
        assert.strictEqual((await db.Season.findOne({ year: 2027 })).lockMinutes, 0);
        await admin('/season/settings', { season: 2027, lockMinutes: 'abc' });
        assert.strictEqual((await db.Season.findOne({ year: 2027 })).lockMinutes, 0);
        await admin('/season/settings', { season: 2027, lockMinutes: 1 });
    });

    await test('F10 zamknięcie sezonu: punkty za typy sezonowe, zapis typów zablokowany, ponowne otwarcie', async () => {
        const m = await mkMatch(5000);
        await db.LongTerm.create({ season: 2027, nickname: 'Ala', champion: TEAMS[0], bronze: TEAMS[2], relegation: TEAMS[3] });
        try {
            await admin('/season/finish', { season: 2027, champion: TEAMS[0], bronze: TEAMS[1], relegation: TEAMS[3], markFinished: true });
            assert.strictEqual((await db.LongTerm.findOne({ season: 2027, nickname: 'Ala' })).pointsEarned, 20, 'mistrz + spadek');
            assert.strictEqual((await submit(TOK.Bob, [{ matchId: String(m._id), homePred: 45, awayPred: 45 }])).status, 403);
        } finally {
            await admin('/season/reopen', { season: 2027 });
        }
        assert.strictEqual((await submit(TOK.Bob, [{ matchId: String(m._id), homePred: 45, awayPred: 45 }])).body.saved, 1);
    });

    /* ============================================================ */
    group('G. Powiadomienia');
    const sent = [];
    const dead = new Set(['https://push.test/martwy']);
    push._setSenderForTests(async (sub, body) => {
        if (dead.has(sub.endpoint)) { const e = new Error('Gone'); e.statusCode = 410; throw e; }
        sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) });
    });
    for (const nick of ['Ala', 'Bob', 'Cyk']) {
        await db.PushSubscription.create({ endpoint: `https://push.test/${nick}`, keys: { p256dh: 'k', auth: 'a' }, nickname: nick, isAdmin: false });
    }

    await test('G1 przypomnienie: tylko aktywni gracze z subskrypcją i bez typu, każdy mecz raz', async () => {
        const m = await mkMatch(61);
        await submit(TOK.Bob, [{ matchId: String(m._id), homePred: 45, awayPred: 45 }]);
        await admin('/player/toggle', { nickname: 'Cyk' }); // wstrzymany
        sent.length = 0;
        await jobs.reminderJob();
        const to = sent.filter(s => s.body.body.includes('Lublin')).map(s => s.endpoint);
        assert.ok(to.includes('https://push.test/Ala'), 'Ala nie ma typu');
        assert.ok(!to.includes('https://push.test/Bob'), 'Bob ma typ');
        assert.ok(!to.includes('https://push.test/Cyk'), 'Cyk jest wstrzymany');
        sent.length = 0;
        await jobs.reminderJob();
        assert.strictEqual(sent.length, 0, 'bez powtórek');
        await admin('/player/toggle', { nickname: 'Cyk' });
        await db.Match.deleteOne({ _id: m._id });
    });

    await test('G2 brak przypomnień dla meczu przełożonego, anulowanego i zamrożonego', async () => {
        const a = await mkMatch(61, { isPostponed: true }), b = await mkMatch(61, { voidPredictions: true }), c = await mkMatch(61, { predictionsFrozen: true });
        await jobs.reminderJob();
        const ids = [a, b, c].map(m => String(m._id));
        const logged = db.NotificationLog._rows.filter(r => ids.some(id => r.key.startsWith(`remind:${id}:`)));
        assert.strictEqual(logged.length, 0, 'żadne przypomnienie o tych meczach');
        for (const m of [a, b, c]) await db.Match.deleteOne({ _id: m._id });
    });

    await test('G3 push z wynikiem i punktami - raz na wynik', async () => {
        const m = await mkMatch(-200);
        await db.Prediction.create({ season: 2027, nickname: 'Ala', matchId: String(m._id), homePred: 46, awayPred: 44 });
        sent.length = 0;
        await admin('/result', { matchId: String(m._id), homeScore: 46, awayScore: 44, notify: true });
        await new Promise(r => setTimeout(r, 50));
        await admin('/result', { matchId: String(m._id), homeScore: 46, awayScore: 44, notify: true });
        await new Promise(r => setTimeout(r, 50));
        const forAla = sent.filter(s => s.endpoint === 'https://push.test/Ala');
        assert.strictEqual(forAla.length, 1);
        assert.ok(/\+5 pkt/.test(forAla[0].body.body), forAla[0].body.body);
    });

    await test('G4 martwa subskrypcja (410) jest usuwana', async () => {
        await db.PushSubscription.create({ endpoint: 'https://push.test/martwy', keys: { p256dh: 'k', auth: 'a' }, nickname: 'Dex' });
        await admin('/push/test', { nickname: 'Dex' });
        assert.strictEqual(await db.PushSubscription.findOne({ endpoint: 'https://push.test/martwy' }), null);
    });

    await test('G5 gdy wszystkie źródła scrapera padną, admin dostaje alert - raz dziennie', async () => {
        await db.PushSubscription.create({ endpoint: 'https://push.test/admin', keys: { p256dh: 'k', auth: 'a' }, nickname: null, isAdmin: true });
        await mkMatch(-300, { teams: [TEAMS[1], TEAMS[3]] });
        sent.length = 0;
        const down = { season: db.Season._rows.find(s => s.year === 2027), urls: ['https://pada.test'], fetchHtml: async () => { throw new Error('HTTP 500'); } };
        await jobs.scrapeJob(down);
        await jobs.scrapeJob(down);
        assert.strictEqual(sent.filter(s => s.endpoint === 'https://push.test/admin').length, 1);
    });

    /* ============================================================ */
    group('H. Statystyki');

    await test('H1 profil: nieistniejący gracz = 404, istniejący ma przebieg sezonu', async () => {
        assert.strictEqual((await get('/api/public/profile?nickname=Nikt')).status, 404);
        cache.invalidate();
        const p = await get('/api/public/profile?nickname=Ala');
        assert.strictEqual(p.status, 200);
        assert.ok(p.body.progress.length > 0);
        assert.ok(p.body.progress.every(x => x.position >= 1));
    });

    await test('H2 H2H: ten sam gracz = 400, wszystkie sezony działają', async () => {
        assert.strictEqual((await get('/api/public/h2h?a=Ala&b=Ala')).status, 400);
        const r = await get('/api/public/h2h?a=Ala&b=Bob&season=all');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.scope, 'all');
        assert.strictEqual(r.body.matches, r.body.rows.length);
    });

    await test('H3 ranking wszech czasów obejmuje wszystkie sezony', async () => {
        cache.invalidate();
        const r = await get('/api/public/alltime');
        assert.ok(r.body.seasons.some(s => s.year === 2028));
        assert.ok(r.body.ranking.find(x => x.nickname === 'Ala').points > 0);
    });

    /* ============================================================ */
    group('I. System, bezpieczeństwo, PWA');

    await test('I1 kopia zapasowa -> przywrócenie (tryb zastąp) odtwarza dane', async () => {
        const backup = (await adminGet('/backup')).body;
        const counts = { m: backup.matches.length, p: backup.predictions.length, pl: backup.players.length };
        assert.strictEqual(backup.version, 3);
        const r = await admin('/restore', { backup, mode: 'replace' });
        assert.strictEqual(r.status, 200);
        assert.strictEqual((await db.Match.find()).length, counts.m);
        assert.strictEqual((await db.Prediction.find()).length, counts.p);
        assert.strictEqual((await db.Player.find()).length, counts.pl);
        assert.strictEqual((await admin('/restore', { backup: { nic: 1 } })).status, 400);
    });

    await test('I2 cron: bez sekretu 503, zły 401, dobry 200', async () => {
        process.env.CRON_SECRET = '';
        assert.strictEqual((await post('/api/cron/run?job=reminders')).status, 503);
        process.env.CRON_SECRET = 'tajny-cron';
        assert.strictEqual((await post('/api/cron/run?job=reminders', {}, { 'x-cron-secret': 'zly' })).status, 401);
        assert.strictEqual((await post('/api/cron/run?job=reminders', {}, { 'x-cron-secret': 'tajny-cron' })).status, 200);
    });

    await test('I3 hasło admina w nagłówku (stara furtka) już nie działa', async () => {
        const r = await get('/api/admin/players', { 'x-admin-password': process.env.ADMIN_PASSWORD });
        assert.strictEqual(r.status, 401);
    });

    await test('I4 manifest PWA: link gracza tylko dla poprawnego tokenu', async () => {
        const ok = await get(`/manifest.webmanifest?id=${TOK.Ala}`);
        assert.ok(ok.body.start_url.includes(TOK.Ala));
        const bad = await get('/manifest.webmanifest?id=<script>');
        assert.strictEqual(bad.body.start_url, '/?source=pwa');
    });

    await test('I5 strony i service worker mają wersję plików (świeży cache po deployu)', async () => {
        const html = await get('/');
        assert.ok(/app\.css\?v=[0-9a-f]{10}/.test(html.text), 'wersja w HTML');
        assert.ok(!html.text.includes('__V__'));
        const sw = await get('/sw.js');
        assert.ok(/typer-[0-9a-f]{10}/.test(sw.text));
        assert.strictEqual(sw.headers.get('cache-control'), 'no-cache');
        for (const page of ['/typuj', '/typuj.html?id=x', '/gracz.html', '/admin']) {
            const r = await get(page);
            assert.strictEqual(r.status, 200, page);
            assert.ok(!r.text.includes('__V__'), page);
        }
        const css = await get(`/css/app.css?v=${(html.text.match(/app\.css\?v=([0-9a-f]{10})/) || [])[1]}`);
        assert.ok(/immutable/.test(css.headers.get('cache-control') || ''));
        assert.strictEqual((await get('/api/nie-ma')).status, 404);
        assert.strictEqual((await get('/healthz')).body.ok, true);
    });

    await test('I6 limit prób logowania: 10 złych haseł = blokada, podrobiony X-Forwarded-For jej nie obchodzi', async () => {
        // Render dopisuje prawdziwy adres NA KOŃCU nagłówka; początek może podrobić klient
        const real = '203.0.113.7';
        for (let i = 0; i < 10; i++) {
            await post('/api/admin/login', { password: 'zle' }, { 'X-Forwarded-For': `10.0.0.${i}, ${real}` });
        }
        const r = await post('/api/admin/login', { password: process.env.ADMIN_PASSWORD }, { 'X-Forwarded-For': `10.9.9.9, ${real}` });
        assert.strictEqual(r.status, 429);
        const other = await post('/api/admin/login', { password: process.env.ADMIN_PASSWORD }, { 'X-Forwarded-For': '198.51.100.1' });
        assert.strictEqual(other.status, 200, 'inny adres może się zalogować');
    });

    await test('I7 zastąpienie terminarza i usuwanie kolejek usuwają też wyniki ze scrapera', async () => {
        await db.Season.create({ year: 2033, label: 'Test 2033', isActive: false, lockMinutes: 1, teams: TEAMS, stageNames: {}, scoring: {} });
        const m1 = await db.Match.create({ season: 2033, round: 1, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: inMin(-300) });
        const m2 = await db.Match.create({ season: 2033, round: 16, homeTeam: TEAMS[2], awayTeam: TEAMS[3], matchDate: inMin(-300) });
        await db.ResultDraft.create({ season: 2033, matchId: String(m1._id), homeScore: 46, awayScore: 44, status: 'draft' });
        await db.ResultDraft.create({ season: 2033, matchId: String(m2._id), homeScore: 46, awayScore: 44, status: 'draft' });
        await admin('/clean-rounds', { season: 2033, from: 15 });
        assert.strictEqual(await db.ResultDraft.findOne({ matchId: String(m2._id) }), null, 'usuwanie kolejek');
        await admin('/generate-schedule', { season: 2033, teams: TEAMS, startDate: '2033-04-04', replace: true });
        assert.strictEqual(await db.ResultDraft.findOne({ matchId: String(m1._id) }), null, 'zastąpienie terminarza');
    });

    await test('I8 render.yaml: build instaluje devDependencies (Tailwind) mimo NODE_ENV=production', async () => {
        const yaml = require('fs').readFileSync(require('path').join(__dirname, '..', 'render.yaml'), 'utf8');
        const build = (yaml.match(/buildCommand:\s*(.+)/) || [])[1] || '';
        assert.ok(/NODE_ENV[\s\S]*production/.test(yaml), 'NODE_ENV=production w render.yaml');
        assert.ok(/npm ci --include=dev/.test(build), `buildCommand: ${build}`);
        assert.ok(require('../package.json').devDependencies.tailwindcss, 'Tailwind w devDependencies');
    });

    await test('I9 świeża instalacja: sezon bieżącego roku z blokadą 1 min; dane z v1: sezon LEGACY z blokadą 24 h', async () => {
        const { getActiveSeason } = require('../services/seasons');
        const { lockMinutesOf } = require('../services/scoring');
        db.Season._rows.length = 0;
        db.Match._rows.length = 0;
        const fresh = await getActiveSeason();
        const year = Number(new Date().toLocaleString('en-US', { timeZone: 'Europe/Warsaw', year: 'numeric' }));
        assert.strictEqual(fresh.year, year);
        assert.strictEqual(lockMinutesOf(fresh), 1);
        db.Season._rows.length = 0;
        await db.Match.create({ round: 1, homeTeam: 'A', awayTeam: 'B', matchDate: new Date() }); // mecz z v1 (bez sezonu)
        const legacy = await getActiveSeason();
        assert.strictEqual(legacy.year, Number(process.env.LEGACY_SEASON || 2026));
        assert.strictEqual(lockMinutesOf(legacy), 24 * 60, 'stara blokada zostaje');
    });

    group('J. Zgodność z regulaminem (API)');

    await test('J1 typy sezonowe: trzy różne drużyny - powtórzony wybór pominięty z ostrzeżeniem', async () => {
        await db.Season.create({ year: 2035, label: 'Test 2035', isActive: false, lockMinutes: 1, teams: TEAMS, stageNames: {}, scoring: {} });
        await db.Match.create({ season: 2035, round: 1, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: inMin(60 * 24 * 20) });
        const r = await submit(TOK.Bob, [], { season: 2035, longTerm: { champion: TEAMS[0], bronze: TEAMS[0], relegation: TEAMS[0] } });
        assert.ok(r.body.warnings.some(w => /brązowy/.test(w)) && r.body.warnings.some(w => /spadkowicz/.test(w)), JSON.stringify(r.body.warnings));
        const lt = await db.LongTerm.findOne({ season: 2035, nickname: 'Bob' });
        assert.deepStrictEqual([lt.champion, lt.bronze, lt.relegation], [TEAMS[0], '', '']);
        assert.strictEqual((await admin('/longterm', { season: 2035, nickname: 'Bob', champion: TEAMS[1], bronze: TEAMS[1] })).status, 400);
    });

    await test('J2 ranking w API: równe punkty rozstrzygają dokładne trafienia (różne miejsca, nie ex aequo)', async () => {
        await db.Season.create({ year: 2036, label: 'Test 2036', isActive: false, lockMinutes: 1, teams: TEAMS, stageNames: {}, scoring: {} });
        const a = await db.Match.create({ season: 2036, round: 1, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: inMin(-500), homeScore: 46, awayScore: 44 });
        const b = await db.Match.create({ season: 2036, round: 1, homeTeam: TEAMS[2], awayTeam: TEAMS[3], matchDate: inMin(-500), homeScore: 50, awayScore: 40 });
        await db.Prediction.create({ season: 2036, nickname: 'Ala', matchId: String(a._id), homePred: 46, awayPred: 44 });
        await db.Prediction.create({ season: 2036, nickname: 'Bob', matchId: String(a._id), homePred: 47, awayPred: 45 });
        await db.Prediction.create({ season: 2036, nickname: 'Bob', matchId: String(b._id), homePred: 48, awayPred: 42 });
        await admin('/recalculate', { season: 2036 });
        cache.invalidate();
        const rank = (await get('/api/public/data?season=2036')).body.ranking;
        const ala = rank.find(r => r.nickname === 'Ala'), bob = rank.find(r => r.nickname === 'Bob');
        assert.strictEqual(ala.points, bob.points, 'po 5 pkt');
        assert.deepStrictEqual([ala.position, bob.position], [1, 2]);
    });

    await test('J3 puchar w API: wynik liczony na bieżąco - korekta wyniku meczu zmienia drabinkę bez "Przelicz"', async () => {
        const ms = (await db.Match.find({ season: 2036 }));
        await db.CupMatch.create({ season: 2036, stage: 'Finał', roundNumber: 1, player1: 'Bob', player2: 'Ala', autoScore: true, score1: null, score2: null });
        cache.invalidate();
        let cup = (await get('/api/public/data?season=2036')).body.cupMatches[0];
        assert.deepStrictEqual([cup.score1, cup.score2, cup.finished, cup.winner, cup.decidedBy], [5, 5, true, 'Ala', 'exact']);
        await admin('/result', { matchId: String(ms[1]._id), homeScore: 48, awayScore: 42 }); // typ Boba 48:42 = dokładny
        cup = (await get('/api/public/data?season=2036')).body.cupMatches[0];
        assert.deepStrictEqual([cup.score1, cup.score2, cup.winner], [8, 5, 'Bob'], 'Bob: 3 + 5 po korekcie');
    });

    await test('J4 regulamin dostaje czas przypomnienia i blokady z serwera', async () => {
        const d = (await get('/api/public/data')).body.season;
        assert.strictEqual(d.reminderMinutes, 120);
        assert.strictEqual(typeof d.lockMinutes, 'number');
    });

    /* ============================================================ */
    group('K. Koniec sezonu: Mistrz Typera i niespodzianka');
    const PRIZE = 'Kask z autografem mistrza świata';
    const NOTE = 'Gratulacje! Odbiór na najbliższym meczu w Lublinie.';
    const pd = (tok, year) => get(`/api/public/player-data?token=${tok}&season=${year}`);
    let k3;

    await test('K1 sezon trwa: brak mistrza, zwycięzca kolejki dopiero po rozliczeniu całej kolejki', async () => {
        await db.Season.create({ year: 2037, label: 'Finał 2037', isActive: false, lockMinutes: 1, teams: TEAMS, stageNames: {}, scoring: {} });
        const k1 = await db.Match.create({ season: 2037, round: 1, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: inMin(-3000), homeScore: 46, awayScore: 44 });
        const k2 = await db.Match.create({ season: 2037, round: 1, homeTeam: TEAMS[2], awayTeam: TEAMS[3], matchDate: inMin(-3000), homeScore: 50, awayScore: 40 });
        k3 = await db.Match.create({ season: 2037, round: 2, homeTeam: TEAMS[1], awayTeam: TEAMS[0], matchDate: inMin(-600) });
        const typ = (nick, m, h, a) => db.Prediction.create({ season: 2037, nickname: nick, matchId: String(m._id), homePred: h, awayPred: a });
        await typ('Ala', k1, 46, 44); await typ('Ala', k2, 49, 41); await typ('Ala', k3, 46, 44);   // 5 + 2, potem +5
        await typ('Bob', k1, 47, 45); await typ('Bob', k2, 50, 40);                               // 3 + 5 = 8
        await typ('Cyk', k1, 50, 40); await typ('Cyk', k2, 45, 45);                               // 2 + 0
        await admin('/recalculate', { season: 2037 });
        cache.invalidate();
        assert.strictEqual((await get('/api/public/data?season=2037')).body.finale, null);
        const bob = (await pd(TOK.Bob, 2037)).body;
        assert.strictEqual(bob.champion, null);
        assert.deepStrictEqual(bob.lastRoundWin, { round: 1, points: 8, shared: false }, 'Bob wygrał rozliczoną kolejkę 1');
        const ala = (await pd(TOK.Ala, 2037)).body;
        assert.strictEqual(ala.lastRoundWin, null, 'kolejka 2 bez wyniku - nikt jej jeszcze nie wygrał');
        const rw = (await get('/api/public/data?season=2037')).body.roundWinners;
        assert.deepStrictEqual(rw.map(r => [r.round, r.complete]), [[1, true]]);
        assert.strictEqual((await post('/api/public/champion/reveal', { token: TOK.Ala, season: 2037 })).status, 403);
    });

    await test('K2 admin ustawia niespodziankę - treść nie wycieka do strony publicznej ani do innych graczy', async () => {
        await admin('/result', { matchId: String(k3._id), homeScore: 46, awayScore: 44 });
        const r = await admin('/season/settings', { season: 2037, winnerSurprise: { prize: PRIZE, message: NOTE } });
        assert.strictEqual(r.status, 200);
        const info = (await adminGet('/seasons')).body.find(x => x.year === 2037);
        assert.deepStrictEqual(info.winnerSurprise, { prize: PRIZE, message: NOTE, revealedBy: [] });
        const pub = (await get('/api/public/data?season=2037')).text;
        assert.ok(!pub.includes(PRIZE) && !pub.includes(NOTE), 'nagroda tajna na stronie publicznej');
        assert.ok(!(await pd(TOK.Ala, 2037)).text.includes(PRIZE), 'przed zamknięciem sezonu nawet lider jej nie widzi');
        assert.deepStrictEqual((await pd(TOK.Ala, 2037)).body.lastRoundWin, { round: 2, points: 5, shared: false });
    });

    await test('K3 zamknięcie sezonu: walidacja wyników, mistrz dostaje push z niespodzianką, reszta - o końcu sezonu (raz)', async () => {
        assert.strictEqual((await admin('/season/finish', { season: 2037, champion: TEAMS[0], bronze: TEAMS[0] })).status, 400, 'ta sama drużyna dwa razy');
        sent.length = 0;
        const r = await admin('/season/finish', { season: 2037, champion: TEAMS[0], bronze: TEAMS[2], relegation: TEAMS[3], markFinished: true });
        assert.strictEqual(r.status, 200);
        assert.ok(/Mistrz Typera: Ala/.test(r.body.message), r.body.message);
        const toAla = sent.filter(x => x.endpoint === 'https://push.test/Ala');
        const toBob = sent.filter(x => x.endpoint === 'https://push.test/Bob');
        assert.ok(toAla.length === 1 && /Mistrzem/.test(toAla[0].body.title) && toAla[0].body.url.includes(TOK.Ala), JSON.stringify(toAla));
        assert.ok(toBob.length === 1 && /Koniec sezonu/.test(toBob[0].body.title) && !toBob[0].body.url.includes('id='), JSON.stringify(toBob));
        sent.length = 0;
        await admin('/season/finish', { season: 2037, champion: TEAMS[0], bronze: TEAMS[2], relegation: TEAMS[3], markFinished: true });
        assert.strictEqual(sent.length, 0, 'ponowne zamknięcie nie powtarza powiadomień');
    });

    await test('K4 po zamknięciu: podium publicznie, niespodzianka tylko w panelu mistrza, medale dla podium', async () => {
        cache.invalidate();
        const data = (await get('/api/public/data?season=2037'));
        assert.deepStrictEqual(data.body.finale.champions, ['Ala']);
        assert.deepStrictEqual(data.body.finale.podium.map(p => [p.nickname, p.position]), [['Ala', 1], ['Bob', 2], ['Cyk', 3]]);
        assert.ok(data.body.finale.hasSurprise && !data.text.includes(PRIZE));
        const ala = (await pd(TOK.Ala, 2037)).body;
        assert.deepStrictEqual([ala.champion.prize, ala.champion.message, ala.champion.revealed, ala.medal], [PRIZE, NOTE, false, 1]);
        const bob = await pd(TOK.Bob, 2037);
        assert.ok(bob.body.champion === null && bob.body.medal === 2 && !bob.text.includes(PRIZE));
        const dex = (await pd(TOK.Dex, 2037)).body;
        assert.strictEqual(dex.medal, null, 'Dex bez typów - poza podium');
    });

    await test('K5 odkrycie niespodzianki: tylko mistrz, raz zapisane, widoczne dla admina', async () => {
        assert.strictEqual((await post('/api/public/champion/reveal', { token: TOK.Bob, season: 2037 })).status, 403);
        assert.strictEqual((await post('/api/public/champion/reveal', { token: 'zly-token', season: 2037 })).status, 403);
        const r = await post('/api/public/champion/reveal', { token: TOK.Ala, season: 2037 });
        assert.deepStrictEqual([r.status, r.body.prize, r.body.text], [200, PRIZE, NOTE]);
        await post('/api/public/champion/reveal', { token: TOK.Ala, season: 2037 });
        const info = (await adminGet('/seasons')).body.find(x => x.year === 2037);
        assert.deepStrictEqual(info.winnerSurprise.revealedBy, ['Ala']);
        cache.invalidate();
        assert.deepStrictEqual((await get('/api/public/data?season=2037')).body.finale.revealed, ['Ala']);
        assert.strictEqual((await pd(TOK.Ala, 2037)).body.champion.revealed, true);
        // zmiana treści nagrody nie kasuje informacji, że mistrz już ją odkrył
        await admin('/season/settings', { season: 2037, winnerSurprise: { prize: PRIZE + ' i bilety' } });
        const again = (await adminGet('/seasons')).body.find(x => x.year === 2037).winnerSurprise;
        assert.deepStrictEqual([again.prize, again.message, again.revealedBy], [PRIZE + ' i bilety', NOTE, ['Ala']]);
    });

    await test('K6 pełny remis na szczycie: dwóch mistrzów ex aequo, obaj mogą odkryć niespodziankę', async () => {
        await db.Season.create({ year: 2038, label: 'Remis 2038', isActive: false, lockMinutes: 1, teams: TEAMS, stageNames: {}, scoring: {} });
        const m = await db.Match.create({ season: 2038, round: 1, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: inMin(-900), homeScore: 46, awayScore: 44 });
        for (const n of ['Ala', 'Bob']) await db.Prediction.create({ season: 2038, nickname: n, matchId: String(m._id), homePred: 46, awayPred: 44 });
        await db.Prediction.create({ season: 2038, nickname: 'Cyk', matchId: String(m._id), homePred: 40, awayPred: 50 });
        await admin('/recalculate', { season: 2038 });
        await admin('/season/finish', { season: 2038, champion: TEAMS[1], markFinished: true, prize: 'Pizza', message: '' });
        cache.invalidate();
        const fin = (await get('/api/public/data?season=2038')).body.finale;
        assert.deepStrictEqual(fin.champions.sort(), ['Ala', 'Bob']);
        const bob = (await pd(TOK.Bob, 2038)).body;
        assert.deepStrictEqual([bob.champion.prize, bob.champion.coChampions], ['Pizza', ['Ala']]);
        assert.strictEqual((await post('/api/public/champion/reveal', { token: TOK.Bob, season: 2038 })).status, 200);
        assert.strictEqual((await pd(TOK.Cyk, 2038)).body.medal, null, 'Cyk jest 3., ale z zerem punktów - bez medalu');
    });

    await test('K7 ponowne otwarcie sezonu chowa mistrza; równe punkty z liderem to nie "ex aequo", gdy rozstrzygają dokładne', async () => {
        await admin('/season/reopen', { season: 2038 });
        cache.invalidate();
        assert.strictEqual((await get('/api/public/data?season=2038')).body.finale, null);
        assert.strictEqual((await pd(TOK.Ala, 2038)).body.champion, null);
        assert.strictEqual((await post('/api/public/champion/reveal', { token: TOK.Ala, season: 2038 })).status, 403);
        await db.Season.create({ year: 2039, label: 'Pościg 2039', isActive: false, lockMinutes: 1, teams: TEAMS, stageNames: {}, scoring: {} });
        const a = await db.Match.create({ season: 2039, round: 1, homeTeam: TEAMS[0], awayTeam: TEAMS[1], matchDate: inMin(-900), homeScore: 46, awayScore: 44 });
        const b = await db.Match.create({ season: 2039, round: 1, homeTeam: TEAMS[2], awayTeam: TEAMS[3], matchDate: inMin(-900), homeScore: 50, awayScore: 40 });
        await db.Prediction.create({ season: 2039, nickname: 'Ala', matchId: String(a._id), homePred: 46, awayPred: 44 });   // 5 (dokładny)
        for (const n of ['Bob', 'Cyk']) {                                                                                     // 3 + 2, bez dokładnych
            await db.Prediction.create({ season: 2039, nickname: n, matchId: String(a._id), homePred: 47, awayPred: 45 });
            await db.Prediction.create({ season: 2039, nickname: n, matchId: String(b._id), homePred: 47, awayPred: 43 });
        }
        await admin('/recalculate', { season: 2039 });
        const bob = (await pd(TOK.Bob, 2039)).body.ranking, cyk = (await pd(TOK.Cyk, 2039)).body.ranking;
        assert.deepStrictEqual([bob.points, bob.position, bob.chasing.nickname, bob.chasing.gap, bob.chasing.samePosition], [5, 2, 'Ala', 0, false]);
        assert.deepStrictEqual([cyk.position, cyk.chasing.nickname, cyk.chasing.samePosition], [2, 'Bob', true], 'Bob i Cyk: pełny remis = ex aequo');
    });

    await test('K8 galeria mistrzów: ranking wszech czasów zna mistrzów zamkniętych sezonów i ich punkty', async () => {
        cache.invalidate();
        const all = (await get('/api/public/alltime')).body;
        const s37 = all.seasons.find(s => s.year === 2037);
        assert.deepStrictEqual([s37.winner, s37.winnerPoints], [['Ala'], 12]);
        const ala = all.ranking.find(r => r.nickname === 'Ala');
        assert.ok(ala.titles.includes(2037), JSON.stringify(ala.titles));
        const prof = (await get('/api/public/profile?nickname=Ala&season=2037')).body;
        assert.deepStrictEqual([prof.medal, prof.roundWins], [1, [2]]);
    });

    server.close();
    console.log(`\n${passed} scenariuszy przeszło${failed ? `, ${failed} NIE przeszło: ${failures.join(' | ')}` : ''}.\n`);
    process.exit(process.exitCode || 0);
})();
