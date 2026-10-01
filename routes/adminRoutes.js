const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Season, Match, Prediction, Player, LongTerm, CupMatch } = require('../models/Database');
const { login, logout, requireAdmin } = require('../middleware/auth');
const { getActiveSeason, recalcMatch, recalcSeason, resolveLongTerm } = require('../services/seasons');
const { generateSchedule } = require('../services/schedule');
const S = require('../services/scoring');
const { MAX_SCORE, DEFAULT_STAGE_NAMES } = require('../config');

const wrap = fn => (req, res) => fn(req, res).catch(err => {
    console.error('❌ adminRoutes:', err);
    res.status(500).json({ error: err.message || 'Błąd serwera.' });
});

// ---- logowanie ----
router.post('/login', login);
router.post('/logout', logout);
router.use(requireAdmin);

router.get('/whoami', (req, res) => res.json({ ok: true }));

async function seasonOf(req) {
    const year = Number(req.body?.season || req.query?.season);
    if (year) {
        const s = await Season.findOne({ year });
        if (s) return s;
    }
    return getActiveSeason();
}

const clampScore = v => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > MAX_SCORE) return null;
    return n;
};

/* ================= SEZONY ================= */

router.get('/seasons', wrap(async (req, res) => {
    const seasons = await Season.find().sort({ year: -1 });
    const out = [];
    for (const s of seasons) {
        out.push({
            year: s.year, label: s.label, isActive: s.isActive, isFinished: s.isFinished,
            lockHours: s.lockHours, scoring: S.scoringOf(s), teams: s.teams,
            stageNames: S.stageNamesOf(s),
            results: s.results,
            matches: await Match.countDocuments({ season: s.year }),
            predictions: await Prediction.countDocuments({ season: s.year })
        });
    }
    res.json(out);
}));

/** Tworzy lub aktualizuje sezon. */
router.post('/season', wrap(async (req, res) => {
    const { year, label, teams, lockHours, scoring, stageNames, copyPlayers, activate } = req.body || {};
    const y = Number(year);
    if (!y || y < 2000 || y > 2100) return res.status(400).json({ error: 'Podaj poprawny rok sezonu.' });

    const payload = {};
    if (label !== undefined) payload.label = label || `Ekstraliga ${y}`;
    if (Array.isArray(teams)) payload.teams = teams.map(t => String(t).trim()).filter(Boolean);
    if (lockHours !== undefined) payload.lockHours = Math.max(1, Math.min(240, Number(lockHours) || 24));
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
    const { champion, bronze, relegation, markFinished } = req.body || {};
    const out = await resolveLongTerm(season.year, { champion, bronze, relegation });
    if (markFinished) {
        season.isFinished = true;
        await season.save();
    }
    res.json({ message: `Rozliczono ${out.players} graczy (przyznano ${out.awarded} pkt).` });
}));

router.post('/season/reopen', wrap(async (req, res) => {
    const season = await seasonOf(req);
    season.isFinished = false;
    await season.save();
    res.json({ message: `Sezon ${season.year} znów otwarty do edycji.` });
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
    const { matchId, homeScore, awayScore, clear } = req.body || {};
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu.' });
    const season = await Season.findOne({ year: match.season });

    if (clear) {
        match.homeScore = null;
        match.awayScore = null;
        await match.save();
        await Prediction.updateMany({ season: match.season, matchId: String(match._id) }, { $set: { pointsEarned: null } });
        return res.json({ message: 'Wynik wyczyszczony, punkty wycofane.' });
    }

    const h = clampScore(homeScore), a = clampScore(awayScore);
    if (h === null || a === null) return res.status(400).json({ error: `Wynik musi być liczbą 0-${MAX_SCORE}.` });
    match.homeScore = h;
    match.awayScore = a;
    match.isPostponed = false;
    await match.save();
    const n = await recalcMatch(match, season);
    res.json({ message: `Wynik ${h}:${a} zapisany. Przeliczono ${n} typów.` });
}));

