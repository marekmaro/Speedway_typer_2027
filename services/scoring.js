/* ------------------------------------------------------------------
   Cała matematyka typera w jednym miejscu, bez mongoose.
   Te same funkcje liczą punkty na serwerze i budują tabele do API,
   więc frontend nigdy nie policzy niczego inaczej niż baza.
------------------------------------------------------------------- */
const { DEFAULT_SCORING, DEFAULT_LOCK_HOURS, DEFAULT_LOCK_MINUTES } = require('../config');

const HOUR = 3600 * 1000;
const MINUTE = 60 * 1000;

function scoringOf(season) {
    const s = (season && season.scoring) || {};
    return { ...DEFAULT_SCORING, ...JSON.parse(JSON.stringify(s)) };
}

/** Nazwy rund jako zwykły obiekt (Mongo zwraca Map, kopia zapasowa zwykły obiekt). */
function stageNamesOf(season) {
    const sn = season && season.stageNames;
    if (!sn) return {};
    if (sn instanceof Map || typeof sn.entries === 'function') {
        try { return Object.fromEntries(sn); } catch (e) { return {}; }
    }
    return { ...sn };
}

/** Kolejki fazy finałowej = te, które mają własną nazwę. */
function playoffRoundsOf(season) {
    return Object.keys(stageNamesOf(season)).map(Number).filter(n => !isNaN(n));
}

/**
 * Ile minut przed pierwszym biegiem zamyka się typowanie.
 * v3 trzyma to w lockMinutes; sezony z v2 mają tylko lockHours (domyślnie 24 h).
 */
function lockMinutesOf(season) {
    if (season && season.lockMinutes !== null && season.lockMinutes !== undefined && !isNaN(Number(season.lockMinutes))) {
        return Math.max(0, Number(season.lockMinutes));
    }
    if (season && season.lockHours) return Number(season.lockHours) * 60;
    return season ? DEFAULT_LOCK_HOURS * 60 : DEFAULT_LOCK_MINUTES;
}

/** Moment zamknięcia typów dla meczu (timestamp w ms). */
function lockTime(match, lockMinutes) {
    return new Date(match.matchDate).getTime() - lockMinutes * MINUTE;
}

/**
 * Czy typy na mecz są zamknięte.
 * predictionsFrozen: mecz przełożony już po blokadzie - typy były jawne, więc nie wolno ich zmieniać,
 * nawet jeśli nowa data jest za tydzień.
 */
function isLocked(match, lockMinutes, now = Date.now()) {
    if (match.predictionsFrozen) return true;
    if (match.homeScore !== null && match.homeScore !== undefined) return true;
    return now >= lockTime(match, lockMinutes);
}

/** Czy typy na ten mecz są rozliczane (jest wynik i mecz nie jest anulowany/walkowerem). */
function isSettled(match) {
    return !!match && match.homeScore !== null && match.homeScore !== undefined && !match.voidPredictions;
}

/** Rodzaj trafienia, niezależny od punktacji sezonu. */
function outcomeOf(homePred, awayPred, homeScore, awayScore) {
    if ([homePred, awayPred, homeScore, awayScore].some(v => v === null || v === undefined)) return null;
    if (homePred === homeScore && awayPred === awayScore) return 'exact';
    const predDiff = homePred - awayPred, actDiff = homeScore - awayScore;
    if (Math.sign(predDiff) !== Math.sign(actDiff)) return 'miss';
    return Math.abs(predDiff) === Math.abs(actDiff) ? 'diff' : 'winner';
}

/**
 * Punktacja jednego typu.
 * 5  - dokładny wynik
 * 3  - dobry zwycięzca + dokładna różnica punktowa
 * 2  - dobry zwycięzca
 * 0  - pudło
 * +1 - Złoty Kask (tylko przy 5 lub 3 pkt)
 * x2 - Joker (mnoży dorobek razem z bonusem, czyli max 12 pkt)
 */
function calculatePoints(homePred, awayPred, homeScore, awayScore, usedJoker, isMotr, scoring = DEFAULT_SCORING) {
    const outcome = outcomeOf(homePred, awayPred, homeScore, awayScore);
    if (outcome === null) return null;

    let points = { exact: scoring.exact, diff: scoring.diff, winner: scoring.winner, miss: 0 }[outcome];
    if (isMotr && points >= scoring.diff && points > 0) points += scoring.motrBonus;
    if (usedJoker) points *= scoring.jokerMultiplier;
    return points;
}

