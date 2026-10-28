const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Season, Match, Prediction, Player, LongTerm, CupMatch, ResultDraft, JobRun, PushSubscription } = require('../models/Database');
const { login, logout, requireAdmin } = require('../middleware/auth');
const { getActiveSeason, recalcMatch, recalcSeason, resolveLongTerm } = require('../services/seasons');
const { applyResult, clearResult } = require('../services/results');
const { generateSchedule } = require('../services/schedule');
const { scrapeJob, reminderJob } = require('../services/jobs');
const push = require('../services/push');
const cache = require('../services/cache');
const S = require('../services/scoring');
const { MAX_SCORE, DEFAULT_STAGE_NAMES, DEFAULT_LOCK_MINUTES } = require('../config');

const wrap = fn => (req, res) => fn(req, res).catch(err => {
    console.error('❌ adminRoutes:', err);
    res.status(500).json({ error: err.message || 'Błąd serwera.' });
});

// ---- logowanie ----
router.post('/login', login);
router.post('/logout', logout);
router.use(requireAdmin);
router.use(cache.invalidateOnWrite);

router.get('/whoami', (req, res) => res.json({ ok: true }));

async function seasonOf(req) {
    const year = Number(req.body?.season || req.query?.season);
    if (year) {
        const s = await Season.findOne({ year });
        if (s) return s;
    }
    return getActiveSeason();
}

const clampLock = v => Math.max(0, Math.min(14 * 24 * 60, Math.round(Number(v)) || 0));

const clampScore = v => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > MAX_SCORE) return null;
    return n;
};

/* ================= SEZONY ================= */

const surpriseOf = s => {
    const ws = (s && s.winnerSurprise) || {};
    return { prize: ws.prize || '', message: ws.message || '', revealedBy: ws.revealedBy || [] };
};

/** Zapis treści niespodzianki (bez ruszania listy "kto już odkrył"). */
function setSurprise(season, { prize, message }) {
    const cur = surpriseOf(season);
    season.winnerSurprise = {
        prize: prize === undefined ? cur.prize : String(prize).trim().slice(0, 200),
        message: message === undefined ? cur.message : String(message).trim().slice(0, 1000),
        revealedBy: cur.revealedBy
    };
}

/**
 * Po zamknięciu sezonu: Mistrz dostaje powiadomienie o niespodziance, pozostali - o końcu sezonu.
 * onceOnly: ponowne zamknięcie (np. po korekcie) nie wyśle drugi raz tego samego.
 */
async function announceFinale(season) {
    const [matches, predictions, longTerms, inSeason] = await Promise.all([
        Match.find({ season: season.year }).lean(),
        Prediction.find({ season: season.year }).lean(),
        LongTerm.find({ season: season.year }).lean(),
        Player.find({ seasons: season.year }).lean()
    ]);
    const players = inSeason.length ? inSeason : await Player.find().lean();
    const stats = S.buildPlayerStats({ players, predictions, matches, longTerms });
    const finale = S.buildFinale(season, stats);
    if (!finale) return { champions: [], sent: 0 };
    const names = finale.champions.join(', ');
    let sent = 0;
    for (const p of players) {
        const isChamp = finale.champions.includes(p.nickname);
        if (!(await push.onceOnly(`finale:${season.year}:${p.nickname}:${isChamp ? 'champ' : 'all'}`))) continue;
        sent += await push.notifyPlayer(p.nickname, isChamp
            ? { title: '🏆 Zostałeś Mistrzem Typera!', body: `Sezon ${season.year} jest Twój. Otwórz aplikację — czeka na Ciebie niespodzianka 🎁`, url: `/typuj.html?id=${p.token}`, tag: 'finale' }
            : { title: `🏁 Koniec sezonu ${season.year}`, body: `Mistrzem Typera ${finale.champions.length > 1 ? 'zostają' : 'został'}: ${names}. Zobacz podium!`, url: '/#ranking', tag: 'finale' });
    }
    return { champions: finale.champions, sent };
}

router.get('/seasons', wrap(async (req, res) => {
    const seasons = await Season.find().sort({ year: -1 });
    const out = [];
    for (const s of seasons) {
        out.push({
            year: s.year, label: s.label, isActive: s.isActive, isFinished: s.isFinished,
            lockMinutes: S.lockMinutesOf(s), scoring: S.scoringOf(s), teams: s.teams,
            stageNames: S.stageNamesOf(s),
            results: s.results,
            standingsAdjustments: s.standingsAdjustments || [],
            teamAliases: s.teamAliases ? Object.fromEntries(s.teamAliases instanceof Map ? s.teamAliases : Object.entries(s.teamAliases)) : {},
            scraperUrls: s.scraperUrls || [],
            winnerSurprise: surpriseOf(s),
            matches: await Match.countDocuments({ season: s.year }),
            predictions: await Prediction.countDocuments({ season: s.year })
        });
    }
    res.json(out);
}));

