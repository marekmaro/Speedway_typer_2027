const express = require('express');
const router = express.Router();
const { Season, Match, Prediction, Player, LongTerm, CupMatch } = require('../models/Database');
const { resolveSeason } = require('../services/seasons');
const S = require('../services/scoring');
const { rateLimit } = require('../middleware/auth');
const { MAX_SCORE } = require('../config');

const wrap = fn => (req, res) => fn(req, res).catch(err => {
    console.error('❌ publicRoutes:', err.message);
    res.status(500).json({ error: 'Błąd serwera. Spróbuj odświeżyć stronę.' });
});

function seasonPayload(season) {
    return {
        year: season.year,
        label: season.label || `Sezon ${season.year}`,
        isActive: season.isActive,
        isFinished: season.isFinished,
        lockHours: S.lockHoursOf(season),
        scoring: S.scoringOf(season),
        teams: season.teams || [],
        stageNames: S.stageNamesOf(season),
        results: season.results || {}
    };
}

/** Lista sezonów - do przełącznika "archiwum". */
router.get('/seasons', wrap(async (req, res) => {
    const seasons = await Season.find().sort({ year: -1 });
    res.json(seasons.map(s => ({ year: s.year, label: s.label || `Sezon ${s.year}`, isActive: s.isActive, isFinished: s.isFinished })));
}));

/** Wszystko, co potrzebuje strona główna. Typy przed blokadą są maskowane TUTAJ. */
router.get('/data', rateLimit({ key: 'data', max: 120 }), wrap(async (req, res) => {
    const season = await resolveSeason(req);
    const year = season.year;
    const lockHours = S.lockHoursOf(season);

    const [matches, rawPreds, players, longTerms, cupMatches, seasons] = await Promise.all([
        Match.find({ season: year }).sort({ round: 1, matchDate: 1 }),
        Prediction.find({ season: year }),
        Player.find({ seasons: year }).select('nickname fullName isActive').sort({ nickname: 1 }),
        LongTerm.find({ season: year }),
        CupMatch.find({ season: year }).sort({ roundNumber: 1 }),
        Season.find().select('year label isActive isFinished').sort({ year: -1 })
    ]);

    const playerList = players.length
        ? players
        : await Player.find().select('nickname fullName isActive').sort({ nickname: 1 });

    const stats = S.buildPlayerStats({ players: playerList, predictions: rawPreds, matches, longTerms });
    const standings = S.buildStandings(matches, season.teams, S.playoffRoundsOf(season));
    const roundWinners = S.buildRoundWinners(stats, matches);

    // Długoterminowe pokazujemy dopiero po zamknięciu (przed startem sezonu to byłaby ściąga)
    const firstMatch = matches.slice().sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
    const longTermOpen = firstMatch ? Date.now() < S.lockTime(firstMatch, lockHours) : true;

    res.json({
        season: seasonPayload(season),
        seasons: seasons.map(s => ({ year: s.year, label: s.label || `Sezon ${s.year}`, isActive: s.isActive, isFinished: s.isFinished })),
        matches,
        predictions: S.maskPredictions(rawPreds, matches, lockHours),
        players: playerList.map(p => ({ nickname: p.nickname, isActive: p.isActive })),
        longTerms: longTermOpen
            ? longTerms.map(lt => ({ nickname: lt.nickname, hidden: true }))
            : longTerms.map(lt => ({ nickname: lt.nickname, champion: lt.champion, bronze: lt.bronze, relegation: lt.relegation, pointsEarned: lt.pointsEarned, hidden: false })),
        longTermOpen,
        cupMatches,
        standings,
        ranking: stats.map(s => ({
            nickname: s.nickname, position: s.position, points: s.points,
            matchPoints: s.matchPoints, longTermPoints: s.longTermPoints,
            perfects: s.perfects, diffs: s.diffs, winners: s.winners, misses: s.misses,
            filled: s.filled, settled: s.settled, avgPerMatch: s.avgPerMatch, hitRate: s.hitRate,
            jokerUsed: s.jokerUsed, jokerPoints: s.jokerPoints,
            bestRound: s.bestRound, form: s.form
        })),
        roundWinners,
        serverTime: new Date().toISOString()
    });
}));