/** Punkty + rodzaj trafienia dla typu na konkretny mecz (uwzględnia anulowanie). */
function settle(pred, match, scoring) {
    if (!isSettled(match)) return { pointsEarned: null, outcome: null };
    return {
        pointsEarned: calculatePoints(pred.homePred, pred.awayPred, match.homeScore, match.awayScore, pred.usedJoker, match.isMatchOfTheRound, scoring),
        outcome: outcomeOf(pred.homePred, pred.awayPred, match.homeScore, match.awayScore)
    };
}

/**
 * Tabela ligowa (2 pkt za mecz + 1 bonusowy za dwumecz).
 * playoffRounds - kolejki fazy finałowej, które NIE wchodzą do tabeli
 * (domyślnie te, które mają własną nazwę w ustawieniach sezonu).
 * adjustments - ręczne korekty admina [{ team, points, reason }].
 */
function buildStandings(matches, teams, playoffRounds = [], adjustments = []) {
    const list = teams && teams.length ? teams : uniqueTeams(matches);
    const table = {};
    const blank = t => ({ name: t, matches: 0, wins: 0, draws: 0, losses: 0, points: 0, bonus: 0, adjustment: 0, adjustmentNotes: [], smallFor: 0, smallAgainst: 0, form: [] });
    list.forEach(t => { table[t] = blank(t); });
    const ensure = t => (table[t] = table[t] || blank(t));

    const skip = new Set((playoffRounds || []).map(Number));
    const played = matches
        .filter(m => m.homeScore !== null && m.homeScore !== undefined && m.awayScore !== null && !skip.has(Number(m.round)))
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));

    const pairs = {};
    played.forEach(m => {
        const h = ensure(m.homeTeam), a = ensure(m.awayTeam);
        h.matches++; a.matches++;
        h.smallFor += m.homeScore; h.smallAgainst += m.awayScore;
        a.smallFor += m.awayScore; a.smallAgainst += m.homeScore;

        if (m.homeScore > m.awayScore) { h.points += 2; h.wins++; a.losses++; h.form.push('W'); a.form.push('L'); }
        else if (m.homeScore < m.awayScore) { a.points += 2; a.wins++; h.losses++; a.form.push('W'); h.form.push('L'); }
        else { h.points += 1; a.points += 1; h.draws++; a.draws++; h.form.push('D'); a.form.push('D'); }

        const key = [m.homeTeam, m.awayTeam].sort().join('###');
        (pairs[key] = pairs[key] || []).push(m);
    });

    // Punkt bonusowy za wygrany dwumecz
    Object.values(pairs).forEach(group => {
        if (group.length !== 2) return;
        const [m1, m2] = group;
        const t1 = m1.homeTeam, t2 = m1.awayTeam;
        const t1Sum = m1.homeScore + (m2.homeTeam === t1 ? m2.homeScore : m2.awayScore);
        const t2Sum = m1.awayScore + (m2.homeTeam === t2 ? m2.homeScore : m2.awayScore);
        if (t1Sum > t2Sum) { table[t1].points += 1; table[t1].bonus += 1; }
        else if (t2Sum > t1Sum) { table[t2].points += 1; table[t2].bonus += 1; }
    });

    (adjustments || []).forEach(adj => {
        if (!adj || !adj.team || !Number(adj.points)) return;
        const t = ensure(adj.team);
        t.points += Number(adj.points);
        t.adjustment += Number(adj.points);
        if (adj.reason) t.adjustmentNotes.push(`${adj.points > 0 ? '+' : ''}${adj.points}: ${adj.reason}`);
    });

    return Object.values(table)
        .map(t => ({ ...t, diff: t.smallFor - t.smallAgainst, form: t.form.slice(-5) }))
        .sort((a, b) => b.points - a.points || b.diff - a.diff || b.smallFor - a.smallFor || a.name.localeCompare(b.name, 'pl'));
}

function uniqueTeams(matches) {
    const set = new Set();
    matches.forEach(m => { set.add(m.homeTeam); set.add(m.awayTeam); });
    return [...set].sort((a, b) => a.localeCompare(b, 'pl'));
}

/** Mapa _id -> mecz. */
function indexMatches(matches) {
    const byId = {};
    (matches || []).forEach(m => { byId[String(m._id)] = m; });
    return byId;
}

/** Rodzaj trafienia: z pola outcome (v3) albo wyliczony z wyniku (stare dane). */
function outcomeFor(pred, match) {
    return pred.outcome || outcomeOf(pred.homePred, pred.awayPred, match.homeScore, match.awayScore);
}

/** Pozycje z uwzględnieniem remisów (ex aequo). Lista musi być posortowana. */
function assignPositions(sorted, key = 'points') {
    let last = null, pos = 0;
    sorted.forEach((s, i) => {
        if (s[key] !== last) { pos = i + 1; last = s[key]; }
        s.position = pos;
    });
    return sorted;
}

