/* Proste testy bez zewnętrznych bibliotek:  npm test  */
const assert = require('assert');
const S = require('../services/scoring');
const { generateSchedule } = require('../services/schedule');
const { DEFAULT_SCORING } = require('../config');

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
test('otwarte 25 h przed', () => assert.strictEqual(S.isLocked(match, 24, new Date('2027-04-30T17:00:00Z').getTime()), false));
test('zamknięte 23 h przed', () => assert.strictEqual(S.isLocked(match, 24, new Date('2027-04-30T19:00:00Z').getTime()), true));

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
const masked = S.maskPredictions([{ _id: 'p', matchId: 'f1', nickname: 'Ala', homePred: 46, awayPred: 44, usedJoker: true }], future, 24);
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

console.log(`\n${passed} testów przeszło.\n`);
