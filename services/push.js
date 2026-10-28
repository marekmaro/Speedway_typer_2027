/* ------------------------------------------------------------------
   Powiadomienia Web Push (PWA).
   Klucze VAPID: własne (`npm run vapid`) wpisujesz w VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
   Bez nich serwer przy pierwszym starcie generuje parę sam i trzyma ją w bazie (init()),
   więc powiadomienia działają od razu po wdrożeniu.
------------------------------------------------------------------- */
const webpush = require('web-push');
const { PushSubscription, NotificationLog, AppSetting } = require('../models/Database');

let configured = null;
let keys = null;          // { publicKey, privateKey, source: 'env' | 'db' }
let sender = (sub, body, opts) => webpush.sendNotification(sub, body, opts);

function configure(publicKey, privateKey, source) {
    try {
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', publicKey, privateKey);
        keys = { publicKey, privateKey, source };
        configured = true;
    } catch (e) {
        console.error('⚠️  Błędne klucze VAPID - powiadomienia wyłączone:', e.message);
        configured = false;
    }
    return configured;
}

const hasEnvKeys = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

function isConfigured() {
    if (configured !== null) return configured;
    // bez kluczy w env nie zapamiętujemy "false" - init() może jeszcze wczytać je z bazy
    return hasEnvKeys() ? configure(process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY, 'env') : false;
}

/**
 * Raz po połączeniu z bazą. Klucze ze zmiennych środowiskowych mają pierwszeństwo; bez nich
 * para generuje się przy pierwszym starcie i zostaje w bazie, więc restart ani nowy deploy
 * nie unieważniają subskrypcji na telefonach. Zwraca źródło kluczy: 'env', 'db' albo null.
 */
async function init() {
    if (hasEnvKeys()) return isConfigured() ? 'env' : null;
    // $setOnInsert: przy równoległych startach wszystkie instancje dostaną tę samą parę
    const doc = await AppSetting.findOneAndUpdate(
        { key: 'vapid' },
        { $setOnInsert: { value: webpush.generateVAPIDKeys() } },
        { upsert: true, new: true }
    ).lean();
    const v = doc && doc.value;
    return v && v.publicKey && v.privateKey && configure(v.publicKey, v.privateKey, 'db') ? 'db' : null;
}

function publicKey() {
    return isConfigured() && keys ? keys.publicKey : null;
}

/** Skąd są klucze: 'env', 'db' albo null (do panelu admina). */
function keySource() {
    return isConfigured() && keys ? keys.source : null;
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
    init, isConfigured, publicKey, keySource, saveSubscription, removeSubscription, sendTo,
    notifyPlayer, notifyAdmins, onceOnly, validSubscription, _setSenderForTests
};