/**
 * Klasyfikacja typerów.
 * Zwraca posortowaną listę z punktami, snajperkami, formą i statystyką rund.
 * Złożoność O(typy + mecze) - jedno przejście, bez zapytań do bazy.
 */
function buildPlayerStats({ players, predictions, matches, longTerms }) {
    const byId = indexMatches(matches);

    const stats = {};
    const ensure = nick => {
        if (!stats[nick]) stats[nick] = {
            nickname: nick, points: 0, matchPoints: 0, longTermPoints: 0,
            perfects: 0, diffs: 0, winners: 0, misses: 0, filled: 0, settled: 0,
            jokerUsed: false, jokerMatchId: null, jokerPoints: 0,
            byRound: {}, bestRound: { round: null, points: 0 }, form: []
        };
        return stats[nick];
    };
    (players || []).forEach(p => ensure(p.nickname));

    (predictions || []).forEach(pr => {
        const s = ensure(pr.nickname);
        const m = byId[pr.matchId];
        s.filled++;
        // Joker na anulowanym meczu wraca do gracza
        if (pr.usedJoker && !(m && m.voidPredictions)) { s.jokerUsed = true; s.jokerMatchId = pr.matchId; }
        if (!isSettled(m)) return;
        s.settled++;
        const pts = pr.pointsEarned || 0;
        s.points += pts;
        s.matchPoints += pts;
        if (pr.usedJoker) s.jokerPoints = pts;

        const o = outcomeFor(pr, m);
        if (o === 'exact') s.perfects++;
        else if (o === 'diff') s.diffs++;
        else if (o === 'winner') s.winners++;
        else s.misses++;

        s.byRound[m.round] = (s.byRound[m.round] || 0) + pts;
    });

    (longTerms || []).forEach(lt => {
        const s = ensure(lt.nickname);
        s.longTermPoints = lt.pointsEarned || 0;
        s.points += lt.pointsEarned || 0;
    });

    Object.values(stats).forEach(s => {
        const rounds = Object.keys(s.byRound).map(Number).sort((a, b) => a - b);
        rounds.forEach(r => {
            if (s.byRound[r] > s.bestRound.points) s.bestRound = { round: r, points: s.byRound[r] };
        });
        s.form = rounds.slice(-5).map(r => ({ round: r, points: s.byRound[r] }));
        s.avgPerMatch = s.settled ? Math.round((s.matchPoints / s.settled) * 100) / 100 : 0;
        s.hitRate = s.settled ? Math.round(((s.settled - s.misses) / s.settled) * 100) : 0;
    });

    const sorted = Object.values(stats).sort((a, b) =>
        b.points - a.points || b.perfects - a.perfects || b.diffs - a.diffs || a.nickname.localeCompare(b.nickname, 'pl'));
    return assignPositions(sorted);
}

/** Zwycięzcy poszczególnych rund - fajna statystyka do rankingu. */
function buildRoundWinners(stats, matches) {
    const rounds = [...new Set(matches.filter(isSettled).map(m => m.round))].sort((a, b) => a - b);
    return rounds.map(r => {
        const scores = stats
            .map(s => ({ nickname: s.nickname, points: s.byRound[r] || 0 }))
            .filter(s => s.points > 0)
            .sort((a, b) => b.points - a.points);
        const top = scores.length ? scores[0].points : 0;
        return { round: r, points: top, winners: scores.filter(s => s.points === top).map(s => s.nickname) };
    }).filter(r => r.winners.length);
}

/**
 * Przebieg sezonu kolejka po kolejce: punkty w kolejce, suma narastająco i miejsce po kolejce.
 * Źródło wykresu formy i "drogi w tabeli". Bez typów długoterminowych (rozliczane na końcu).
 */
function buildRoundProgress(stats, matches) {
    const rounds = [...new Set(matches.filter(isSettled).map(m => Number(m.round)))].sort((a, b) => a - b);
    const cumulative = {};
    stats.forEach(s => { cumulative[s.nickname] = 0; });
    const series = {}, byNick = {};
    stats.forEach(s => { series[s.nickname] = []; byNick[s.nickname] = s; });

    rounds.forEach(r => {
        stats.forEach(s => { cumulative[s.nickname] += s.byRound[r] || 0; });
        const ordered = stats.map(s => ({ nickname: s.nickname, points: cumulative[s.nickname] }))
            .sort((a, b) => b.points - a.points || a.nickname.localeCompare(b.nickname, 'pl'));
        assignPositions(ordered);
        ordered.forEach(o => {
            series[o.nickname].push({ round: r, points: byNick[o.nickname].byRound[r] || 0, total: o.points, position: o.position });
        });
    });
    return { rounds, series };
}

