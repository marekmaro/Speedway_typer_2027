const crypto = require('crypto');
const { ADMIN_SESSION_TTL } = require('../config');

/* ------------------------------------------------------------------
   Logowanie admina.
   Zmiany względem v1:
   - hasło leci TYLKO raz (przy logowaniu), potem działa token sesji,
   - porównanie hasła odporne na timing attack,
   - limit prób logowania (brute force),
   - token trzymany w sessionStorage, nie w localStorage na zawsze.
------------------------------------------------------------------- */

const sessions = new Map();      // token -> expiresAt
const attempts = new Map();      // ip -> { count, resetAt }

const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW = 15 * 60 * 1000;

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a || ''));
    const bufB = Buffer.from(String(b || ''));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function cleanup() {
    const now = Date.now();
    for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
    for (const [ip, a] of attempts) if (a.resetAt < now) attempts.delete(ip);
}
setInterval(cleanup, 10 * 60 * 1000).unref();

/**
 * Adres klienta do limitów. NIE czytamy X-Forwarded-For ręcznie: pierwszy wpis w tym nagłówku
 * ustawia sam klient, więc zmieniając go, można by obejść limit prób logowania.
 * req.ip uwzględnia "trust proxy" z server.js (Render dopisuje prawdziwy adres na końcu).
 */
function ipOf(req) {
    return req.ip || (req.socket && req.socket.remoteAddress) || 'local';
}

function login(req, res) {
    const ip = ipOf(req);
    const now = Date.now();
    const rec = attempts.get(ip) || { count: 0, resetAt: now + ATTEMPT_WINDOW };
    if (rec.count >= MAX_ATTEMPTS && rec.resetAt > now) {
        const mins = Math.ceil((rec.resetAt - now) / 60000);
        return res.status(429).json({ error: `Zbyt wiele prób. Spróbuj za ${mins} min.` });
    }

    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) return res.status(500).json({ error: 'Brak ADMIN_PASSWORD w pliku .env na serwerze.' });

    if (!safeEqual(req.body && req.body.password, expected)) {
        rec.count += 1;
        attempts.set(ip, rec);
        return res.status(401).json({ error: 'Złe hasło.' });
    }

    attempts.delete(ip);
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, now + ADMIN_SESSION_TTL);
    res.json({ token, expiresIn: ADMIN_SESSION_TTL, message: 'Zalogowano.' });
}

function logout(req, res) {
    const token = req.headers['x-admin-token'];
    if (token) sessions.delete(token);
    res.json({ message: 'Wylogowano.' });
}

function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (token && sessions.has(token) && sessions.get(token) > Date.now()) {
        sessions.set(token, Date.now() + ADMIN_SESSION_TTL); // odświeżenie sesji
        return next();
    }
    // Uwaga: v2 przyjmowało też hasło w nagłówku x-admin-password - usunięte, bo omijało limit prób logowania.
    res.status(401).json({ error: 'Sesja wygasła. Zaloguj się ponownie.' });
}

/** Prosty limiter dla publicznych endpointów (bez dodatkowych paczek npm). */
function rateLimit({ windowMs = 60000, max = 60, key = 'default' } = {}) {
    const hits = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
    }, windowMs).unref();

    return (req, res, next) => {
        const id = `${key}:${ipOf(req)}`;
        const now = Date.now();
        const rec = hits.get(id) || { count: 0, resetAt: now + windowMs };
        if (rec.resetAt < now) { rec.count = 0; rec.resetAt = now + windowMs; }
        rec.count += 1;
        hits.set(id, rec);
        if (rec.count > max) return res.status(429).json({ error: 'Zbyt wiele żądań. Odczekaj chwilę.' });
        next();
    };
}

module.exports = { login, logout, requireAdmin, rateLimit };