/** Tworzy lub aktualizuje sezon. */
router.post('/season', wrap(async (req, res) => {
    const { year, label, teams, lockMinutes, lockHours, scoring, stageNames, copyPlayers, activate } = req.body || {};
    const y = Number(year);
    if (!y || y < 2000 || y > 2100) return res.status(400).json({ error: 'Podaj poprawny rok sezonu.' });

    const payload = {};
    if (label !== undefined) payload.label = label || `Ekstraliga ${y}`;
    if (Array.isArray(teams)) payload.teams = teams.map(t => String(t).trim()).filter(Boolean);
    if (lockMinutes !== undefined && lockMinutes !== '') payload.lockMinutes = clampLock(lockMinutes);
    else if (lockHours !== undefined && lockHours !== '') payload.lockMinutes = clampLock(Number(lockHours) * 60);
    else if (!(await Season.findOne({ year: y }))) payload.lockMinutes = DEFAULT_LOCK_MINUTES; // nowy sezon: 1 min przed startem
    if (scoring && typeof scoring === 'object') payload.scoring = { ...S.scoringOf(null), ...scoring };
    if (stageNames && Object.keys(stageNames).length) payload.stageNames = stageNames;

    const season = await Season.findOneAndUpdate({ year: y }, payload, { upsert: true, new: true, setDefaultsOnInsert: true });
    if (Object.keys(S.stageNamesOf(season)).length === 0) {
        season.stageNames = DEFAULT_STAGE_NAMES;
        await season.save();
    }

    if (copyPlayers) {
        const players = await Player.find({ isActive: true });
        for (const p of players) {
            if (!p.seasons.includes(y)) { p.seasons.push(y); await p.save(); }
        }
    }
    if (activate) {
        await Season.updateMany({ year: { $ne: y } }, { $set: { isActive: false } });
        season.isActive = true;
        await season.save();
    }

    res.json({ message: `Sezon ${y} zapisany.`, season: { year: season.year, isActive: season.isActive } });
}));

router.post('/season/activate', wrap(async (req, res) => {
    const y = Number(req.body.year);
    const season = await Season.findOne({ year: y });
    if (!season) return res.status(404).json({ error: 'Nie ma takiego sezonu.' });
    await Season.updateMany({}, { $set: { isActive: false } });
    season.isActive = true;
    season.isFinished = false;
    await season.save();
    res.json({ message: `Sezon ${y} jest teraz aktywny. Strona główna pokazuje go domyślnie.` });
}));

/** Zamknięcie sezonu: przyznanie punktów za typy długoterminowe + oznaczenie archiwum. */
router.post('/season/finish', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const { champion, bronze, relegation, markFinished, prize, message } = req.body || {};
    const picked = [champion, bronze, relegation].filter(Boolean);
    if (new Set(picked).size !== picked.length) return res.status(400).json({ error: 'Mistrz, brązowy medalista i spadkowicz muszą być różnymi drużynami.' });
    const out = await resolveLongTerm(season.year, { champion, bronze, relegation });
    if (prize !== undefined || message !== undefined) setSurprise(season, { prize, message });
    if (markFinished) season.isFinished = true;
    await season.save();
    let extra = '';
    if (markFinished) {
        const fin = await announceFinale(season);
        if (fin.champions.length) extra = ` Mistrz Typera: ${fin.champions.join(', ')}${fin.sent ? ` (powiadomienia: ${fin.sent})` : ''}.`;
    }
    res.json({ message: `Rozliczono ${out.players} graczy (przyznano ${out.awarded} pkt).${extra}` });
}));

router.post('/season/reopen', wrap(async (req, res) => {
    const season = await seasonOf(req);
    season.isFinished = false;
    await season.save();
    res.json({ message: `Sezon ${season.year} znów otwarty do edycji.` });
}));

/**
 * Ustawienia sezonu v3: blokada w minutach, korekty tabeli, aliasy drużyn i źródła scrapera.
 * Zmiana blokady nie rusza typów - zmienia tylko moment zamknięcia kolejnych meczów.
 */
router.post('/season/settings', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const { lockMinutes, standingsAdjustments, teamAliases, scraperUrls, scoring, winnerSurprise } = req.body || {};
    if (lockMinutes !== undefined && lockMinutes !== '') season.lockMinutes = clampLock(lockMinutes);
    if (winnerSurprise && typeof winnerSurprise === 'object') setSurprise(season, winnerSurprise);
    if (Array.isArray(standingsAdjustments)) {
        season.standingsAdjustments = standingsAdjustments
            .map(a => ({ team: String(a.team || '').trim(), points: Number(a.points) || 0, reason: String(a.reason || '').slice(0, 200) }))
            .filter(a => a.team && a.points);
    }
    if (teamAliases && typeof teamAliases === 'object') {
        const clean = {};
        Object.entries(teamAliases).forEach(([team, list]) => {
            const arr = (Array.isArray(list) ? list : String(list).split(',')).map(x => String(x).trim()).filter(Boolean);
            if (arr.length) clean[team] = arr;
        });
        season.teamAliases = clean;
    }
    if (Array.isArray(scraperUrls)) {
        season.scraperUrls = scraperUrls.map(u => String(u).trim()).filter(u => /^https?:\/\//.test(u));
    }
    let recalculated = false;
    if (scoring && typeof scoring === 'object') {
        const next = {};
        ['exact', 'diff', 'winner', 'motrBonus', 'jokerMultiplier', 'longTermEach', 'diffTolerance'].forEach(k => {
            if (scoring[k] !== undefined && scoring[k] !== '' && !isNaN(Number(scoring[k]))) next[k] = Math.max(0, Number(scoring[k]));
        });
        if (next.diffTolerance !== undefined) next.diffTolerance = Math.min(20, Math.round(next.diffTolerance));
        season.scoring = { ...S.scoringOf(season), ...next };
        recalculated = true;
    }
    await season.save();
    if (recalculated) await recalcSeason(season.year);
    res.json({ message: `Ustawienia sezonu ${season.year} zapisane${recalculated ? ' i punkty przeliczone' : ''}.` });
}));

/* ================= TERMINARZ ================= */