/** Panel gracza (magiczny link). */
router.get('/player-data', rateLimit({ key: 'pd', max: 120 }), wrap(async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Brak klucza dostępu.' });
    const player = await Player.findOne({ token });
    if (!player) return res.status(404).json({ error: 'Link nieprawidłowy lub wygasł. Poproś admina o nowy.' });

    const season = await resolveSeason(req);
    const year = season.year;
    const lockHours = S.lockHoursOf(season);

    const [matches, allPreds, players, longTerms] = await Promise.all([
        Match.find({ season: year }).sort({ round: 1, matchDate: 1 }),
        Prediction.find({ season: year }),
        Player.find({ seasons: year }).select('nickname'),
        LongTerm.find({ season: year })
    ]);

    const playerList = players.length ? players : await Player.find().select('nickname');
    const stats = S.buildPlayerStats({ players: playerList, predictions: allPreds, matches, longTerms });
    const meIdx = stats.findIndex(s => s.nickname === player.nickname);
    const me = stats[meIdx] || { points: 0, perfects: 0, position: stats.length + 1, byRound: {}, form: [] };
    const chasing = meIdx > 0 ? stats[meIdx - 1] : null;
    const chased = meIdx >= 0 && meIdx < stats.length - 1 ? stats[meIdx + 1] : null;

    const firstMatch = matches.slice().sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
    const longTermLockAt = firstMatch ? new Date(S.lockTime(firstMatch, lockHours)).toISOString() : null;

    const mySeasons = await Season.find({ year: { $in: player.seasons.length ? player.seasons : [year] } })
        .select('year label isActive isFinished').sort({ year: -1 });

    res.json({
        season: seasonPayload(season),
        playerSeasons: mySeasons.map(s => ({ year: s.year, label: s.label || `Sezon ${s.year}`, isFinished: s.isFinished })),
        player: { nickname: player.nickname, fullName: player.fullName },
        matches,
        predictions: allPreds.filter(p => p.nickname === player.nickname),
        longTerm: longTerms.find(l => l.nickname === player.nickname) || null,
        longTermLockAt,
        longTermOpen: firstMatch ? Date.now() < S.lockTime(firstMatch, lockHours) : true,
        ranking: {
            position: me.position || stats.length + 1,
            totalPlayers: stats.length,
            points: me.points,
            snipers: me.perfects,
            avgPerMatch: me.avgPerMatch || 0,
            hitRate: me.hitRate || 0,
            bestRound: me.bestRound || { round: null, points: 0 },
            form: me.form || [],
            leader: stats[0] ? { nickname: stats[0].nickname, points: stats[0].points } : null,
            chasing: chasing ? { nickname: chasing.nickname, gap: chasing.points - me.points } : null,
            chased: chased ? { nickname: chased.nickname, gap: me.points - chased.points } : null
        },
        serverTime: new Date().toISOString()
    });
}));