/** Wpisanie wyników całej kolejki jednym strzałem. */
router.post('/results-bulk', wrap(async (req, res) => {
    const { results } = req.body || {};
    if (!Array.isArray(results)) return res.status(400).json({ error: 'Brak danych.' });
    let ok = 0;
    for (const r of results) {
        const h = clampScore(r.homeScore), a = clampScore(r.awayScore);
        if (h === null || a === null) continue;
        const match = await Match.findById(r.matchId);
        if (!match) continue;
        match.homeScore = h; match.awayScore = a; match.isPostponed = false;
        await match.save();
        const season = await Season.findOne({ year: match.season });
        await recalcMatch(match, season);
        ok++;
    }
    res.json({ message: `Zapisano wyniki ${ok} meczów i przeliczono punkty.` });
}));

router.post('/match-edit', wrap(async (req, res) => {
    const { matchId, isMatchOfTheRound, isPostponed, matchDate, note } = req.body || {};
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu.' });
    if (matchDate) {
        const d = new Date(matchDate);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'Niepoprawna data.' });
        match.matchDate = d;
    }
    if (isMatchOfTheRound !== undefined) match.isMatchOfTheRound = !!isMatchOfTheRound;
    if (isPostponed !== undefined) match.isPostponed = !!isPostponed;
    if (note !== undefined) match.note = String(note);
    await match.save();
    // Złoty Kask zmienia punktację, więc od razu przeliczamy
    if (match.homeScore !== null) {
        const season = await Season.findOne({ year: match.season });
        await recalcMatch(match, season);
    }
    res.json({ message: 'Mecz zaktualizowany.' });
}));

router.post('/match-add', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const { round, homeTeam, awayTeam, matchDate } = req.body || {};
    if (!round || !homeTeam || !awayTeam || !matchDate) return res.status(400).json({ error: 'Uzupełnij kolejkę, drużyny i datę.' });
    await Match.updateOne(
        { season: season.year, round: Number(round), homeTeam, awayTeam },
        { $set: { matchDate: new Date(matchDate) } },
        { upsert: true }
    );
    res.json({ message: 'Mecz dodany do terminarza.' });
}));

router.post('/match-delete', wrap(async (req, res) => {
    const { matchId } = req.body || {};
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu.' });
    await Prediction.deleteMany({ season: match.season, matchId: String(match._id) });
    await Match.deleteOne({ _id: match._id });
    res.json({ message: 'Mecz i powiązane typy usunięte.' });
}));

/** Czyszczenie rund od podanego numeru w górę (np. błędna faza play-off). */
router.post('/clean-rounds', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const from = Number(req.body.from || 15);
    const matches = await Match.find({ season: season.year, round: { $gte: from } }).select('_id');
    const ids = matches.map(m => String(m._id));
    await Prediction.deleteMany({ season: season.year, matchId: { $in: ids } });
    await Match.deleteMany({ season: season.year, round: { $gte: from } });
    res.json({ message: `Usunięto ${ids.length} meczów od kolejki ${from} wraz z typami.` });
}));

/* ================= GRACZE ================= */

router.post('/player', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const fullName = String(req.body.fullName || '').trim();
    const nickname = String(req.body.nickname || '').trim();
    if (!nickname) return res.status(400).json({ error: 'Pseudonim jest wymagany.' });

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
        isActive: p.isActive, seasons: p.seasons
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
    res.json({ message: `Gracz ${nickname} usunięty wraz z całą historią.` });
}));

/* ================= TYPY ================= */

router.post('/predict', wrap(async (req, res) => {
    const season = await seasonOf(req);
    const { nickname, matchId, homePred, awayPred, usedJoker } = req.body || {};
    if (!nickname || !matchId) return res.status(400).json({ error: 'Wybierz gracza i mecz.' });
    const h = clampScore(homePred), a = clampScore(awayPred);
    if (h === null || a === null) return res.status(400).json({ error: `Typ musi być liczbą 0-${MAX_SCORE}.` });

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'Nie ma takiego meczu.' });

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

/* ================= KOPIA ZAPASOWA ================= */

router.get('/backup', wrap(async (req, res) => {
    const data = {
        exportedAt: new Date().toISOString(),
        version: 2,
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