/** Generator terminarza (dwumecze każdy z każdym). dryRun=true zwraca podgląd. */
router.post('/generate-schedule', wrap(async (req, res) => {
    const { teams, startDate, weekGap, slots, doubleRound, skipWeeks, dryRun, season, replace } = req.body || {};
    let schedule;
    try {
        schedule = generateSchedule({ teams, startDate, weekGap, slots, doubleRound, skipWeeks: skipWeeks || [] });
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
    if (dryRun) {
        return res.json({ message: `Podgląd: ${schedule.length} meczów w ${Math.max(...schedule.map(m => m.round))} kolejkach.`, schedule });
    }

    const y = Number(season) || (await getActiveSeason()).year;
    const target = await Season.findOneAndUpdate({ year: y }, {}, { upsert: true, new: true, setDefaultsOnInsert: true });
    if (replace) {
        const ids = (await Match.find({ season: y }).select('_id')).map(m => String(m._id));
        await Prediction.deleteMany({ season: y, matchId: { $in: ids } });
        await ResultDraft.deleteMany({ matchId: { $in: ids } });
        await Match.deleteMany({ season: y });
    }
    let added = 0;
    for (const m of schedule) {
        const r = await Match.updateOne(
            { season: y, round: m.round, homeTeam: m.homeTeam, awayTeam: m.awayTeam },
            { $set: { matchDate: new Date(m.matchDate) }, $setOnInsert: { isMatchOfTheRound: !!m.isMatchOfTheRound } },
            { upsert: true }
        );
        if (r.upsertedCount) added++;
    }
    target.teams = [...new Set(schedule.flatMap(m => [m.homeTeam, m.awayTeam]))];
    if (!target.label) target.label = `Ekstraliga ${y}`;
    await target.save();
    res.json({ message: `Terminarz sezonu ${y} gotowy: ${schedule.length} meczów (${added} nowych).` });
}));

/** Import terminarza z JSON. */
router.post('/load-schedule', wrap(async (req, res) => {
    const { schedule } = req.body || {};
    if (!Array.isArray(schedule) || !schedule.length) return res.status(400).json({ error: 'Oczekiwano niepustej tablicy JSON.' });
    const season = await seasonOf(req);
    const y = season.year;

    let added = 0, updated = 0, bad = 0;
    for (const m of schedule) {
        const date = new Date(m.matchDate);
        if (!m.round || !m.homeTeam || !m.awayTeam || isNaN(date.getTime())) { bad++; continue; }
        const set = { matchDate: date };
        if (m.isMatchOfTheRound !== undefined) set.isMatchOfTheRound = !!m.isMatchOfTheRound;
        if (m.note !== undefined) set.note = String(m.note);
        const r = await Match.updateOne(
            { season: y, round: Number(m.round), homeTeam: m.homeTeam, awayTeam: m.awayTeam },
            { $set: set },
            { upsert: true }
        );
        if (r.upsertedCount) added++; else updated++;
    }
    const teams = [...new Set((await Match.find({ season: y }).select('homeTeam awayTeam')).flatMap(m => [m.homeTeam, m.awayTeam]))];
    season.teams = teams;
    await season.save();

    res.json({ message: `Sezon ${y}: dodano ${added}, zaktualizowano ${updated}${bad ? `, pominięto błędnych: ${bad}` : ''}.` });
}));

/** Ustawienie wyniku meczu + automatyczne przeliczenie punktów tego meczu. */
router.post('/result', wrap(async (req, res) => {
    const { matchId, homeScore, awayScore, clear, walkover, notify } = req.body || {};
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu.' });

    if (clear) {
        await clearResult(match);
        return res.json({ message: 'Wynik wyczyszczony, punkty wycofane.' });
    }

    const h = clampScore(homeScore), a = clampScore(awayScore);
    if (h === null || a === null) return res.status(400).json({ error: `Wynik musi być liczbą 0-${MAX_SCORE}.` });
    const n = await applyResult(match, h, a, { source: 'admin', walkover: walkover === undefined ? undefined : !!walkover, notify: !!notify });
    await ResultDraft.updateMany({ matchId: String(match._id), status: 'draft' }, { $set: { status: 'rejected', decidedAt: new Date() } });
    res.json({ message: `Wynik ${h}:${a} zapisany${match.isWalkover ? ' jako walkower (typy anulowane)' : ''}. Przeliczono ${n} typów.` });
}));

/** Wpisanie wyników całej kolejki jednym strzałem. */
router.post('/results-bulk', wrap(async (req, res) => {
    const { results } = req.body || {};
    if (!Array.isArray(results)) return res.status(400).json({ error: 'Brak danych.' });
    let ok = 0, unchanged = 0;
    const invalid = [];
    for (const r of results) {
        const h = clampScore(r.homeScore), a = clampScore(r.awayScore);
        const match = await Match.findById(r.matchId);
        if (!match) continue;
        if (h === null || a === null) { invalid.push(`${match.homeTeam} – ${match.awayTeam}`); continue; }
        if (match.homeScore === h && match.awayScore === a) { unchanged++; continue; } // bez zmian - nie ruszamy
        await applyResult(match, h, a, { source: 'admin', notify: !!req.body.notify });
        await ResultDraft.updateMany({ matchId: String(match._id), status: 'draft' }, { $set: { status: 'rejected', decidedAt: new Date() } });
        ok++;
    }
    if (invalid.length && !ok) return res.status(400).json({ error: `Wynik musi być liczbą 0-${MAX_SCORE}: ${invalid.join(', ')}.` });
    res.json({
        message: `Zapisano wyniki ${ok} meczów${unchanged ? `, bez zmian: ${unchanged}` : ''}${invalid.length ? `, pominięto błędne: ${invalid.join(', ')}` : ''}.`,
        saved: ok, unchanged, invalid
    });
}));

/**
 * Edycja meczu. Reguły przełożeń (żużel = deszcz):
 * - typy NIGDY nie są kasowane - wiszą na _id meczu, nie na dacie,
 * - jeśli w chwili przełożenia typy były już zablokowane (a więc jawne), zostają zamrożone,
 *   żeby nikt nie poprawił typu, znając cudze; admin może je świadomie odmrozić,
 * - "termin nieznany" (isPostponed) przed blokadą: typy zostają otwarte i ukryte do nowej daty,
 * - ustawienie nowej daty kończy stan "termin nieznany".
 */
router.post('/match-edit', wrap(async (req, res) => {
    const { matchId, isMatchOfTheRound, isPostponed, matchDate, note, voidPredictions, predictionsFrozen, isWalkover, round } = req.body || {};
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu.' });
    const season = await Season.findOne({ year: match.season });
    const lockMinutes = S.lockMinutesOf(season);
    const hasResult = match.homeScore !== null && match.homeScore !== undefined;
    // Stan PRZED zmianami: czy typy były już zablokowane (jawne)?
    const lockedBefore = S.isLocked(match, lockMinutes);
    const msgs = [];

    let newDate = null;
    if (matchDate) {
        newDate = new Date(matchDate);
        if (isNaN(newDate.getTime())) return res.status(400).json({ error: 'Niepoprawna data.' });
        if (match.matchDate && newDate.getTime() === new Date(match.matchDate).getTime()) newDate = null;
    }

    if (round !== undefined && round !== '' && Number(round) !== Number(match.round)) {
        const r = Number(round);
        if (!Number.isInteger(r) || r < 1 || r > 99) return res.status(400).json({ error: 'Numer kolejki musi być liczbą 1-99.' });
        const clash = await Match.findOne({ season: match.season, round: r, homeTeam: match.homeTeam, awayTeam: match.awayTeam });
        if (clash && String(clash._id) !== String(match._id)) {
            return res.status(400).json({ error: `W kolejce ${r} jest już mecz ${match.homeTeam} – ${match.awayTeam}.` });
        }
        match.round = r;
        msgs.push(`przeniesiony do kolejki ${r}`);
    }

    const becamePostponed = isPostponed === true && !match.isPostponed;
    if (isPostponed !== undefined) match.isPostponed = !!isPostponed;
    if (newDate) {
        if (!match.originalDate) match.originalDate = match.matchDate;
        match.matchDate = newDate;
        match.isPostponed = false; // jest nowy termin
        msgs.push(`nowy termin ${newDate.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' })}`);
    } else if (becamePostponed) {
        msgs.push('oznaczony jako przełożony (termin nieznany)');
    }

    if (predictionsFrozen !== undefined) {
        match.predictionsFrozen = !!predictionsFrozen;
        msgs.push(match.predictionsFrozen ? 'typy zamrożone' : 'typy odmrożone');
    } else if (lockedBefore && !hasResult && !match.predictionsFrozen && (newDate || becamePostponed)) {
        match.predictionsFrozen = true;
        msgs.push('typy zamrożone (były już jawne w chwili przełożenia)');
    }

    if (isMatchOfTheRound !== undefined) match.isMatchOfTheRound = !!isMatchOfTheRound;
    if (note !== undefined) match.note = String(note).slice(0, 300);
    if (isWalkover !== undefined) {
        if (isWalkover) match.voidPredictions = true;
        else if (match.isWalkover && voidPredictions === undefined) match.voidPredictions = false;
        match.isWalkover = !!isWalkover;
    }
    if (voidPredictions !== undefined) match.voidPredictions = !!voidPredictions;
    await match.save();
    // Złoty Kask / anulowanie zmieniają punktację, więc od razu przeliczamy
    await recalcMatch(match, season);
    res.json({ message: `Mecz zaktualizowany${msgs.length ? ': ' + msgs.join(', ') : ''}.` });
}));

router.post('/match-add', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const { round, homeTeam, awayTeam, matchDate, isMatchOfTheRound } = req.body || {};
    if (!round || !homeTeam || !awayTeam || !matchDate) return res.status(400).json({ error: 'Uzupełnij kolejkę, drużyny i datę.' });
    if (homeTeam === awayTeam) return res.status(400).json({ error: 'Drużyna nie może grać sama ze sobą.' });
    const r = Number(round);
    if (!Number.isInteger(r) || r < 1 || r > 99) return res.status(400).json({ error: 'Numer kolejki musi być liczbą 1-99.' });
    const date = new Date(matchDate);
    if (isNaN(date.getTime())) return res.status(400).json({ error: 'Niepoprawna data.' });
    const exists = await Match.findOne({ season: season.year, round: r, homeTeam, awayTeam });
    if (exists) return res.status(400).json({ error: `Ten mecz jest już w kolejce ${r} — zmień jego termin w edycji meczu.` });
    await Match.create({ season: season.year, round: r, homeTeam, awayTeam, matchDate: date, isMatchOfTheRound: !!isMatchOfTheRound });
    if (season.teams && season.teams.length && (!season.teams.includes(homeTeam) || !season.teams.includes(awayTeam))) {
        season.teams = [...new Set([...season.teams, homeTeam, awayTeam])];
        await season.save();
    }
    res.json({ message: `Mecz ${homeTeam} – ${awayTeam} dodany do kolejki ${r}.` });
}));

