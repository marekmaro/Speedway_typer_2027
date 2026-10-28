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
        // przy odświeżaniu w tle zgoda już jest - Safari nie lubi pytania bez dotknięcia ekranu
        const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('Nie udzielono zgody na powiadomienia.');
        const reg = await navigator.serviceWorker.ready;
        const key = urlBase64ToUint8Array(publicKey);
        let sub = await reg.pushManager.getSubscription();
        // subskrypcja na stary klucz serwera (np. po zmianie kluczy VAPID) nic już nie dostanie
        if (sub && !sameServerKey(sub, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        return postJson(saveUrl, { ...extra, subscription: sub.toJSON() }, headers);
    }

    function sameServerKey(sub, key) {
        const k = sub.options && sub.options.applicationServerKey;
        if (!k) return true;   // przeglądarka nie podaje klucza - zostawiamy subskrypcję
        const a = new Uint8Array(k);
        return a.length === key.length && a.every((b, i) => b === key[i]);
    }

    async function disablePush() {
        const sub = await currentPush();
        if (!sub) return;
        await postJson('/api/public/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
    }

    /* ---------------- motyw żużlowy: kaski, światła startowe, konfetti, dyplom ---------------- */

    const HELMETS = ['h-red', 'h-blue', 'h-white', 'h-yellow'];
    /** Kolor kasku typera - stały dla pseudonimu (jak numer startowy). */
    function helmetColor(nick) {
        let h = 0;
        for (const ch of String(nick || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
        return HELMETS[h % HELMETS.length];
    }
    function nickInitials(nick) {
        const words = String(nick || '?').trim().split(/[\s_.-]+/).filter(Boolean);
        const out = words.length > 1 ? words[0][0] + words[1][0] : [...words[0] || '?'].slice(0, 2).join('');
        return out.toUpperCase();
    }
    /** Kask-awatar. medal: 1/2/3 = złoty/srebrny/brązowy kask (podium). */
    function helmet(nick, { size = '', medal = null, title = true } = {}) {
        const color = medal === 1 ? 'h-gold' : medal === 2 ? 'h-silver' : medal === 3 ? 'h-bronze' : helmetColor(nick);
        return `<span class="helmet ${color} ${size ? `helmet-${size}` : ''}" ${title ? `title="${escapeHtml(nick)}"` : ''} aria-hidden="true"><span>${escapeHtml(nickInitials(nick))}</span></span>`;
    }

    /** Światła startowe: im bliżej blokady, tym więcej się pali (4 = ostatnie minuty). */
    function startLights(msLeft) {
        const on = msLeft === null || msLeft === undefined ? 0
            : msLeft <= 5 * 60e3 ? 4 : msLeft <= 30 * 60e3 ? 3 : msLeft <= 3 * 3600e3 ? 2 : msLeft <= 24 * 3600e3 ? 1 : 0;
        return { on, html: `<span class="start-lights ${on === 4 ? 'hot' : ''}" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>` };
    }

    const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /** Konfetti w kolorach kasków i złota. Bez bibliotek, sam się sprząta. */
    function confetti(ms = 3500) {
        if (reducedMotion() || !document.body) return;
        let c = document.getElementById('confetti');
        if (!c) { c = document.createElement('canvas'); c.id = 'confetti'; document.body.appendChild(c); }
        const ctx = c.getContext('2d');
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const resize = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; };
        resize();
        const colors = ['#dc2626', '#2563eb', '#f1f5f9', '#facc15', '#ca8a04'];
        const parts = Array.from({ length: 160 }, () => ({
            x: Math.random() * c.width, y: -Math.random() * c.height * 0.6, w: (6 + Math.random() * 6) * dpr, h: (8 + Math.random() * 10) * dpr,
            vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
            color: colors[Math.floor(Math.random() * colors.length)]
        }));
        const end = Date.now() + ms;
        (function frame() {
            ctx.clearRect(0, 0, c.width, c.height);
            parts.forEach(p => {
                p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.03 * dpr;
                ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
            });
            if (Date.now() < end) requestAnimationFrame(frame); else c.remove();
        })();
    }

    /**
     * Dyplom Mistrza Typera (PNG z canvas). opts: { nick, title, subtitle, season, points, perfects, position, date }
     * Zwraca Promise<Blob>.
     */
    function diploma(opts) {
        const W = 1600, H = 1131;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        const gold = g.createLinearGradient(0, 0, W, H);
        gold.addColorStop(0, '#fde68a'); gold.addColorStop(0.5, '#ca8a04'); gold.addColorStop(1, '#fde68a');
        // tło: nocny stadion
        const bg = g.createRadialGradient(W / 2, -200, 100, W / 2, H / 2, H);
        bg.addColorStop(0, '#3b2a05'); bg.addColorStop(0.55, '#0b1220'); bg.addColorStop(1, '#05080f');
        g.fillStyle = bg; g.fillRect(0, 0, W, H);
        // tor (owal)
        g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 60;
        g.beginPath(); g.ellipse(W / 2, H / 2 + 40, W * 0.42, H * 0.33, 0, 0, Math.PI * 2); g.stroke();
        // ramka
        g.strokeStyle = gold; g.lineWidth = 10; g.strokeRect(40, 40, W - 80, H - 80);
        g.lineWidth = 2; g.strokeRect(62, 62, W - 124, H - 124);
        // pasek kasków
        ['#dc2626', '#2563eb', '#f1f5f9', '#facc15'].forEach((col, i) => { g.fillStyle = col; g.fillRect(W / 2 - 240 + i * 120, 120, 120, 10); });
        g.textAlign = 'center';
        g.fillStyle = '#fde68a'; g.font = '900 italic 40px system-ui, sans-serif';
        g.fillText('ŻUŻLOWY TYPER', W / 2, 200);
        g.fillStyle = '#ffffff'; g.font = '900 120px Georgia, serif';
        g.fillText('DYPLOM', W / 2, 340);
        g.fillStyle = gold; g.font = '900 italic 64px system-ui, sans-serif';
        g.fillText(opts.title || 'MISTRZ TYPERA', W / 2, 440);
        g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '400 34px system-ui, sans-serif';
        g.fillText(opts.subtitle || `sezon ${opts.season}`, W / 2, 500);
        g.fillStyle = '#ffffff'; g.font = '900 150px system-ui, sans-serif';
        let size = 150;
        while (g.measureText(opts.nick).width > W - 300 && size > 60) { size -= 10; g.font = `900 ${size}px system-ui, sans-serif`; }
        g.fillText(opts.nick, W / 2, 690);
        g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '600 38px system-ui, sans-serif';
        const facts = [`${opts.position}. miejsce`, `${opts.points} pkt`, `${opts.perfects} dokładnych wyników`].join('   ·   ');
        g.fillText(facts, W / 2, 790);
        g.font = '120px system-ui, sans-serif';
        g.fillText(opts.position === 1 ? '🏆' : opts.position === 2 ? '🥈' : '🥉', W / 2, 950);
        g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '400 28px system-ui, sans-serif';
        g.textAlign = 'left'; g.fillText(opts.date || new Date().toLocaleDateString('pl-PL'), 140, H - 120);
        g.textAlign = 'right'; g.fillText('organizator typera', W - 140, H - 120);
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(W - 520, H - 160); g.lineTo(W - 140, H - 160); g.stroke();
        return new Promise(resolve => c.toBlob(resolve, 'image/png'));
    }

    /** Pobranie / udostępnienie pliku (Web Share na telefonie, zwykłe pobranie na komputerze). */
    async function shareOrDownload(blob, filename, text) {
        const file = new File([blob], filename, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ files: [file], title: filename, text }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'aborted'; }
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        return 'downloaded';
    }

    /** "Raz na urządzenie" - np. konfetti tylko przy pierwszym wejściu po zamknięciu sezonu. */
    function once(key) {
        try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, '1'); return true; } catch (e) { return false; }
    }

    return {
        LOGOS, shortName, initials, logoHtml, fmtDate, fmtDateTime, fmtDay, fmtTime, countdown, lockTime, isLocked, syncClock, now,
        hasResult, lockLabel, matchStatus, roundName, escapeHtml, getJson, postJson, toast, pad,
        registerSW, rememberToken, storedToken, isStandalone, isIOS, pushSupported, currentPush, enablePush, disablePush,
        helmet, helmetColor, nickInitials, startLights, confetti, diploma, shareOrDownload, once, reducedMotion
    };
})();
