/* Proste testy bez zewnętrznych bibliotek:  npm test  */
const assert = require('assert');
const S = require('../services/scoring');
const { generateSchedule } = require('../services/schedule');
const { DEFAULT_SCORING } = require('../config');
const scraper = require('../services/scraper');

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); process.exitCode = 1; }
}

const sc = DEFAULT_SCORING;
const pts = (ph, pa, h, a, joker = false, motr = false) => S.calculatePoints(ph, pa, h, a, joker, motr, sc);

console.log('\nPunktacja typów:');
test('dokładny wynik = 5 pkt', () => assert.strictEqual(pts(46, 44, 46, 44), 5));
test('dobry zwycięzca + różnica = 3 pkt', () => assert.strictEqual(pts(47, 43, 46, 42), 3));
test('dobry zwycięzca = 2 pkt', () => assert.strictEqual(pts(50, 40, 46, 44), 2));
test('zły zwycięzca = 0 pkt', () => assert.strictEqual(pts(50, 40, 40, 50), 0));
test('remis trafiony dokładnie = 5 pkt', () => assert.strictEqual(pts(45, 45, 45, 45), 5));
test('remis przewidziany, inny remis = 3 pkt', () => assert.strictEqual(pts(45, 45, 44, 44), 3));
test('remis przewidziany, brak remisu = 0 pkt', () => assert.strictEqual(pts(45, 45, 46, 44), 0));
test('Złoty Kask dodaje +1 przy 5 pkt', () => assert.strictEqual(pts(46, 44, 46, 44, false, true), 6));
test('Złoty Kask nie dodaje przy 2 pkt', () => assert.strictEqual(pts(50, 40, 46, 44, false, true), 2));
test('Joker podwaja', () => assert.strictEqual(pts(46, 44, 46, 44, true, false), 10));
test('Joker + Kask = maksimum 12 pkt', () => assert.strictEqual(pts(46, 44, 46, 44, true, true), 12));
test('brak wyniku = null', () => assert.strictEqual(pts(46, 44, null, null), null));
test('pudło z jokerem to nadal 0', () => assert.strictEqual(pts(50, 40, 40, 50, true, true), 0));

console.log('\nBlokada typów:');
const match = { matchDate: new Date('2027-05-01T18:00:00Z') };
const at = iso => new Date(iso).getTime();
test('blokada 24 h (1440 min): otwarte 25 h przed', () => assert.strictEqual(S.isLocked(match, 1440, at('2027-04-30T17:00:00Z')), false));
test('blokada 24 h (1440 min): zamknięte 23 h przed', () => assert.strictEqual(S.isLocked(match, 1440, at('2027-04-30T19:00:00Z')), true));
test('blokada 1 min: otwarte 2 min przed startem', () => assert.strictEqual(S.isLocked(match, 1, at('2027-05-01T17:58:00Z')), false));
test('blokada 1 min: zamknięte 59 s przed startem', () => assert.strictEqual(S.isLocked(match, 1, at('2027-05-01T17:59:01Z')), true));
test('zamrożone typy (przełożony po blokadzie) są zamknięte mimo dalekiej daty', () =>
    assert.strictEqual(S.isLocked({ ...match, predictionsFrozen: true }, 1, at('2027-04-01T12:00:00Z')), true));
test('sezon v2 bez lockMinutes używa lockHours', () => assert.strictEqual(S.lockMinutesOf({ lockHours: 24, lockMinutes: null }), 1440));
test('sezon v3 używa lockMinutes', () => assert.strictEqual(S.lockMinutesOf({ lockHours: 24, lockMinutes: 1 }), 1));

console.log('\nTabela ligowa:');
const teams = ['A', 'B'];
const matches = [
    { _id: '1', round: 1, homeTeam: 'A', awayTeam: 'B', homeScore: 50, awayScore: 40, matchDate: '2027-04-10T18:00:00Z' },
    { _id: '2', round: 2, homeTeam: 'B', awayTeam: 'A', homeScore: 46, awayScore: 44, matchDate: '2027-04-17T18:00:00Z' }
];
const table = S.buildStandings(matches, teams);
test('A ma 2 pkt + bonus za dwumecz', () => {
    const a = table.find(t => t.name === 'A');
    assert.strictEqual(a.points, 3);
    assert.strictEqual(a.bonus, 1);
});
test('B ma 2 pkt bez bonusu', () => assert.strictEqual(table.find(t => t.name === 'B').points, 2));
test('A jest pierwsze', () => assert.strictEqual(table[0].name, 'A'));
test('mecze fazy play-off nie wchodzą do tabeli', () => {
    const withPlayoff = [...matches, { _id: '3', round: 17, homeTeam: 'B', awayTeam: 'A', homeScore: 55, awayScore: 35, matchDate: '2027-09-10T18:00:00Z' }];
    const t = S.buildStandings(withPlayoff, teams, [15, 16, 17, 18]);
    assert.strictEqual(t.find(x => x.name === 'B').points, 2);
    assert.strictEqual(t.find(x => x.name === 'A').matches, 2);
});

