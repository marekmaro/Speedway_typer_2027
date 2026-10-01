require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const publicRoutes = require('./routes/publicRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { bootstrap } = require('./services/seasons');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' })); // limit zwiększony pod import kopii zapasowej

// Proste nagłówki bezpieczeństwa (bez dodatkowych paczek)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/typuj', (req, res) => res.sendFile(path.join(__dirname, 'public', 'typuj.html')));
app.get('/healthz', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Nieznany endpoint API.' }));

app.use((err, req, res, next) => {
    console.error('🔥 Nieobsłużony błąd:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Błąd serwera.' });
});

const PORT = process.env.PORT || 3000;

async function start() {
    if (!process.env.MONGODB_URI) {
        console.error('❌ Brak MONGODB_URI w pliku .env — serwer nie wystartuje.');
        process.exit(1);
    }
    if (!process.env.ADMIN_PASSWORD) {
        console.warn('⚠️  Brak ADMIN_PASSWORD w .env — panel admina będzie niedostępny.');
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
}

start();

module.exports = app;
