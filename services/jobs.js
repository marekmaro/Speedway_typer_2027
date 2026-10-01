/* ------------------------------------------------------------------
   Zadania w tle: scraper wyników i przypomnienia o typach.

   Na Render (plan darmowy) serwer zasypia po 15 min bez ruchu, więc setInterval
   nie wystarczy. Dlatego każde zadanie można też odpalić z zewnątrz:
   POST /api/cron/run  (nagłówek x-cron-secret) - np. z GitHub Actions co 30 min
   (gotowy workflow w .github/workflows/cron.yml). Wywołanie przy okazji budzi serwer.
------------------------------------------------------------------- */
const { Season, Match, Prediction, Player, PushSubscription, JobRun, ResultDraft } = require('../models/Database');
const { runScrape } = require('./scraper');
const push = require('./push');
const S = require('./scoring');
const { REMINDER_MINUTES } = require('../config');

const running = new Set();

/** Zabezpieczenie przed równoległym uruchomieniem tego samego zadania + zapis do dziennika. */
async function guarded(name, fn) {
    if (running.has(name)) return { ok: false, summary: 'Zadanie już trwa.' };
    running.add(name);
    try {
        const out = await fn();
        await JobRun.create({ job: name, ok: out.ok !== false, summary: out.summary, details: out }).catch(() => {});
        return out;
    } catch (e) {
        console.error(`❌ job ${name}:`, e);
        await JobRun.create({ job: name, ok: false, summary: e.message }).catch(() => {});
        return { ok: false, summary: e.message };
    } finally {
        running.delete(name);
    }
}

/** Scraper + powiadomienie admina, gdy pojawiły się wyniki do zatwierdzenia. */
function scrapeJob(opts = {}) {
    return guarded('scrape', async () => {
        const out = await runScrape(opts);
        if (out.created || out.updated) {
            const pending = await ResultDraft.countDocuments({ status: 'draft' });
            await push.notifyAdmins({
                title: '📥 Wyniki czekają na zatwierdzenie',
                body: `${(out.createdList || []).slice(0, 3).join(' · ')}${pending > 3 ? ` (+${pending - 3})` : ''}`,
                url: '/admin#drafts',
                tag: 'drafts',
                urgency: 'high'
            });
        } else if (out.sourceErrors && out.sourceErrors.length && out.ok === false) {
            // Wszystkie źródła padły - pewnie zmienił się układ strony. Raz dziennie wystarczy.
            const day = new Date().toISOString().slice(0, 10);
            if (await push.onceOnly(`scrape-broken:${day}`)) {
                await push.notifyAdmins({ title: '⚠️ Scraper nie działa', body: out.sourceErrors[0], url: '/admin#drafts', tag: 'scraper' });
            }
        }
        return out;
    });
}

/**
 * Przypomnienia: mecze, których blokada wypada w ciągu REMINDER_MINUTES, a gracz nie ma typu.
 * Jeden push na gracza (lista meczów), każdy mecz przypominany tylko raz (NotificationLog).
 */
function reminderJob(opts = {}) {
    return guarded('reminders', async () => {
        if (!push.isConfigured()) return { ok: true, summary: 'Push wyłączony (brak kluczy VAPID).' };
        const now = opts.now || Date.now();
        const season = await Season.findOne({ isActive: true });
        if (!season || season.isFinished) return { ok: true, summary: 'Brak aktywnego sezonu.' };
        const lockMinutes = S.lockMinutesOf(season);

        const matches = (await Match.find({ season: season.year, homeScore: null }).lean()).filter(m => {
            if (m.isPostponed || m.voidPredictions || m.predictionsFrozen) return false;
            const lock = S.lockTime(m, lockMinutes);
            return lock > now && lock <= now + REMINDER_MINUTES * 60 * 1000;
        });
        if (!matches.length) return { ok: true, summary: 'Brak meczów w oknie przypomnień.' };

        // Tylko gracze, którzy mają włączone powiadomienia
        const subscribed = new Set((await PushSubscription.find({ nickname: { $ne: null } }).select('nickname').lean()).map(s => s.nickname));
        const players = (await Player.find({ seasons: season.year, isActive: true }).lean()).filter(p => subscribed.has(p.nickname));
        if (!players.length) return { ok: true, summary: 'Nikt nie ma włączonych powiadomień.' };

        const preds = await Prediction.find({ season: season.year, matchId: { $in: matches.map(m => String(m._id)) } })
            .select('nickname matchId').lean();
        const has = new Set(preds.map(p => `${p.nickname}|${p.matchId}`));

        let sent = 0;
        for (const player of players) {
            const missing = [];
            for (const m of matches) {
                if (has.has(`${player.nickname}|${m._id}`)) continue;
                if (await push.onceOnly(`remind:${m._id}:${player.nickname}`)) missing.push(m);
            }
            if (!missing.length) continue;
            const first = missing.sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
            const mins = Math.max(1, Math.round((S.lockTime(first, lockMinutes) - now) / 60000));
            const left = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60 ? `${mins % 60} min` : ''}`.trim() : `${mins} min`;
            const list = missing.map(m => `${short(m.homeTeam)} – ${short(m.awayTeam)}`).join(', ');
            sent += await push.notifyPlayer(player.nickname, {
                title: `⏰ Za ${left} blokada typów!`,
                body: `Nie masz jeszcze typu: ${list}`,
                url: `/typuj.html?id=${player.token}`,
                tag: `remind-${first._id}`,
                urgency: 'high'
            });
        }
        return { ok: true, summary: `Mecze w oknie: ${matches.length}, wysłane przypomnienia: ${sent}.` };
    });
}

function short(name) {
    const parts = String(name || '').split(/\s+/);
    return parts.length > 2 ? parts.slice(-2).join(' ') : name;
}

/** setInterval dla serwera, który nie śpi (płatny plan / własny VPS / lokalnie). */
function startScheduler() {
    if (process.env.ENABLE_SCHEDULER === 'false') return;
    const scrapeEvery = Number(process.env.SCRAPE_INTERVAL_MINUTES || 60);
    setInterval(() => reminderJob().catch(() => {}), 10 * 60 * 1000).unref();
    setInterval(() => scrapeJob().catch(() => {}), scrapeEvery * 60 * 1000).unref();
    setTimeout(() => reminderJob().catch(() => {}), 30 * 1000).unref();
    console.log(`⏱️  Zadania w tle: przypomnienia co 10 min, scraper co ${scrapeEvery} min.`);
}

module.exports = { scrapeJob, reminderJob, startScheduler };