console.log('\nRanking typerów:');
const players = [{ nickname: 'Ala' }, { nickname: 'Bob' }];
const predictions = [
    { nickname: 'Ala', matchId: '1', homePred: 50, awayPred: 40, pointsEarned: 5, usedJoker: false },
    { nickname: 'Ala', matchId: '2', homePred: 46, awayPred: 44, pointsEarned: 10, usedJoker: true },
    { nickname: 'Bob', matchId: '1', homePred: 40, awayPred: 50, pointsEarned: 0, usedJoker: false }
];
const longTerms = [{ nickname: 'Bob', pointsEarned: 10 }];
const stats = S.buildPlayerStats({ players, predictions, matches, longTerms });
test('Ala ma 15 pkt i jest pierwsza', () => {
    assert.strictEqual(stats[0].nickname, 'Ala');
    assert.strictEqual(stats[0].points, 15);
});
test('Bob liczy punkty długoterminowe', () => assert.strictEqual(stats[1].points, 10));
test('Ala ma zużytego jokera', () => assert.strictEqual(stats[0].jokerUsed, true));
test('najlepsza runda Ali to R2 (10 pkt)', () => assert.deepStrictEqual(stats[0].bestRound, { round: 2, points: 10 }));

console.log('\nMaskowanie typów przed blokadą:');
const future = [{ _id: 'f1', matchDate: new Date(Date.now() + 5 * 24 * 3600 * 1000), homeScore: null, round: 3 }];
const masked = S.maskPredictions([{ _id: 'p', matchId: 'f1', nickname: 'Ala', homePred: 46, awayPred: 44, usedJoker: true }], future, 1440);
test('typ przyszłego meczu jest ukryty', () => {
    assert.strictEqual(masked[0].hidden, true);
    assert.strictEqual(masked[0].homePred, null);
    assert.strictEqual(masked[0].usedJoker, false);
});

console.log('\nGenerator terminarza:');
const t8 = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
const sched = generateSchedule({ teams: t8, startDate: '2027-04-05' });
test('8 drużyn = 56 meczów', () => assert.strictEqual(sched.length, 56));
test('14 kolejek', () => assert.strictEqual(Math.max(...sched.map(m => m.round)), 14));
test('każda kolejka ma 4 mecze', () => {
    for (let r = 1; r <= 14; r++) assert.strictEqual(sched.filter(m => m.round === r).length, 4);
});
test('każda para gra raz u siebie i raz na wyjeździe', () => {
    const count = {};
    sched.forEach(m => { count[`${m.homeTeam}>${m.awayTeam}`] = (count[`${m.homeTeam}>${m.awayTeam}`] || 0) + 1; });
    t8.forEach(a => t8.forEach(b => {
        if (a !== b) assert.strictEqual(count[`${a}>${b}`], 1, `${a} vs ${b}`);
    }));
});
test('drużyna nie gra dwa razy w tej samej kolejce', () => {
    for (let r = 1; r <= 14; r++) {
        const names = sched.filter(m => m.round === r).flatMap(m => [m.homeTeam, m.awayTeam]);
        assert.strictEqual(new Set(names).size, 8);
    }
});
test('tydzień przerwy po wskazanej kolejce', () => {
    const s = generateSchedule({ teams: t8, startDate: '2027-04-05', skipWeeks: [3] });
    const r3 = new Date(s.find(m => m.round === 3).matchDate);
    const r4 = new Date(s.find(m => m.round === 4).matchDate);
    assert.ok((r4 - r3) / 86400000 > 10);
});
test('nieparzysta liczba drużyn = błąd', () => assert.throws(() => generateSchedule({ teams: ['A', 'B', 'C'], startDate: '2027-04-05' })));