/**
 * Pojedynek dwóch typerów na meczach, które obaj wytypowali i które są rozliczone.
 * Zwraca bilans (wygrane / remisy / porażki meczowe) i listę meczów.
 */
function buildH2H(nickA, nickB, predictions, matches) {
    const byId = indexMatches(matches);
    const mine = {}, theirs = {};
    (predictions || []).forEach(p => {
        if (p.nickname === nickA) mine[p.matchId] = p;
        else if (p.nickname === nickB) theirs[p.matchId] = p;
    });
    const rows = [];
    const sum = { pointsA: 0, pointsB: 0, winsA: 0, winsB: 0, draws: 0, exactA: 0, exactB: 0 };
    Object.keys(mine).forEach(id => {
        const m = byId[id];
        if (!theirs[id] || !isSettled(m)) return;
        const pa = mine[id], pb = theirs[id];
        const ptsA = pa.pointsEarned || 0, ptsB = pb.pointsEarned || 0;
        sum.pointsA += ptsA; sum.pointsB += ptsB;
        if (ptsA > ptsB) sum.winsA++; else if (ptsB > ptsA) sum.winsB++; else sum.draws++;
        if (outcomeFor(pa, m) === 'exact') sum.exactA++;
        if (outcomeFor(pb, m) === 'exact') sum.exactB++;
        rows.push({
            matchId: id, season: m.season, round: m.round, matchDate: m.matchDate,
            homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore, awayScore: m.awayScore,
            a: { homePred: pa.homePred, awayPred: pa.awayPred, points: ptsA, joker: !!pa.usedJoker },
            b: { homePred: pb.homePred, awayPred: pb.awayPred, points: ptsB, joker: !!pb.usedJoker }
        });
    });
    rows.sort((x, y) => new Date(y.matchDate) - new Date(x.matchDate));
    return { a: nickA, b: nickB, matches: rows.length, ...sum, rows };
}

/**
 * Ranking wszech czasów ze wszystkich sezonów.
 * seasons: [{ year, isFinished, stats }] - stats to wynik buildPlayerStats danego sezonu.
 */
function buildAllTime(seasons) {
    const all = {};
    (seasons || []).forEach(({ year, isFinished, stats }) => {
        (stats || []).forEach(s => {
            if (!s.settled && !s.points) return;
            const a = all[s.nickname] = all[s.nickname] || {
                nickname: s.nickname, points: 0, settled: 0, perfects: 0, diffs: 0, winners: 0, misses: 0,
                seasons: [], titles: [], podiums: 0, bestFinish: null
            };
            a.points += s.points; a.settled += s.settled;
            a.perfects += s.perfects; a.diffs += s.diffs; a.winners += s.winners; a.misses += s.misses;
            a.seasons.push(year);
            if (isFinished) {
                if (s.position === 1) a.titles.push(year);
                if (s.position <= 3) a.podiums++;
                if (a.bestFinish === null || s.position < a.bestFinish) a.bestFinish = s.position;
            }
        });
    });
    const list = Object.values(all).map(a => ({
        ...a,
        seasons: a.seasons.sort((x, y) => x - y),
        avgPerMatch: a.settled ? Math.round((a.points / a.settled) * 100) / 100 : 0,
        hitRate: a.settled ? Math.round(((a.settled - a.misses) / a.settled) * 100) : 0
    })).sort((x, y) => y.points - x.points || y.perfects - x.perfects || x.nickname.localeCompare(y.nickname, 'pl'));
    return assignPositions(list);
}

/**
 * Ukrywanie typów przed blokadą - realizowane NA SERWERZE.
 * Wcześniej kłódka była tylko w HTML, a /api/public/data oddawało wszystkie typy.
 */
function maskPredictions(predictions, matches, lockMinutes, now = Date.now()) {
    const byId = indexMatches(matches);
    return predictions.map(p => {
        const raw = p.toObject ? p.toObject() : { ...p };
        const m = byId[raw.matchId];
        const reveal = m && isLocked(m, lockMinutes, now);
        if (reveal) return { ...raw, hidden: false };
        // Przed blokadą świat widzi tylko: kto już wytypował.
        return {
            _id: raw._id,
            season: raw.season,
            nickname: raw.nickname,
            matchId: raw.matchId,
            usedJoker: false,
            homePred: null,
            awayPred: null,
            pointsEarned: null,
            hidden: true
        };
    });
}

module.exports = {
    HOUR, MINUTE, scoringOf, stageNamesOf, playoffRoundsOf, lockMinutesOf, lockTime, isLocked, isSettled,
    outcomeOf, calculatePoints, settle, buildStandings, buildPlayerStats, buildRoundWinners, buildRoundProgress,
    buildH2H, buildAllTime, uniqueTeams, indexMatches, maskPredictions
};
