/* ------------------------------------------------------------------
   Powiadomienia Web Push (PWA).
   Klucze VAPID generujesz raz: `npm run vapid` i wklejasz do zmiennych środowiskowych.
   Bez kluczy wszystko działa, tylko powiadomienia są wyłączone.
------------------------------------------------------------------- */
const webpush = require('web-push');
const { PushSubscription, NotificationLog } = require('../models/Database');

let configured = null;
let sender = (sub, body, opts) => webpush.sendNotification(sub, body, opts);

function isConfigured() {
    if (configured !== null) return configured;
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
        try {
            webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
            configured = true;
        } catch (e) {
            console.error('⚠️  Błędne klucze VAPID - powiadomienia wyłączone:', e.message);
            configured = false;
        }
    } else configured = false;
    return configured;
}

function publicKey() {
    return isConfigured() ? process.env.VAPID_PUBLIC_KEY : null;
}

function validSubscription(sub) {
    return sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint)
        && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
}

async function saveSubscription(sub, { nickname = null, isAdmin = false, userAgent = '' } = {}) {
    if (!validSubscription(sub)) throw new Error('Niepoprawna subskrypcja push.');
    const set = { keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, userAgent: String(userAgent).slice(0, 200), failures: 0 };
    if (nickname) set.nickname = nickname;
    if (isAdmin) set.isAdmin = true;
    await PushSubscription.updateOne({ endpoint: sub.endpoint }, { $set: set }, { upsert: true });
}

async function removeSubscription(endpoint) {
    await PushSubscription.deleteOne({ endpoint });
}

/** Wysyła payload do listy subskrypcji; martwe (404/410) usuwa. Zwraca liczbę dostarczonych. */
async function sendTo(subs, payload) {
    if (!isConfigured() || !subs.length) return 0;
    const body = JSON.stringify(payload);
    let ok = 0;
    await Promise.all(subs.map(async s => {
        try {
            await sender({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 6 * 3600, urgency: payload.urgency || 'normal' });
            ok++;
        } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) await PushSubscription.deleteOne({ endpoint: s.endpoint });
            else {
                console.warn('⚠️  push:', err.statusCode || '', err.message);
                await PushSubscription.updateOne({ endpoint: s.endpoint }, { $set: { failures: (s.failures || 0) + 1 } });
            }
        }
    }));
    return ok;
}

async function notifyPlayer(nickname, payload) {
    const subs = await PushSubscription.find({ nickname }).lean();
    return sendTo(subs, payload);
}

async function notifyAdmins(payload) {
    const subs = await PushSubscription.find({ isAdmin: true }).lean();
    return sendTo(subs, payload);
}

/**
 * Zwraca true tylko za pierwszym razem dla danego klucza (indeks unikalny w bazie).
 * Dzięki temu przypomnienie nie przyjdzie dwa razy, nawet gdy zadanie odpali się równolegle.
 */
async function onceOnly(key) {
    try {
        await NotificationLog.create({ key });
        return true;
    } catch (e) {
        if (e && (e.code === 11000 || /duplicate/i.test(e.message))) return false;
        throw e;
    }
}

/** Tylko do testów: podmiana wysyłki i konfiguracji. */
function _setSenderForTests(fn) { sender = fn; configured = true; }

module.exports = {
    isConfigured, publicKey, saveSubscription, removeSubscription, sendTo,
    notifyPlayer, notifyAdmins, onceOnly, validSubscription, _setSenderForTests
};