console.log('\nSytuacje żużlowe:');
test('anulowany mecz (walkower) nie daje punktów', () => {
    const r = S.settle({ homePred: 40, awayPred: 0, usedJoker: false }, { homeScore: 40, awayScore: 0, voidPredictions: true }, sc);
    assert.deepStrictEqual(r, { pointsEarned: null, outcome: null });
});
test('joker na anulowanym meczu nie jest zużyty', () => {
    const ms = [{ _id: 'v', round: 1, homeTeam: 'A', awayTeam: 'B', homeScore: 40, awayScore: 0, voidPredictions: true, matchDate: '2027-04-10' }];
    const st = S.buildPlayerStats({ players: [{ nickname: 'Ala' }], predictions: [{ nickname: 'Ala', matchId: 'v', homePred: 50, awayPred: 40, usedJoker: true, pointsEarned: null }], matches: ms, longTerms: [] });
    assert.strictEqual(st[0].jokerUsed, false);
    assert.strictEqual(st[0].settled, 0);
});
test('walkower liczy się do tabeli ligi', () => {
    const ms = [{ _id: 'w', round: 1, homeTeam: 'A', awayTeam: 'B', homeScore: 40, awayScore: 0, isWalkover: true, voidPredictions: true, matchDate: '2027-04-10' }];
    assert.strictEqual(S.buildStandings(ms, ['A', 'B']).find(t => t.name === 'A').points, 2);
});
test('ręczna korekta tabeli (np. -2 pkt za walkower)', () => {
    const t = S.buildStandings(matches, teams, [], [{ team: 'B', points: -2, reason: 'walkower' }]);
    const b = t.find(x => x.name === 'B');
    assert.strictEqual(b.points, 0);
    assert.strictEqual(b.adjustment, -2);
});
test('remis w dwumeczu = brak bonusu', () => {
    const ms = [
        { _id: '1', round: 1, homeTeam: 'A', awayTeam: 'B', homeScore: 50, awayScore: 40, matchDate: '2027-04-10' },
        { _id: '2', round: 8, homeTeam: 'B', awayTeam: 'A', homeScore: 50, awayScore: 40, matchDate: '2027-06-10' }
    ];
    const t = S.buildStandings(ms, ['A', 'B']);
    assert.strictEqual(t.find(x => x.name === 'A').bonus + t.find(x => x.name === 'B').bonus, 0);
});

console.log('\nStatystyki:');
test('rodzaj trafienia', () => {
    assert.strictEqual(S.outcomeOf(46, 44, 46, 44), 'exact');
    assert.strictEqual(S.outcomeOf(47, 43, 46, 42), 'diff');
    assert.strictEqual(S.outcomeOf(50, 40, 46, 44), 'winner');
    assert.strictEqual(S.outcomeOf(40, 50, 46, 44), 'miss');
});
test('przebieg sezonu: suma narastająco i miejsce po kolejce', () => {
    const pr = S.buildRoundProgress(stats, matches);
    assert.deepStrictEqual(pr.rounds, [1, 2]);
    assert.deepStrictEqual(pr.series.Ala.map(x => x.total), [5, 15]);
    assert.strictEqual(pr.series.Ala[1].position, 1);
    assert.strictEqual(pr.series.Bob[0].position, 2);
});
test('H2H liczy tylko wspólne, rozliczone mecze', () => {
    const h = S.buildH2H('Ala', 'Bob', predictions, matches);
    assert.strictEqual(h.matches, 1);
    assert.strictEqual(h.winsA, 1);
    assert.strictEqual(h.pointsA, 5);
    assert.strictEqual(h.pointsB, 0);
});
test('ranking wszech czasów sumuje sezony i liczy tytuły', () => {
    const at2 = S.buildAllTime([
        { year: 2026, isFinished: true, stats: [{ nickname: 'Ala', points: 100, settled: 50, perfects: 5, diffs: 5, winners: 20, misses: 20, position: 1 }, { nickname: 'Bob', points: 90, settled: 50, perfects: 3, diffs: 5, winners: 20, misses: 22, position: 2 }] },
        { year: 2027, isFinished: false, stats: [{ nickname: 'Bob', points: 30, settled: 10, perfects: 1, diffs: 1, winners: 5, misses: 3, position: 1 }] }
    ]);
    assert.strictEqual(at2[0].nickname, 'Bob');
    assert.strictEqual(at2[0].points, 120);
    assert.deepStrictEqual(at2[1].titles, [2026]);
    assert.deepStrictEqual(at2[0].titles, []);
});

