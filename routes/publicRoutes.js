const express = require('express');
const router = express.Router();
const { Season, Match, Prediction, Player, LongTerm, CupMatch } = require('../models/Database');
const { resolveSeason } = require('../services/seasons');
const S = require('../services/scoring');
const push = require('../services/push');
const cache = require('../services/cache');
const { rateLimit } = require('../middleware/auth');
const { MAX_SCORE, REMINDER_MINUTES } = require('../config');

const wrap = fn => (req, res) => fn(req, res).catch(err => {
    console.error('❌ publicRoutes:', err.message);
    res.status(500).json({ error: 'Błąd serwera. Spróbuj odświeżyć stronę.' });
});

router.use(cache.invalidateOnWrite);

// Krótki TTL: maskowanie typów zależy od czasu, więc dłużej nie trzymamy
const DATA_TTL = 15 * 1000;

function seasonPayload(season) {
    return {
        year: season.year,
        label: season.label || `Sezon ${season.year}`,
        isActive: season.isActive,
        isFinished: season.isFinished,
        lockMinutes: S.lockMinutesOf(season),
        reminderMinutes: REMINDER_MINUTES,
        scoring: S.scoringOf(season),
        teams: season.teams || [],
        stageNames: S.stageNamesOf(season),
        results: season.results || {}
    };
}

const seasonListItem = s => ({ year: s.year, label: s.label || `Sezon ${s.year}`, isActive: s.isActive, isFinished: s.isFinished });

/** Typ: liczba całkowita 0-75 (pusty string, ułamek, tekst = błąd). */
function validScore(v) {
    if (v === null || v === undefined || v === '') return false;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= MAX_SCORE;
}

/** Pola meczu, które widzi frontend. */
function matchPayload(m) {
    return {
        _id: String(m._id), season: m.season, round: m.round,
        homeTeam: m.homeTeam, awayTeam: m.awayTeam,
        matchDate: m.matchDate, originalDate: m.originalDate || null,
        homeScore: m.homeScore ?? null, awayScore: m.awayScore ?? null,
        isMatchOfTheRound: !!m.isMatchOfTheRound, isPostponed: !!m.isPostponed,
        isWalkover: !!m.isWalkover, voidPredictions: !!m.voidPredictions,
        predictionsFrozen: !!m.predictionsFrozen, note: m.note || ''
    };
}

/** Gracze sezonu (albo wszyscy, gdy sezon nie ma jeszcze przypisań - dane z v1). */
async function seasonPlayers(year) {
    const players = await Player.find({ seasons: year }).select('nickname fullName isActive').sort({ nickname: 1 }).lean();
    return players.length ? players : Player.find().select('nickname fullName isActive').sort({ nickname: 1 }).lean();
}

/** Wszystko o sezonie, co jest potrzebne do statystyk (jedno miejsce, jedna porcja zapytań). */
async function loadSeasonCore(year) {
    const [matches, predictions, players, longTerms] = await Promise.all([
        Match.find({ season: year }).sort({ round: 1, matchDate: 1 }).lean(),
        Prediction.find({ season: year }).lean(),
        seasonPlayers(year),
        LongTerm.find({ season: year }).lean()
    ]);
    const stats = S.buildPlayerStats({ players, predictions, matches, longTerms });
    return { matches, predictions, players, longTerms, stats };
}

function firstMatchLock(matches, lockMinutes) {
    const first = matches.slice().sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
    return first ? S.lockTime(first, lockMinutes) : null;
}

/** Lista sezonów - do przełącznika "archiwum". */
router.get('/seasons', wrap(async (req, res) => {
    const seasons = await Season.find().sort({ year: -1 });
    res.json(seasons.map(seasonListItem));
}));

