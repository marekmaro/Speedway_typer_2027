/* ------------------------------------------------------------------
   Jedno miejsce, w którym wynik trafia do meczu - bez względu na to,
   czy wpisał go admin ręcznie, czy zatwierdził draft ze scrapera.
------------------------------------------------------------------- */
const { Season, Prediction } = require('../models/Database');
const { recalcMatch } = require('./seasons');
const push = require('./push');
const S = require('./scoring');
const { shortName } = require('./names');

/**
 * Zapisuje wynik, przelicza typy meczu i (opcjonalnie) wysyła graczom push z ich punktami.
 * opts: { source: 'admin'|'scraper', walkover, notify }
 */
async function applyResult(match, homeScore, awayScore, opts = {}) {
    match.homeScore = homeScore;
    match.awayScore = awayScore;
    match.isPostponed = false;
    match.resultSource = opts.source || 'admin';
    match.resultConfirmedAt = new Date();
    if (opts.walkover !== undefined) {
        // Walkower: tabela ligi liczy wynik, ale typów nie rozliczamy (joker wraca do gracza)
        if (opts.walkover) match.voidPredictions = true;
        else if (match.isWalkover) match.voidPredictions = false; // cofnięcie walkowera
        match.isWalkover = !!opts.walkover;
    }
    await match.save();
    const season = await Season.findOne({ year: match.season });
    const n = await recalcMatch(match, season);
    if (opts.notify) notifyResult(match).catch(e => console.warn('⚠️  push wyniku:', e.message));
    return n;
}

/** Push do każdego gracza, który typował mecz: "Motor – Sparta 52:38 · +5 pkt". */
async function notifyResult(match) {
    if (!push.isConfigured()) return 0;
    if (!(await push.onceOnly(`result:${match._id}:${match.homeScore}:${match.awayScore}`))) return 0;
    const preds = await Prediction.find({ matchId: String(match._id) }).lean();
    const title = `🏁 ${S.isSettled(match) ? 'Wynik' : 'Mecz'}: ${shortName(match.homeTeam)} – ${shortName(match.awayTeam)}`;
    let sent = 0;
    for (const p of preds) {
        const body = match.voidPredictions
            ? `${match.homeScore}:${match.awayScore} — typy anulowane (walkower).`
            : `${match.homeScore}:${match.awayScore} · Twój typ ${p.homePred}:${p.awayPred} · +${p.pointsEarned || 0} pkt`;
        sent += await push.notifyPlayer(p.nickname, { title, body, url: '/', tag: `result-${match._id}` });
    }
    return sent;
}

async function clearResult(match) {
    // Bez wyniku nie ma walkowera - przy okazji przywracamy rozliczanie typów
    if (match.isWalkover) { match.isWalkover = false; match.voidPredictions = false; }
    match.homeScore = null;
    match.awayScore = null;
    match.resultSource = null;
    match.resultConfirmedAt = null;
    await match.save();
    await Prediction.updateMany({ matchId: String(match._id) }, { $set: { pointsEarned: null, outcome: null } });
}

module.exports = { applyResult, clearResult, notifyResult };