router.post('/match-delete', wrap(async (req, res) => {
    const { matchId } = req.body || {};
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu.' });
    await Prediction.deleteMany({ season: match.season, matchId: String(match._id) });
    await Match.deleteOne({ _id: match._id });
    await ResultDraft.deleteMany({ matchId: String(match._id) });
    res.json({ message: 'Mecz i powiązane typy usunięte.' });
}));

/** Czyszczenie rund od podanego numeru w górę (np. błędna faza play-off). */
router.post('/clean-rounds', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const from = Number(req.body.from || 15);
    const matches = await Match.find({ season: season.year, round: { $gte: from } }).select('_id');
    const ids = matches.map(m => String(m._id));
    await Prediction.deleteMany({ season: season.year, matchId: { $in: ids } });
    await ResultDraft.deleteMany({ matchId: { $in: ids } });
    await Match.deleteMany({ season: season.year, round: { $gte: from } });
    res.json({ message: `Usunięto ${ids.length} meczów od kolejki ${from} wraz z typami.` });
}));

/* ================= GRACZE ================= */

router.post('/player', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const fullName = String(req.body.fullName || '').trim();
    const nickname = String(req.body.nickname || '').trim();
    if (!nickname) return res.status(400).json({ error: 'Pseudonim jest wymagany.' });
    if (nickname.length > 30) return res.status(400).json({ error: 'Pseudonim może mieć najwyżej 30 znaków.' });

    let player = await Player.findOne({ nickname });
    if (!player) {
        player = await Player.create({
            fullName, nickname,
            token: crypto.randomBytes(12).toString('hex'),
            seasons: [season.year]
        });
    } else {
        if (fullName) player.fullName = fullName;
        if (!player.token) player.token = crypto.randomBytes(12).toString('hex');
        if (!player.seasons.includes(season.year)) player.seasons.push(season.year);
        player.isActive = true;
        await player.save();
    }
    res.json({ message: `Gracz ${nickname} zapisany.`, token: player.token });
}));