console.log('\nZgodność z regulaminem:');
test('regulamin: przykład punktacji przy wyniku 46:44 (5 / 3 / 2 / 0)', () => {
    assert.deepStrictEqual([pts(46, 44, 46, 44), pts(47, 45, 46, 44), pts(50, 40, 46, 44), pts(44, 46, 46, 44)], [5, 3, 2, 0]);
});
test('regulamin: remis punktowy rozstrzygają dokładne trafienia, potem różnice; pełny remis = ex aequo', () => {
    const ms = [
        { _id: 'r1', round: 1, homeTeam: 'A', awayTeam: 'B', homeScore: 46, awayScore: 44, matchDate: '2027-04-01' },
        { _id: 'r2', round: 1, homeTeam: 'C', awayTeam: 'D', homeScore: 50, awayScore: 40, matchDate: '2027-04-01' }
    ];
    const pr = [
        { nickname: 'Ala', matchId: 'r1', homePred: 46, awayPred: 44, pointsEarned: 5 }, // 5 = dokładny
        { nickname: 'Bob', matchId: 'r1', homePred: 47, awayPred: 45, pointsEarned: 3 }, // 3 + 2
        { nickname: 'Bob', matchId: 'r2', homePred: 48, awayPred: 42, pointsEarned: 2 },
        { nickname: 'Cyk', matchId: 'r1', homePred: 47, awayPred: 45, pointsEarned: 3 }, // identycznie jak Bob
        { nickname: 'Cyk', matchId: 'r2', homePred: 48, awayPred: 42, pointsEarned: 2 },
        { nickname: 'Dex', matchId: 'r1', homePred: 50, awayPred: 40, pointsEarned: 2 }, // 2 + 3
        { nickname: 'Dex', matchId: 'r2', homePred: 51, awayPred: 41, pointsEarned: 3 }
    ];
    const st = S.buildPlayerStats({ players: [], predictions: pr, matches: ms, longTerms: [] });
    const pos = Object.fromEntries(st.map(x => [x.nickname, x.position]));
    assert.deepStrictEqual(pos, { Ala: 1, Bob: 2, Cyk: 2, Dex: 2 }, 'Bob/Cyk/Dex: 5 pkt, 0 dokładnych, 1 różnica');
    const prog = S.buildRoundProgress(st, ms);
    assert.strictEqual(prog.series.Ala[0].position, 1, 'te same kryteria po kolejce');
    assert.strictEqual(prog.series.Bob[0].position, 2);
});
test('regulamin: zwycięzca kolejki przy remisie - kilku zwycięzców', () => {
    const ms = [{ _id: 'w1', round: 3, homeTeam: 'A', awayTeam: 'B', homeScore: 46, awayScore: 44, matchDate: '2027-04-01' }];
    const pr = [{ nickname: 'Ala', matchId: 'w1', homePred: 46, awayPred: 44, pointsEarned: 5 }, { nickname: 'Bob', matchId: 'w1', homePred: 46, awayPred: 44, pointsEarned: 5 }];
    const st = S.buildPlayerStats({ players: [], predictions: pr, matches: ms, longTerms: [] });
    assert.deepStrictEqual(S.buildRoundWinners(st, ms)[0].winners.sort(), ['Ala', 'Bob']);
});
test('regulamin: puchar - remis: dokładne trafienia, mniejsza pomyłka, rozstawienie; wynik po całej kolejce', () => {
    const ms = [
        { _id: 'c1', round: 5, homeTeam: 'A', awayTeam: 'B', homeScore: 46, awayScore: 44, matchDate: '2027-04-01' },
        { _id: 'c2', round: 5, homeTeam: 'C', awayTeam: 'D', homeScore: null, awayScore: null, matchDate: '2027-04-02' }
    ];
    const pr = [
        { nickname: 'Ala', matchId: 'c1', homePred: 46, awayPred: 44, pointsEarned: 5 },
        { nickname: 'Bob', matchId: 'c1', homePred: 50, awayPred: 40, pointsEarned: 2 }
    ];
    const cup = [{ stage: 'Półfinał', roundNumber: 5, player1: 'Bob', player2: 'Ala', autoScore: true }];
    let r = S.buildCupResults(cup, pr, ms)[0];
    assert.strictEqual(r.finished, false, 'kolejka niedokończona');
    assert.strictEqual(r.live, true);
    assert.strictEqual(r.winner, null);
    ms[1].homeScore = 45; ms[1].awayScore = 45;
    // Bob: 2 (zwycięzca) + 3 (remis 44:44 = dobra różnica) = 5; Ala: 5 (dokładny) i brak typu na c2 = 5
    pr.push({ nickname: 'Bob', matchId: 'c2', homePred: 44, awayPred: 44, pointsEarned: 3 });
    r = S.buildCupResults(cup, pr, ms)[0];
    assert.deepStrictEqual([r.score1, r.score2, r.exact1, r.exact2], [5, 5, 0, 1]);
    assert.deepStrictEqual([r.winner, r.decidedBy, r.finished, r.live], ['Ala', 'exact', true, false], 'Ala ma dokładny wynik');
    // Pełny remis: obaj 6 pkt i zero dokładnych -> wygrywa wyżej rozstawiony (gracz 1 = Bob)
    Object.assign(pr[0], { homePred: 47, awayPred: 45, pointsEarned: 3 });
    Object.assign(pr[1], { homePred: 47, awayPred: 45, pointsEarned: 3 });
    pr.push({ nickname: 'Ala', matchId: 'c2', homePred: 44, awayPred: 44, pointsEarned: 3 });
    r = S.buildCupResults(cup, pr, ms)[0];
    assert.deepStrictEqual([r.score1, r.score2, r.winner, r.decidedBy], [6, 6, 'Bob', 'seed'], 'pełny remis - wyżej rozstawiony (gracz 1)');
    // te same punkty i dokładne, ale Bob pomylił się bardziej (48:46 zamiast 47:45 przy 46:44) -> wygrywa Ala
    Object.assign(pr[1], { homePred: 48, awayPred: 46, pointsEarned: 3 });
    r = S.buildCupResults(cup, pr, ms)[0];
    assert.deepStrictEqual([r.score1, r.score2, r.error1, r.error2, r.winner, r.decidedBy], [6, 6, 6, 4, 'Ala', 'error'], 'mniejsza łączna pomyłka');
    // brak typu na mecz liczy się jako pomyłka 90
    pr.splice(pr.findIndex(p => p.nickname === 'Bob' && p.matchId === 'c2'), 1);
    r = S.buildCupResults(cup, pr, ms)[0];
    assert.deepStrictEqual([r.score1, r.error1, r.winner], [3, 4 + S.CUP_MISSING_ERROR, 'Ala']);
});

