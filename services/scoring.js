/* ------------------------------------------------------------------
   Cała matematyka typera w jednym miejscu, bez mongoose.
   Te same funkcje liczą punkty na serwerze i budują tabele do API,
   więc frontend nigdy nie policzy niczego inaczej niż baza.
------------------------------------------------------------------- */
const { DEFAULT_SCORING, DEFAULT_LOCK_HOURS } = require('../config');

const HOUR = 3600 * 1000;

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

function lockHoursOf(season) {
    return (season && Number(season.lockHours)) || DEFAULT_LOCK_HOURS;
}

/** Moment zamknięcia typów dla meczu (timestamp w ms). */
function lockTime(match, lockHours) {
    return new Date(match.matchDate).getTime() - lockHours * HOUR;
}

function isLocked(match, lockHours, now = Date.now()) {
    return now >= lockTime(match, lockHours);
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
    if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) return null;
    if (homePred === null || homePred === undefined || awayPred === null || awayPred === undefined) return null;

    const predDiff = homePred - awayPred;
    const actDiff = homeScore - awayScore;
    let points;

    if (homePred === homeScore && awayPred === awayScore) points = scoring.exact;
    else if (Math.sign(predDiff) === Math.sign(actDiff)) {
        points = Math.abs(predDiff) === Math.abs(actDiff) ? scoring.diff : scoring.winner;
    } else points = 0;

    if (isMotr && points >= scoring.diff && points > 0) points += scoring.motrBonus;
    if (usedJoker) points *= scoring.jokerMultiplier;
    return points;
}

/**
 * Tabela ligowa (2 pkt za mecz + 1 bonusowy za dwumecz).
 * playoffRounds - kolejki fazy finałowej, które NIE wchodzą do tabeli
 * (domyślnie te, które mają własną nazwę w ustawieniach sezonu).
 */
function buildStandings(matches, teams, playoffRounds = []) {
    const list = teams && teams.length ? teams : uniqueTeams(matches);
    const table = {};
    list.forEach(t => {
        table[t] = { name: t, matches: 0, wins: 0, draws: 0, losses: 0, points: 0, bonus: 0, smallFor: 0, smallAgainst: 0, form: [] };
    });
    const ensure = t => {
        if (!table[t]) table[t] = { name: t, matches: 0, wins: 0, draws: 0, losses: 0, points: 0, bonus: 0, smallFor: 0, smallAgainst: 0, form: [] };
        return table[t];
    };

    const skip = new Set((playoffRounds || []).map(Number));
    const played = matches
        .filter(m => m.homeScore !== null && m.awayScore !== null && !skip.has(Number(m.round)))
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

    return Object.values(table)
        .map(t => ({ ...t, diff: t.smallFor - t.smallAgainst, form: t.form.slice(-5) }))
        .sort((a, b) => b.points - a.points || b.diff - a.diff || b.smallFor - a.smallFor || a.name.localeCompare(b.name, 'pl'));
}

function uniqueTeams(matches) {
    const set = new Set();
    matches.forEach(m => { set.add(m.homeTeam); set.add(m.awayTeam); });
    return [...set].sort((a, b) => a.localeCompare(b, 'pl'));
}

/**
 * Klasyfikacja typerów.
 * Zwraca posortowaną listę z punktami, snajperkami, formą i statystyką rund.
 */
function buildPlayerStats({ players, predictions, matches, longTerms }) {
    const byId = {};
    matches.forEach(m => { byId[String(m._id)] = m; });

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
        s.filled++;
        if (pr.usedJoker) { s.jokerUsed = true; s.jokerMatchId = pr.matchId; }
        const m = byId[pr.matchId];
        if (!m || m.homeScore === null) return;
        s.settled++;
        const pts = pr.pointsEarned || 0;
        s.points += pts;
        s.matchPoints += pts;
        if (pr.usedJoker) s.jokerPoints = pts;

        if (pr.homePred === m.homeScore && pr.awayPred === m.awayScore) s.perfects++;
        else if (Math.sign(pr.homePred - pr.awayPred) === Math.sign(m.homeScore - m.awayScore)) {
            if (Math.abs(pr.homePred - pr.awayPred) === Math.abs(m.homeScore - m.awayScore)) s.diffs++;
            else s.winners++;
        } else s.misses++;

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

    // Pozycje z uwzględnieniem remisów (ex aequo)
    let lastPoints = null, lastPos = 0;
    sorted.forEach((s, i) => {
        if (s.points !== lastPoints) { lastPos = i + 1; lastPoints = s.points; }
        s.position = lastPos;
    });
    return sorted;
}

/** Zwycięzcy poszczególnych rund - fajna statystyka do rankingu. */
function buildRoundWinners(stats, matches) {
    const rounds = [...new Set(matches.filter(m => m.homeScore !== null).map(m => m.round))].sort((a, b) => a - b);
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
 * Ukrywanie typów przed blokadą - realizowane NA SERWERZE.
 * Wcześniej kłódka była tylko w HTML, a /api/public/data oddawało wszystkie typy.
 */
function maskPredictions(predictions, matches, lockHours, now = Date.now()) {
    const byId = {};
    matches.forEach(m => { byId[String(m._id)] = m; });
    return predictions.map(p => {
        const raw = p.toObject ? p.toObject() : { ...p };
        const m = byId[raw.matchId];
        const reveal = m && (m.homeScore !== null || isLocked(m, lockHours, now));
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
    HOUR, scoringOf, stageNamesOf, playoffRoundsOf, lockHoursOf, lockTime, isLocked, calculatePoints,
    buildStandings, buildPlayerStats, buildRoundWinners, uniqueTeams, maskPredictions
};