router.get('/players', wrap(async (req, res) => {
    const players = await Player.find().sort({ nickname: 1 });
    res.json(players.map(p => ({
        nickname: p.nickname, fullName: p.fullName, token: p.token,
        isActive: p.isActive, seasons: p.seasons, lastSeenAt: p.lastSeenAt || null
    })));
}));

router.post('/player/token', wrap(async (req, res) => {
    const player = await Player.findOne({ nickname: req.body.nickname });
    if (!player) return res.status(404).json({ error: 'Nie ma takiego gracza.' });
    player.token = crypto.randomBytes(12).toString('hex');
    await player.save();
    res.json({ message: `Nowy link dla ${player.nickname} wygenerowany (stary przestał działać).`, token: player.token });
}));

router.post('/player/toggle', wrap(async (req, res) => {
    const player = await Player.findOne({ nickname: req.body.nickname });
    if (!player) return res.status(404).json({ error: 'Nie ma takiego gracza.' });
    player.isActive = !player.isActive;
    await player.save();
    res.json({ message: `${player.nickname}: ${player.isActive ? 'aktywny' : 'wstrzymany'}.` });
}));

/**
 * Zmiana pseudonimu (i imienia). Pseudonim jest kluczem w typach, więc przenosimy go wszędzie:
 * typy, typy sezonowe, puchar i subskrypcje push. Link (token) gracza się nie zmienia.
 */
router.post('/player/rename', wrap(async (req, res) => {
    const { nickname, newNickname, fullName } = req.body || {};
    const player = await Player.findOne({ nickname });
    if (!player) return res.status(404).json({ error: 'Nie ma takiego gracza.' });
    const next = String(newNickname === undefined ? nickname : newNickname).trim();
    if (!next) return res.status(400).json({ error: 'Pseudonim nie może być pusty.' });
    if (next.length > 30) return res.status(400).json({ error: 'Pseudonim może mieć najwyżej 30 znaków.' });
    if (next !== nickname) {
        if (await Player.findOne({ nickname: next })) return res.status(409).json({ error: `Pseudonim „${next}” jest już zajęty.` });
        player.nickname = next;
        await Prediction.updateMany({ nickname }, { $set: { nickname: next } });
        await LongTerm.updateMany({ nickname }, { $set: { nickname: next } });
        await CupMatch.updateMany({ player1: nickname }, { $set: { player1: next } });
        await CupMatch.updateMany({ player2: nickname }, { $set: { player2: next } });
        await PushSubscription.updateMany({ nickname }, { $set: { nickname: next } });
    }
    if (fullName !== undefined) player.fullName = String(fullName).trim().slice(0, 80);
    await player.save();
    res.json({ message: next !== nickname ? `Zmieniono pseudonim: ${nickname} → ${next}. Typy i punkty przeniesione.` : 'Dane gracza zapisane.' });
}));

/** Zapisanie gracza do sezonu (albo wypisanie). */
router.post('/player/season', wrap(async (req, res) => {
    const { nickname, year, join } = req.body || {};
    const player = await Player.findOne({ nickname });
    if (!player) return res.status(404).json({ error: 'Nie ma takiego gracza.' });
    const y = Number(year);
    if (join === false) player.seasons = player.seasons.filter(s => s !== y);
    else if (!player.seasons.includes(y)) player.seasons.push(y);
    await player.save();
    res.json({ message: `${nickname}: sezony ${player.seasons.join(', ') || '-'}` });
}));

