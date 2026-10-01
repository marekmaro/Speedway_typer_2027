/* ------------------------------------------------------------------
   Mała pamięć podręczna dla ciężkich odczytów (strona główna, statystyki).
   Każdy zapis (typ, wynik, zmiana meczu) woła invalidate(), więc gracze
   nigdy nie widzą starych danych dłużej niż TTL - a zwykle wcale.
   Trzymana w pamięci procesu: przy jednej instancji na Render to wystarcza.
------------------------------------------------------------------- */

const store = new Map(); // key -> { expires, value }
let version = 0;

async function remember(key, ttlMs, producer) {
    const k = `${version}:${key}`;
    const hit = store.get(k);
    const now = Date.now();
    if (hit && hit.expires > now) return hit.value;
    const value = await producer();
    store.set(k, { expires: now + ttlMs, value });
    if (store.size > 200) {
        for (const [key2, v] of store) if (v.expires <= now || !key2.startsWith(`${version}:`)) store.delete(key2);
    }
    return value;
}

function invalidate() {
    version++;
    store.clear();
}

/** Middleware: po udanym zapisie (POST/PUT/DELETE) czyścimy cache. */
function invalidateOnWrite(req, res, next) {
    if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) invalidate(); });
    next();
}

module.exports = { remember, invalidate, invalidateOnWrite };