/** Zapis typów gracza. Wszystkie blokady są weryfikowane po stronie serwera. */
router.post('/submit-all', rateLimit({ key: 'submit', max: 90 }), wrap(async (req, res) => {
    const { token, predictions, longTerm } = req.body || {};
    if (!token) return res.status(403).json({ error: 'Brak uprawnień.' });
    const player = await Player.findOne({ token });
    if (!player) return res.status(403).json({ error: 'Brak uprawnień.' });

    const season = await resolveSeason(req);
    if (season.isFinished) return res.status(403).json({ error: 'Ten sezon jest już zamknięty.' });

    const year = season.year;
    const lockHours = S.lockHoursOf(season);
    const now = Date.now();
    const matches = await Match.find({ season: year });
    const byId = {};
    matches.forEach(m => { byId[String(m._id)] = m; });

    const result = { saved: 0, skipped: 0, longTerm: false, jokerMovedTo: null, warnings: [] };

    // ---- 1. Typy długoterminowe (tylko przed blokadą pierwszego meczu) ----
    const sorted = matches.slice().sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    const ltOpen = sorted.length ? now < S.lockTime(sorted[0], lockHours) : true;
    if (longTerm && ltOpen) {
        const allowed = new Set(season.teams && season.teams.length ? season.teams : S.uniqueTeams(matches));
        const pick = v => (allowed.has(v) ? v : '');
        await LongTerm.findOneAndUpdate(
            { season: year, nickname: player.nickname },
            { champion: pick(longTerm.champion), bronze: pick(longTerm.bronze), relegation: pick(longTerm.relegation) },
            { upsert: true }
        );
        result.longTerm = true;
    } else if (longTerm && !ltOpen) {
        result.warnings.push('Typy sezonowe są już zablokowane.');
    }

    // ---- 2. Joker: dokładnie jeden na sezon ----
    const myPreds = await Prediction.find({ season: year, nickname: player.nickname });
    const currentJoker = myPreds.find(p => p.usedJoker);
    const jokerFrozen = currentJoker && byId[currentJoker.matchId]
        ? S.isLocked(byId[currentJoker.matchId], lockHours, now)
        : false;

    const requestedJoker = (predictions || []).find(p => p.usedJoker);
    let jokerTarget = currentJoker ? currentJoker.matchId : null;
    if (requestedJoker) {
        const m = byId[requestedJoker.matchId];
        const validTarget = m && !S.isLocked(m, lockHours, now) && !m.isPostponed;
        if (jokerFrozen && currentJoker.matchId !== requestedJoker.matchId) {
            result.warnings.push('Joker jest już wykorzystany w rozegranym meczu - nie można go przenieść.');
        } else if (validTarget) {
            jokerTarget = requestedJoker.matchId;
        }
    } else if (currentJoker && !jokerFrozen) {
        // Gracz odznaczył jokera w kolejce, w której go miał -> rezygnuje z niego
        const submittedIds = new Set((predictions || []).map(p => p.matchId));
        if (submittedIds.has(currentJoker.matchId)) jokerTarget = null;
    }

    // ---- 3. Typy meczowe ----
    for (const p of (predictions || [])) {
        const match = byId[p.matchId];
        if (!match) { result.skipped++; continue; }
        if (match.isPostponed && !match.matchDate) { result.skipped++; continue; }
        if (S.isLocked(match, lockHours, now)) { result.skipped++; continue; }

        const home = Number(p.homePred), away = Number(p.awayPred);
        if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > MAX_SCORE || away > MAX_SCORE) {
            result.skipped++;
            continue;
        }

        await Prediction.findOneAndUpdate(
            { season: year, nickname: player.nickname, matchId: p.matchId },
            { homePred: home, awayPred: away, usedJoker: jokerTarget === p.matchId, source: 'player' },
            { upsert: true }
        );
        result.saved++;
    }

    // ---- 4. Porządki z jokerem (przeniesienie lub rezygnacja) ----
    if (!jokerTarget && !jokerFrozen) {
        await Prediction.updateMany(
            { season: year, nickname: player.nickname, usedJoker: true },
            { $set: { usedJoker: false } }
        );
    } else if (jokerTarget && !jokerFrozen) {
        await Prediction.updateMany(
            { season: year, nickname: player.nickname, matchId: { $ne: jokerTarget }, usedJoker: true },
            { $set: { usedJoker: false } }
        );
        await Prediction.updateOne(
            { season: year, nickname: player.nickname, matchId: jokerTarget },
            { $set: { usedJoker: true } }
        );
        result.jokerMovedTo = jokerTarget;
    }

    if (!player.seasons.includes(year)) {
        player.seasons.push(year);
        await player.save();
    }

    res.json({ message: 'Zapisano!', ...result });
}));

module.exports = router;