test('finał sezonu: mistrz tylko po zamknięciu, ex aequo = kilku mistrzów, medal wymaga punktów', () => {
    const st = [
        { nickname: 'Ala', position: 1, points: 20, perfects: 2, diffs: 1, settled: 5 },
        { nickname: 'Bob', position: 1, points: 20, perfects: 2, diffs: 1, settled: 5 },
        { nickname: 'Cyk', position: 3, points: 0, perfects: 0, diffs: 0, settled: 5 },
        { nickname: 'Dex', position: 4, points: 0, perfects: 0, diffs: 0, settled: 0 }
    ];
    assert.strictEqual(S.buildFinale({ year: 2027, isFinished: false }, st), null, 'sezon trwa');
    const f = S.buildFinale({ year: 2027, isFinished: true, winnerSurprise: { prize: 'Kask', revealedBy: ['Bob', 'Zed'] } }, st);
    assert.deepStrictEqual(f.champions, ['Ala', 'Bob']);
    assert.deepStrictEqual(f.podium.map(p => p.nickname), ['Ala', 'Bob'], 'Cyk z zerem bez medalu');
    assert.deepStrictEqual([f.hasSurprise, f.revealed], [true, ['Bob']]);
    assert.strictEqual(S.buildFinale({ isFinished: true }, st.map(x => ({ ...x, points: 0 }))), null, 'nikt nie zdobył punktu');
});
test('zwycięzca kolejki: "complete" dopiero, gdy cała kolejka rozliczona (anulowany mecz się nie liczy)', () => {
    const ms = [
        { _id: 'r1', round: 1, homeScore: 46, awayScore: 44 }, { _id: 'r2', round: 1, homeScore: null, voidPredictions: true },
        { _id: 'r3', round: 2, homeScore: 50, awayScore: 40 }, { _id: 'r4', round: 2, homeScore: null }
    ];
    const st = [{ nickname: 'Ala', byRound: { 1: 5, 2: 3 } }, { nickname: 'Bob', byRound: { 1: 2, 2: 3 } }];
    const rw = S.buildRoundWinners(st, ms);
    assert.deepStrictEqual(rw.map(r => [r.round, r.winners, r.complete]), [[1, ['Ala'], true], [2, ['Ala', 'Bob'], false]]);
});

