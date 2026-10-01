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

const app = express();
app.use(express.json());
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const inHours = h => new Date(Date.now() + h * HOUR);

let passed = 0, failed = 0;
async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.error(`  ❌ ${name}\n     ${e.message}`); process.exitCode = 1; }
}

let base;
const get = async (url) => {
    const res = await fetch(base + url);
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
