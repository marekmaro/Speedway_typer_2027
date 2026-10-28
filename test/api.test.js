/* Testy integracyjne tras API na atrapie bazy (bez MongoDB).
   Sprawdzają rzeczy, których nie widać w testach jednostkowych:
   blokady czasowe, ukrywanie typów, jeden joker na sezon, autoryzację admina. */

process.env.ADMIN_PASSWORD = 'test-haslo-admina';

const assert = require('assert');
const path = require('path');

// Podmiana modeli na atrapę PRZED wczytaniem tras
const dbPath = require.resolve('../models/Database');
const db = require('./fake-db')();
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db, children: [], paths: [] };

const express = require('express');
const publicRoutes = require('../routes/publicRoutes');
const adminRoutes = require('../routes/adminRoutes');
const cronRoutes = require('../routes/cronRoutes');
const jobs = require('../services/jobs');
const push = require('../services/push');
const cache = require('../services/cache');

const app = express();
app.use(express.json());
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cron', cronRoutes);

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const inHours = h => new Date(Date.now() + h * HOUR);

let passed = 0, failed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.error(`  ❌ ${name}\n     ${e.message}`); process.exitCode = 1; }
}

let base;
const get = async (url, headers = {}) => {
    const res = await fetch(base + url, { headers });
    return { status: res.status, body: await res.json().catch(() => ({})) };
};
const post = async (url, body, headers = {}) => {
    const res = await fetch(base + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body || {})
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function seed() {
    await db.Season.create({
        year: 2027, label: 'Ekstraliga 2027', isActive: true, lockHours: 24,
        teams: ['Team A', 'Team B', 'Team C', 'Team D'],
        stageNames: new Map([[15, 'Półfinały']]),
        scoring: { exact: 5, diff: 3, winner: 2, motrBonus: 1, jokerMultiplier: 2, longTermEach: 10 }
    });
    // mecz zablokowany (start za 2 h), otwarty (za 5 dni), drugi otwarty (za 6 dni), rozegrany
    const locked = await db.Match.create({ season: 2027, round: 2, homeTeam: 'Team A', awayTeam: 'Team B', matchDate: inHours(2) });
    const open1 = await db.Match.create({ season: 2027, round: 3, homeTeam: 'Team C', awayTeam: 'Team D', matchDate: inHours(5 * 24) });
    const open2 = await db.Match.create({ season: 2027, round: 3, homeTeam: 'Team A', awayTeam: 'Team C', matchDate: inHours(6 * 24), isMatchOfTheRound: true });
    const done = await db.Match.create({ season: 2027, round: 1, homeTeam: 'Team B', awayTeam: 'Team C', matchDate: inHours(-7 * 24), homeScore: 46, awayScore: 44 });

    await db.Player.create({ nickname: 'Ala', fullName: 'Ala K.', token: 'tok-ala', seasons: [2027] });
    await db.Player.create({ nickname: 'Bob', fullName: 'Bob N.', token: 'tok-bob', seasons: [2027] });

    // typ na przyszły mecz (powinien być ukryty w API publicznym)
    await db.Prediction.create({ season: 2027, nickname: 'Bob', matchId: String(open1._id), homePred: 50, awayPred: 40, usedJoker: true });
    // typ rozliczony
    await db.Prediction.create({ season: 2027, nickname: 'Ala', matchId: String(done._id), homePred: 46, awayPred: 44, pointsEarned: 5 });

    return { locked, open1, open2, done };
}

(async () => {
    const ids = await seed();
    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;

    console.log('\nAPI publiczne:');
    await test('nie ujawnia tokenów graczy', async () => {
        const { body } = await get('/api/public/data');
        assert.ok(Array.isArray(body.players));
        const raw = JSON.stringify(body);
        assert.ok(!raw.includes('tok-ala'), 'token wyciekł w odpowiedzi!');
        assert.ok(!raw.includes('tok-bob'), 'token wyciekł w odpowiedzi!');
    });

    await test('ukrywa typy niezablokowanych meczów', async () => {
        const { body } = await get('/api/public/data');
        const p = body.predictions.find(x => x.matchId === String(ids.open1._id));
        assert.strictEqual(p.hidden, true);
        assert.strictEqual(p.homePred, null);
        assert.strictEqual(p.usedJoker, false, 'nawet joker nie może być widoczny przed blokadą');
    });

    await test('pokazuje typy meczów rozegranych', async () => {
        const { body } = await get('/api/public/data');
        const p = body.predictions.find(x => x.matchId === String(ids.done._id));
        assert.strictEqual(p.hidden, false);
        assert.strictEqual(p.homePred, 46);
    });

    await test('liczy ranking i tabelę', async () => {
        const { body } = await get('/api/public/data');
        const ala = body.ranking.find(r => r.nickname === 'Ala');
        assert.strictEqual(ala.points, 5);
        assert.strictEqual(ala.position, 1);
        assert.strictEqual(body.standings.find(t => t.name === 'Team B').points, 2); // 2 za wygrany mecz, bez bonusu (rewanżu jeszcze nie było)
    });

    await test('zła nazwa sezonu spada na sezon aktywny', async () => {
        const { body } = await get('/api/public/data?season=1999');
        assert.strictEqual(body.season.year, 2027);
    });

    console.log('\nPanel gracza:');
    await test('zły token = 404', async () => {
        const { status } = await get('/api/public/player-data?token=nieistnieje');
        assert.strictEqual(status, 404);
    });

    await test('gracz widzi swoje dane i pozycję', async () => {
        const { body } = await get('/api/public/player-data?token=tok-ala');
        assert.strictEqual(body.player.nickname, 'Ala');
        assert.strictEqual(body.ranking.points, 5);
        assert.strictEqual(body.predictions.length, 1);
    });

    console.log('\nZapis typów (blokady serwera):');
    await test('typ na zablokowany mecz jest odrzucany', async () => {
        const { body } = await post('/api/public/submit-all', {
            token: 'tok-ala', season: 2027,
            predictions: [{ matchId: String(ids.locked._id), homePred: 45, awayPred: 45 }]
        });
        assert.strictEqual(body.saved, 0);
        assert.strictEqual(body.skipped, 1);
        const saved = await db.Prediction.findOne({ nickname: 'Ala', matchId: String(ids.locked._id) });
        assert.strictEqual(saved, null);
    });

    await test('typ na otwarty mecz zapisuje się', async () => {
        const { body } = await post('/api/public/submit-all', {
            token: 'tok-ala', season: 2027,
            predictions: [{ matchId: String(ids.open1._id), homePred: 47, awayPred: 43 }]
        });
        assert.strictEqual(body.saved, 1);
        const saved = await db.Prediction.findOne({ nickname: 'Ala', matchId: String(ids.open1._id) });
        assert.strictEqual(saved.homePred, 47);
    });

    await test('bzdurne wartości są odrzucane', async () => {
        const { body } = await post('/api/public/submit-all', {
            token: 'tok-ala', season: 2027,
            predictions: [
                { matchId: String(ids.open1._id), homePred: 200, awayPred: 3 },
                { matchId: String(ids.open2._id), homePred: -5, awayPred: 4 },
                { matchId: String(ids.open2._id), homePred: 'abc', awayPred: 4 }
            ]
        });
        assert.strictEqual(body.saved, 0);
        assert.strictEqual(body.skipped, 3);
    });

    await test('bez tokena brak zapisu', async () => {
        const { status } = await post('/api/public/submit-all', { predictions: [] });
        assert.strictEqual(status, 403);
    });

    console.log('\nJoker:');
    await test('joker zapisuje się na wybranym meczu', async () => {
        await post('/api/public/submit-all', {
            token: 'tok-ala', season: 2027,
            predictions: [{ matchId: String(ids.open1._id), homePred: 47, awayPred: 43, usedJoker: true }]
        });
        const jokers = await db.Prediction.find({ season: 2027, nickname: 'Ala', usedJoker: true });
        assert.strictEqual(jokers.length, 1);
        assert.strictEqual(jokers[0].matchId, String(ids.open1._id));
    });

    await test('przeniesienie jokera nie tworzy drugiego', async () => {
        await post('/api/public/submit-all', {
            token: 'tok-ala', season: 2027,
            predictions: [
                { matchId: String(ids.open1._id), homePred: 47, awayPred: 43, usedJoker: false },
                { matchId: String(ids.open2._id), homePred: 44, awayPred: 46, usedJoker: true }
            ]
        });
        const jokers = await db.Prediction.find({ season: 2027, nickname: 'Ala', usedJoker: true });
        assert.strictEqual(jokers.length, 1, 'gracz miałby dwa jokery!');
        assert.strictEqual(jokers[0].matchId, String(ids.open2._id));
    });

    await test('rezygnacja z jokera działa', async () => {
        await post('/api/public/submit-all', {
            token: 'tok-ala', season: 2027,
            predictions: [{ matchId: String(ids.open2._id), homePred: 44, awayPred: 46, usedJoker: false }]
        });
        const jokers = await db.Prediction.find({ season: 2027, nickname: 'Ala', usedJoker: true });
        assert.strictEqual(jokers.length, 0);
    });

    console.log('\nTypy długoterminowe:');
    await test('po starcie sezonu są zablokowane', async () => {
        const { body } = await post('/api/public/submit-all', {
            token: 'tok-bob', season: 2027,
            longTerm: { champion: 'Team A', bronze: 'Team B', relegation: 'Team D' },
            predictions: []
        });
        assert.strictEqual(body.longTerm, false);
        assert.ok(body.warnings.length > 0);
        const lt = await db.LongTerm.findOne({ season: 2027, nickname: 'Bob' });
        assert.strictEqual(lt, null);
    });

    console.log('\nAutoryzacja admina:');
    let adminToken = null;
    await test('złe hasło = 401', async () => {
        const { status } = await post('/api/admin/login', { password: 'zle' });
        assert.strictEqual(status, 401);
    });

    await test('dobre hasło daje token sesji', async () => {
        const { status, body } = await post('/api/admin/login', { password: 'test-haslo-admina' });
        assert.strictEqual(status, 200);
        assert.ok(body.token && body.token.length > 20);
        adminToken = body.token;
    });

    await test('endpoint admina bez tokena = 401', async () => {
        const { status } = await post('/api/admin/result', { matchId: String(ids.open1._id), homeScore: 1, awayScore: 2 });
        assert.strictEqual(status, 401);
    });

    console.log('\nOperacje admina:');
    const auth = () => ({ 'x-admin-token': adminToken });

    await test('wpisanie wyniku przelicza punkty (5 / 3 / 2 / 0)', async () => {
        const m = await db.Match.create({ season: 2027, round: 4, homeTeam: 'Team A', awayTeam: 'Team D', matchDate: inHours(-2) });
        await db.Prediction.create({ season: 2027, nickname: 'Ala', matchId: String(m._id), homePred: 46, awayPred: 44 });
        await db.Prediction.create({ season: 2027, nickname: 'Bob', matchId: String(m._id), homePred: 48, awayPred: 46 });
        await db.Prediction.create({ season: 2027, nickname: 'Cyk', matchId: String(m._id), homePred: 50, awayPred: 40 });
        await db.Prediction.create({ season: 2027, nickname: 'Dex', matchId: String(m._id), homePred: 40, awayPred: 50 });

        const { status } = await post('/api/admin/result', { matchId: String(m._id), homeScore: 46, awayScore: 44 }, auth());
        assert.strictEqual(status, 200);
        const pts = async nick => (await db.Prediction.findOne({ matchId: String(m._id), nickname: nick })).pointsEarned;
        assert.strictEqual(await pts('Ala'), 5);
        assert.strictEqual(await pts('Bob'), 3);
        assert.strictEqual(await pts('Cyk'), 2);
        assert.strictEqual(await pts('Dex'), 0);
    });

    await test('Złoty Kask i joker liczą się razem (12 pkt)', async () => {
        const m = await db.Match.create({ season: 2027, round: 5, homeTeam: 'Team B', awayTeam: 'Team D', matchDate: inHours(-2), isMatchOfTheRound: true });
        await db.Prediction.create({ season: 2027, nickname: 'Ala', matchId: String(m._id), homePred: 46, awayPred: 44, usedJoker: true });
        await post('/api/admin/result', { matchId: String(m._id), homeScore: 46, awayScore: 44 }, auth());
        const p = await db.Prediction.findOne({ matchId: String(m._id), nickname: 'Ala' });
        assert.strictEqual(p.pointsEarned, 12);
    });

    await test('wycofanie wyniku zeruje punkty', async () => {
        const m = await db.Match.create({ season: 2027, round: 6, homeTeam: 'Team C', awayTeam: 'Team A', matchDate: inHours(-2) });
        await db.Prediction.create({ season: 2027, nickname: 'Ala', matchId: String(m._id), homePred: 45, awayPred: 45 });
        await post('/api/admin/result', { matchId: String(m._id), homeScore: 45, awayScore: 45 }, auth());
        await post('/api/admin/result', { matchId: String(m._id), clear: true }, auth());
        const p = await db.Prediction.findOne({ matchId: String(m._id), nickname: 'Ala' });
        assert.strictEqual(p.pointsEarned, null);
        const match = await db.Match.findById(String(m._id));
        assert.strictEqual(match.homeScore, null);
    });

    await test('wynik poza zakresem 0-75 jest odrzucany', async () => {
        const { status } = await post('/api/admin/result', { matchId: String(ids.open1._id), homeScore: 120, awayScore: 3 }, auth());
        assert.strictEqual(status, 400);
    });

    await test('nowy gracz dostaje unikalny token', async () => {
        const { body } = await post('/api/admin/player', { nickname: 'Ewa', fullName: 'Ewa Z.', season: 2027 }, auth());
        assert.ok(body.token && body.token.length >= 16);
        const p = await db.Player.findOne({ nickname: 'Ewa' });
        assert.deepStrictEqual(p.seasons, [2027]);
    });

    await test('regeneracja linku unieważnia stary', async () => {
        const before = (await db.Player.findOne({ nickname: 'Ewa' })).token;
        await post('/api/admin/player/token', { nickname: 'Ewa' }, auth());
        const after = (await db.Player.findOne({ nickname: 'Ewa' })).token;
        assert.notStrictEqual(before, after);
        const { status } = await get(`/api/public/player-data?token=${before}`);
        assert.strictEqual(status, 404);
    });

    await test('admin może wpisać typ omijając blokadę', async () => {
        const { status } = await post('/api/admin/predict', {
            season: 2027, nickname: 'Bob', matchId: String(ids.locked._id), homePred: 45, awayPred: 45
        }, auth());
        assert.strictEqual(status, 200);
        const p = await db.Prediction.findOne({ nickname: 'Bob', matchId: String(ids.locked._id) });
        assert.strictEqual(p.homePred, 45);
        assert.strictEqual(p.source, 'admin');
    });

    console.log('\nPrzełożenia, walkowery, blokady (v3):');

    await test('przełożenie PRZED blokadą: typy zostają i można je zmieniać', async () => {
        const m = await db.Match.create({ season: 2027, round: 9, homeTeam: 'Team A', awayTeam: 'Team D', matchDate: inHours(72) });
        await db.Prediction.create({ season: 2027, nickname: 'Ala', matchId: String(m._id), homePred: 50, awayPred: 40 });
        const { status } = await post('/api/admin/match-edit', { matchId: String(m._id), matchDate: inHours(240).toISOString() }, auth());
        assert.strictEqual(status, 200);
        const after = await db.Match.findById(String(m._id));
        assert.strictEqual(after.predictionsFrozen, false);
        assert.ok(after.originalDate, 'pierwotna data zapamiętana');
        assert.strictEqual((await db.Prediction.findOne({ matchId: String(m._id), nickname: 'Ala' })).homePred, 50);
        const { body } = await post('/api/public/submit-all', { token: 'tok-ala', predictions: [{ matchId: String(m._id), homePred: 41, awayPred: 49 }] });
        assert.strictEqual(body.saved, 1);
    });

    await test('przełożenie PO blokadzie (deszcz): typy zamrożone mimo nowej daty', async () => {
        const m = await db.Match.create({ season: 2027, round: 9, homeTeam: 'Team B', awayTeam: 'Team C', matchDate: inHours(1) });
        await db.Prediction.create({ season: 2027, nickname: 'Bob', matchId: String(m._id), homePred: 46, awayPred: 44 });
        await post('/api/admin/match-edit', { matchId: String(m._id), matchDate: inHours(24 * 7).toISOString() }, auth());
        assert.strictEqual((await db.Match.findById(String(m._id))).predictionsFrozen, true);
        const { body } = await post('/api/public/submit-all', { token: 'tok-bob', predictions: [{ matchId: String(m._id), homePred: 30, awayPred: 60 }] });
        assert.strictEqual(body.saved, 0);
        assert.strictEqual((await db.Prediction.findOne({ matchId: String(m._id), nickname: 'Bob' })).homePred, 46);
        // typy dalej są jawne na stronie głównej
        cache.invalidate();
        const { body: data } = await get('/api/public/data');
        const p = data.predictions.find(x => x.matchId === String(m._id) && x.nickname === 'Bob');
        assert.strictEqual(p.hidden, false);
    });

    await test('walkower: tabela liczy wynik, typy anulowane, joker wraca', async () => {
        const m = await db.Match.create({ season: 2027, round: 10, homeTeam: 'Team C', awayTeam: 'Team B', matchDate: inHours(-3) });
        await db.Prediction.create({ season: 2027, nickname: 'Cyk', matchId: String(m._id), homePred: 50, awayPred: 40, usedJoker: true });
        const { status } = await post('/api/admin/result', { matchId: String(m._id), homeScore: 40, awayScore: 0, walkover: true }, auth());
        assert.strictEqual(status, 200);
        const p = await db.Prediction.findOne({ matchId: String(m._id), nickname: 'Cyk' });
        assert.strictEqual(p.pointsEarned, null);
        const { body } = await get('/api/public/data');
        const cyk = body.ranking.find(r => r.nickname === 'Cyk');
        assert.ok(!cyk || cyk.jokerUsed === false, 'joker z walkowera nie przepada');
    });

    await test('wstrzymany gracz nie może typować', async () => {
        await post('/api/admin/player/toggle', { nickname: 'Bob' }, auth());
        const { status } = await post('/api/public/submit-all', { token: 'tok-bob', predictions: [{ matchId: String(ids.open1._id), homePred: 45, awayPred: 45 }] });
        assert.strictEqual(status, 403);
        await post('/api/admin/player/toggle', { nickname: 'Bob' }, auth());
    });

    await test('blokada w minutach: ustawienie 1 min otwiera mecz startujący za 2 h', async () => {
        await post('/api/admin/season/settings', { season: 2027, lockMinutes: 1 }, auth());
        const { body } = await post('/api/public/submit-all', { token: 'tok-ala', predictions: [{ matchId: String(ids.locked._id), homePred: 44, awayPred: 46 }] });
        assert.strictEqual(body.saved, 1);
        await post('/api/admin/season/settings', { season: 2027, lockMinutes: 1440 }, auth());
    });

    console.log('\nScraper i zatwierdzanie (v3):');
    const seasonDoc = await db.Season.findOne({ year: 2027 });
    seasonDoc.teamAliases = { 'Team A': ['Alfa'], 'Team B': ['Beta'], 'Team C': ['Cecha'], 'Team D': ['Delta'] };
    const scr = await db.Match.create({ season: 2027, round: 11, homeTeam: 'Team D', awayTeam: 'Team A', matchDate: inHours(-4) });
    await db.Prediction.create({ season: 2027, nickname: 'Ala', matchId: String(scr._id), homePred: 47, awayPred: 43 });
    const fakePage = '<table><tr><td>Delta</td><td>47 : 43</td><td>Alfa</td></tr><tr><td>Alfa</td><td>start 20:30</td><td>Beta</td></tr></table>';

    await test('scraper tworzy draft, ale NIE wpisuje wyniku', async () => {
        const out = await jobs.scrapeJob({ season: seasonDoc, urls: ['https://example.test/wyniki'], fetchHtml: async () => fakePage });
        assert.strictEqual(out.created, 1, out.summary);
        assert.strictEqual((await db.Match.findById(String(scr._id))).homeScore, null);
        const { body } = await get('/api/admin/drafts', auth());
        assert.strictEqual(body.length, 1);
        assert.strictEqual(body[0].match.homeTeam, 'Team D');
    });

    await test('ponowne pobranie nie dubluje draftu', async () => {
        const out = await jobs.scrapeJob({ season: seasonDoc, urls: ['https://example.test/wyniki'], fetchHtml: async () => fakePage });
        assert.strictEqual(out.created, 0);
        assert.strictEqual((await db.ResultDraft.find({ status: 'draft' })).length, 1);
    });

    await test('zatwierdzenie draftu wpisuje wynik i przelicza punkty', async () => {
        const draft = await db.ResultDraft.findOne({ status: 'draft' });
        const { status } = await post('/api/admin/drafts/approve', { id: String(draft._id), notify: false }, auth());
        assert.strictEqual(status, 200);
        const m = await db.Match.findById(String(scr._id));
        assert.strictEqual(m.homeScore, 47);
        assert.strictEqual(m.resultSource, 'scraper');
        assert.strictEqual((await db.Prediction.findOne({ matchId: String(scr._id), nickname: 'Ala' })).pointsEarned, 5);
    });

    await test('niemożliwy wynik (suma > 90) wymaga korekty przed zatwierdzeniem', async () => {
        const m = await db.Match.create({ season: 2027, round: 11, homeTeam: 'Team B', awayTeam: 'Team C', matchDate: inHours(-4) });
        await jobs.scrapeJob({ season: seasonDoc, urls: ['https://example.test/x'], fetchHtml: async () => '<p>Beta 60:40 Cecha</p>' });
        const draft = await db.ResultDraft.findOne({ matchId: String(m._id), status: 'draft' });
        assert.ok(draft.blockers.length);
        const r1 = await post('/api/admin/drafts/approve', { id: String(draft._id) }, auth());
        assert.strictEqual(r1.status, 409);
        const r2 = await post('/api/admin/drafts/approve', { id: String(draft._id), homeScore: 50, awayScore: 40, notify: false }, auth());
        assert.strictEqual(r2.status, 200);
        assert.strictEqual((await db.Match.findById(String(m._id))).homeScore, 50);
    });

    await test('odrzucony wynik nie wraca przy kolejnym pobraniu', async () => {
        const m = await db.Match.create({ season: 2027, round: 12, homeTeam: 'Team C', awayTeam: 'Team A', matchDate: inHours(-5) });
        const page = '<p>Cecha 46:44 Alfa</p>';
        await jobs.scrapeJob({ season: seasonDoc, urls: ['https://example.test/y'], fetchHtml: async () => page });
        const d = await db.ResultDraft.findOne({ matchId: String(m._id), status: 'draft' });
        await post('/api/admin/drafts/reject', { id: String(d._id) }, auth());
        await jobs.scrapeJob({ season: seasonDoc, urls: ['https://example.test/y'], fetchHtml: async () => page });
        assert.strictEqual((await db.ResultDraft.find({ matchId: String(m._id), status: 'draft' })).length, 0);
    });

    await test('wyzwalacz cron wymaga sekretu', async () => {
        process.env.CRON_SECRET = 'sekret-cron-123';
        const bad = await post('/api/cron/run?job=reminders', {}, { 'x-cron-secret': 'zly' });
        assert.strictEqual(bad.status, 401);
        const ok = await post('/api/cron/run?job=reminders', {}, { 'x-cron-secret': 'sekret-cron-123' });
        assert.strictEqual(ok.status, 200);
    });

    console.log('\nPowiadomienia push (v3):');
    const sent = [];
    push._setSenderForTests(async (sub, body) => { sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) }); });

    await test('gracz zapisuje subskrypcję tylko ze swoim tokenem', async () => {
        const sub = { endpoint: 'https://push.example/ala', keys: { p256dh: 'k', auth: 'a' } };
        assert.strictEqual((await post('/api/public/push/subscribe', { token: 'zly', subscription: sub })).status, 403);
        assert.strictEqual((await post('/api/public/push/subscribe', { token: 'tok-ala', subscription: sub })).status, 200);
        assert.strictEqual((await db.PushSubscription.findOne({ endpoint: sub.endpoint })).nickname, 'Ala');
    });

    await test('przypomnienie idzie do gracza bez typu i tylko raz', async () => {
        // blokada 24 h -> mecz za 25 h ma blokadę za ~60 min (w oknie 120 min)
        const m = await db.Match.create({ season: 2027, round: 13, homeTeam: 'Team A', awayTeam: 'Team B', matchDate: inHours(25) });
        sent.length = 0;
        await jobs.reminderJob();
        const toAla = sent.filter(x => x.endpoint === 'https://push.example/ala');
        assert.strictEqual(toAla.length, 1);
        assert.ok(/Team B/.test(toAla[0].body.body));
        assert.ok(toAla[0].body.url.includes('tok-ala'));
        sent.length = 0;
        await jobs.reminderJob();
        assert.strictEqual(sent.length, 0, 'drugi raz nie wysyłamy');
        await db.Match.deleteOne({ _id: m._id });
    });

    console.log('\nStatystyki (v3):');

    await test('profil gracza: przebieg sezonu i tylko jawne typy', async () => {
        cache.invalidate();
        const { status, body } = await get('/api/public/profile?nickname=Ala');
        assert.strictEqual(status, 200);
        assert.ok(body.progress.length > 0);
        assert.ok(body.progress.every(p => typeof p.total === 'number' && p.position >= 1));
        const open = body.history.find(h => h.matchId === String(ids.open2._id));
        assert.strictEqual(open, undefined, 'typ na otwarty mecz nie może wyciec przez profil');
    });

    await test('H2H dwóch graczy', async () => {
        const { status, body } = await get('/api/public/h2h?a=Ala&b=Bob');
        assert.strictEqual(status, 200);
        assert.strictEqual(body.a, 'Ala');
        assert.strictEqual(body.matches, body.rows.length);
    });

    await test('ranking wszech czasów', async () => {
        const { status, body } = await get('/api/public/alltime');
        assert.strictEqual(status, 200);
        assert.ok(body.ranking.find(r => r.nickname === 'Ala'));
    });

    await test('nowy sezon powstaje obok bieżącego', async () => {
        const { status } = await post('/api/admin/season', {
            year: 2028, label: 'Ekstraliga 2028', teams: ['X', 'Y'], copyPlayers: true
        }, auth());
        assert.strictEqual(status, 200);
        const s2027 = await db.Season.findOne({ year: 2027 });
        const s2028 = await db.Season.findOne({ year: 2028 });
        assert.strictEqual(s2027.isActive, true, 'bieżący sezon musi zostać aktywny');
        assert.strictEqual(s2028.isActive, false);
        const ala = await db.Player.findOne({ nickname: 'Ala' });
        assert.ok(ala.seasons.includes(2028), 'gracze mieli zostać przepisani');
    });

    await test('aktywacja sezonu przełącza tylko jeden', async () => {
        await post('/api/admin/season/activate', { year: 2028 }, auth());
        assert.strictEqual((await db.Season.findOne({ year: 2028 })).isActive, true);
        assert.strictEqual((await db.Season.findOne({ year: 2027 })).isActive, false);
        const { body } = await get('/api/public/data');
        assert.strictEqual(body.season.year, 2028, 'strona główna pokazuje nowy sezon');
        const { body: old } = await get('/api/public/data?season=2027');
        assert.strictEqual(old.matches.length > 0, true, 'archiwum 2027 nadal dostępne');
        await post('/api/admin/season/activate', { year: 2027 }, auth());
    });

    await test('generator terminarza zapisuje kolejki do sezonu', async () => {
        const { body } = await post('/api/admin/generate-schedule', {
            season: 2028, teams: ['X1', 'X2', 'X3', 'X4'], startDate: '2028-04-03'
        }, auth());
        assert.ok(/12 meczów/.test(body.message), body.message);
        const created = await db.Match.find({ season: 2028 });
        assert.strictEqual(created.length, 12);
    });

    await test('rozliczenie sezonu przyznaje punkty za trafienia', async () => {
        await db.LongTerm.create({ season: 2027, nickname: 'Ala', champion: 'Team A', bronze: 'Team B', relegation: 'Team D' });
        await db.LongTerm.create({ season: 2027, nickname: 'Bob', champion: 'Team C', bronze: 'Team B', relegation: 'Team X' });
        await post('/api/admin/season/finish', {
            season: 2027, champion: 'Team A', bronze: 'Team B', relegation: 'Team D', markFinished: true
        }, auth());
        assert.strictEqual((await db.LongTerm.findOne({ season: 2027, nickname: 'Ala' })).pointsEarned, 30);
        assert.strictEqual((await db.LongTerm.findOne({ season: 2027, nickname: 'Bob' })).pointsEarned, 10);
        assert.strictEqual((await db.Season.findOne({ year: 2027 })).isFinished, true);
    });

    await test('zamknięty sezon nie przyjmuje nowych typów', async () => {
        const { status, body } = await post('/api/public/submit-all', {
            token: 'tok-ala', season: 2027,
            predictions: [{ matchId: String(ids.open1._id), homePred: 40, awayPred: 40 }]
        });
        assert.strictEqual(status, 403);
        assert.ok(/zamknięty/i.test(body.error));
    });

    server.close();
    console.log(`\n${passed} testów przeszło${failed ? `, ${failed} nie przeszło` : ''}.\n`);
})();
