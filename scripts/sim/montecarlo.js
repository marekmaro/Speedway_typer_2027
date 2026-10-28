/* ------------------------------------------------------------------
   Monte Carlo zasad typera: tysiące sezonów (bez API - same reguły z services/scoring.js).
   Pytania: czy wygrywa umiejętność, czy szczęście? Jak często remisy rozstrzyga regulamin?
   Ile znaczą Joker, Złoty Kask i typy sezonowe? Jak rozstrzyga się Puchar Typerów?
------------------------------------------------------------------- */
const S = require('../../services/scoring');
const { roundRobin } = require('../../services/schedule');
const { rngOf, TEAMS, simulateMatch, expectedTable } = require('./engine');
const { PERSONAS, predictFor, jokerPick, longTermPick } = require('./personas');

const SC = { exact: 5, diff: 3, winner: 2, motrBonus: 1, jokerMultiplier: 2, longTermEach: 10, diffTolerance: 0 };
const TOL4 = { ...SC, diffTolerance: 4 };

function runMonteCarlo({ runs = 2000, seed = 2027 } = {}) {
    const E = expectedTable(300, seed + 1);
    const rng = rngOf(seed * 7 + 3);
    const nicks = PERSONAS.map(p => p.nick);
    const acc = Object.fromEntries(PERSONAS.map(p => [p.nick, {
        titles: 0, shared: 0, points: 0, pos: 0, podium: 0, exact: 0, diff: 0, winner: 0, miss: 0, typed: 0,
        joker: 0, kask: 0, lt: 0, cupWins: 0, beatExpert: 0, titlesTol4: 0
    }]));
    const agg = {
        runs, topTie: 0, decidedByExact: 0, decidedByDiff: 0, coChampions: 0, ltChanged: 0, lt5Changed: 0, jokerChanged: 0,
        kaskChanged: 0, roundTies: 0, rounds: 0, cup: { points: 0, exact: 0, error: 0, seed: 0 }, avgWinner: 0, avgMargin: 0,
        expertTop3: 0, randomLast: 0, tol4Changed: 0, outcomes: {}, outcomesTol4: {}
    };
    const first = roundRobin(TEAMS);
    const regular = [...first, ...first.map(r => r.map(([h, a]) => [a, h]))];

    for (let run = 0; run < runs; run++) {
        const pr = PERSONAS.map((p, i) => ({ ...p, rng: rngOf(seed * 1000 + run * 31 + i), joker: null }));
        const matches = [];
        const preds = [];
        let id = 0;
        const addRound = (round, pairs, motrIdx = 0) => {
            const ms = pairs.map(([h, a], i) => ({ _id: `m${++id}`, round, homeTeam: h, awayTeam: a, isMatchOfTheRound: i === motrIdx, matchDate: new Date(2027, 3, round * 7 + i) }));
            const table = S.buildStandings(matches, TEAMS, [15, 16, 17, 18, 19, 20]);
            for (const p of pr) {
                if (p.joinRound && round < p.joinRound) continue;
                const open = [];
                for (const m of ms) {
                    if (p.kind === 'zapominalski' && p.rng.chance(0.35)) continue;
                    if (p.kind === 'spoznialski' && p.rng.chance(0.3)) continue; // typ po blokadzie - odrzucony
                    const [h, a] = predictFor(p.kind, m, { E, table }, p.rng);
                    open.push({ m, h, a });
                }
                if (!p.joker && open.length) {
                    const pick = jokerPick(p.kind, round, open.map(o => o.m), { E, table, luckyRound: n => 2 + (n.length * 7) % 11 }, p.rng, p.nick);
                    if (pick) p.joker = pick._id;
                }
                open.forEach(o => preds.push({ nickname: p.nick, matchId: o.m._id, homePred: o.h, awayPred: o.a, usedJoker: p.joker === o.m._id }));
            }
            for (const m of ms) { const r = simulateMatch(m.homeTeam, m.awayTeam, rng); m.homeScore = r.home; m.awayScore = r.away; }
            matches.push(...ms);
            return ms;
        };
        regular.forEach((pairs, i) => addRound(i + 1, pairs));
        // play-off jak w lidze: 5-6, półfinały 1-4 / 2-3, finał i mecz o brąz (dwumecze)
        const table = S.buildStandings(matches, TEAMS, []);
        const seeds = table.map(t => t.name);
        const legs = (r1, r2, pairs) => { addRound(r1, pairs.map(([x, y]) => [y, x])); addRound(r2, pairs, pairs.length - 1); };
        const agg2 = (x, y, rs) => {
            const ms = matches.filter(m => rs.includes(m.round) && [m.homeTeam, m.awayTeam].includes(x) && [m.homeTeam, m.awayTeam].includes(y));
            const sum = t => ms.reduce((s, m) => s + (m.homeTeam === t ? m.homeScore : m.awayScore), 0);
            return sum(x) !== sum(y) ? (sum(x) > sum(y) ? [x, y] : [y, x]) : (rng.chance(0.5) ? [x, y] : [y, x]);
        };
        legs(17, 18, [[seeds[0], seeds[3]], [seeds[1], seeds[2]]]);
        const [w1, l1] = agg2(seeds[0], seeds[3], [17, 18]), [w2, l2] = agg2(seeds[1], seeds[2], [17, 18]);
        legs(19, 20, [[w1, w2], [l1, l2]]);
        const [champ] = agg2(w1, w2, [19, 20]), [bronze] = agg2(l1, l2, [19, 20]);
        const results = { champion: champ, bronze, relegation: seeds[7] };

        // rozliczenie typów według reguł aplikacji
        const byId = S.indexMatches(matches);
        const scored = preds.map(p => {
            const m = byId[p.matchId];
            return { ...p, pointsEarned: S.calculatePoints(p.homePred, p.awayPred, m.homeScore, m.awayScore, p.usedJoker, m.isMatchOfTheRound, SC),
                outcome: S.outcomeOf(p.homePred, p.awayPred, m.homeScore, m.awayScore),
                noJoker: S.calculatePoints(p.homePred, p.awayPred, m.homeScore, m.awayScore, false, m.isMatchOfTheRound, SC),
                noKask: S.calculatePoints(p.homePred, p.awayPred, m.homeScore, m.awayScore, p.usedJoker, false, SC),
                tol4: S.calculatePoints(p.homePred, p.awayPred, m.homeScore, m.awayScore, p.usedJoker, m.isMatchOfTheRound, TOL4),
                tol4Outcome: S.outcomeOf(p.homePred, p.awayPred, m.homeScore, m.awayScore, 4) };
        });
        const longTerms = pr.map(p => ({ nickname: p.nick, ...(longTermPick(p.kind, TEAMS, p.rng) || {}) })).filter(l => l.champion)
            .map(l => ({ ...l, pointsEarned: ['champion', 'bronze', 'relegation'].filter(k => l[k] === results[k]).length * SC.longTermEach }));
        const stats = S.buildPlayerStats({ players: pr.map(p => ({ nickname: p.nick, isActive: true })), predictions: scored, matches, longTerms });

        const champs = stats.filter(s => s.position === 1 && s.points > 0).map(s => s.nickname);
        champs.forEach(n => { acc[n].titles += 1 / champs.length; if (champs.length > 1) acc[n].shared++; });
        if (champs.length > 1) agg.coChampions++;
        const [a, b] = stats;
        if (a && b && a.points === b.points) {
            agg.topTie++;
            if (a.perfects !== b.perfects) agg.decidedByExact++; else if (a.diffs !== b.diffs) agg.decidedByDiff++;
        }
        agg.avgWinner += a.points;
        agg.avgMargin += a.points - b.points;

        // co by było, gdyby... (ten sam sezon, inne zasady)
        const rankBy = fn => {
            const list = stats.map(s => ({ nickname: s.nickname, points: fn(s), perfects: s.perfects, diffs: s.diffs }));
            list.sort((x, y) => S.compareRank(x, y));
            return list.filter(x => S.compareRank(x, list[0]) === 0).map(x => x.nickname).sort().join();
        };
        const base = champs.slice().sort().join();
        const sumWhere = (nick, key) => scored.filter(p => p.nickname === nick).reduce((s, p) => s + (p[key] || 0), 0);
        if (rankBy(s => s.matchPoints) !== base) agg.ltChanged++;
        if (rankBy(s => s.matchPoints + s.longTermPoints / 2) !== base) agg.lt5Changed++;
        if (rankBy(s => sumWhere(s.nickname, 'noJoker') + s.longTermPoints) !== base) agg.jokerChanged++;
        if (rankBy(s => sumWhere(s.nickname, 'noKask') + s.longTermPoints) !== base) agg.kaskChanged++;
        const t4 = rankBy(s => sumWhere(s.nickname, 'tol4') + s.longTermPoints);
        if (t4 !== base) agg.tol4Changed++;
        t4.split(',').forEach(n => { acc[n].titlesTol4 += 1 / t4.split(',').length; });
        scored.forEach(p => { agg.outcomes[p.outcome] = (agg.outcomes[p.outcome] || 0) + 1; agg.outcomesTol4[p.tol4Outcome] = (agg.outcomesTol4[p.tol4Outcome] || 0) + 1; });

        for (const s of stats) {
            const x = acc[s.nickname];
            x.points += s.points; x.pos += s.position; if (s.position <= 3 && s.points > 0) x.podium++;
            x.exact += s.perfects; x.diff += s.diffs; x.winner += s.winners; x.miss += s.misses; x.typed += s.settled;
            x.lt += s.longTermPoints;
            x.joker += sumWhere(s.nickname, 'pointsEarned') - sumWhere(s.nickname, 'noJoker');
            x.kask += sumWhere(s.nickname, 'pointsEarned') - sumWhere(s.nickname, 'noKask');
        }
        const expert = stats.find(s => s.nickname === 'Ekspert');
        stats.forEach(s => { if (s.nickname !== 'Ekspert' && S.compareRank(s, expert) < 0) acc[s.nickname].beatExpert++; });
        if (expert.position <= 3) agg.expertTop3++;
        const losowy = stats.find(s => s.nickname === 'Losowy');
        if (losowy.position >= stats.length - 1) agg.randomLast++;

        // zwycięzcy kolejek - jak często remis
        S.buildRoundWinners(stats, matches).forEach(r => { agg.rounds++; if (r.winners.length > 1) agg.roundTies++; });

        // Puchar Typerów: rozstawienie po R5 (8 najlepszych), ćwierćfinał R6, półfinał R9, finał R12
        const rankAfter = r => {
            const part = S.buildPlayerStats({ players: pr.map(p => ({ nickname: p.nick, isActive: true })), predictions: scored.filter(p => byId[p.matchId].round <= r), matches: matches.filter(m => m.round <= r), longTerms: [] });
            return part.map(s => s.nickname);
        };
        const seed8 = rankAfter(5).slice(0, 8);
        const duel = (p1, p2, round) => {
            const res = S.buildCupResults([{ stage: 'x', roundNumber: round, player1: p1, player2: p2, autoScore: true }], scored, matches)[0];
            agg.cup[res.decidedBy]++;
            return res.winner;
        };
        const qf = [0, 1, 2, 3].map(i => duel(seed8[i], seed8[7 - i], 6));
        const sf = [duel(qf[0], qf[3], 9), duel(qf[1], qf[2], 9)];
        acc[duel(sf[0], sf[1], 12)].cupWins++;
    }

    const per = nicks.map(n => {
        const x = acc[n], p = PERSONAS.find(q => q.nick === n);
        return {
            nick: n, desc: p.desc,
            titlePct: (x.titles / runs) * 100, podiumPct: (x.podium / runs) * 100, cupPct: (x.cupWins / runs) * 100,
            avgPoints: x.points / runs, avgPos: x.pos / runs, avgExact: x.exact / runs,
            hitRate: x.typed ? ((x.typed - x.miss) / x.typed) * 100 : 0, perMatch: x.typed ? (x.points - x.lt) / x.typed : 0,
            avgJoker: x.joker / runs, avgKask: x.kask / runs, avgLt: x.lt / runs, beatExpertPct: n === 'Ekspert' ? null : (x.beatExpert / runs) * 100,
            titleTol4Pct: (x.titlesTol4 / runs) * 100
        };
    }).sort((p, q) => q.titlePct - p.titlePct || q.avgPoints - p.avgPoints);
    const share = o => { const t = Object.values(o).reduce((a, b) => a + b, 0) || 1; return Object.fromEntries(['exact', 'diff', 'winner', 'miss'].map(k => [k, ((o[k] || 0) / t) * 100])); };
    const cupTotal = agg.cup.points + agg.cup.exact + agg.cup.error + agg.cup.seed;
    return {
        runs, per,
        topTiePct: (agg.topTie / runs) * 100, decidedByExactPct: (agg.decidedByExact / runs) * 100, decidedByDiffPct: (agg.decidedByDiff / runs) * 100,
        coChampionsPct: (agg.coChampions / runs) * 100,
        ltChangedPct: (agg.ltChanged / runs) * 100, lt5ChangedPct: (agg.lt5Changed / runs) * 100,
        jokerChangedPct: (agg.jokerChanged / runs) * 100, kaskChangedPct: (agg.kaskChanged / runs) * 100,
        roundTiePct: agg.rounds ? (agg.roundTies / agg.rounds) * 100 : 0,
        cupPct: { points: (agg.cup.points / cupTotal) * 100, exact: (agg.cup.exact / cupTotal) * 100, error: (agg.cup.error / cupTotal) * 100, seed: (agg.cup.seed / cupTotal) * 100 },
        avgWinner: agg.avgWinner / runs, avgMargin: agg.avgMargin / runs,
        expertTop3Pct: (agg.expertTop3 / runs) * 100, randomLastPct: (agg.randomLast / runs) * 100,
        tol4ChangedPct: (agg.tol4Changed / runs) * 100,
        outcomePct: share(agg.outcomes), outcomeTol4Pct: share(agg.outcomesTol4)
    };
}

module.exports = { runMonteCarlo };