/** Wszystko, co potrzebuje strona główna. Typy przed blokadą są maskowane TUTAJ. */
router.get('/data', rateLimit({ key: 'data', max: 120 }), wrap(async (req, res) => {
    const season = await resolveSeason(req);
    const year = season.year;
    const payload = await cache.remember(`data:${year}`, DATA_TTL, async () => {
        const lockMinutes = S.lockMinutesOf(season);
        const [core, cupMatches, seasons] = await Promise.all([
            loadSeasonCore(year),
            CupMatch.find({ season: year }).sort({ roundNumber: 1 }).lean(),
            Season.find().select('year label isActive isFinished').sort({ year: -1 }).lean()
        ]);
        const { matches, predictions, players, longTerms, stats } = core;
        const standings = S.buildStandings(matches, season.teams, S.playoffRoundsOf(season), season.standingsAdjustments);
        const roundWinners = S.buildRoundWinners(stats, matches);
        const progress = S.buildRoundProgress(stats, matches);

        // Długoterminowe pokazujemy dopiero po zamknięciu (przed startem sezonu to byłaby ściąga)
        const ltLock = firstMatchLock(matches, lockMinutes);
        const longTermOpen = ltLock ? Date.now() < ltLock : true;

        return {
            season: seasonPayload(season),
            seasons: seasons.map(seasonListItem),
            matches: matches.map(matchPayload),
            predictions: S.maskPredictions(predictions, matches, lockMinutes)
                .map(p => ({ nickname: p.nickname, matchId: p.matchId, homePred: p.homePred, awayPred: p.awayPred, usedJoker: p.usedJoker, pointsEarned: p.pointsEarned, hidden: p.hidden })),
            players: players.map(p => ({ nickname: p.nickname, isActive: p.isActive })),
            longTerms: longTermOpen
                ? longTerms.map(lt => ({ nickname: lt.nickname, hidden: true }))
                : longTerms.map(lt => ({ nickname: lt.nickname, champion: lt.champion, bronze: lt.bronze, relegation: lt.relegation, pointsEarned: lt.pointsEarned, hidden: false })),
            longTermOpen,
            cupMatches: S.buildCupResults(cupMatches, predictions, matches),
            standings,
            finale: S.buildFinale(season, stats),
            ranking: stats.map(s => ({
                nickname: s.nickname, position: s.position, points: s.points,
                matchPoints: s.matchPoints, longTermPoints: s.longTermPoints,
                perfects: s.perfects, diffs: s.diffs, winners: s.winners, misses: s.misses,
                filled: s.filled, settled: s.settled, avgPerMatch: s.avgPerMatch, hitRate: s.hitRate,
                jokerUsed: s.jokerUsed, jokerPoints: s.jokerPoints,
                bestRound: s.bestRound, form: s.form,
                // miejsce przed ostatnią kolejką -> strzałka awansu/spadku w rankingu
                trend: (() => {
                    const ser = progress.series[s.nickname] || [];
                    return ser.length >= 2 ? ser[ser.length - 2].position - ser[ser.length - 1].position : 0;
                })()
            })),
            roundWinners
        };
    });
    res.json({ ...payload, serverTime: new Date().toISOString() });
}));