router.post('/delete-player', wrap(async (req, res) => {
    const { nickname, onlySeason } = req.body || {};
    if (!nickname) return res.status(400).json({ error: 'Nie podano gracza.' });
    if (onlySeason) {
        const y = Number(onlySeason);
        await Prediction.deleteMany({ season: y, nickname });
        await LongTerm.deleteMany({ season: y, nickname });
        await Player.updateOne({ nickname }, { $pull: { seasons: y } });
        return res.json({ message: `${nickname} usunięty z sezonu ${y} (historia innych sezonów zostaje).` });
    }
    await Player.deleteOne({ nickname });
    await Prediction.deleteMany({ nickname });
    await LongTerm.deleteMany({ nickname });
    await PushSubscription.deleteMany({ nickname });
    res.json({ message: `Gracz ${nickname} usunięty wraz z całą historią.` });
}));

/* ================= TYPY ================= */

/** Pełne typy sezonu (bez maskowania) - tylko dla admina. */
router.get('/predictions', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const preds = await Prediction.find({ season: season.year }).lean();
    res.json(preds.map(p => ({ nickname: p.nickname, matchId: p.matchId, homePred: p.homePred, awayPred: p.awayPred, usedJoker: !!p.usedJoker, pointsEarned: p.pointsEarned ?? null, source: p.source })));
}));

router.post('/predict', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const { nickname, matchId, homePred, awayPred, usedJoker } = req.body || {};
    if (!nickname || !matchId) return res.status(400).json({ error: 'Wybierz gracza i mecz.' });
    const h = clampScore(homePred), a = clampScore(awayPred);
    if (h === null || a === null) return res.status(400).json({ error: `Typ musi być liczbą 0-${MAX_SCORE}.` });

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu.' });
    if (!(await Player.findOne({ nickname }))) return res.status(404).json({ error: 'Nie ma takiego gracza.' });

    if (usedJoker) {
        await Prediction.updateMany(
            { season: season.year, nickname, matchId: { $ne: String(matchId) }, usedJoker: true },
            { $set: { usedJoker: false } }
        );
    }
    await Prediction.findOneAndUpdate(
        { season: season.year, nickname, matchId: String(matchId) },
        { homePred: h, awayPred: a, usedJoker: !!usedJoker, source: 'admin' },
        { upsert: true }
    );

    const s = await Season.findOne({ year: season.year });
    if (match.homeScore !== null) await recalcMatch(match, s);
    await recalcSeason(season.year); // joker mógł się przenieść
    res.json({ message: `Typ ${nickname} na ${match.homeTeam} - ${match.awayTeam} zapisany.` });
}));

router.post('/predict-delete', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const { nickname, matchId } = req.body || {};
    await Prediction.deleteOne({ season: season.year, nickname, matchId: String(matchId) });
    res.json({ message: 'Typ usunięty.' });
}));

router.post('/longterm', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const { nickname, champion, bronze, relegation } = req.body || {};
    if (!nickname) return res.status(400).json({ error: 'Wybierz gracza.' });
    const picked = [champion, bronze, relegation].filter(Boolean);
    if (new Set(picked).size !== picked.length) return res.status(400).json({ error: 'Typy sezonowe muszą wskazywać trzy różne drużyny.' });
    await LongTerm.findOneAndUpdate(
        { season: season.year, nickname },
        { champion: champion || '', bronze: bronze || '', relegation: relegation || '' },
        { upsert: true }
    );
    res.json({ message: `Typy sezonowe gracza ${nickname} zapisane.` });
}));

router.post('/recalculate', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const out = await recalcSeason(season.year);
    res.json({ message: `Przeliczono ${out.predictions} typów sezonu ${season.year} (zmian: ${out.changed}).` });
}));

/** Zapasowe czyszczenie duplikatów (po v2 nie powinny już powstawać). */
router.post('/fix-duplicates', wrap(async (req, res) => {
    const all = await Prediction.find().sort({ updatedAt: -1, _id: -1 });
    const seen = new Set();
    let deleted = 0;
    for (const p of all) {
        const key = `${p.season}_${p.nickname}_${p.matchId}`;
        if (seen.has(key)) { await Prediction.deleteOne({ _id: p._id }); deleted++; }
        else seen.add(key);
    }
    // Jeden joker na sezon
    const players = await Player.find().select('nickname');
    let jokersFixed = 0;
    const seasons = await Season.find().select('year');
    for (const s of seasons) {
        for (const pl of players) {
            const jokers = await Prediction.find({ season: s.year, nickname: pl.nickname, usedJoker: true }).sort({ updatedAt: -1 });
            for (const extra of jokers.slice(1)) {
                extra.usedJoker = false;
                await extra.save();
                jokersFixed++;
            }
        }
    }
    res.json({ message: `Usunięto ${deleted} duplikatów, poprawiono ${jokersFixed} nadmiarowych jokerów.` });
}));

/* ================= PUCHAR TYPERÓW ================= */

router.post('/cup-match', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const { stage, roundNumber, player1, player2, score1, score2, autoScore } = req.body || {};
    if (!stage || !player1 || !player2) return res.status(400).json({ error: 'Podaj fazę i obu graczy.' });
    if (player1 === player2) return res.status(400).json({ error: 'Gracz nie może grać sam ze sobą.' });
    const badScore = v => v !== '' && v !== undefined && v !== null && !(Number.isFinite(Number(v)) && Number(v) >= 0);
    if (badScore(score1) || badScore(score2)) return res.status(400).json({ error: 'Punkty muszą być liczbą nieujemną.' });
    await CupMatch.findOneAndUpdate(
        { season: season.year, stage, player1, player2 },
        {
            roundNumber: Number(roundNumber) || null,
            score1: score1 === '' || score1 === undefined ? null : Number(score1),
            score2: score2 === '' || score2 === undefined ? null : Number(score2),
            autoScore: autoScore !== false
        },
        { upsert: true }
    );
    res.json({ message: 'Para pucharowa zapisana.' });
}));

