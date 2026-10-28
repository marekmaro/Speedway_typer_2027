/* ------------------------------------------------------------------
   Tryb demo: cała aplikacja na atrapie bazy w pamięci, z przykładowym sezonem.
   Nie wymaga MongoDB - do podglądu wyglądu i testów na telefonie w sieci lokalnej.
     npm run demo   ->  http://localhost:3000   (admin: hasło "demo")
   Dane znikają po restarcie. NIE używać na produkcji.
   Ten sam zestaw danych wykorzystują testy w przeglądarce (test/e2e.test.js).
------------------------------------------------------------------- */

const TEAMS = ['Orlen Oil Motor Lublin', 'Betard Sparta Wrocław', 'PRES Grupa Deweloperska Toruń', 'Gezet Stal Gorzów',
    'Krono-Plast Włókniarz Częstochowa', 'Bayersystem GKM Grudziądz', 'Stelmet Falubaz Zielona Góra', 'Fogo Unia Leszno'];
const PLAYERS = ['Marek', 'Kasia', 'Tomek', 'Ola', 'Piotrek', 'Zbyszek'];
const tokenOf = i => `dec0de${String(i).padStart(18, '0')}`;
const DAY = 24 * 3600 * 1000;

/** Wypełnia (atrapę) bazy przykładowym sezonem w połowie rozgrywek. */
async function seedDemo(db) {
    // wymagane dopiero tutaj - po podmianie modeli na atrapę
    const { generateSchedule } = require('../services/schedule');
    const { recalcSeason } = require('../services/seasons');

    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const score = () => { const h = 30 + Math.round(rnd() * 30); return [h, 90 - h - (rnd() < 0.2 ? 2 : 0)]; };

    const now = Date.now();
    // poniedziałek ~6,5 tygodnia temu (w UTC - generator i tak liczy godziny w czasie polskim)
    const startDay = new Date(now - 6 * 7 * DAY - 3 * DAY);
    const monday = new Date(Date.UTC(startDay.getUTCFullYear(), startDay.getUTCMonth(), startDay.getUTCDate() - ((startDay.getUTCDay() + 6) % 7)));

    await db.Season.create({
        year: 2027, label: 'PGE Ekstraliga 2027', isActive: true, lockMinutes: 1, lockHours: 24, teams: TEAMS,
        stageNames: {}, scoring: { exact: 5, diff: 3, winner: 2, motrBonus: 1, jokerMultiplier: 2, longTermEach: 10 },
        standingsAdjustments: [], teamAliases: {}, scraperUrls: []
    });
    const sched = generateSchedule({ teams: TEAMS, startDate: monday.toISOString().slice(0, 10) });
    const matches = [];
    for (const m of sched) {
        const doc = await db.Match.create({ season: 2027, ...m, matchDate: new Date(m.matchDate) });
        if (new Date(m.matchDate).getTime() < now - 3 * 3600 * 1000 && m.round < 7) {
            const [h, a] = score(); doc.homeScore = h; doc.awayScore = a; doc.resultSource = 'admin';
        }
        matches.push(doc);
    }
    // ostatnia rozegrana kolejka: dwa mecze czekają na wynik (jeden ze scrapera, drugi do wpisania)
    const lastPlayed = Math.max(...matches.filter(m => m.homeScore !== null).map(m => m.round));
    const waiting = matches.filter(m => m.round === lastPlayed).sort((a, b) => a.matchDate - b.matchDate).slice(-2);
    waiting.forEach(m => { m.homeScore = null; m.awayScore = null; m.resultSource = null; });
    // jeden mecz przełożony przez deszcz po blokadzie
    const r7 = matches.filter(m => m.round === 7);
    if (r7[0]) { r7[0].originalDate = r7[0].matchDate; r7[0].matchDate = new Date(now + 9 * DAY); r7[0].predictionsFrozen = true; r7[0].note = 'Deszcz — przełożony'; }
    const pendingDraft = waiting[0];

    for (const [i, nick] of PLAYERS.entries()) {
        await db.Player.create({ nickname: nick, fullName: '', token: tokenOf(i), seasons: [2027], isActive: true });
        let joker = false;
        for (const m of matches) {
            if (new Date(m.matchDate).getTime() > now + 6 * DAY) continue;
            if (rnd() < 0.12) continue;
            const base = m.homeScore !== null ? [m.homeScore, m.awayScore] : score();
            const jitter = Math.round((rnd() - 0.5) * 16);
            const useJoker = !joker && m.homeScore !== null && rnd() < 0.08;
            if (useJoker) joker = true;
            await db.Prediction.create({ season: 2027, nickname: nick, matchId: String(m._id), homePred: Math.max(20, base[0] + jitter), awayPred: Math.max(20, base[1] - jitter), usedJoker: useJoker });
        }
        await db.LongTerm.create({ season: 2027, nickname: nick, champion: TEAMS[i % 3], bronze: TEAMS[3 + (i % 2)], relegation: TEAMS[7 - (i % 2)] });
    }
    if (pendingDraft) {
        await db.ResultDraft.create({ season: 2027, matchId: String(pendingDraft._id), homeScore: 47, awayScore: 43, source: 'przyklad.pl', sourceUrl: 'https://example.com', snippet: `${pendingDraft.homeTeam} 47:43 ${pendingDraft.awayTeam}`, warnings: [], blockers: [], status: 'draft' });
    }
    await db.CupMatch.create({ season: 2027, stage: 'Ćwierćfinał', roundNumber: 5, player1: 'Marek', player2: 'Zbyszek', score1: 9, score2: 6, autoScore: true });
    await recalcSeason(2027);
    return { matches, pendingDraft };
}

/** Podmienia modele Mongo na atrapę w pamięci. Musi się wykonać PRZED require('../server'). */
function useFakeDb() {
    const dbPath = require.resolve('../models/Database');
    const db = require('../test/fake-db')();
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db, children: [], paths: [] };
    return db;
}

module.exports = { seedDemo, useFakeDb, TEAMS, PLAYERS, tokenOf };

if (require.main === module) {
    process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo';
    process.env.ENABLE_SCHEDULER = 'false';
    const db = useFakeDb();
    const app = require('../server');
    seedDemo(db).then(() => {
        const port = process.env.PORT || 3000;
        app.listen(port, () => {
            console.log(`🧪 Demo: http://localhost:${port}  ·  panel gracza: /typuj.html?id=${tokenOf(0)}  ·  admin: hasło "${process.env.ADMIN_PASSWORD}"`);
        });
    });
}
