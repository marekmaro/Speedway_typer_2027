require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const publicRoutes = require('./routes/publicRoutes');
const adminRoutes = require('./routes/adminRoutes');
const cronRoutes = require('./routes/cronRoutes');
const { bootstrap } = require('./services/seasons');
const { startScheduler } = require('./services/jobs');
const push = require('./services/push');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(',') }));
app.use(express.json({ limit: '10mb' })); // limit zwiększony pod import kopii zapasowej

// Proste nagłówki bezpieczeństwa (bez dodatkowych paczek)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
});

/**
 * Manifest PWA generowany dynamicznie: gdy gracz doda do ekranu głównego
 * swój panel (/typuj.html?id=...), ikona otwiera od razu JEGO panel.
 */
app.get('/manifest.webmanifest', (req, res) => {
    const token = String(req.query.id || '');
    const valid = /^[a-f0-9]{16,64}$/i.test(token);
    res.type('application/manifest+json');
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
        name: 'Żużlowy Typer',
        short_name: 'Typer',
        description: 'Typer PGE Ekstraligi dla znajomych',
        lang: 'pl',
        id: valid ? `/typuj?player=${token.slice(0, 8)}` : '/',
        start_url: valid ? `/typuj.html?id=${token}&source=pwa` : '/?source=pwa',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b1220',
        theme_color: '#0b1220',
        icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
            { name: 'Ranking', url: '/#ranking' },
            { name: 'Tabela ligi', url: '/#tabela' }
        ]
    });
});

/* ------------------------------------------------------------------
   Wersjonowanie plików frontu: serwer liczy skrót z CSS/JS i dokleja go do adresów (?v=...)
   w HTML i w service workerze. Każdy deploy = nowe adresy = telefony graczy od razu
   pobierają nowe pliki, a stary cache PWA jest usuwany. Nic nie trzeba podbijać ręcznie.
------------------------------------------------------------------- */
const PUBLIC_DIR = path.join(__dirname, 'public');
const VERSIONED = ['css/app.css', 'js/shared.js', 'js/main.js', 'js/typuj.js', 'js/gracz.js', 'js/admin.js', 'js/rules.js', 'js/zasady.js', 'sw.js'];
const IS_PROD = process.env.NODE_ENV === 'production';
let cachedVersion = null;

function assetVersion() {
    if (cachedVersion && IS_PROD) return cachedVersion;
    const h = crypto.createHash('sha1');
    VERSIONED.forEach(f => { try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch (e) { /* brak pliku */ } });
    cachedVersion = h.digest('hex').slice(0, 10);
    return cachedVersion;
}

const fileCache = new Map();
function readPublic(file) {
    if (IS_PROD && fileCache.has(file)) return fileCache.get(file);
    const text = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    if (IS_PROD) fileCache.set(file, text);
    return text;
}

function sendVersioned(file, type) {
    return (req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.type(type).send(readPublic(file).replace(/__V__/g, assetVersion()));
    };
}

// Service worker musi być zawsze świeży, inaczej aktualizacje aplikacji utkną u graczy
app.get('/sw.js', (req, res, next) => {
    res.setHeader('Service-Worker-Allowed', '/');
    sendVersioned('sw.js', 'application/javascript')(req, res, next);
});
app.get(['/', '/index.html'], sendVersioned('index.html', 'html'));
app.get(['/typuj', '/typuj.html'], sendVersioned('typuj.html', 'html'));
app.get(['/gracz', '/gracz.html'], sendVersioned('gracz.html', 'html'));
app.get(['/zasady', '/zasady.html', '/regulamin'], sendVersioned('zasady.html', 'html'));
app.get(['/admin', '/admin.html'], sendVersioned('admin.html', 'html'));

app.use(express.static(PUBLIC_DIR, {
    index: false,
    setHeaders(res, file) {
        if (/\.(png|svg|ico)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
        // CSS/JS mają ?v=wersja w adresie, więc mogą być trzymane długo
        else if (/\.(css|js)$/.test(file) && res.req && res.req.query && res.req.query.v) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
}));

app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cron', cronRoutes);

app.get('/healthz', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1, push: push.isConfigured(), version: assetVersion() }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Nieznany endpoint API.' }));

app.use((err, req, res, next) => {
    console.error('🔥 Nieobsłużony błąd:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Błąd serwera.' });
});

const PORT = process.env.PORT || 3000;

async function start() {
    if (!process.env.MONGODB_URI) {
        console.error('❌ Brak MONGODB_URI w zmiennych środowiskowych — serwer nie wystartuje.');
        process.exit(1);
    }
    if (!process.env.ADMIN_PASSWORD) {
        console.warn('⚠️  Brak ADMIN_PASSWORD — panel admina będzie niedostępny.');
    }
    if (!push.isConfigured()) {
        console.warn('ℹ️  Brak kluczy VAPID — powiadomienia push wyłączone (npm run vapid).');
    }
    try {
        await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
        console.log('✅ Połączono z bazą MongoDB.');
        const season = await bootstrap();
        console.log(`🏁 Aktywny sezon: ${season.year} (${season.label || 'bez nazwy'}).`);
    } catch (err) {
        console.error('❌ Błąd połączenia z bazą:', err.message);
        process.exit(1);
    }
    app.listen(PORT, () => console.log(`🚀 Serwer działa na porcie ${PORT}`));
    startScheduler();
}

// Łagodne zamknięcie (Render wysyła SIGTERM przy każdym deployu)
process.on('SIGTERM', () => {
    mongoose.connection.close().finally(() => process.exit(0));
});

if (require.main === module) start();

module.exports = app;