router.post('/cup-delete', wrap(async (req, res) => {
    await CupMatch.deleteOne({ _id: req.body.id });
    res.json({ message: 'Para usunięta.' });
}));

/** Automatyczne policzenie wyników H2H na podstawie punktów z danej kolejki. */
router.post('/cup-autoscore', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const cups = await CupMatch.find({ season: season.year, autoScore: true });
    const matches = await Match.find({ season: season.year });
    const preds = await Prediction.find({ season: season.year });

    const roundOf = {};
    matches.forEach(m => { roundOf[String(m._id)] = m.round; });
    const sum = (nick, round) => preds
        .filter(p => p.nickname === nick && roundOf[p.matchId] === round && p.pointsEarned !== null)
        .reduce((acc, p) => acc + p.pointsEarned, 0);

    let updated = 0;
    for (const c of cups) {
        if (!c.roundNumber) continue;
        c.score1 = sum(c.player1, c.roundNumber);
        c.score2 = sum(c.player2, c.roundNumber);
        await c.save();
        updated++;
    }
    res.json({ message: `Przeliczono ${updated} par pucharowych z punktów kolejek.` });
}));

/** Automatyczne rozstawienie drabinki wg aktualnego rankingu (1 vs 8, 2 vs 7...). */
router.post('/cup-generate', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const { stage, roundNumber, count } = req.body || {};
    if (!stage || !roundNumber) return res.status(400).json({ error: 'Podaj fazę i numer kolejki.' });

    const [matches, preds, players, longTerms] = await Promise.all([
        Match.find({ season: season.year }),
        Prediction.find({ season: season.year }),
        Player.find({ seasons: season.year, isActive: true }).select('nickname'),
        LongTerm.find({ season: season.year })
    ]);
    const stats = S.buildPlayerStats({ players, predictions: preds, matches, longTerms });
    const pool = stats.slice(0, Number(count) || stats.length);
    if (pool.length < 2) return res.status(400).json({ error: 'Za mało graczy w rankingu.' });

    let created = 0;
    for (let i = 0; i < Math.floor(pool.length / 2); i++) {
        const p1 = pool[i].nickname, p2 = pool[pool.length - 1 - i].nickname;
        await CupMatch.findOneAndUpdate(
            { season: season.year, stage, player1: p1, player2: p2 },
            { roundNumber: Number(roundNumber), autoScore: true, score1: null, score2: null },
            { upsert: true }
        );
        created++;
    }
    res.json({ message: `Rozstawiono ${created} par (${stage}) na kolejkę ${roundNumber}.` });
}));

/* ================= WYNIKI ZE SCRAPERA (DRAFTY) ================= */

router.get('/drafts', wrap(async (req, res) => {
    const status = req.query.status || 'draft';
    const drafts = await ResultDraft.find(status === 'all' ? {} : { status }).sort({ createdAt: -1 }).lean();
    const list = drafts.slice(0, 100);
    const matches = await Match.find({ _id: { $in: list.map(d => d.matchId) } }).lean();
    const byId = S.indexMatches(matches);
    res.json(list.map(d => {
        const m = byId[d.matchId];
        return {
            ...d,
            match: m ? {
                _id: String(m._id), round: m.round, homeTeam: m.homeTeam, awayTeam: m.awayTeam, matchDate: m.matchDate,
                homeScore: m.homeScore, awayScore: m.awayScore, isMatchOfTheRound: m.isMatchOfTheRound
            } : null
        };
    }));
}));

async function approveDraft(draft, override = {}) {
    const match = await Match.findById(draft.matchId);
    if (!match) throw Object.assign(new Error('Mecz z draftu już nie istnieje.'), { status: 404 });
    const h = clampScore(override.homeScore ?? draft.homeScore);
    const a = clampScore(override.awayScore ?? draft.awayScore);
    if (h === null || a === null) throw Object.assign(new Error(`Wynik musi być liczbą 0-${MAX_SCORE}.`), { status: 400 });
    const corrected = h !== draft.homeScore || a !== draft.awayScore;
    if ((draft.blockers || []).length && !corrected && !override.force) {
        throw Object.assign(new Error('Ten wynik nie przeszedł kontroli (patrz uwagi). Popraw liczby albo zatwierdź świadomie.'), { status: 409 });
    }
    const n = await applyResult(match, h, a, { source: corrected ? 'admin' : 'scraper', notify: override.notify !== false });
    await ResultDraft.updateOne({ _id: draft._id }, { $set: {
        status: 'approved', decidedAt: new Date(), homeScore: h, awayScore: a,
        ...(corrected ? { scrapedHome: draft.homeScore, scrapedAway: draft.awayScore } : {})
    } });
    // inne drafty tego meczu tracą sens
    await ResultDraft.updateMany({ matchId: draft.matchId, status: 'draft', _id: { $ne: draft._id } }, { $set: { status: 'rejected', decidedAt: new Date() } });
    return { match, h, a, n };
}