test('krótkie nazwy drużyn: serwer (push) i przeglądarka dają to samo', () => {
    const vm = require('vm');
    const fs = require('fs');
    const sandbox = { window: {}, navigator: {}, document: {}, localStorage: null, console };
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/shared.js'), 'utf8'), sandbox);
    const names = require('../services/names');
    ['Orlen Oil Motor Lublin', 'PRES Grupa Deweloperska Toruń', 'Stelmet Falubaz Zielona Góra', 'Gezet Stal Gorzów', 'Fogo Unia Leszno', 'Nowa Drużyna']
        .forEach(t => assert.strictEqual(names.shortName(t), sandbox.window.T.shortName(t), t));
    assert.strictEqual(names.shortName('PRES Grupa Deweloperska Toruń'), 'Toruń');
});

console.log('\nScraper (parsowanie bez sieci):');
const T8 = ['Orlen Oil Motor Lublin', 'Betard Sparta Wrocław', 'PRES Grupa Deweloperska Toruń', 'Gezet Stal Gorzów',
    'Stal Rzeszów', 'Fogo Unia Leszno', 'Unia Tarnów', 'Bayersystem GKM Grudziądz'];
const matcher = scraper.buildTeamMatcher(T8, { 'PRES Grupa Deweloperska Toruń': ['Apator'] });
test('słowa wspólne dwóch drużyn (Stal, Unia) nie są aliasami', () => {
    assert.ok(!matcher.aliases['Gezet Stal Gorzów'].includes('stal'));
    assert.ok(!matcher.aliases['Fogo Unia Leszno'].includes('unia'));
});
test('wiersz tabeli bez sponsorów w nazwach', () => {
    const c = scraper.extractCandidates('<table><tr><td>Motor Lublin</td><td>52 : 38</td><td>Sparta Wrocław</td></tr></table>', matcher);
    assert.strictEqual(c.length, 1);
    assert.deepStrictEqual([c[0].home, c[0].away, c[0].homeScore, c[0].awayScore], ['Orlen Oil Motor Lublin', 'Betard Sparta Wrocław', 52, 38]);
});
test('alias admina (Apator = Toruń)', () => {
    const c = scraper.extractCandidates('<ul><li>Apator 47:43 Stal Gorzów</li></ul>', matcher);
    assert.strictEqual(c[0].home, 'PRES Grupa Deweloperska Toruń');
});
test('godzina 20:30 nie jest wynikiem', () => {
    assert.strictEqual(scraper.extractCandidates('<p>Unia Leszno - GKM Grudziądz, start 20:30</p>', matcher).length, 0);
});
test('odmiana nazw ("pokonał Spartę w Lublinie")', () => {
    const c = scraper.extractCandidates('<p>Motor pokonał Spartę 50:40.</p>', matcher);
    assert.strictEqual(c.length, 1);
    assert.strictEqual(c[0].away, 'Betard Sparta Wrocław');
});
test('blok z kilkoma meczami jest pomijany (nie zgadujemy)', () => {
    const html = '<div>Motor Lublin 50:40 Sparta Wrocław oraz Unia Leszno 46:44 GKM Grudziądz</div>';
    assert.strictEqual(scraper.extractCandidates(html, matcher).filter(c => c.snippet.includes('oraz')).length, 0);
});
test('kontrola sensowności: suma > 90 blokuje', () => assert.ok(scraper.sanityCheck(60, 40).blockers.length));
test('kontrola sensowności: stan w trakcie meczu (< 8 biegów) blokuje', () => assert.ok(scraper.sanityCheck(25, 17).blockers.length));
test('kontrola sensowności: 46:44 jest czyste', () => {
    const r = scraper.sanityCheck(46, 44);
    assert.strictEqual(r.blockers.length + r.warnings.length, 0);
});
test('kontrola sensowności: 40:38 ostrzega (mecz skrócony?)', () => assert.ok(scraper.sanityCheck(40, 38).warnings.length));

console.log(`\n${passed} testów przeszło.\n`);
