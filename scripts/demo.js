/* ------------------------------------------------------------------
   Tryb demo: cała aplikacja na atrapie bazy w pamięci, z przykładowym sezonem.
   Nie wymaga MongoDB - do podglądu wyglądu i testów na telefonie w sieci lokalnej.
     npm run demo   ->  http://localhost:3000   (admin: hasło "demo")
   Dane znikają po restarcie. NIE używać na produkcji.
------------------------------------------------------------------- */
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo';
process.env.ENABLE_SCHEDULER = 'false';

const path = require('path');
const dbPath = require.resolve('../models/Database');
const db = require('../test/fake-db')();
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db, children: [], paths: [] };

const app = require('../server');
const { generateSchedule } = require('../services/schedule');
const { recalcSeason } = require('../services/seasons');

const TEAMS = ['Orlen Oil Motor Lublin', 'Betard Sparta Wrocław', 'PRES Grupa Deweloperska Toruń', 'Gezet Stal Gorzów',
    'Krono-Plast Włókniarz Częstochowa', 'Bayersystem GKM Grudziądz', 'Stelmet Falubaz Zielona Góra', 'Fogo Unia Leszno'];
const PLAYERS = ['Marek', 'Kasia', 'Tomek', 'Ola', 'Piotrek', 'Zbyszek'];

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const score = () => { const h = 30 + Math.round(rnd() * 30); return [h, 90 - h - (rnd() < 0.2 ? 2 : 0)]; };

(async () => {
    const start = new Date(Date.now() - 6 * 7 * 24 * 3600 * 1000 - 3 * 24 * 3600 * 1000);
    const monday = new Date(start); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    await db.Season.create({
        year: 2027, label: 'PGE Ekstraliga 2027', isActive: true, lockMinutes: 1, lockHours: 24, teams: TEAMS,
        stageNames: {}, scoring: { exact: 5, diff: 3, winner: 2, motrBonus: 1, jokerMultiplier: 2, longTermEach: 10 },
        standingsAdjustments: [], teamAliases: {}, scraperUrls: []
    });
    const sched = generateSchedule({ teams: TEAMS, startDate: monday.toISOString().slice(0, 10) });
    const now = Date.now();
    const matches = [];
    for (const m of sched) {
        const doc = await db.Match.create({ season: 2027, ...m, matchDate: new Date(m.matchDate) });
        if (new Date(m.matchDate).getTime() < now - 3 * 3600 * 1000 && m.round < 7) {
            const [h, a] = score(); doc.homeScore = h; doc.awayScore = a; doc.resultSource = 'admin';
        }
        matches.push(doc);
    }
    // jeden mecz przełożony przez deszcz po blokadzie, jeden czeka na zatwierdzenie wyniku ze scrapera
    const r7 = matches.filter(m => m.round === 7);
    if (r7[0]) { r7[0].originalDate = r7[0].matchDate; r7[0].matchDate = new Date(now + 9 * 24 * 3600 * 1000); r7[0].predictionsFrozen = true; r7[0].note = 'Deszcz — przełożony'; }
    const pendingDraft = matches.find(m => m.homeScore === null && new Date(m.matchDate).getTime() < now - 3 * 3600 * 1000);

    for (const [i, nick] of PLAYERS.entries()) {
        await db.Player.create({ nickname: nick, fullName: '', token: `dec0de${String(i).padStart(18, "0")}`, seasons: [2027], isActive: true });
        let joker = false;
        for (const m of matches) {
            if (new Date(m.matchDate).getTime() > now + 6 * 24 * 3600 * 1000) continue;
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

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`🧪 Demo: http://localhost:${port}  ·  panel gracza: /typuj.html?id=dec0de000000000000000000  ·  admin: hasło "${process.env.ADMIN_PASSWORD}"`);
    });
})();