/** Zatwierdzenie jednego draftu (opcjonalnie z poprawionym wynikiem). */
router.post('/drafts/approve', wrap(async (req, res) => {
    const { id, homeScore, awayScore, force, notify } = req.body || {};
    const draft = await ResultDraft.findById(id);
    if (!draft || draft.status !== 'draft') return res.status(404).json({ error: 'Draft nie istnieje albo został już rozpatrzony.' });
    try {
        const out = await approveDraft(draft, { homeScore, awayScore, force, notify });
        res.json({ message: `Zatwierdzono ${out.match.homeTeam} – ${out.match.awayTeam} ${out.h}:${out.a}. Przeliczono ${out.n} typów.` });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message });
    }
}));

/**
 * "Zatwierdź wszystkie bez uwag": tylko drafty bez blokerów I bez ostrzeżeń (najczęstszy przypadek: jeden klik po kolejce).
 * Draft z ostrzeżeniem (np. źródła podają różne wyniki) admin zatwierdza pojedynczo - po rzuceniu okiem na fragment ze źródła.
 */
router.post('/drafts/approve-all', wrap(async (req, res) => {
    const drafts = await ResultDraft.find({ status: 'draft' });
    let ok = 0, skipped = 0;
    for (const d of drafts) {
        if ((d.blockers || []).length || (d.warnings || []).length) { skipped++; continue; }
        try { await approveDraft(d, { notify: req.body.notify !== false }); ok++; } catch (e) { skipped++; }
    }
    res.json({ message: `Zatwierdzono ${ok} wyników${skipped ? `, pominięto ${skipped} (wymagają ręcznej weryfikacji)` : ''}.` });
}));

router.post('/drafts/reject', wrap(async (req, res) => {
    const draft = await ResultDraft.findById(req.body.id);
    if (!draft) return res.status(404).json({ error: 'Nie ma takiego draftu.' });
    await ResultDraft.updateOne({ _id: draft._id }, { $set: { status: 'rejected', decidedAt: new Date() } });
    res.json({ message: 'Draft odrzucony. Ten sam wynik nie wróci przy kolejnym pobraniu.' });
}));

/* ================= ZADANIA W TLE ================= */

router.get('/jobs', wrap(async (req, res) => {
    const runs = await JobRun.find().sort({ createdAt: -1 }).lean();
    res.json({
        runs: runs.slice(0, 20).map(r => ({ job: r.job, ok: r.ok, summary: r.summary, createdAt: r.createdAt, details: r.details })),
        push: { enabled: push.isConfigured(), source: push.keySource(), subscriptions: await PushSubscription.countDocuments({}), admins: await PushSubscription.countDocuments({ isAdmin: true }) },
        scraper: { envUrls: String(process.env.SCRAPER_URLS || '').split(/[\s,]+/).filter(Boolean) }
    });
}));

router.post('/jobs/scrape', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const out = await scrapeJob({ season });
    res.json({ message: `Scraper: ${out.summary}`, ...out });
}));

router.post('/jobs/reminders', wrap(async (req, res) => {
    const out = await reminderJob();
    res.json({ message: `Przypomnienia: ${out.summary}` });
}));

/* ================= POWIADOMIENIA ADMINA ================= */

router.post('/push/subscribe', wrap(async (req, res) => {
    if (!push.isConfigured()) return res.status(503).json({ error: 'Powiadomienia push są wyłączone na serwerze (brak kluczy VAPID).' });
    try { await push.saveSubscription(req.body.subscription, { isAdmin: true, userAgent: req.headers['user-agent'] }); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    res.json({ message: 'To urządzenie dostanie powiadomienia admina (nowe wyniki do zatwierdzenia).' });
}));

router.post('/push/test', wrap(async (req, res) => {
    const { nickname } = req.body || {};
    const payload = { title: '🏍️ Test powiadomień', body: 'Jeśli to widzisz, powiadomienia działają.', url: nickname ? '/' : '/admin' };
    const n = nickname ? await push.notifyPlayer(nickname, payload) : await push.notifyAdmins(payload);
    res.json({ message: `Wysłano ${n} powiadomień.` });
}));

/* ================= KOPIA ZAPASOWA ================= */

router.get('/backup', wrap(async (req, res) => {
    const data = {
        exportedAt: new Date().toISOString(),
        version: 3,
        seasons: await Season.find(),
        players: await Player.find(),
        matches: await Match.find(),
        predictions: await Prediction.find(),
        longTerms: await LongTerm.find(),
        cupMatches: await CupMatch.find()
    };
    res.setHeader('Content-Disposition', `attachment; filename="typer-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
}));

/** Przywrócenie z kopii. mode=merge (domyślnie) albo mode=replace. */
router.post('/restore', wrap(async (req, res) => {
    const { backup, mode } = req.body || {};
    if (!backup || !Array.isArray(backup.matches)) return res.status(400).json({ error: 'To nie wygląda na plik kopii zapasowej.' });
    if (mode === 'replace') {
        await Promise.all([
            Season.deleteMany({}), Player.deleteMany({}), Match.deleteMany({}),
            Prediction.deleteMany({}), LongTerm.deleteMany({}), CupMatch.deleteMany({})
        ]);
    }
    const insert = async (Model, rows) => {
        for (const row of (rows || [])) {
            const doc = { ...row };
            delete doc.__v;
            await Model.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
        }
    };
    await insert(Season, backup.seasons);
    await insert(Player, backup.players);
    await insert(Match, backup.matches);
    await insert(Prediction, backup.predictions);
    await insert(LongTerm, backup.longTerms);
    await insert(CupMatch, backup.cupMatches);
    res.json({ message: 'Kopia przywrócona.' });
}));

module.exports = router;
