/* ------------------------------------------------------------------
   Wspólne narzędzia dla wszystkich stron (main / typuj / gracz / admin).
   Jedno miejsce na: nazwy i logo drużyn, daty, blokady, statusy meczów,
   wywołania API, service worker (PWA) i powiadomienia push.
------------------------------------------------------------------- */
window.T = (function () {

    const LOGOS = {
        "PRES Grupa Deweloperska Toruń": "https://v.wpimg.pl/MDc4NzEuYiUCVjhJag5vMEEObBMsV2FmFhZ0WGpBdTxMRygNNVs6NABQIFQ1GWIwAlM9VXNMfCBaBX4fJ0IvfAUGEUl9QH1zWwN_VDUbKmYe",
        "Orlen Oil Motor Lublin": "https://v.wpimg.pl/MjQ1NDIuYgswUzh3Zg5vHnMLbC0gV2FIJBN0ZmZBdRJ-QigzOVs6GjJVIGo5GWIeMFY9a3xNK1hnAC12fUQrXDIJEXN8RH9eZAV8ajkbKkgs",
        "Betard Sparta Wrocław": "https://v.wpimg.pl/NDQ3NzUuYSUwUThJeg5sMHMJbBM8V2JmJBF0WHpBdjx-QCgNJVs5NDJXIFQlGWEwMFQ9VWNHfXU1BS8ZZ0J6J2UHEU9jR3pwZgR7VCUbKWYs",
        "Bayersystem GKM Grudziądz": "https://v.wpimg.pl/MzI3OTUuYhsoUTlneg5vDmsJbT08V2FYPBF1dnpBdQJmQCkjJVs6CipXIXolGWIOKFQ8e2AQeB57V3tgNkZ1Sn8GEGVhR35Ifgp6eiUbKlg0",
        "Stelmet Falubaz Zielona Góra": "https://v.wpimg.pl/OTAxMDMuYDUgGjt3Yg5tIGNCby0kV2N2NFp3ZmJBdyxuCyszPVs4JCIcI2o9GWAgIB8-a3tAdmF4TXwhexQrZCVLEnx4TXZkcEh-aj0bKHY8",
        "Krono-Plast Włókniarz Częstochowa": "https://v.wpimg.pl/NTQ0MzYuYTUwUjtJdg5sIHMKbxMwV2J2JBJ3WHZBdix-QysNKVs5JDJUI1QpGWEgMFc-VWwQezBjUStPa0B4YmcDEk1gR3tgZQN7VCkbKXYs",
        "Gezet Stal Gorzów": "https://v.wpimg.pl/MDE2OTMuYiUkUDlnYg5vMGcIbT0kV2FmMBB1dmJBdTxqQSkjPVs6NCZWIXo9GWIwJFU8e3gQeCB3UXpseBR-dHYFEGB1RX11cwt8ej0bKmY4",
        "Fogo Unia Leszno": "https://v.wpimg.pl/OTM2MjAuYDUsUDtZbg5tIG8IbwMoV2N2OBB3SG5BdyxiQSsdMVs4JC5WI0QxGWAgLFU-RXQQejB-A3sPcBd5NikKElp3RXZnewB9RDEbKHYw"
    };

    // Przedrostki sponsorskie do ucięcia w wersji skróconej nazwy
    const SPONSORS = /^(Orlen Oil|Betard|PRES Grupa Deweloperska|PRES|Gezet|Bayersystem|Krono-Plast|Stelmet|Fogo|Enea|Cellfast|Abramczyk|For Nature Solutions|Zooleszcz|Texom|Arged|Ebut|Novum|Polski Cukier|H\. Skrzydlewska|Marwis\.pl|eWinner|ROW|Lokomotiv)\s+/i;

    function shortName(name) {
        if (!name) return '';
        let out = String(name).replace(SPONSORS, '').trim();
        const parts = out.split(/\s+/);
        if (parts.length > 2) out = parts.slice(-2).join(' ');
        return out;
    }

    function initials(name) {
        return shortName(name).split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
    }

    /** Logo drużyny; gdy nie znamy adresu (np. nowy sezon) rysujemy kółko z inicjałami. */
    function logoHtml(name, cls = 'team-logo') {
        const url = LOGOS[name];
        const badge = `<span class="team-badge${cls.includes('lg') ? ' lg' : ''}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
        if (url) {
            return `<img src="${url}" alt="" class="${cls}" loading="lazy" referrerpolicy="no-referrer"
                onerror="this.outerHTML=this.dataset.fallback" data-fallback="${escapeHtml(badge)}">`;
        }
        return badge;
    }

    const pad = n => String(n).padStart(2, '0');

    /* Zegar serwera: telefon może mieć źle ustawioną godzinę, a blokada liczy się co do minuty.
       Każda odpowiedź API niesie serverTime - liczymy różnicę i odliczamy według serwera. */
    let clockOffset = 0;
    function syncClock(serverTimeIso, requestStartedAt) {
        const server = new Date(serverTimeIso).getTime();
        if (!server) return;
        const local = requestStartedAt ? (requestStartedAt + Date.now()) / 2 : Date.now();
        clockOffset = server - local;
    }
    function now() { return Date.now() + clockOffset; }
    const TZ = { timeZone: 'Europe/Warsaw' };

    function fmtDateTime(d) {
        return new Date(d).toLocaleString('pl-PL', { ...TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    function fmtDate(d) {
        return new Date(d).toLocaleDateString('pl-PL', { ...TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    function fmtDay(d) {
        return new Date(d).toLocaleDateString('pl-PL', { ...TZ, weekday: 'short', day: '2-digit', month: '2-digit' });
    }
    function fmtTime(d) {
        return new Date(d).toLocaleTimeString('pl-PL', { ...TZ, hour: '2-digit', minute: '2-digit' });
    }

    /** "2d 04h 12m" / "04:12:08" albo null, gdy czas minął. */
    function countdown(targetMs, at = now()) {
        const diff = targetMs - at;
        if (diff <= 0) return null;
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`;
    }

    /** Te same zasady co na serwerze (services/scoring.js) - serwer i tak ma ostatnie słowo. */
    function lockTime(match, lockMinutes) {
        return new Date(match.matchDate).getTime() - lockMinutes * 60 * 1000;
    }
    function isLocked(match, lockMinutes, at = now()) {
        if (match.predictionsFrozen) return true;
        if (match.homeScore !== null && match.homeScore !== undefined) return true;
        if (match.isPostponed) return false; // termin nieznany: stara data nic nie znaczy
        return at >= lockTime(match, lockMinutes);
    }
    function hasResult(m) { return m.homeScore !== null && m.homeScore !== undefined; }

    /** Opis blokady po ludzku: "1 min przed startem", "24 h przed startem". */
    function lockLabel(lockMinutes) {
        if (lockMinutes < 60) return `${lockMinutes} min`;
        if (lockMinutes % 60 === 0) return `${lockMinutes / 60} h`;
        return `${Math.floor(lockMinutes / 60)} h ${lockMinutes % 60} min`;
    }

    /** Status meczu jako plakietka - wspólny dla strony głównej, panelu gracza i admina. */
    function matchStatus(m, lockMinutes, at = now()) {
        if (m.isWalkover) return { cls: 'chip-warn', text: 'Walkower · typy anulowane' };
        if (m.voidPredictions) return { cls: 'chip-warn', text: 'Typy anulowane' };
        if (hasResult(m)) return { cls: 'chip-muted', text: 'Zakończony' };
        if (m.isPostponed && m.predictionsFrozen) return { cls: 'chip-bad', text: '🔒 Przełożony · typy zamrożone' };
        if (m.isPostponed) return { cls: 'chip-warn', text: 'Przełożony · czeka na termin' };
        if (m.predictionsFrozen) return { cls: 'chip-bad', text: '🔒 Przełożony · typy zamrożone' };
        if (isLocked(m, lockMinutes, at)) {
            return new Date(m.matchDate).getTime() <= at
                ? { cls: 'chip-brand', text: 'Trwa / czeka na wynik' }
                : { cls: 'chip-bad', text: '🔒 Typy zamknięte' };
        }
        return { cls: 'chip-ok', text: `Otwarte · ${countdown(lockTime(m, lockMinutes), at) || ''}` };
    }

    function roundName(round, stageNames) {
        if (stageNames && stageNames[round]) return stageNames[round];
        return `Runda ${round}`;
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function getJson(url, headers = {}) {
        const res = await fetch(url, { headers: { 'Accept': 'application/json', ...headers } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Błąd ${res.status}`);
        return data;
    }

    async function postJson(url, body, headers = {}) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body || {})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Błąd ${res.status}`);
        return data;
    }

    function toast(msg, kind = 'ok') {
        let box = document.getElementById('t-toast');
        if (!box) {
            box = document.createElement('div');
            box.id = 't-toast';
            box.className = 'toast-box';
            box.setAttribute('role', 'status');
            box.setAttribute('aria-live', 'polite');
            document.body.appendChild(box);
        }
        box.textContent = msg;
        box.className = `toast-box show ${kind === 'err' ? 'toast-err' : 'toast-ok'}`;
        clearTimeout(box._timer);
        box._timer = setTimeout(() => { box.className = 'toast-box'; }, 3200);
    }

    /* ---------------- PWA ---------------- */

    function registerSW() {
        if (!('serviceWorker' in navigator)) return Promise.resolve(null);
        return navigator.serviceWorker.register('/sw.js').catch(err => { console.warn('SW:', err); return null; });
    }

    /** Link gracza zapamiętany na urządzeniu - strona główna pokazuje wtedy "Mój panel". */
    function rememberToken(token) { try { localStorage.setItem('typerToken', token); } catch (e) { /* tryb prywatny */ } }
    function storedToken() { try { return localStorage.getItem('typerToken'); } catch (e) { return null; } }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }
    function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }

    function pushSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    }

    function urlBase64ToUint8Array(base64) {
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
    }

    /** Aktualna subskrypcja tego urządzenia (albo null). */
    async function currentPush() {
        if (!pushSupported()) return null;
        const reg = await navigator.serviceWorker.ready;
        return reg.pushManager.getSubscription();
    }

    /**
     * Włącza powiadomienia: zgoda przeglądarki -> subskrypcja -> zapis na serwerze.
     * saveUrl/extra/headers: gdzie i z czym zapisać (gracz: token, admin: nagłówek sesji).
     */
    async function enablePush(saveUrl, extra = {}, headers = {}) {
        if (!pushSupported()) throw new Error(isIOS() && !isStandalone()
            ? 'Na iPhonie najpierw dodaj aplikację do ekranu głównego (Udostępnij → Do ekranu początkowego).'
            : 'Ta przeglądarka nie obsługuje powiadomień.');
        const { enabled, publicKey } = await getJson('/api/public/push/key');
        if (!enabled) throw new Error('Powiadomienia nie są jeszcze skonfigurowane na serwerze.');
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('Nie udzielono zgody na powiadomienia.');
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
        return postJson(saveUrl, { ...extra, subscription: sub.toJSON() }, headers);
    }

    async function disablePush() {
        const sub = await currentPush();
        if (!sub) return;
        await postJson('/api/public/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
    }

    return {
        LOGOS, shortName, initials, logoHtml, fmtDate, fmtDateTime, fmtDay, fmtTime, countdown, lockTime, isLocked, syncClock, now,
        hasResult, lockLabel, matchStatus, roundName, escapeHtml, getJson, postJson, toast, pad,
        registerSW, rememberToken, storedToken, isStandalone, isIOS, pushSupported, currentPush, enablePush, disablePush
    };
})();