/** Panel gracza (magiczny link). */
router.get('/player-data', rateLimit({ key: 'pd', max: 120 }), wrap(async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Brak klucza dostępu.' });
    const player = await Player.findOne({ token });
    if (!player) return res.status(404).json({ error: 'Link nieprawidłowy lub wygasł. Poproś admina o nowy.' });

    const season = await resolveSeason(req);
    const year = season.year;
    const lockMinutes = S.lockMinutesOf(season);

    const { matches, predictions, stats } = await loadSeasonCore(year);
    const longTerm = await LongTerm.findOne({ season: year, nickname: player.nickname }).lean();
    const meIdx = stats.findIndex(s => s.nickname === player.nickname);
    const me = stats[meIdx] || { points: 0, perfects: 0, position: null, byRound: {}, form: [] };
    const chasing = meIdx > 0 ? stats[meIdx - 1] : null;
    const chased = meIdx >= 0 && meIdx < stats.length - 1 ? stats[meIdx + 1] : null;
    // przy równych punktach ex aequo jest tylko wtedy, gdy rozstrzygające kryteria też są równe
    const rel = other => ({ nickname: other.nickname, gap: Math.abs(other.points - me.points), samePosition: other.position === me.position });

    const finale = S.buildFinale(season, stats);
    const roundWinners = S.buildRoundWinners(stats, matches);
    const lastDone = roundWinners.filter(r => r.complete).pop();
    let champion = null;
    if (finale && finale.champions.includes(player.nickname)) {
        const ws = season.winnerSurprise || {};
        champion = {
            year, label: season.label || `Sezon ${year}`,
            prize: ws.prize || '', message: ws.message || '',
            revealed: (ws.revealedBy || []).includes(player.nickname),
            coChampions: finale.champions.filter(n => n !== player.nickname)
        };
    }

    const ltLock = firstMatchLock(matches, lockMinutes);
    const mySeasons = await Season.find({ year: { $in: player.seasons.length ? player.seasons : [year] } })
        .select('year label isActive isFinished').sort({ year: -1 });

    // "ostatnio widziany" - przydaje się adminowi przy martwych kontach (zapis max raz na godzinę)
    if (!player.lastSeenAt || Date.now() - new Date(player.lastSeenAt).getTime() > 3600 * 1000) {
        Player.updateOne({ _id: player._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
    }

    res.json({
        season: seasonPayload(season),
        playerSeasons: mySeasons.map(s => ({ year: s.year, label: s.label || `Sezon ${s.year}`, isFinished: s.isFinished })),
        player: { nickname: player.nickname, fullName: player.fullName, isActive: player.isActive !== false },
        matches: matches.map(matchPayload),
        predictions: predictions.filter(p => p.nickname === player.nickname),
        longTerm: longTerm || null,
        longTermLockAt: ltLock ? new Date(ltLock).toISOString() : null,
        longTermOpen: ltLock ? Date.now() < ltLock : true,
        ranking: {
            position: me.position || null,  // null = gracz jeszcze nie jest w rankingu tego sezonu
            totalPlayers: stats.length,
            points: me.points,
            snipers: me.perfects,
            avgPerMatch: me.avgPerMatch || 0,
            hitRate: me.hitRate || 0,
            bestRound: me.bestRound || { round: null, points: 0 },
            form: me.form || [],
            leader: stats[0] ? { nickname: stats[0].nickname, points: stats[0].points } : null,
            chasing: chasing ? rel(chasing) : null,
            chased: chased ? rel(chased) : null,
            diffs: me.diffs || 0,
            roundWins: roundWinners.filter(r => r.winners.includes(player.nickname)).map(r => r.round)
        },
        // ostatnia ROZLICZONA w całości kolejka, jeśli gracz ją wygrał (baner "Wygrałeś kolejkę")
        lastRoundWin: lastDone && lastDone.winners.includes(player.nickname)
            ? { round: lastDone.round, points: lastDone.points, shared: lastDone.winners.length > 1 } : null,
        finale,
        medal: finale && me.position && me.position <= 3 && finale.podium.some(p => p.nickname === player.nickname) ? me.position : null,
        champion,
        push: { enabled: push.isConfigured() },
        serverTime: new Date().toISOString()
    });
}));

/** Zapis typów gracza. Wszystkie blokady są weryfikowane po stronie serwera. */
router.post('/submit-all', rateLimit({ key: 'submit', max: 90 }), wrap(async (req, res) => {
    const { token, predictions, longTerm } = req.body || {};
    if (!token) return res.status(403).json({ error: 'Brak uprawnień.' });
    const player = await Player.findOne({ token });
    if (!player) return res.status(403).json({ error: 'Brak uprawnień.' });
    if (player.isActive === false) return res.status(403).json({ error: 'Twoje konto jest wstrzymane. Odezwij się do admina.' });

    const season = await resolveSeason(req);
    if (season.isFinished) return res.status(403).json({ error: 'Ten sezon jest już zamknięty.' });

    const year = season.year;
    const lockMinutes = S.lockMinutesOf(season);
    const now = Date.now();
    const matches = await Match.find({ season: year }).lean();
    const byId = S.indexMatches(matches);

    const result = { saved: 0, skipped: 0, deleted: 0, skippedMatches: [], longTerm: false, jokerMovedTo: null, warnings: [] };

    // ---- 1. Typy długoterminowe (tylko przed blokadą pierwszego meczu) ----
    const ltLock = firstMatchLock(matches, lockMinutes);
    const ltOpen = ltLock ? now < ltLock : true;
    if (longTerm && ltOpen) {
        const allowed = new Set(season.teams && season.teams.length ? season.teams : S.uniqueTeams(matches));
        const pick = v => (allowed.has(v) ? v : '');
        const lt = { champion: pick(longTerm.champion), bronze: pick(longTerm.bronze), relegation: pick(longTerm.relegation) };
        // Regulamin: trzy RÓŻNE drużyny (mistrz nie może być jednocześnie brązowym medalistą ani spadkowiczem)
        if (lt.bronze && lt.bronze === lt.champion) { lt.bronze = ''; result.warnings.push('Typy sezonowe: brązowy medalista musi być inną drużyną niż mistrz.'); }
        if (lt.relegation && (lt.relegation === lt.champion || lt.relegation === lt.bronze)) {
            lt.relegation = '';
            result.warnings.push('Typy sezonowe: spadkowicz nie może być medalistą.');
        }
        await LongTerm.findOneAndUpdate({ season: year, nickname: player.nickname }, lt, { upsert: true });
        result.longTerm = true;
    } else if (longTerm && !ltOpen) {
        result.warnings.push('Typy sezonowe są już zablokowane.');
    }

    // ---- 2. Joker: dokładnie jeden na sezon ----
    // Joker na anulowanym meczu (walkower / odwołany) nie przepada - można go przenieść.
    const myPreds = await Prediction.find({ season: year, nickname: player.nickname }).lean();
    const currentJoker = myPreds.find(p => p.usedJoker && !(byId[p.matchId] && byId[p.matchId].voidPredictions));
    const jokerFrozen = currentJoker && byId[currentJoker.matchId]
        ? S.isLocked(byId[currentJoker.matchId], lockMinutes, now)
        : false;

    const requestedJoker = (predictions || []).find(p => p.usedJoker && p.clear !== true);
    let jokerTarget = currentJoker ? currentJoker.matchId : null;
    if (requestedJoker) {
        const m = byId[requestedJoker.matchId];
        const validTarget = m && !S.isLocked(m, lockMinutes, now) && !m.isPostponed && !m.voidPredictions;
        // Joker musi stać na meczu z typem (zapisanym wcześniej albo w tym żądaniu)
        const hasTyp = validScore(requestedJoker.homePred) && validScore(requestedJoker.awayPred)
            || myPreds.some(p => p.matchId === requestedJoker.matchId);
        if (jokerFrozen && currentJoker.matchId !== requestedJoker.matchId) {
            result.warnings.push('Joker jest już wykorzystany w rozegranym meczu - nie można go przenieść.');
        } else if (validTarget && !hasTyp) {
            result.warnings.push('Joker wymaga wpisanego typu na ten mecz.');
        } else if (validTarget) {
            jokerTarget = requestedJoker.matchId;
        }
    } else if (currentJoker && !jokerFrozen) {
        // Gracz odznaczył jokera w kolejce, w której go miał -> rezygnuje z niego
        const submittedIds = new Set((predictions || []).map(p => p.matchId));
        if (submittedIds.has(currentJoker.matchId)) jokerTarget = null;
    }
    // Joker na meczu, z którego gracz właśnie usuwa typ, przepada razem z typem
    if (jokerTarget && (predictions || []).some(p => p.clear === true && p.matchId === jokerTarget)
        && !(jokerFrozen && currentJoker && currentJoker.matchId === jokerTarget)) {
        jokerTarget = null;
    }

    // ---- 3. Typy meczowe ----
    const ops = [];
    const skip = (match, why) => {
        result.skipped++;
        if (match) result.skippedMatches.push({ matchId: String(match._id), reason: why });
    };
    for (const p of (predictions || [])) {
        const match = byId[p.matchId];
        if (!match) { skip(null, 'unknown'); continue; }
        if (match.voidPredictions) { skip(match, 'void'); continue; }
        if (S.isLocked(match, lockMinutes, now)) { skip(match, 'locked'); continue; }

        // Gracz wyczyścił oba pola = rezygnuje z typu (tylko przed blokadą)
        if (p.clear === true) {
            ops.push({ deleteOne: { filter: { season: year, nickname: player.nickname, matchId: p.matchId } } });
            result.deleted++;
            continue;
        }

        if (!validScore(p.homePred) || !validScore(p.awayPred)) { skip(match, 'invalid'); continue; }
        const home = Number(p.homePred), away = Number(p.awayPred);
        ops.push({
            updateOne: {
                filter: { season: year, nickname: player.nickname, matchId: p.matchId },
                update: { $set: { homePred: home, awayPred: away, usedJoker: jokerTarget === p.matchId, source: 'player' } },
                upsert: true
            }
        });
        result.saved++;
    }
    if (ops.length) await Prediction.bulkWrite(ops, { ordered: false });
    if (result.skippedMatches.some(s => s.reason === 'locked')) {
        result.warnings.push('Część typów nie została zapisana — mecz jest już zablokowany.');
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

/**
 * Mistrz Typera odkrywa niespodziankę (zdrapka w panelu). Tylko zwycięzca zamkniętego sezonu, przez swój link.
 * Zapis "kto odkrył" widzi admin - wie, że nagroda dotarła.
 */
router.post('/champion/reveal', rateLimit({ key: 'reveal', max: 20 }), wrap(async (req, res) => {
    const { token } = req.body || {};
    const player = token ? await Player.findOne({ token }) : null;
    if (!player) return res.status(403).json({ error: 'Brak uprawnień.' });
    const season = await resolveSeason(req);
    if (!season.isFinished) return res.status(403).json({ error: 'Sezon jeszcze trwa — mistrza poznamy po jego zamknięciu.' });
    const { stats } = await loadSeasonCore(season.year);
    const finale = S.buildFinale(season, stats);
    if (!finale || !finale.champions.includes(player.nickname)) return res.status(403).json({ error: 'Ta niespodzianka czeka na Mistrza Typera.' });
    const ws = season.winnerSurprise || {};
    const revealedBy = [...new Set([...(ws.revealedBy || []), player.nickname])];
    if (revealedBy.length !== (ws.revealedBy || []).length) {
        season.winnerSurprise = { prize: ws.prize || '', message: ws.message || '', revealedBy };
        await season.save();
    }
    res.json({ message: 'Gratulacje, Mistrzu!', prize: ws.prize || '', text: ws.message || '' });
}));

/* ================= STATYSTYKI ================= */

/**
 * Profil typera: przebieg sezonu (wykres formy), historia typów, bilans.
 * Pokazuje wyłącznie typy już jawne (po blokadzie), więc nie da się podejrzeć cudzych typów.
 */
router.get('/profile', rateLimit({ key: 'stats', max: 120 }), wrap(async (req, res) => {
    const nickname = String(req.query.nickname || '');
    if (!nickname) return res.status(400).json({ error: 'Podaj pseudonim.' });
    const season = await resolveSeason(req);
    const year = season.year;

    const payload = await cache.remember(`profile:${year}:${nickname}`, DATA_TTL, async () => {
        const lockMinutes = S.lockMinutesOf(season);
        const { matches, predictions, stats } = await loadSeasonCore(year);
        const me = stats.find(s => s.nickname === nickname);
        if (!me) return null;
        const progress = S.buildRoundProgress(stats, matches);
        const byId = S.indexMatches(matches);
        const now = Date.now();

        // Średnia ligi na kolejkę - tło dla wykresu formy
        const avgByRound = {};
        progress.rounds.forEach(r => {
            const vals = stats.filter(s => s.settled).map(s => s.byRound[r] || 0);
            avgByRound[r] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
        });

        const history = predictions
            .filter(p => p.nickname === nickname && byId[p.matchId] && S.isLocked(byId[p.matchId], lockMinutes, now))
            .map(p => {
                const m = byId[p.matchId];
                return {
                    matchId: p.matchId, round: m.round, matchDate: m.matchDate,
                    homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore ?? null, awayScore: m.awayScore ?? null,
                    voided: !!m.voidPredictions, isMatchOfTheRound: !!m.isMatchOfTheRound,
                    homePred: p.homePred, awayPred: p.awayPred, usedJoker: !!p.usedJoker,
                    pointsEarned: p.pointsEarned ?? null,
                    outcome: S.isSettled(m) ? (p.outcome || S.outcomeOf(p.homePred, p.awayPred, m.homeScore, m.awayScore)) : null
                };
            })
            .sort((a, b) => new Date(b.matchDate) - new Date(a.matchDate));

        const finale = S.buildFinale(season, stats);
        return {
            season: seasonPayload(season),
            nickname,
            roundWins: S.buildRoundWinners(stats, matches).filter(r => r.winners.includes(nickname)).map(r => r.round),
            medal: finale && finale.podium.some(p => p.nickname === nickname) ? me.position : null,
            summary: {
                position: me.position, totalPlayers: stats.length, points: me.points, matchPoints: me.matchPoints,
                longTermPoints: me.longTermPoints, perfects: me.perfects, diffs: me.diffs, winners: me.winners,
                misses: me.misses, settled: me.settled, avgPerMatch: me.avgPerMatch, hitRate: me.hitRate,
                bestRound: me.bestRound, jokerUsed: me.jokerUsed, jokerPoints: me.jokerPoints
            },
            progress: (progress.series[nickname] || []).map(p => ({ ...p, leagueAvg: avgByRound[p.round] })),
            history,
            rivals: stats.filter(s => s.nickname !== nickname).map(s => s.nickname)
        };
    });
    if (!payload) return res.status(404).json({ error: 'Nie ma takiego gracza w tym sezonie.' });
    res.json(payload);
}));

/** H2H dwóch typerów. season=all -> wszystkie sezony. */
router.get('/h2h', rateLimit({ key: 'stats', max: 120 }), wrap(async (req, res) => {
    const a = String(req.query.a || ''), b = String(req.query.b || '');
    if (!a || !b || a === b) return res.status(400).json({ error: 'Wybierz dwóch różnych graczy.' });
    const all = req.query.season === 'all';
    const season = all ? null : await resolveSeason(req);

    const payload = await cache.remember(`h2h:${all ? 'all' : season.year}:${a}:${b}`, DATA_TTL, async () => {
        const filter = all ? {} : { season: season.year };
        const [matches, predictions] = await Promise.all([
            Match.find({ ...filter, homeScore: { $ne: null } }).lean(),
            Prediction.find({ ...filter, nickname: { $in: [a, b] }, pointsEarned: { $ne: null } }).lean()
        ]);
        return { scope: all ? 'all' : season.year, ...S.buildH2H(a, b, predictions, matches) };
    });
    res.json(payload);
}));

/** Ranking wszech czasów: suma ze wszystkich sezonów, tytuły, podia. */
router.get('/alltime', rateLimit({ key: 'stats', max: 60 }), wrap(async (req, res) => {
    const payload = await cache.remember('alltime', 60 * 1000, async () => {
        const seasons = await Season.find().sort({ year: 1 }).lean();
        const perSeason = [];
        for (const s of seasons) {
            const { stats } = await loadSeasonCore(s.year);
            perSeason.push({ year: s.year, label: s.label, isFinished: s.isFinished, stats });
        }
        return {
            seasons: perSeason.map(s => ({
                year: s.year, label: s.label || `Sezon ${s.year}`, isFinished: s.isFinished,
                winner: (S.buildFinale({ year: s.year, isFinished: s.isFinished }, s.stats) || { champions: [] }).champions,
                winnerPoints: s.stats[0] ? s.stats[0].points : 0
            })),
            ranking: S.buildAllTime(perSeason)
        };
    });
    res.json(payload);
}));

/* ================= POWIADOMIENIA PUSH ================= */

router.get('/push/key', (req, res) => {
    res.json({ enabled: push.isConfigured(), publicKey: push.publicKey() });
});

router.post('/push/subscribe', rateLimit({ key: 'push', max: 20 }), wrap(async (req, res) => {
    const { token, subscription } = req.body || {};
    const player = token ? await Player.findOne({ token }) : null;
    if (!player) return res.status(403).json({ error: 'Brak uprawnień.' });
    if (!push.isConfigured()) return res.status(503).json({ error: 'Powiadomienia nie są skonfigurowane na serwerze.' });
    try {
        await push.saveSubscription(subscription, { nickname: player.nickname, userAgent: req.headers['user-agent'] });
    } catch (e) { return res.status(400).json({ error: e.message }); }
    res.json({ message: 'Powiadomienia włączone na tym urządzeniu.' });
}));

router.post('/push/unsubscribe', rateLimit({ key: 'push', max: 20 }), wrap(async (req, res) => {
    const { endpoint } = req.body || {};
    if (endpoint) await push.removeSubscription(String(endpoint));
    res.json({ message: 'Powiadomienia wyłączone na tym urządzeniu.' });
}));

module.exports = router;
