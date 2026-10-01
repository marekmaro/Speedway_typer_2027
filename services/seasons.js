const { Season, Match, Prediction, LongTerm, CupMatch, Player } = require('../models/Database');
const { LEGACY_SEASON, DEFAULT_STAGE_NAMES } = require('../config');
const { settle, scoringOf, uniqueTeams, stageNamesOf, indexMatches } = require('./scoring');

/** Aktywny sezon; jeśli baza jest pusta, tworzy go automatycznie. */
async function getActiveSeason() {
    let season = await Season.findOne({ isActive: true });
    if (!season) {
        season = await Season.findOne().sort({ year: -1 });
        if (season) { season.isActive = true; await season.save(); }
    }
    if (!season) {
        season = await Season.create({
            year: LEGACY_SEASON,
            label: `Ekstraliga ${LEGACY_SEASON}`,
            isActive: true,
            stageNames: DEFAULT_STAGE_NAMES
        });
    }
    return season;
}

/** Sezon z zapytania (?season=2026) albo aktywny. */
async function resolveSeason(req) {
    const year = Number(req.query.season || req.body?.season);
    if (year) {
        const s = await Season.findOne({ year });
        if (s) return s;
    }
    return getActiveSeason();
}

/**
 * Jednorazowa migracja z wersji 1: stare dokumenty nie mają pola "season".
 * Odpala się sama przy starcie serwera, więc nie musisz nic klikać.
 */
async function bootstrap() {
    const orphanMatches = await Match.countDocuments({ season: { $in: [null, undefined] } });
    const orphanPreds = await Prediction.countDocuments({ season: { $in: [null, undefined] } });
    const orphanLt = await LongTerm.countDocuments({ season: { $in: [null, undefined] } });
    const orphanCup = await CupMatch.countDocuments({ season: { $in: [null, undefined] } });
    const total = orphanMatches + orphanPreds + orphanLt + orphanCup;

    if (total > 0) {
        await Match.updateMany({ season: { $in: [null, undefined] } }, { $set: { season: LEGACY_SEASON } });
        await Prediction.updateMany({ season: { $in: [null, undefined] } }, { $set: { season: LEGACY_SEASON } });
        await LongTerm.updateMany({ season: { $in: [null, undefined] } }, { $set: { season: LEGACY_SEASON } });
        await CupMatch.updateMany({ season: { $in: [null, undefined] } }, { $set: { season: LEGACY_SEASON } });
        console.log(`🔁 Migracja v1 -> v2: ${total} dokumentów przypisano do sezonu ${LEGACY_SEASON}.`);
    }

    const season = await getActiveSeason();
    if (!season.teams || season.teams.length === 0) {
        const matches = await Match.find({ season: season.year }).select('homeTeam awayTeam');
        if (matches.length) {
            season.teams = uniqueTeams(matches);
            await season.save();
            console.log(`🏁 Sezon ${season.year}: wykryto ${season.teams.length} drużyn z terminarza.`);
        }
    }
    if (Object.keys(stageNamesOf(season)).length === 0) {
        season.stageNames = DEFAULT_STAGE_NAMES;
        await season.save();
    }

    // Gracze bez przypisanego sezonu
    await Player.updateMany({ seasons: { $size: 0 } }, { $set: { seasons: [season.year] } });

    // Ostrzeżenie o zdublowanych meczach (zdarzało się w wersji 1 przy wgrywaniu play-off)
    try {
        const dups = await Match.aggregate([
            { $group: { _id: { s: '$season', r: '$round', h: '$homeTeam', a: '$awayTeam' }, n: { $sum: 1 } } },
            { $match: { n: { $gt: 1 } } }
        ]);
        if (dups.length) {
            console.warn(`⚠️  W bazie jest ${dups.length} zdublowanych meczów — usuń nadmiarowe w panelu (zakładka Terminarz), inaczej indeks unikalny się nie zbuduje.`);
            dups.slice(0, 10).forEach(d => console.warn(`   • S${d._id.s} R${d._id.r}: ${d._id.h} vs ${d._id.a} (x${d.n})`));
        }
    } catch (e) { /* aggregate nie jest krytyczne */ }

    return season;
}

/**
 * Zapisuje punkty tylko tam, gdzie się zmieniły - jednym bulkWrite zamiast N zapisów.
 * Przy 30 graczach i 4 meczach kolejki to 1 zapytanie zamiast 120.
 */
async function applySettlement(preds, byId, scoring) {
    const ops = [];
    for (const p of preds) {
        const next = settle(p, byId[p.matchId], scoring);
        if (p.pointsEarned !== next.pointsEarned || (p.outcome || null) !== next.outcome) {
            ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: next } } });
        }
    }
    if (ops.length) await Prediction.bulkWrite(ops, { ordered: false });
    return ops.length;
}

/** Przeliczenie punktów dla jednego meczu. */
async function recalcMatch(match, season) {
    const scoring = scoringOf(season);
    const preds = await Prediction.find({ season: match.season, matchId: String(match._id) })
        .select('_id matchId homePred awayPred usedJoker pointsEarned outcome').lean();
    await applySettlement(preds, { [String(match._id)]: match }, scoring);
    return preds.length;
}

/** Przeliczenie całego sezonu od zera. */
async function recalcSeason(year) {
    const season = await Season.findOne({ year });
    const scoring = scoringOf(season);
    const matches = await Match.find({ season: year }).lean();
    const preds = await Prediction.find({ season: year })
        .select('_id matchId homePred awayPred usedJoker pointsEarned outcome').lean();
    const changed = await applySettlement(preds, indexMatches(matches), scoring);
    return { predictions: preds.length, changed };
}

/** Rozliczenie typów długoterminowych po zakończeniu sezonu. */
async function resolveLongTerm(year, results) {
    const season = await Season.findOne({ year });
    const scoring = scoringOf(season);
    const bets = await LongTerm.find({ season: year });
    let awarded = 0;
    for (const bet of bets) {
        let earned = 0;
        if (results.champion && bet.champion === results.champion) earned += scoring.longTermEach;
        if (results.bronze && bet.bronze === results.bronze) earned += scoring.longTermEach;
        if (results.relegation && bet.relegation === results.relegation) earned += scoring.longTermEach;
        bet.pointsEarned = earned;
        await bet.save();
        awarded += earned;
    }
    if (season) {
        season.results = {
            champion: results.champion || '',
            bronze: results.bronze || '',
            relegation: results.relegation || ''
        };
        await season.save();
    }
    return { players: bets.length, awarded };
}

module.exports = { getActiveSeason, resolveSeason, bootstrap, recalcMatch, recalcSeason, resolveLongTerm };
