/* ------------------------------------------------------------------
   Wyzwalacz zadań z zewnątrz (GitHub Actions, cron-job.org, Render Cron Job).
   Chroniony sekretem CRON_SECRET. Przy okazji budzi uśpiony serwer na Render.
------------------------------------------------------------------- */
const express = require('express');
const crypto = require('crypto');
const { scrapeJob, reminderJob } = require('../services/jobs');
const cache = require('../services/cache');

const router = express.Router();

function authorized(req) {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;
    const given = String(req.headers['x-cron-secret'] || req.query.key || '');
    const a = Buffer.from(given), b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/run', async (req, res) => {
    if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'Ustaw CRON_SECRET, aby włączyć zewnętrzny wyzwalacz.' });
    if (!authorized(req)) return res.status(401).json({ error: 'Zły sekret.' });
    const job = String(req.query.job || req.body?.job || 'all');
    const out = {};
    try {
        if (job === 'all' || job === 'reminders') out.reminders = (await reminderJob()).summary;
        if (job === 'all' || job === 'scrape') out.scrape = (await scrapeJob()).summary;
        cache.invalidate();
        res.json({ ok: true, ...out });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
