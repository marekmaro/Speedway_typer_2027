require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

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

// Service worker musi być zawsze świeży, inaczej aktualizacje aplikacji utkną u graczy
app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(res, file) {
        if (/\.(png|svg|ico)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
    }
}));

app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cron', cronRoutes);

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/typuj', (req, res) => res.sendFile(path.join(__dirname, 'public', 'typuj.html')));
app.get('/gracz', (req, res) => res.sendFile(path.join(__dirname, 'public', 'gracz.html')));
app.get('/healthz', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1, push: push.isConfigured() }));

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
