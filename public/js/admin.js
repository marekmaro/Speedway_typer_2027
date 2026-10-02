/* ------------------------------------------------------------------
   Panel administratora.
   Układ: Pulpit (co wymaga uwagi) · Mecze (kolejka po kolejce) · Gracze · Puchar · Sezon · System.
   - wszystkie przyciski działają przez data-act (delegacja zdarzeń) - żadnych onclick z danymi graczy,
   - szczegóły meczu / gracza otwierają się w szufladzie (na telefonie od dołu ekranu),
   - po każdej zmianie dane są pobierane od nowa, więc ekran zawsze pokazuje stan z serwera.
------------------------------------------------------------------- */

const esc = T.escapeHtml;
const HOUR = 3600 * 1000;

const S = {
    token: sessionStorage.getItem('adminToken') || '',
    season: Number(localStorage.getItem('adminSeason')) || null,
    data: null,            // /api/public/data (mecze, tabela, ranking)
    predictions: [],       // pełne typy (admin widzi też ukryte)
    players: [],           // pełna lista graczy z linkami
    seasons: [],           // szczegóły sezonów
    drafts: [],            // wyniki ze scrapera do zatwierdzenia
    jobs: null,            // dziennik zadań + stan push
    view: 'pulpit',
    arg: null,
    round: null,
    sub: 'ustawienia',     // podsekcja "Sezon"
    playerFilter: 'season',
    search: '',
    resultEdits: new Map(), // matchId -> { h, a } - wyniki wpisane, jeszcze niezapisane
    openPreds: new Set()    // mecze z rozwiniętą listą typów
};

/* ================= NAWIGACJA ================= */

const ICONS = {
    pulpit: '<path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z"/>',
    mecze: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    gracze: '<path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/>',
    puchar: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4"/>',
    sezon: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    system: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    wiecej: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
};
const VIEWS = {
    pulpit: { title: 'Pulpit', render: renderPulpit },
    mecze: { title: 'Mecze i wyniki', short: 'Mecze', render: renderMecze },
    gracze: { title: 'Gracze', render: renderGracze },
    puchar: { title: 'Puchar Typerów', short: 'Puchar', render: renderPuchar },
    sezon: { title: 'Sezon', render: renderSezon },
    system: { title: 'System', render: renderSystem },
    wiecej: { title: 'Więcej', render: renderWiecej }
};
const SIDE = ['pulpit', 'mecze', 'gracze', 'puchar', 'sezon', 'system'];
const TABS = ['pulpit', 'mecze', 'gracze', 'sezon', 'wiecej'];
const svg = name => `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function renderNav() {
    const badge = attentionCount();
    document.getElementById('side-nav').innerHTML = SIDE.map(v => `
        <a href="#${v}" class="side-link" ${S.view === v ? 'aria-current="page"' : ''}>${svg(v)}${VIEWS[v].short || VIEWS[v].title}
            ${v === 'pulpit' && badge ? `<span class="badge-count" title="Do zrobienia">${badge}</span>` : ''}</a>`).join('');
    document.getElementById('tab-nav').innerHTML = TABS.map(v => {
        const current = S.view === v || (v === 'wiecej' && ['puchar', 'system'].includes(S.view));
        return `<a href="#${v}" class="tab-link relative" ${current ? 'aria-current="page"' : ''}>${svg(v)}${VIEWS[v].short || VIEWS[v].title}
            ${v === 'pulpit' && badge ? `<span class="badge-dot">${badge}</span>` : ''}</a>`;
    }).join('');
}

function parseHash() {
    const [view, arg] = location.hash.replace('#', '').split('/');
    const legacy = { drafts: 'pulpit', results: 'mecze', matches: 'mecze', players: 'gracze', tips: 'gracze', cup: 'puchar', season: 'sezon' };
    const v = VIEWS[view] ? view : (legacy[view] || 'pulpit');
    S.view = v;
    S.arg = arg ? decodeURIComponent(arg) : null;
    if (v === 'mecze' && S.arg) S.round = Number(S.arg) || S.round;
    if (v === 'sezon' && S.arg) S.sub = S.arg;
}

function go(hash) {
    if (location.hash === `#${hash}`) render();
    else location.hash = hash;
}

/* ================= START I LOGOWANIE ================= */

document.addEventListener('DOMContentLoaded', async () => {
    T.registerSW();
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    window.addEventListener('hashchange', () => { parseHash(); render(); });
    document.getElementById('season-picker').addEventListener('change', async e => {
        S.season = Number(e.target.value);
        localStorage.setItem('adminSeason', S.season);
        S.round = null;
        S.resultEdits.clear();
        await loadAll();
    });
    window.addEventListener('beforeunload', e => { if (S.resultEdits.size) { e.preventDefault(); e.returnValue = ''; } });
    parseHash();
    if (S.token) {
        try { await api('GET', '/api/admin/whoami'); return showDashboard(); }
        catch (e) { sessionStorage.removeItem('adminToken'); }
    }
    showLogin();
});

function showLogin(message = '') {
    document.getElementById('login-modal').classList.remove('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('login-error').textContent = message;
    setTimeout(() => document.getElementById('admin-pass-input').focus(), 50);
}

window.loginAdmin = async function () {
    const input = document.getElementById('admin-pass-input');
    const err = document.getElementById('login-error');
    err.textContent = '';
    try {
        const out = await T.postJson('/api/admin/login', { password: input.value });
        S.token = out.token;
        sessionStorage.setItem('adminToken', S.token);
        input.value = '';
        showDashboard();
    } catch (e) {
        err.textContent = e.message;
    }
};

async function showDashboard() {
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    await loadAll();
}

/* ================= API ================= */

async function api(method, url, body) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-admin-token': S.token },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
        sessionStorage.removeItem('adminToken');
        showLogin('Sesja wygasła — zaloguj się ponownie.');
        throw new Error('Sesja wygasła');
    }
    if (!res.ok) throw Object.assign(new Error(data.error || `Błąd ${res.status}`), { status: res.status });
    return data;
}

const withSeason = body => ({ season: S.season || undefined, ...body });

function setBusy(btn, on) {
    if (!btn || !(btn instanceof HTMLElement)) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="animate-pulse">…</span>'; }
    else { btn.disabled = false; btn.removeAttribute('aria-busy'); if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

/* Licznik trwających operacji: pasek postępu u góry + body[data-busy] (używane też przez testy). */
let busyCount = 0;
function busy(delta) {
    busyCount = Math.max(0, busyCount + delta);
    if (busyCount) document.body.dataset.busy = '1'; else delete document.body.dataset.busy;
}

/**
 * Akcja z komunikatem i odświeżeniem danych. Zwraca odpowiedź albo null przy błędzie.
 * Komunikat pojawia się dopiero PO odświeżeniu ekranu - wcześniej admin mógłby zacząć
 * wpisywać coś w polu, które za chwilę zostanie przerysowane.
 * onDone - wywoływane po udanym zapisie, przed odświeżeniem (np. wyczyszczenie stanu ekranu).
 */
async function act(url, body, { btn = null, reload = true, quiet = false, onDone = null } = {}) {
    setBusy(btn, true);
    busy(+1);
    try {
        const out = await api('POST', url, withSeason(body || {}));
        if (onDone) onDone(out);
        if (reload) await loadAll();
        if (!quiet) T.toast(out.message || 'Gotowe');
        return out;
    } catch (e) {
        if (e.message !== 'Sesja wygasła') T.toast(e.message, 'err');
        return null;
    } finally {
        busy(-1);
        if (btn && btn.isConnected) setBusy(btn, false);
    }
}

async function loadAll() {
    busy(+1);
    try {
        const started = Date.now();
        S.data = await T.getJson('/api/public/data' + (S.season ? `?season=${S.season}` : ''));
        T.syncClock(S.data.serverTime, started);
        if (!S.season || S.season !== S.data.season.year) S.season = S.data.season.year;
        const [players, seasons, drafts, jobs, preds] = await Promise.all([
            api('GET', '/api/admin/players'),
            api('GET', '/api/admin/seasons'),
            api('GET', '/api/admin/drafts'),
            api('GET', '/api/admin/jobs').catch(() => null),
            api('GET', `/api/admin/predictions?season=${S.season}`)
        ]);
        Object.assign(S, { players, seasons, drafts, jobs, predictions: preds });
        // wyniki wpisane na ekranie, a w międzyczasie zapisane (albo usunięte mecze) - porządki
        for (const [id, v] of S.resultEdits) {
            const m = matchById(id);
            if (!m || (String(m.homeScore) === v.h && String(m.awayScore) === v.a)) S.resultEdits.delete(id);
        }
        render();
        if (sheet && sheet.rerender) sheet.rerender();
    } catch (e) {
        if (e.message !== 'Sesja wygasła') {
            document.getElementById('view').innerHTML = `<div class="card card-pad text-bad font-bold">Nie udało się pobrać danych: ${esc(e.message)}</div>`;
        }
    } finally {
        busy(-1);
    }
}

/* ================= POMOCNICZE ================= */

const lockMin = () => S.data.season.lockMinutes;
const matchById = id => S.data.matches.find(m => m._id === id);
const seasonInfo = () => S.seasons.find(s => s.year === S.season) || null;
const seasonTeams = () => (S.data.season.teams && S.data.season.teams.length) ? S.data.season.teams : [...new Set(S.data.matches.flatMap(m => [m.homeTeam, m.awayTeam]))];
const activePlayers = () => S.players.filter(p => p.isActive && p.seasons.includes(S.season));
const predOf = (nick, matchId) => S.predictions.find(p => p.nickname === nick && p.matchId === matchId) || null;
const rankOf = nick => (S.data.ranking || []).find(r => r.nickname === nick) || null;
const short = T.shortName;
const label = m => `${short(m.homeTeam)} – ${short(m.awayTeam)}`;
const when = m => `${T.fmtDay(m.matchDate)} · ${T.fmtTime(m.matchDate)}`;
const playerLink = token => `${location.origin}/typuj.html?id=${token}`;
const sortByDate = (a, b) => new Date(a.matchDate) - new Date(b.matchDate);
const notifyOn = () => { try { return localStorage.getItem('adminNotify') !== '0'; } catch (e) { return true; } };

function relTime(d) {
    if (!d) return 'nigdy';
    const diff = T.now() - new Date(d).getTime();
    if (diff < 60 * 1000) return 'przed chwilą';
    if (diff < HOUR) return `${Math.round(diff / 60000)} min temu`;
    if (diff < 24 * HOUR) return `${Math.round(diff / HOUR)} h temu`;
    const days = Math.round(diff / (24 * HOUR));
    return days === 1 ? 'wczoraj' : `${days} dni temu`;
}

/** Mecze, które powinny już mieć wynik (koniec ~2 h po starcie). */
function matchesNeedingResult() {
    const now = T.now();
    const draftIds = new Set(S.drafts.map(d => d.matchId));
    return S.data.matches.filter(m => !T.hasResult(m) && !m.isPostponed && !m.voidPredictions
        && new Date(m.matchDate).getTime() < now - 2 * HOUR && !draftIds.has(m._id)).sort(sortByDate);
}

function attentionCount() {
    if (!S.data) return 0;
    return S.drafts.length + matchesNeedingResult().length + S.data.matches.filter(m => m.isPostponed && !T.hasResult(m)).length;
}

async function copyText(text, okMsg = 'Skopiowano') {
    try { await navigator.clipboard.writeText(text); T.toast(okMsg); }
    catch (e) { window.prompt('Skopiuj ręcznie:', text); }
}

/* ================= SZUFLADA I POTWIERDZENIA ================= */

let sheet = null;

function openSheet({ title, subtitle = '', body = '', foot = '', rerender = null, onClose = null }) {
    closeSheet();
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop';
    wrap.innerHTML = `
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
            <div class="sheet-head">
                <div class="min-w-0 flex-1">
                    <h2 id="sheet-title" class="text-lg font-black leading-tight">${title}</h2>
                    ${subtitle ? `<p class="text-sm text-muted">${subtitle}</p>` : ''}
                </div>
                <button data-act="close-sheet" class="btn-ghost btn-sm !min-h-[36px] !px-2.5" aria-label="Zamknij">✕</button>
            </div>
            <div class="sheet-body">${body}</div>
            ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
        </div>`;
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) closeSheet(); });
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    sheet = { el: wrap, rerender, onClose };
    const first = wrap.querySelector('input:not([type=checkbox]):not([readonly]), select, textarea');
    if (first && window.innerWidth >= 640) first.focus();
    return wrap;
}

function closeSheet() {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    s.el.remove();
    document.body.style.overflow = '';
    if (s.onClose) s.onClose();
}

/** Okno potwierdzenia. danger = czerwony przycisk. Zwraca Promise<boolean>. */
function confirmBox({ title, message, confirm = 'Potwierdź', danger = false }) {
    return new Promise(resolve => {
        const prev = sheet;
        if (prev) { prev.el.style.display = 'none'; sheet = null; }
        const wrap = document.createElement('div');
        wrap.className = 'sheet-backdrop z-[95]';
        wrap.innerHTML = `
            <div class="sheet sm:max-w-sm" role="alertdialog" aria-modal="true" aria-labelledby="cf-title">
                <div class="sheet-body">
                    <h2 id="cf-title" class="text-lg font-black mb-1">${title}</h2>
                    <p class="text-sm text-muted">${message}</p>
                </div>
                <div class="sheet-foot">
                    <button class="btn-ghost flex-1" data-cf="0">Anuluj</button>
                    <button class="${danger ? 'btn bg-bad text-white' : 'btn-primary'} flex-1" data-cf="1">${confirm}</button>
                </div>
            </div>`;
        const done = v => {
            wrap.remove();
            if (prev) { prev.el.style.display = ''; sheet = prev; }
            else document.body.style.overflow = '';
            resolve(v);
        };
        wrap.addEventListener('click', e => {
            const b = e.target.closest('[data-cf]');
            if (b) done(b.dataset.cf === '1');
            else if (e.target === wrap) done(false);
        });
        wrap.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
        document.body.appendChild(wrap);
        document.body.style.overflow = 'hidden';
        wrap.querySelector('[data-cf="1"]').focus();
    });
}

/* ================= RENDEROWANIE ================= */

function render() {
    if (!S.data) return;
    const info = seasonInfo();
    document.getElementById('season-picker').innerHTML = S.data.seasons.map(s =>
        `<option value="${s.year}" ${s.year === S.season ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
    const state = document.getElementById('season-state');
    state.textContent = S.data.season.isFinished ? 'archiwum' : S.data.season.isActive ? 'aktywny' : 'nieaktywny';
    const warn = document.getElementById('season-warning');
    const active = S.data.seasons.find(s => s.isActive);
    if (S.data.season.isFinished) {
        warn.textContent = `Sezon ${S.season} jest zakończony (archiwum) — gracze nie mogą już typować. Zmiany wyników przeliczą ranking archiwalny.`;
        warn.classList.remove('hidden');
    } else if (!S.data.season.isActive) {
        warn.textContent = `Edytujesz sezon ${S.season}, który nie jest aktywny — gracze widzą teraz ${active ? active.label : 'inny sezon'}.`;
        warn.classList.remove('hidden');
    } else warn.classList.add('hidden');

    const v = VIEWS[S.view];
    document.getElementById('view-title').textContent = v.title;
    document.title = `${v.title} — panel admina`;
    renderNav();
    document.getElementById('view').innerHTML = v.render(info);
    renderSaveBar();
}

/* ---------------- PULPIT ---------------- */

function renderPulpit() {
    const now = T.now();
    const lock = lockMin();
    const ms = S.data.matches;
    const needResult = matchesNeedingResult();
    const postponed = ms.filter(m => m.isPostponed && !T.hasResult(m)).sort(sortByDate);
    const soon = ms.filter(m => !m.isPostponed && !m.voidPredictions && !T.hasResult(m) && !T.isLocked(m, lock, now)
        && T.lockTime(m, lock) - now < 48 * HOUR).sort(sortByDate);
    const players = activePlayers();
    const missing = soon.map(m => ({ m, who: players.filter(p => !predOf(p.nickname, m._id)) })).filter(x => x.who.length);
    const played = ms.filter(T.hasResult).length;
    const leader = (S.data.ranking || [])[0];

    const cards = [];

    if (S.drafts.length) {
        const clean = S.drafts.filter(d => !(d.blockers || []).length).length;
        cards.push(`
        <section class="todo-card border-l-brand">
            <div class="flex flex-wrap items-center gap-2 mb-1">
                <h2 class="section-title flex-1">📥 Wyniki do zatwierdzenia <span class="text-muted">(${S.drafts.length})</span></h2>
                ${clean > 1 ? `<button data-act="drafts-approve-all" class="btn-ok btn-sm">✓ Zatwierdź ${clean} bez uwag</button>` : ''}
            </div>
            <p class="text-sm text-muted mb-3">Pobrane automatycznie. Nic się nie liczy, dopóki nie zatwierdzisz — sprawdź fragment ze źródła. Liczby możesz poprawić przed zatwierdzeniem.</p>
            <label class="option-row !py-2 !border-0"><span class="text-sm font-semibold">Wyślij graczom powiadomienie z punktami</span>
                <input type="checkbox" class="switch" data-change="notify" ${notifyOn() ? 'checked' : ''}></label>
            <div class="space-y-3">${S.drafts.map(draftBlock).join('')}</div>
        </section>`);
    }

    if (needResult.length) {
        cards.push(`
        <section class="todo-card border-l-warn">
            <h2 class="section-title mb-1">⏱️ Mecze bez wyniku <span class="text-muted">(${needResult.length})</span></h2>
            <p class="text-sm text-muted mb-3">Powinny być już po zakończeniu. Wpisz wynik i zapisz — albo przełóż mecz w „Edytuj”.</p>
            <div class="divide-y divide-line">${needResult.map(m => resultRow(m)).join('')}</div>
        </section>`);
    }

    if (postponed.length) {
        cards.push(`
        <section class="todo-card border-l-bad">
            <h2 class="section-title mb-1">🌧️ Przełożone — ustal nowy termin <span class="text-muted">(${postponed.length})</span></h2>
            <p class="text-sm text-muted mb-3">Typy czekają. Gdy liga poda datę, wpisz ją — przypomnienia i blokada ruszą same.</p>
            <div class="divide-y divide-line">${postponed.map(m => `
                <div class="flex items-center gap-3 py-2.5">
                    <div class="min-w-0 flex-1"><div class="font-bold text-sm truncate">${esc(label(m))}</div>
                        <div class="text-xs text-muted">R${m.round} · pierwotnie ${T.fmtDateTime(m.originalDate || m.matchDate)}${m.predictionsFrozen ? ' · typy zamrożone' : ''}</div></div>
                    <button data-act="edit-match" data-id="${m._id}" data-focus="date" class="btn-primary btn-sm">Ustal termin</button>
                </div>`).join('')}</div>
        </section>`);
    }

    if (missing.length) {
        cards.push(`
        <section class="todo-card border-l-line">
            <h2 class="section-title mb-1">📝 Brakujące typy — najbliższe 48 h</h2>
            <p class="text-sm text-muted mb-3">Skopiuj przypomnienie i wklej na grupę. Gracze z włączonymi powiadomieniami dostaną je też automatycznie 2 h przed blokadą.</p>
            <div class="divide-y divide-line">${missing.map(({ m, who }) => `
                <div class="py-2.5">
                    <div class="flex items-center gap-2">
                        <div class="min-w-0 flex-1"><div class="font-bold text-sm truncate">${esc(label(m))}</div>
                            <div class="text-xs text-muted">${when(m)} · blokada ${T.fmtTime(T.lockTime(m, lock))} · brakuje ${who.length} z ${players.length}</div></div>
                        <button data-act="copy-reminder" data-id="${m._id}" class="btn-ghost btn-sm" aria-label="Kopiuj przypomnienie">📋 Kopiuj</button>
                    </div>
                    <div class="flex flex-wrap gap-1 mt-1.5">${who.map(p => `<span class="chip-muted">${esc(p.nickname)}</span>`).join('')}</div>
                </div>`).join('')}</div>
        </section>`);
    }

    if (!S.drafts.length && !needResult.length && !postponed.length) {
        cards.unshift(`<section class="card card-pad flex items-center gap-3">
            <span class="text-3xl" aria-hidden="true">✅</span>
            <div><h2 class="section-title">Wszystko gra</h2><p class="text-sm text-muted">Żaden wynik ani mecz nie czeka na Ciebie.</p></div>
        </section>`);
    }

    const lastScrape = S.jobs && S.jobs.runs.find(r => r.job === 'scrape');
    const urls = (seasonInfo() && seasonInfo().scraperUrls.length) ? seasonInfo().scraperUrls : (S.jobs ? S.jobs.scraper.envUrls : []);
    const push = S.jobs ? S.jobs.push : null;

    return `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        ${tile('Gracze', activePlayers().length, `${S.players.filter(p => !p.isActive).length} wstrzymanych`)}
        ${tile('Rozegrane', `${played}/${ms.length}`, 'meczów sezonu')}
        ${tile('Blokada', T.lockLabel(lock), 'przed 1. biegiem')}
        ${tile('Lider', leader ? esc(leader.nickname) : '—', leader ? `${leader.points} pkt` : '')}
    </div>
    <div class="space-y-4">${cards.join('')}</div>
    <section class="card card-pad mt-4">
        <h2 class="section-title mb-2">Stan systemu</h2>
        <dl>
            <div class="kv"><dt>Wyniki automatyczne</dt><dd>${urls.length ? `${urls.length} ${urls.length === 1 ? 'źródło' : 'źródła'}` : '<span class="text-warn">brak źródeł</span>'}</dd></div>
            <div class="kv"><dt>Ostatnie pobranie</dt><dd>${lastScrape ? `<span class="${lastScrape.ok ? 'text-ok' : 'text-bad'}">${lastScrape.ok ? '✓' : '✕'}</span> ${relTime(lastScrape.createdAt)}` : 'jeszcze nie było'}</dd></div>
            <div class="kv"><dt>Powiadomienia push</dt><dd>${push ? (push.enabled ? `włączone · ${push.subscriptions} urządzeń` : '<span class="text-warn">wyłączone (brak kluczy)</span>') : '—'}</dd></div>
        </dl>
        <div class="flex flex-wrap gap-2 mt-3">
            <button data-act="scrape-now" class="btn-ghost btn-sm">🔄 Pobierz wyniki teraz</button>
            <a href="#sezon/auto" class="btn-ghost btn-sm">Źródła wyników</a>
            <a href="#system" class="btn-ghost btn-sm">Powiadomienia</a>
        </div>
        ${lastScrape && lastScrape.summary ? `<p class="text-xs text-muted mt-2">${esc(lastScrape.summary)}</p>` : ''}
    </section>`;
}

function tile(title, value, sub) {
    return `<div class="card p-3"><div class="eyebrow">${title}</div><div class="text-xl font-black truncate">${value}</div><div class="text-xs text-muted truncate">${sub}</div></div>`;
}

function draftBlock(d) {
    const m = d.match || {};
    const blocked = (d.blockers || []).length > 0;
    return `
    <div class="rounded-2xl border ${blocked ? 'border-bad/50' : (d.warnings || []).length ? 'border-warn/50' : 'border-line'} p-3" data-draft="${d._id}">
        <div class="flex items-center justify-between gap-2">
            <span class="eyebrow">R${m.round || '?'} · ${m.matchDate ? T.fmtDateTime(m.matchDate) : ''}${m.isMatchOfTheRound ? ' · ⭐ Kask' : ''}</span>
            <a href="${/^https?:\/\//.test(d.sourceUrl || '') ? esc(d.sourceUrl) : '#'}" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-brand truncate max-w-[45%]">${esc(d.source || 'źródło')} ↗</a>
        </div>
        ${scoreLine(m.homeTeam || '?', m.awayTeam || '?', `data-draft-h value="${d.homeScore}"`, `data-draft-a value="${d.awayScore}"`)}
        <p class="text-center text-xs text-muted mt-1" data-sum>suma ${d.homeScore + d.awayScore} / 90${T.hasResult(m) ? ` · w bazie ${m.homeScore}:${m.awayScore}` : ''}</p>
        ${(d.blockers || []).map(b => `<p class="mt-2 text-sm font-bold text-bad">⛔ ${esc(b)}</p>`).join('')}
        ${(d.warnings || []).map(w => `<p class="mt-1 text-sm text-warn">⚠️ ${esc(w)}</p>`).join('')}
        ${d.snippet ? `<blockquote class="mt-2 rounded-xl bg-raised px-3 py-2 text-xs text-muted border-l-4 border-line">„${esc(d.snippet)}”</blockquote>` : ''}
        <div class="flex gap-2 mt-3">
            <button data-act="draft-approve" data-id="${d._id}" class="btn-ok flex-1">✓ Zatwierdź</button>
            <button data-act="draft-reject" data-id="${d._id}" class="btn-ghost">Odrzuć</button>
        </div>
    </div>`;
}

/** Linia: gospodarz [__] : [__] gość - wspólna dla draftów, wyników i typów. */
function scoreLine(home, away, homeAttrs, awayAttrs, cls = '') {
    return `
    <div class="grid grid-cols-[1fr_auto_auto_auto_1fr] items-center gap-2 mt-2">
        <span class="text-right font-bold text-sm leading-tight">${esc(short(home))}</span>
        <input type="number" inputmode="numeric" min="0" max="75" class="mini-score ${cls}" aria-label="Gospodarze: ${esc(home)}" ${homeAttrs}>
        <span class="text-lg font-black text-faint">:</span>
        <input type="number" inputmode="numeric" min="0" max="75" class="mini-score ${cls}" aria-label="Goście: ${esc(away)}" ${awayAttrs}>
        <span class="font-bold text-sm leading-tight">${esc(short(away))}</span>
    </div>`;
}

/** Pola wyniku meczu (z niezapisaną wartością, jeśli admin coś już wpisał). */
function resultLine(m) {
    const edit = S.resultEdits.get(m._id);
    const h = edit ? edit.h : (m.homeScore ?? ''), a = edit ? edit.a : (m.awayScore ?? '');
    return scoreLine(m.homeTeam, m.awayTeam,
        `data-res="h" data-id="${m._id}" value="${h}"`, `data-res="a" data-id="${m._id}" value="${a}"`, edit ? 'changed' : '');
}

function resultRow(m) {
    return `<div class="py-3" data-row="${m._id}">
        <div class="flex items-center gap-2 text-xs text-muted"><span class="flex-1">R${m.round} · ${when(m)}</span>
            <button data-act="edit-match" data-id="${m._id}" class="font-bold text-brand">Edytuj</button></div>
        ${resultLine(m)}
        <p class="text-center text-xs text-muted mt-1" data-hint-for="${m._id}">${resultHint(m)}</p>
    </div>`;
}

function resultHint(m) {
    const e = S.resultEdits.get(m._id);
    const h = e ? e.h : m.homeScore, a = e ? e.a : m.awayScore;
    if (h === '' || a === '' || h === null || a === null || h === undefined) return T.hasResult(m) ? '' : 'Pełny mecz: suma 90 pkt';
    const sum = Number(h) + Number(a);
    if (sum > 90) return `<span class="text-bad font-bold">Suma ${sum} > 90 — niemożliwe w 15 biegach</span>`;
    if (sum < 48) return `<span class="text-bad font-bold">Suma ${sum} — mniej niż 8 biegów</span>`;
    if (sum < 84) return `<span class="text-warn">Suma ${sum} — mecz skrócony / upadki?</span>`;
    return `<span class="text-ok">Suma ${sum} ✓</span>`;
}

/* ---------------- MECZE ---------------- */

function rounds() { return [...new Set(S.data.matches.map(m => m.round))].sort((a, b) => a - b); }

function defaultRound() {
    const now = T.now();
    const todo = S.data.matches.filter(m => !T.hasResult(m) && !m.isPostponed && !m.voidPredictions)
        .sort(sortByDate);
    const past = todo.find(m => new Date(m.matchDate).getTime() < now);
    if (past) return past.round;
    if (todo[0]) return todo[0].round;
    const all = rounds();
    return all[all.length - 1] || 1;
}

function renderMecze() {
    const all = rounds();
    if (!all.length) {
        return `<div class="card card-pad"><h2 class="section-title">Brak terminarza</h2>
            <p class="text-sm text-muted mt-1">Wygeneruj kolejki albo zaimportuj terminarz w zakładce Sezon.</p>
            <div class="flex gap-2 mt-3"><a href="#sezon/sezony" class="btn-primary btn-sm">Terminarz sezonu</a>
            <button data-act="add-match" class="btn-ghost btn-sm">+ Dodaj mecz ręcznie</button></div></div>`;
    }
    if (!S.round || !all.includes(S.round)) S.round = defaultRound();
    const now = T.now();
    const ms = S.data.matches.filter(m => m.round === S.round).sort(sortByDate);
    const chips = all.map(r => {
        const rm = S.data.matches.filter(m => m.round === r);
        const todo = rm.some(m => !T.hasResult(m) && !m.isPostponed && !m.voidPredictions && new Date(m.matchDate).getTime() < now - 2 * HOUR);
        const name = T.roundName(r, S.data.season.stageNames);
        return `<a href="#mecze/${r}" class="round-chip gap-1.5" aria-current="${r === S.round}" title="${esc(name)}">${/^Runda \d+$/.test(name) ? `R${r}` : esc(name)}
            ${todo ? '<span class="w-2 h-2 rounded-full bg-warn" aria-label="brak wyniku"></span>' : ''}</a>`;
    }).join('');
    const first = ms[0], last = ms[ms.length - 1];
    return `
    <div class="scroller mb-3" aria-label="Kolejki">${chips}</div>
    <div class="flex items-center gap-2 mb-3">
        <div class="min-w-0 flex-1">
            <h2 class="section-title">${esc(T.roundName(S.round, S.data.season.stageNames))}</h2>
            <p class="text-xs text-muted">${first ? `${T.fmtDay(first.matchDate)}${last !== first ? ` – ${T.fmtDay(last.matchDate)}` : ''} · ${ms.length} mecze` : ''}</p>
        </div>
        <button data-act="add-match" class="btn-ghost btn-sm">+ Mecz</button>
    </div>
    <div class="grid gap-3 lg:grid-cols-2">${ms.map(matchCard).join('')}</div>
    <p class="text-xs text-muted mt-4">Wyniki wpisujesz bezpośrednio na kartach — pojawi się pasek „Zapisz”. Przełożenie, walkower, Złoty Kask i usuwanie meczu: przycisk „Edytuj”.</p>`;
}

function matchCard(m) {
    const st = T.matchStatus(m, lockMin());
    const draft = S.drafts.find(d => d.matchId === m._id);
    const players = activePlayers();
    const open = S.openPreds.has(m._id);
    const typed = S.predictions.filter(p => p.matchId === m._id).length;
    const flags = [
        m.isMatchOfTheRound ? '<span class="chip-gold">⭐ Kask</span>' : '',
        m.resultSource === 'scraper' ? '<span class="chip-muted" title="Wynik zatwierdzony ze scrapera">🤖</span>' : ''
    ].join('');
    return `
    <article class="card card-pad" data-card="${m._id}">
        <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-bold text-muted">${when(m)}</span>
            <span class="flex flex-wrap justify-end gap-1">${flags}<span class="${st.cls}">${esc(st.text)}</span></span>
        </div>
        ${resultLine(m)}
        <p class="text-center text-xs text-muted mt-1" data-hint-for="${m._id}">${resultHint(m)}</p>
        ${m.originalDate ? `<p class="text-center text-xs text-muted">Przełożony z ${T.fmtDateTime(m.originalDate)}</p>` : ''}
        ${m.note ? `<p class="text-center text-xs text-muted italic">${esc(m.note)}</p>` : ''}
        ${draft ? `<div class="mt-2 flex items-center gap-2 rounded-xl bg-brand/5 border border-brand/20 px-3 py-2 text-sm">
            <span class="flex-1">🤖 Scraper: <strong class="tabular-nums">${draft.homeScore}:${draft.awayScore}</strong>${(draft.blockers || []).length ? ' <span class="text-bad font-bold">⛔</span>' : (draft.warnings || []).length ? ' ⚠️' : ''}</span>
            <a href="#pulpit" class="font-bold text-brand text-xs">sprawdź</a></div>` : ''}
        <div class="flex items-center gap-2 mt-3">
            <button data-act="toggle-preds" data-id="${m._id}" class="btn-ghost btn-sm" aria-expanded="${open}">Typy ${typed}/${players.length} ${open ? '▴' : '▾'}</button>
            <span class="flex-1"></span>
            <button data-act="edit-match" data-id="${m._id}" class="btn-ghost btn-sm">Edytuj</button>
        </div>
        <div class="${open ? '' : 'hidden '}mt-3" data-preds="${m._id}">${open ? predsPanel(m) : ''}</div>
    </article>`;
}

/** Typy wszystkich graczy na jeden mecz - admin może wpisać / poprawić (omija blokadę). */
function predsPanel(m) {
    const players = activePlayers();
    const extra = S.predictions.filter(p => p.matchId === m._id && !players.some(x => x.nickname === p.nickname))
        .map(p => ({ nickname: p.nickname, isActive: false }));
    const rows = [...players, ...extra].map(p => tipRow(p.nickname, m)).join('');
    return `<div class="rounded-xl bg-raised border border-line p-2">
        <p class="text-xs text-muted px-1 pb-1">Zmiana typu przez admina omija blokadę — np. gdy ktoś podał typ SMS-em.</p>
        <div class="divide-y divide-line">${rows || '<p class="text-sm text-muted p-2">Brak graczy w sezonie.</p>'}</div></div>`;
}

function tipRow(nick, m, withMatchLabel = false) {
    const p = predOf(nick, m._id);
    const key = `${nick}|${m._id}`;
    const who = withMatchLabel ? `${esc(label(m))} <span class="text-xs font-semibold text-muted">${T.fmtDay(m.matchDate)} ${T.fmtTime(m.matchDate)}</span>` : esc(nick);
    return `<div class="py-2 px-1" data-tip="${esc(key)}">
        <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 text-sm font-bold truncate">${who}</span>
            ${p && p.pointsEarned !== null && p.pointsEarned !== undefined ? `<span class="chip ${p.pointsEarned > 0 ? 'chip-ok' : 'chip-muted'} tabular-nums">+${p.pointsEarned} pkt</span>` : ''}
            ${p ? '' : '<span class="chip-warn">brak typu</span>'}
        </div>
        <div class="flex flex-wrap items-center gap-2 mt-1.5">
            <span class="flex items-center gap-1.5">
                <input type="number" inputmode="numeric" min="0" max="75" class="mini-score !w-12 !h-10 !text-base" aria-label="${esc(nick)}: typ gospodarzy" data-tip-h value="${p ? p.homePred : ''}">
                <span class="font-black text-faint">:</span>
                <input type="number" inputmode="numeric" min="0" max="75" class="mini-score !w-12 !h-10 !text-base" aria-label="${esc(nick)}: typ gości" data-tip-a value="${p ? p.awayPred : ''}">
            </span>
            <label class="flex items-center gap-1 text-xs font-bold text-gold" title="Joker"><input type="checkbox" class="w-5 h-5" data-tip-j ${p && p.usedJoker ? 'checked' : ''}>⭐<span class="sr-only sm:not-sr-only">Joker</span></label>
            <span class="flex-1"></span>
            <span class="flex gap-2">
                ${p ? `<button data-act="delete-tip" data-key="${esc(key)}" class="btn-ghost btn-sm !min-h-[40px] !px-3" aria-label="Usuń typ ${esc(nick)}">✕</button>` : ''}
                <button data-act="save-tip" data-key="${esc(key)}" class="btn-primary btn-sm !min-h-[40px]">Zapisz</button>
            </span>
        </div>
    </div>`;
}

/* Pasek zapisu wyników (gdy coś wpisano na kartach) */
function renderSaveBar() {
    let bar = document.getElementById('savebar');
    const n = S.resultEdits.size;
    if (!n || !['mecze', 'pulpit'].includes(S.view)) { if (bar) bar.remove(); return; }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'savebar';
        bar.className = 'fixed inset-x-0 z-40 px-4 bottom-[calc(64px_+_env(safe-area-inset-bottom))] lg:bottom-4 lg:left-64';
        document.body.appendChild(bar);
    }
    bar.innerHTML = `<div class="mx-auto max-w-xl card flex flex-wrap items-center gap-2 p-2.5 shadow-xl border-warn/50">
        <span class="text-sm font-bold flex-1 min-w-[8rem]">Niezapisane wyniki: ${n}</span>
        <label class="flex items-center gap-2 text-xs font-semibold text-muted"><input type="checkbox" class="switch" data-change="notify" ${notifyOn() ? 'checked' : ''}>push</label>
        <button data-act="discard-results" class="btn-ghost btn-sm">Cofnij</button>
        <button data-act="save-results" class="btn-ok btn-sm">Zapisz wyniki</button>
    </div>`;
}

/* ---------------- EDYCJA MECZU ---------------- */

function toLocalInput(date) {
    const d = new Date(date);
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    return parts.replace(' ', 'T');
}

/** "2027-05-01T18:00" w czasie polskim -> ISO (niezależnie od strefy telefonu admina). */
function fromLocalInput(value) {
    const [date, time] = value.split('T');
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const offset = tz => {
        const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(tz));
        const g = t => Number(p.find(x => x.type === t).value);
        return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute')) - tz) / 60000;
    };
    let ts = guess - offset(guess) * 60000;
    const again = guess - offset(ts) * 60000;
    if (again !== ts) ts = again;
    return new Date(ts).toISOString();
}

/** Podpowiedź w edycji meczu: czy przełożenie zamrozi typy. Wywoływana z onInput/onChange. */
function editorHint() {
    if (!sheet || !sheet.matchId) return;
    const m = matchById(sheet.matchId);
    const date = sheet.el.querySelector('#ed-date'), post = sheet.el.querySelector('#ed-postponed');
    if (!m || !date || !post) return;
    const dateChanged = date.value !== date.dataset.orig;
    const becamePostponed = post.checked && !m.isPostponed;
    const willFreeze = T.isLocked(m, lockMin()) && !T.hasResult(m) && !m.predictionsFrozen && (dateChanged || becamePostponed);
    sheet.el.querySelector('#ed-freeze-hint').classList.toggle('hidden', !willFreeze);
}

function openMatchEditor(id, focus) {
    const render = () => {
        const m = matchById(id);
        if (!m) { closeSheet(); return; }
        const lock = lockMin();
        const typed = S.predictions.filter(p => p.matchId === m._id).length;
        const hasRes = T.hasResult(m);
        const body = `
        <dl class="mb-3">
            <div class="kv"><dt>Typy</dt><dd>${typed} graczy</dd></div>
            <div class="kv"><dt>Blokada typów</dt><dd>${m.isPostponed ? 'czeka na nowy termin' : T.fmtDateTime(T.lockTime(m, lock))}</dd></div>
            ${m.originalDate ? `<div class="kv"><dt>Pierwotny termin</dt><dd>${T.fmtDateTime(m.originalDate)}</dd></div>` : ''}
            ${hasRes ? `<div class="kv"><dt>Wynik</dt><dd>${m.homeScore}:${m.awayScore}${m.isWalkover ? ' (walkower)' : ''}</dd></div>` : ''}
        </dl>

        <h3 class="eyebrow mt-4 mb-1">Termin</h3>
        <label class="label" for="ed-date">Pierwszy bieg (czas polski)</label>
        <input type="datetime-local" id="ed-date" class="input" value="${toLocalInput(m.matchDate)}" data-orig="${toLocalInput(m.matchDate)}">
        <p id="ed-freeze-hint" class="text-xs text-warn font-bold mt-1 hidden">Typy na ten mecz były już jawne — po przełożeniu zostaną zamrożone.</p>
        <label class="option-row"><span><span class="font-bold">Przełożony, termin nieznany</span><span class="hint block">Typy zostają. Gdy liga poda datę, wpisz ją powyżej — mecz wróci do gry.</span></span>
            <input type="checkbox" class="switch" id="ed-postponed" ${m.isPostponed ? 'checked' : ''}></label>

        <h3 class="eyebrow mt-4 mb-1">Mecz</h3>
        <label class="option-row"><span><span class="font-bold">⭐ Złoty Kask (mecz kolejki)</span><span class="hint block">Trafienie za ${S.data.season.scoring.exact} lub ${S.data.season.scoring.diff} pkt daje +${S.data.season.scoring.motrBonus}.</span></span>
            <input type="checkbox" class="switch" id="ed-motr" ${m.isMatchOfTheRound ? 'checked' : ''}></label>
        <label class="option-row"><span><span class="font-bold">🔒 Typy zamrożone</span><span class="hint block">Nikt nie zmieni typu, nawet przed nową datą. Włącza się samo przy przełożeniu po blokadzie.</span></span>
            <input type="checkbox" class="switch" id="ed-frozen" ${m.predictionsFrozen ? 'checked' : ''}></label>
        <label class="option-row"><span><span class="font-bold">Mecz odwołany — anuluj typy</span><span class="hint block">Nikt nie dostaje punktów, Joker wraca do gracza.</span></span>
            <input type="checkbox" class="switch" id="ed-void" ${m.voidPredictions && !m.isWalkover ? 'checked' : ''} ${m.isWalkover ? 'disabled' : ''}></label>
        <div class="grid grid-cols-[6rem_1fr] gap-2 mt-3">
            <div><label class="label" for="ed-round">Kolejka</label><input type="number" id="ed-round" class="input" min="1" max="99" value="${m.round}"></div>
            <div><label class="label" for="ed-note">Notatka dla graczy</label><input type="text" id="ed-note" class="input" maxlength="300" value="${esc(m.note || '')}" placeholder="np. przerwany po 11 biegach (deszcz)"></div>
        </div>

        <h3 class="eyebrow mt-5 mb-1">Walkower</h3>
        ${m.isWalkover
            ? `<p class="text-sm text-muted mb-2">Mecz zakończony walkowerem ${m.homeScore}:${m.awayScore}. Typy anulowane.</p>
               <button data-act="walkover-undo" data-id="${m._id}" class="btn-ghost btn-sm">Cofnij walkower (usuń wynik)</button>`
            : `<p class="text-sm text-muted mb-2">Wynik liczy się do tabeli ligi, typy graczy są anulowane, Joker wraca do gracza.</p>
               <div class="flex flex-wrap gap-2">
                    <button data-act="walkover" data-id="${m._id}" data-h="40" data-a="0" class="btn-ghost btn-sm">Dla ${esc(short(m.homeTeam))} (40:0)</button>
                    <button data-act="walkover" data-id="${m._id}" data-h="0" data-a="40" class="btn-ghost btn-sm">Dla ${esc(short(m.awayTeam))} (0:40)</button>
               </div>`}

        <h3 class="eyebrow mt-5 mb-1 text-bad">Strefa ryzyka</h3>
        <div class="flex flex-wrap gap-2">
            ${hasRes ? `<button data-act="clear-result" data-id="${m._id}" class="btn-danger btn-sm">Wyczyść wynik</button>` : ''}
            <button data-act="delete-match" data-id="${m._id}" class="btn-danger btn-sm">Usuń mecz${typed ? ` (i ${typed} typów)` : ''}</button>
        </div>`;
        const el = sheet && sheet.matchId === id ? sheet.el : null;
        if (el) { el.querySelector('.sheet-body').innerHTML = body; return; }
        openSheet({
            title: esc(label(m)),
            subtitle: `${esc(T.roundName(m.round, S.data.season.stageNames))} · ${when(m)}`,
            body,
            foot: `<button data-act="close-sheet" class="btn-ghost flex-1">Anuluj</button><button data-act="save-match" data-id="${m._id}" class="btn-primary flex-1">Zapisz zmiany</button>`,
            rerender: render
        });
        sheet.matchId = id;
        if (focus === 'date') setTimeout(() => sheet && sheet.el.querySelector('#ed-date').focus(), 50);
    };
    render();
}

async function saveMatch(btn) {
    const m = matchById(btn.dataset.id);
    if (!m) return;
    const q = id => sheet.el.querySelector(id);
    const body = { matchId: m._id };
    const dateVal = q('#ed-date').value;
    if (dateVal && dateVal !== q('#ed-date').dataset.orig) body.matchDate = fromLocalInput(dateVal);
    const postponed = q('#ed-postponed').checked;
    if (postponed !== !!m.isPostponed && !body.matchDate) body.isPostponed = postponed;
    if (q('#ed-motr').checked !== !!m.isMatchOfTheRound) body.isMatchOfTheRound = q('#ed-motr').checked;
    const frozen = q('#ed-frozen').checked;
    if (frozen !== !!m.predictionsFrozen) {
        if (!frozen && !(await confirmBox({ title: 'Odmrozić typy?', message: 'Gracze widzieli już cudze typy na ten mecz. Odmrożenie pozwoli im poprawić swoje, znając typy innych.', confirm: 'Odmroź', danger: true }))) return;
        body.predictionsFrozen = frozen;
    }
    if (!m.isWalkover && q('#ed-void').checked !== !!m.voidPredictions) body.voidPredictions = q('#ed-void').checked;
    const round = Number(q('#ed-round').value);
    if (round && round !== m.round) body.round = round;
    if (q('#ed-note').value !== (m.note || '')) body.note = q('#ed-note').value;
    if (Object.keys(body).length === 1) { closeSheet(); return T.toast('Bez zmian'); }
    if (body.voidPredictions && !(await confirmBox({ title: 'Anulować typy?', message: `Wszystkie typy na ${esc(label(m))} przestaną się liczyć.`, confirm: 'Anuluj typy', danger: true }))) return;
    const out = await act('/api/admin/match-edit', body, { btn });
    if (out) {
        closeSheet();
        if (body.round) go(`mecze/${body.round}`);
    }
}

function openAddMatch() {
    const teams = seasonTeams();
    const opts = teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    openSheet({
        title: 'Nowy mecz',
        subtitle: 'Np. baraż albo mecz dopisany przez ligę',
        body: `
        <div class="grid grid-cols-2 gap-2">
            <div><label class="label" for="am-round">Kolejka</label><input type="number" id="am-round" class="input" min="1" max="99" value="${S.round || 1}"></div>
            <div><label class="label" for="am-date">Pierwszy bieg</label><input type="datetime-local" id="am-date" class="input"></div>
            <div><label class="label" for="am-home">Gospodarz</label><select id="am-home" class="input">${opts}</select></div>
            <div><label class="label" for="am-away">Gość</label><select id="am-away" class="input">${opts}</select></div>
        </div>
        <label class="option-row mt-2"><span class="font-bold">⭐ Złoty Kask</span><input type="checkbox" class="switch" id="am-motr"></label>`,
        foot: `<button data-act="close-sheet" class="btn-ghost flex-1">Anuluj</button><button data-act="add-match-save" class="btn-primary flex-1">Dodaj mecz</button>`
    });
    if (teams[1]) sheet.el.querySelector('#am-away').value = teams[1];
}

/* ---------------- GRACZE ---------------- */

function renderGracze() {
    const q = S.search.trim().toLowerCase();
    const list = S.players.filter(p => {
        if (S.playerFilter === 'season' && !p.seasons.includes(S.season)) return false;
        if (S.playerFilter === 'blocked' && p.isActive) return false;
        return !q || p.nickname.toLowerCase().includes(q) || (p.fullName || '').toLowerCase().includes(q);
    }).sort((a, b) => (rankOf(a.nickname)?.position || 999) - (rankOf(b.nickname)?.position || 999) || a.nickname.localeCompare(b.nickname, 'pl'));
    const counts = {
        season: S.players.filter(p => p.seasons.includes(S.season)).length,
        all: S.players.length,
        blocked: S.players.filter(p => !p.isActive).length
    };
    const seg = (key, text) => `<button data-act="player-filter" data-filter="${key}" aria-current="${S.playerFilter === key}">${text} (${counts[key]})</button>`;
    return `
    <div class="flex flex-wrap items-center gap-2 mb-3">
        <input type="search" class="input flex-1 min-w-[10rem]" placeholder="Szukaj gracza…" value="${esc(S.search)}" data-input="search" aria-label="Szukaj gracza">
        <button data-act="add-player" class="btn-primary">+ Dodaj gracza</button>
    </div>
    <div class="seg mb-3" role="tablist">${seg('season', `W sezonie ${S.season}`)}${seg('all', 'Wszyscy')}${seg('blocked', 'Wstrzymani')}</div>
    <div class="card overflow-hidden"><ul class="divide-y divide-line">
        ${list.length ? list.map(playerRow).join('') : '<li class="p-4 text-sm text-muted">Nikogo nie znaleziono.</li>'}
    </ul></div>
    <p class="text-xs text-muted mt-3">Link gracza jest jego hasłem. „Nowy link” w karcie gracza działa jak reset hasła — stary przestaje działać.</p>`;
}

function playerRow(p) {
    const r = rankOf(p.nickname);
    const inSeason = p.seasons.includes(S.season);
    const typed = S.predictions.filter(x => x.nickname === p.nickname).length;
    return `<li><button data-act="open-player" data-nick="${esc(p.nickname)}" class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised">
        <span class="w-10 h-10 rounded-full bg-night text-white flex items-center justify-center text-sm font-black shrink-0" aria-hidden="true">${esc(p.nickname.slice(0, 2).toUpperCase())}</span>
        <span class="min-w-0 flex-1">
            <span class="flex flex-wrap items-center gap-1.5"><span class="font-bold truncate">${esc(p.nickname)}</span>
                ${p.isActive ? '' : '<span class="chip-bad">wstrzymany</span>'}
                ${inSeason ? '' : '<span class="chip-muted">poza sezonem</span>'}</span>
            <span class="block text-xs text-muted truncate">${p.fullName ? `${esc(p.fullName)} · ` : ''}${typed} typów · ostatnio ${relTime(p.lastSeenAt)}</span>
        </span>
        ${r ? `<span class="text-right"><span class="block text-lg font-black tabular-nums">${r.points}</span><span class="text-xs text-muted">${r.position}. miejsce</span></span>` : ''}
    </button></li>`;
}

function openPlayer(nick) {
    let current = nick;
    let tipRound = null;
    const render = () => {
        const p = S.players.find(x => x.nickname === current);
        if (!p) { closeSheet(); return; }
        const r = rankOf(p.nickname);
        const inSeason = p.seasons.includes(S.season);
        const link = playerLink(p.token);
        const lt = (S.data.longTerms || []).find(l => l.nickname === p.nickname);
        const allRounds = rounds();
        if (!tipRound || !allRounds.includes(tipRound)) tipRound = S.round && allRounds.includes(S.round) ? S.round : defaultRound();
        const teams = seasonTeams();
        const teamOpts = sel => '<option value="">—</option>' + teams.map(t => `<option value="${esc(t)}" ${sel === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
        const body = `
        <dl class="mb-2">
            ${r ? `<div class="kv"><dt>Ranking ${S.season}</dt><dd>${r.position}. miejsce · ${r.points} pkt</dd></div>` : ''}
            <div class="kv"><dt>Ostatnio w aplikacji</dt><dd>${relTime(p.lastSeenAt)}</dd></div>
            <div class="kv"><dt>Sezony</dt><dd>${p.seasons.join(', ') || '—'}</dd></div>
        </dl>

        <h3 class="eyebrow mt-4 mb-1">Link do typowania (= hasło gracza)</h3>
        <input type="text" readonly class="input font-mono text-xs" value="${esc(link)}" aria-label="Link gracza" onfocus="this.select()">
        <div class="flex flex-wrap gap-2 mt-2">
            <button data-act="copy-link" data-nick="${esc(p.nickname)}" class="btn-primary btn-sm">Kopiuj link</button>
            <a class="btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Twój panel typera (nie udostępniaj nikomu): ${link}`)}">WhatsApp</a>
            <button data-act="new-token" data-nick="${esc(p.nickname)}" class="btn-ghost btn-sm">Nowy link (reset)</button>
            <button data-act="push-test-player" data-nick="${esc(p.nickname)}" class="btn-ghost btn-sm">Test powiadomienia</button>
        </div>

        <h3 class="eyebrow mt-5 mb-1">Konto</h3>
        <label class="option-row"><span><span class="font-bold">Konto aktywne</span><span class="hint block">Wstrzymany gracz widzi swój panel, ale nie może typować.</span></span>
            <input type="checkbox" class="switch" data-act="toggle-active" data-nick="${esc(p.nickname)}" ${p.isActive ? 'checked' : ''}></label>
        <label class="option-row"><span><span class="font-bold">Gra w sezonie ${S.season}</span><span class="hint block">Widoczny w rankingu i dostaje przypomnienia.</span></span>
            <input type="checkbox" class="switch" data-act="toggle-season" data-nick="${esc(p.nickname)}" ${inSeason ? 'checked' : ''}></label>
        <div class="grid grid-cols-2 gap-2 mt-3">
            <div><label class="label" for="pl-nick">Pseudonim</label><input id="pl-nick" class="input" maxlength="30" value="${esc(p.nickname)}"></div>
            <div><label class="label" for="pl-name">Imię i nazwisko</label><input id="pl-name" class="input" maxlength="80" value="${esc(p.fullName || '')}"></div>
        </div>
        <button data-act="rename-player" data-nick="${esc(p.nickname)}" class="btn-ghost btn-sm mt-2">Zapisz dane</button>

        <h3 class="eyebrow mt-5 mb-1">Typy gracza (admin omija blokadę)</h3>
        ${allRounds.length ? `<select class="input mb-2" data-change="tip-round" aria-label="Kolejka">${allRounds.map(x => `<option value="${x}" ${x === tipRound ? 'selected' : ''}>${esc(T.roundName(x, S.data.season.stageNames))}</option>`).join('')}</select>
        <div class="rounded-xl bg-raised border border-line divide-y divide-line">${S.data.matches.filter(m => m.round === tipRound).sort(sortByDate).map(m => tipRow(p.nickname, m, true)).join('')}</div>` : '<p class="text-sm text-muted">Brak terminarza.</p>'}

        <h3 class="eyebrow mt-5 mb-1">Typy sezonowe</h3>
        <div class="grid sm:grid-cols-3 gap-2">
            <div><label class="label" for="pl-lt-c">🥇 Mistrz</label><select id="pl-lt-c" class="input">${teamOpts(lt && lt.champion)}</select></div>
            <div><label class="label" for="pl-lt-b">🥉 Brąz</label><select id="pl-lt-b" class="input">${teamOpts(lt && lt.bronze)}</select></div>
            <div><label class="label" for="pl-lt-r">⬇️ Spadek</label><select id="pl-lt-r" class="input">${teamOpts(lt && lt.relegation)}</select></div>
        </div>
        ${S.data.longTermOpen ? '' : '<p class="text-xs text-muted mt-1">Zakryte dla graczy do startu sezonu — tu widzisz je zawsze po zapisaniu.</p>'}
        <button data-act="save-longterm" data-nick="${esc(p.nickname)}" class="btn-ghost btn-sm mt-2">Zapisz typy sezonowe</button>

        <h3 class="eyebrow mt-5 mb-1 text-bad">Strefa ryzyka</h3>
        <div class="flex flex-wrap gap-2">
            ${inSeason ? `<button data-act="delete-player-season" data-nick="${esc(p.nickname)}" class="btn-danger btn-sm">Usuń typy z sezonu ${S.season}</button>` : ''}
            <button data-act="delete-player" data-nick="${esc(p.nickname)}" class="btn-danger btn-sm">Usuń gracza całkowicie</button>
        </div>`;
        if (sheet && sheet.player) {
            const keepScroll = sheet.el.querySelector('.sheet').scrollTop;
            sheet.el.querySelector('#sheet-title').textContent = p.nickname;
            sheet.el.querySelector('.sheet-body').innerHTML = body;
            sheet.el.querySelector('.sheet').scrollTop = keepScroll;
            return;
        }
        openSheet({ title: esc(p.nickname), subtitle: esc(p.fullName || ''), body, rerender: render });
        sheet.player = true;
    };
    render();
    sheet.setPlayer = nick2 => { current = nick2; };
    sheet.setTipRound = r => { tipRound = r; render(); };
}

function openAddPlayer() {
    openSheet({
        title: 'Nowy gracz',
        subtitle: `Zostanie dopisany do sezonu ${S.season}`,
        body: `
        <div class="grid gap-2">
            <div><label class="label" for="np-nick">Pseudonim (widoczny w rankingu)</label><input id="np-nick" class="input" maxlength="30" autocomplete="off"></div>
            <div><label class="label" for="np-name">Imię i nazwisko (opcjonalnie)</label><input id="np-name" class="input" maxlength="80" autocomplete="off"></div>
        </div>`,
        foot: `<button data-act="close-sheet" class="btn-ghost flex-1">Anuluj</button><button data-act="add-player-save" class="btn-primary flex-1">Dodaj</button>`
    });
}

/* ---------------- PUCHAR ---------------- */

function renderPuchar() {
    const cups = S.data.cupMatches || [];
    const players = activePlayers();
    const popts = '<option value="">—</option>' + players.map(p => `<option value="${esc(p.nickname)}">${esc(p.nickname)}</option>`).join('');
    const ropts = rounds().map(r => `<option value="${r}">${esc(T.roundName(r, S.data.season.stageNames))}</option>`).join('');
    const stages = [...new Set(cups.map(c => c.stage))];
    return `
    <section class="card card-pad mb-4">
        <div class="flex items-center gap-2 mb-3"><h2 class="section-title flex-1">Drabinka</h2>
            ${cups.length ? '<button data-act="cup-autoscore" class="btn-ghost btn-sm">🔄 Przelicz z kolejek</button>' : ''}</div>
        ${cups.length ? stages.map(st => `
            <h3 class="eyebrow mt-3 mb-1">${esc(st)}</h3>
            <ul class="divide-y divide-line">${cups.filter(c => c.stage === st).map(c => `
                <li class="flex items-center gap-2 py-2 text-sm">
                    <span class="flex-1 min-w-0"><strong>${esc(c.player1)}</strong> <span class="tabular-nums font-black">${c.score1 ?? '–'}:${c.score2 ?? '–'}</span> <strong>${esc(c.player2)}</strong>
                        <span class="block text-xs text-muted">${c.roundNumber ? esc(T.roundName(c.roundNumber, S.data.season.stageNames)) : 'bez kolejki'}${c.autoScore ? ' · liczone automatycznie' : ' · ręcznie'}</span></span>
                    <button data-act="cup-delete" data-id="${c._id}" class="btn-ghost btn-sm !px-2.5" aria-label="Usuń parę">✕</button>
                </li>`).join('')}</ul>`).join('') : '<p class="text-sm text-muted">Drabinka jest pusta. Rozstaw pary poniżej.</p>'}
    </section>
    <section class="card card-pad mb-4">
        <h2 class="section-title mb-1">Rozstaw według rankingu</h2>
        <p class="text-sm text-muted mb-3">1. miejsce gra z ostatnim, 2. z przedostatnim… Wygrywa lepszy wynik w wybranej kolejce.</p>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div><label class="label" for="cg-stage">Faza</label><input id="cg-stage" class="input" placeholder="Ćwierćfinał"></div>
            <div><label class="label" for="cg-round">Kolejka</label><select id="cg-round" class="input">${ropts}</select></div>
            <div><label class="label" for="cg-count">Ilu graczy</label><input id="cg-count" type="number" class="input" placeholder="${players.length}"></div>
        </div>
        <button data-act="cup-generate" class="btn-primary mt-3">Rozstaw pary</button>
    </section>
    <section class="card card-pad">
        <h2 class="section-title mb-3">Para ręcznie</h2>
        <div class="grid grid-cols-2 gap-2">
            <div><label class="label" for="cm-stage">Faza</label><input id="cm-stage" class="input"></div>
            <div><label class="label" for="cm-round">Kolejka</label><select id="cm-round" class="input">${ropts}</select></div>
            <div><label class="label" for="cm-p1">Gracz 1</label><select id="cm-p1" class="input">${popts}</select></div>
            <div><label class="label" for="cm-p2">Gracz 2</label><select id="cm-p2" class="input">${popts}</select></div>
            <div><label class="label" for="cm-s1">Punkty 1 (puste = auto)</label><input id="cm-s1" type="number" class="input"></div>
            <div><label class="label" for="cm-s2">Punkty 2 (puste = auto)</label><input id="cm-s2" type="number" class="input"></div>
        </div>
        <label class="option-row mt-2"><span class="font-bold">Licz punkty automatycznie z kolejki</span><input id="cm-auto" type="checkbox" class="switch" checked></label>
        <button data-act="cup-save" class="btn-primary mt-2">Zapisz parę</button>
    </section>`;
}

/* ---------------- SEZON ---------------- */

const SUBS = { ustawienia: 'Zasady', tabela: 'Tabela', auto: 'Wyniki auto', sezony: 'Sezony' };

function renderSezon(info) {
    if (!SUBS[S.sub]) S.sub = 'ustawienia';
    const seg = Object.entries(SUBS).map(([k, v]) => `<a href="#sezon/${k}" role="tab" class="shrink-0 rounded-lg px-3 min-h-[36px] text-sm font-bold whitespace-nowrap inline-flex items-center ${S.sub === k ? 'bg-surface text-ink shadow-card' : 'text-muted'}" aria-current="${S.sub === k}">${v}</a>`).join('');
    const content = { ustawienia: sezonUstawienia, tabela: sezonTabela, auto: sezonAuto, sezony: sezonSezony }[S.sub](info);
    return `<div class="seg mb-4" role="tablist">${seg}</div>${content}`;
}

function sezonUstawienia(info) {
    if (!info) return '';
    const sc = info.scoring;
    const presets = [[1, '1 min'], [15, '15 min'], [60, '1 h'], [1440, '24 h']];
    const field = (id, key, text) => `<div><label class="label" for="${id}">${text}</label><input type="number" id="${id}" data-score="${key}" class="input" min="0" value="${sc[key]}"></div>`;
    return `
    <section class="card card-pad mb-4">
        <h2 class="section-title mb-1">Blokada typów</h2>
        <p class="text-sm text-muted mb-3">Ile minut przed pierwszym biegiem zamyka się typowanie. Zmiana nie rusza już wpisanych typów.</p>
        <div class="flex flex-wrap items-center gap-2">
            <input type="number" id="set-lock" class="input w-28" min="0" value="${info.lockMinutes}" aria-label="Minuty przed startem">
            <span class="text-sm text-muted">min przed startem</span>
            ${presets.map(([v, t]) => `<button data-act="lock-preset" data-v="${v}" class="btn-ghost btn-sm">${t}</button>`).join('')}
        </div>
        <button data-act="save-lock" class="btn-primary mt-3">Zapisz blokadę</button>
    </section>
    <section class="card card-pad">
        <h2 class="section-title mb-1">Punktacja</h2>
        <p class="text-sm text-muted mb-3">Po zapisaniu cały sezon zostanie przeliczony.</p>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            ${field('set-exact', 'exact', 'Dokładny wynik')}${field('set-diff', 'diff', 'Zwycięzca + różnica')}${field('set-winner', 'winner', 'Zwycięzca')}
            ${field('set-motr', 'motrBonus', 'Bonus Złoty Kask')}${field('set-joker', 'jokerMultiplier', 'Mnożnik Jokera')}${field('set-lt', 'longTermEach', 'Typ sezonowy (każdy)')}
        </div>
        <button data-act="save-scoring" class="btn-primary mt-3">Zapisz i przelicz</button>
    </section>`;
}

function sezonTabela(info) {
    if (!info) return '';
    const teams = seasonTeams();
    const rows = (info.standingsAdjustments || []);
    const row = (a = {}) => `<div class="grid grid-cols-[1fr_5rem_auto] sm:grid-cols-[1fr_5rem_1.2fr_auto] gap-2 items-end" data-adj>
        <div><label class="label">Drużyna</label><select class="input" data-adj-team>${teams.map(t => `<option value="${esc(t)}" ${a.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div><label class="label">Punkty</label><input type="number" class="input" data-adj-points value="${a.points ?? ''}" placeholder="-2"></div>
        <div class="col-span-2 sm:col-span-1 order-last sm:order-none"><label class="label">Powód</label><input class="input" data-adj-reason value="${esc(a.reason || '')}" placeholder="np. walkower R5, decyzja GKSŻ"></div>
        <button data-act="adj-remove" class="btn-ghost btn-sm !min-h-[44px]" aria-label="Usuń korektę">✕</button>
    </div>`;
    return `
    <section class="card card-pad mb-4">
        <h2 class="section-title mb-1">Korekty tabeli ligi</h2>
        <p class="text-sm text-muted mb-3">Punkty dodane lub odjęte ręcznie (walkower z ujemnymi punktami, decyzja przy zielonym stoliku). Gracze widzą korektę z powodem pod tabelą. Punkt bonusowy za dwumecz liczy się sam.</p>
        <div class="space-y-3" id="adj-list">${rows.map(row).join('')}</div>
        <div class="flex flex-wrap gap-2 mt-3">
            <button data-act="adj-add" class="btn-ghost btn-sm">+ Dodaj korektę</button>
            <button data-act="adj-save" class="btn-primary btn-sm">Zapisz korekty</button>
        </div>
        <template id="adj-template">${row()}</template>
    </section>
    <section class="card overflow-hidden">
        <h2 class="section-title px-4 pt-4 pb-2">Podgląd tabeli</h2>
        <table class="w-full text-sm"><tbody>${S.data.standings.map((t, i) => `<tr class="border-t border-line">
            <td class="pl-4 py-2 w-8 text-muted font-bold">${i + 1}</td><td class="py-2">${esc(short(t.name))}</td>
            <td class="py-2 text-xs text-muted text-right">${t.matches} m · bonus ${t.bonus}${t.adjustment ? ` · korekta ${t.adjustment > 0 ? '+' : ''}${t.adjustment}` : ''}</td>
            <td class="pr-4 py-2 text-right font-black w-12">${t.points}</td></tr>`).join('')}</tbody></table>
    </section>`;
}

function sezonAuto(info) {
    if (!info) return '';
    const env = S.jobs ? S.jobs.scraper.envUrls : [];
    const runs = S.jobs ? S.jobs.runs.filter(r => r.job === 'scrape').slice(0, 6) : [];
    return `
    <section class="card card-pad mb-4">
        <h2 class="section-title mb-1">Źródła wyników</h2>
        <p class="text-sm text-muted mb-3">Strony z wynikami Ekstraligi (jedna na linię). Scraper sprawdza je co godzinę po meczach i tworzy wyniki do zatwierdzenia na Pulpicie — sam nic nie wpisuje.</p>
        <textarea id="auto-urls" rows="3" class="input py-2 font-mono text-xs" placeholder="https://…">${esc(info.scraperUrls.join('\n'))}</textarea>
        <p class="text-xs text-muted mt-1">${env.length ? `Gdy puste, używane są źródła z SCRAPER_URLS: ${env.map(esc).join(', ')}` : 'Możesz też ustawić zmienną SCRAPER_URLS na serwerze.'}</p>
    </section>
    <section class="card card-pad mb-4">
        <h2 class="section-title mb-1">Inne nazwy drużyn</h2>
        <p class="text-sm text-muted mb-3">Scraper rozpoznaje drużyny po mieście i przydomku. Jeśli portal używa innej nazwy (np. „Apator” dla Torunia), dopisz ją tutaj — po przecinku.</p>
        <div class="space-y-2">${seasonTeams().map(t => `<div class="grid sm:grid-cols-[14rem_1fr] gap-1 sm:gap-2 sm:items-center">
            <label class="text-sm font-bold" for="alias-${esc(t)}">${esc(t)}</label>
            <input id="alias-${esc(t)}" class="input" data-alias="${esc(t)}" value="${esc((info.teamAliases[t] || []).join(', '))}" placeholder="np. ${esc(short(t))}">
        </div>`).join('')}</div>
    </section>
    <div class="flex flex-wrap gap-2 mb-4">
        <button data-act="save-auto" class="btn-primary">Zapisz źródła i nazwy</button>
        <button data-act="scrape-now" class="btn-ghost">🔄 Pobierz wyniki teraz</button>
    </div>
    <section class="card card-pad">
        <h2 class="section-title mb-2">Ostatnie pobrania</h2>
        ${runs.length ? `<ul class="divide-y divide-line text-sm">${runs.map(jobItem).join('')}</ul>` : '<p class="text-sm text-muted">Jeszcze nic nie pobrano.</p>'}
    </section>`;
}

function sezonSezony(info) {
    const teams = seasonTeams();
    const days = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
    const slots = [[4, '18:00'], [4, '20:30'], [6, '16:00'], [6, '19:15']];
    const topts = sel => '<option value="">—</option>' + teams.map(t => `<option value="${esc(t)}" ${sel === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const res = (info && info.results) || {};
    return `
    <section class="card card-pad mb-4">
        <h2 class="section-title mb-3">Sezony w bazie</h2>
        <div class="space-y-2">${S.seasons.map(s => `
            <div class="rounded-xl border ${s.year === S.season ? 'border-brand/50' : 'border-line'} bg-raised p-3">
                <div class="flex flex-wrap items-center gap-2"><strong>${esc(s.label || `Sezon ${s.year}`)}</strong>
                    ${s.isActive ? '<span class="chip-ok">aktywny</span>' : ''}${s.isFinished ? '<span class="chip-muted">archiwum</span>' : ''}${s.year === S.season ? '<span class="chip-brand">edytujesz</span>' : ''}</div>
                <div class="text-xs text-muted">${s.matches} meczów · ${s.predictions} typów · ${s.teams.length} drużyn · blokada ${T.lockLabel(s.lockMinutes)}</div>
                <div class="flex flex-wrap gap-1.5 mt-2">
                    ${s.year === S.season ? '' : `<button data-act="edit-season" data-year="${s.year}" class="btn-ghost btn-sm">Edytuj ten sezon</button>`}
                    ${s.isActive ? '' : `<button data-act="activate-season" data-year="${s.year}" class="btn-ok btn-sm">Ustaw jako aktywny</button>`}
                    ${s.isFinished ? `<button data-act="reopen-season" data-year="${s.year}" class="btn-ghost btn-sm">Otwórz ponownie</button>` : ''}
                </div>
            </div>`).join('')}</div>
    </section>

    <details class="card mb-4 group">
        <summary class="card-pad cursor-pointer list-none flex items-center justify-between"><span class="section-title">🆕 Nowy sezon — krok 1: dane</span><span class="text-muted group-open:rotate-180 transition">▾</span></summary>
        <div class="px-4 pb-4">
            <p class="text-sm text-muted mb-3">Bieżący sezon zostaje nietknięty i trafi do archiwum, gdy aktywujesz nowy.</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div><label class="label" for="ns-year">Rok</label><input type="number" id="ns-year" class="input" value="${Math.max(...S.seasons.map(s => s.year), new Date().getFullYear()) + 1}"></div>
                <div><label class="label" for="ns-label">Nazwa</label><input id="ns-label" class="input" placeholder="PGE Ekstraliga"></div>
                <div><label class="label" for="ns-lock">Blokada (min)</label><input type="number" id="ns-lock" class="input" value="1" min="0"></div>
            </div>
            <label class="label mt-2" for="ns-teams">Drużyny (jedna na linię)</label>
            <textarea id="ns-teams" rows="8" class="input py-2 font-mono text-xs">${esc(teams.join('\n'))}</textarea>
            <label class="option-row"><span class="font-bold">Przepisz aktywnych graczy</span><input type="checkbox" id="ns-copy" class="switch" checked></label>
            <div class="flex flex-wrap gap-2 mt-2">
                <button data-act="new-season" data-activate="0" class="btn-primary btn-sm">Zapisz (nieaktywny)</button>
                <button data-act="new-season" data-activate="1" class="btn-ok btn-sm">Zapisz i aktywuj</button>
            </div>
        </div>
    </details>

    <details class="card mb-4 group">
        <summary class="card-pad cursor-pointer list-none flex items-center justify-between"><span class="section-title">📅 Krok 2: terminarz sezonu ${S.season}</span><span class="text-muted group-open:rotate-180 transition">▾</span></summary>
        <div class="px-4 pb-4">
            <p class="text-sm text-muted mb-3">Dwumecze każdy z każdym (8 drużyn = 14 kolejek po 4 mecze). Godziny w czasie polskim. Drużyny bierze z kroku 1 (albo z edytowanego sezonu).</p>
            <div class="grid grid-cols-2 gap-2">
                <div><label class="label" for="gen-start">Poniedziałek 1. kolejki</label><input type="date" id="gen-start" class="input"></div>
                <div><label class="label" for="gen-skip">Wolny tydzień po kolejkach</label><input id="gen-skip" class="input" placeholder="np. 3,6,11"></div>
            </div>
            <span class="label mt-2">Mecze w kolejce</span>
            <div class="grid sm:grid-cols-2 gap-2">${slots.map(([d, t], i) => `<div class="flex gap-2">
                <select class="input" data-slot-day="${i}" aria-label="Dzień meczu ${i + 1}">${days.map((x, di) => `<option value="${di}" ${di === d ? 'selected' : ''}>${x}</option>`).join('')}</select>
                <input type="time" class="input w-32" data-slot-time="${i}" value="${t}" aria-label="Godzina meczu ${i + 1}"></div>`).join('')}</div>
            <div class="flex flex-wrap gap-2 mt-3">
                <button data-act="schedule-preview" class="btn-ghost btn-sm">👁️ Podgląd</button>
                <button data-act="schedule-save" data-replace="0" class="btn-primary btn-sm">Zapisz terminarz</button>
                <button data-act="schedule-save" data-replace="1" class="btn-danger btn-sm">Zastąp istniejący (usuwa typy!)</button>
            </div>
            <pre id="gen-preview" class="mt-3 bg-night text-ok text-[11px] p-3 rounded-xl max-h-64 overflow-auto hidden"></pre>
            <details class="mt-4"><summary class="text-sm font-bold cursor-pointer">Albo wklej terminarz jako JSON</summary>
                <textarea id="schedule-json" rows="4" class="input py-2 font-mono text-xs mt-2" placeholder='[{"round":1,"homeTeam":"…","awayTeam":"…","matchDate":"2027-04-09T18:00:00+02:00","isMatchOfTheRound":true}]'></textarea>
                <button data-act="schedule-import" class="btn-ghost btn-sm mt-2">Wczytaj JSON</button>
            </details>
        </div>
    </details>

    <details class="card group">
        <summary class="card-pad cursor-pointer list-none flex items-center justify-between"><span class="section-title">🏆 Zakończenie sezonu ${S.season}</span><span class="text-muted group-open:rotate-180 transition">▾</span></summary>
        <div class="px-4 pb-4">
            <p class="text-sm text-muted mb-3">Wskaż wyniki ligi — gracze dostaną punkty za trafione typy sezonowe (${S.data.season.scoring.longTermEach} pkt za każdy).</p>
            <div class="grid sm:grid-cols-3 gap-2">
                <div><label class="label" for="fin-c">Mistrz Polski</label><select id="fin-c" class="input">${topts(res.champion)}</select></div>
                <div><label class="label" for="fin-b">Brąz</label><select id="fin-b" class="input">${topts(res.bronze)}</select></div>
                <div><label class="label" for="fin-r">Spadek</label><select id="fin-r" class="input">${topts(res.relegation)}</select></div>
            </div>
            <label class="option-row"><span><span class="font-bold">Zamknij sezon (archiwum)</span><span class="hint block">Gracze nie będą mogli typować. Można otworzyć ponownie.</span></span><input type="checkbox" id="fin-mark" class="switch"></label>
            <button data-act="finish-season" class="btn-primary btn-sm mt-2">Rozlicz typy sezonowe</button>
        </div>
    </details>`;
}

/* ---------------- SYSTEM ---------------- */

function jobItem(r) {
    return `<li class="py-2">
        <div class="flex items-center gap-2"><span class="${r.ok ? 'chip-ok' : 'chip-bad'}">${r.job === 'scrape' ? 'wyniki' : r.job === 'reminders' ? 'przypomnienia' : esc(r.job)}</span>
            <span class="text-xs text-muted">${T.fmtDateTime(r.createdAt)} · ${relTime(r.createdAt)}</span></div>
        <div class="text-sm mt-0.5">${esc(r.summary || '')}</div>
        ${r.details && r.details.sourceErrors && r.details.sourceErrors.length ? `<div class="text-xs text-bad mt-0.5">${r.details.sourceErrors.map(esc).join('<br>')}</div>` : ''}
    </li>`;
}

function renderSystem() {
    const j = S.jobs;
    return `
    <section class="card card-pad mb-4">
        <h2 class="section-title mb-1">🔔 Powiadomienia</h2>
        <p class="text-sm text-muted mb-3">${j ? (j.push.enabled ? `Włączone · ${j.push.subscriptions} urządzeń (w tym ${j.push.admins} admina).` : 'Wyłączone — ustaw VAPID_PUBLIC_KEY i VAPID_PRIVATE_KEY (npm run vapid).') : ''}</p>
        <div class="flex flex-wrap gap-2">
            <button data-act="admin-push" class="btn-primary btn-sm">Powiadamiaj ten telefon o wynikach</button>
            <button data-act="admin-push-test" class="btn-ghost btn-sm">Wyślij test</button>
            <button data-act="run-reminders" class="btn-ghost btn-sm">Wyślij przypomnienia teraz</button>
        </div>
    </section>
    <section class="card card-pad mb-4">
        <h2 class="section-title mb-2">Dziennik zadań w tle</h2>
        ${j && j.runs.length ? `<ul class="divide-y divide-line">${j.runs.slice(0, 12).map(jobItem).join('')}</ul>` : '<p class="text-sm text-muted">Jeszcze nic nie uruchomiono.</p>'}
    </section>
    <section class="card card-pad mb-4">
        <h2 class="section-title mb-1">💾 Kopia zapasowa</h2>
        <p class="text-sm text-muted mb-3">Pobierz przed większą operacją (nowy sezon, import). Plik zawiera linki graczy — trzymaj go prywatnie.</p>
        <div class="flex flex-wrap gap-2 items-center">
            <button data-act="backup" class="btn-ok btn-sm">Pobierz kopię (JSON)</button>
        </div>
        <label class="label mt-4" for="restore-file">Przywróć z pliku (scalanie z obecnymi danymi)</label>
        <div class="flex flex-wrap gap-2"><input type="file" id="restore-file" accept="application/json" class="input py-2 flex-1 min-w-[12rem]">
            <button data-act="restore" class="btn-danger btn-sm">Przywróć</button></div>
    </section>
    <section class="card card-pad mb-4">
        <h2 class="section-title mb-1">🔧 Narzędzia</h2>
        <p class="text-sm text-muted mb-3">Zwykle niepotrzebne — punkty przeliczają się same po każdym wyniku.</p>
        <div class="flex flex-wrap gap-2">
            <button data-act="recalc" class="btn-ghost btn-sm">Przelicz punkty sezonu</button>
            <button data-act="fix-duplicates" class="btn-ghost btn-sm">Napraw duplikaty i nadmiarowe jokery</button>
        </div>
    </section>
    <section class="card card-pad border-bad/40">
        <h2 class="section-title mb-1 text-bad">Strefa ryzyka</h2>
        <p class="text-sm text-muted mb-3">Usuwa mecze od podanej kolejki w górę razem z typami (np. błędnie wgrana faza play-off).</p>
        <div class="flex flex-wrap gap-2 items-end">
            <div><label class="label" for="clean-from">Od kolejki</label><input type="number" id="clean-from" class="input w-28" value="15"></div>
            <button data-act="clean-rounds" class="btn-danger btn-sm !min-h-[44px]">Usuń kolejki</button>
        </div>
    </section>`;
}

function renderWiecej() {
    const item = (href, icon, title, sub) => `<a href="${href}" class="flex items-center gap-3 px-4 py-3.5 hover:bg-raised">
        <span class="w-9 h-9 rounded-xl bg-raised border border-line flex items-center justify-center text-muted">${icon}</span>
        <span class="flex-1"><span class="block font-bold">${title}</span><span class="text-xs text-muted">${sub}</span></span><span class="text-muted">›</span></a>`;
    return `<div class="card overflow-hidden divide-y divide-line">
        ${item('#puchar', svg('puchar'), 'Puchar Typerów', 'drabinka, pary, przeliczenie')}
        ${item('#system', svg('system'), 'System', 'powiadomienia, kopia zapasowa, narzędzia')}
        ${item('/', svg('pulpit'), 'Strona typera', 'tak, jak widzą ją gracze')}
    </div>
    <button data-act="logout" class="btn-ghost w-full mt-4">Wyloguj</button>`;
}

/* ================= OBSŁUGA ZDARZEŃ ================= */

function onInput(e) {
    const t = e.target;
    if (t.dataset.input === 'search') {
        S.search = t.value;
        const pos = t.selectionStart;
        render();
        const again = document.querySelector('[data-input="search"]');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) { /* ignore */ } }
        return;
    }
    if (t.dataset.res) {
        const id = t.dataset.id;
        const m = matchById(id);
        const box = t.closest('[data-card], [data-row]');
        const h = box.querySelector('[data-res="h"]').value, a = box.querySelector('[data-res="a"]').value;
        const same = String(m.homeScore ?? '') === h && String(m.awayScore ?? '') === a;
        if (same) S.resultEdits.delete(id); else S.resultEdits.set(id, { h, a });
        box.querySelectorAll('[data-res]').forEach(i => i.classList.toggle('changed', !same));
        const hint = document.querySelector(`[data-hint-for="${id}"]`);
        if (hint) hint.innerHTML = resultHint(m);
        renderSaveBar();
        if (t.value.length >= 2 && t.dataset.res === 'h') box.querySelector('[data-res="a"]').focus();
        return;
    }
    if (t.id === 'ed-date') {
        // nowy termin kończy "termin nieznany"
        if (t.value !== t.dataset.orig) { const post = sheet && sheet.el.querySelector('#ed-postponed'); if (post) post.checked = false; }
        editorHint();
        return;
    }
    if (t.matches('[data-draft-h], [data-draft-a]')) {
        const box = t.closest('[data-draft]');
        const h = Number(box.querySelector('[data-draft-h]').value), a = Number(box.querySelector('[data-draft-a]').value);
        box.querySelector('[data-sum]').textContent = `suma ${h + a} / 90${h + a > 90 ? ' — niemożliwe!' : ''}`;
    }
}

function onChange(e) {
    const t = e.target;
    if (t.dataset.change === 'notify') {
        try { localStorage.setItem('adminNotify', t.checked ? '1' : '0'); } catch (err) { /* ignore */ }
        document.querySelectorAll('[data-change="notify"]').forEach(x => { x.checked = t.checked; });
    }
    if (t.dataset.change === 'tip-round' && sheet && sheet.setTipRound) sheet.setTipRound(Number(t.value));
    if (t.id === 'ed-postponed') editorHint();
}

async function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    if (el.tagName === 'BUTTON' || el.tagName === 'A') e.preventDefault();
    await fn(el, e);
}

const intOrNull = v => (v === '' || v === null || v === undefined || !Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 75) ? null : Number(v);

const ACTIONS = {
    'close-sheet': () => closeSheet(),
    logout: async () => {
        try { await api('POST', '/api/admin/logout', {}); } catch (e) { /* ignore */ }
        sessionStorage.removeItem('adminToken');
        location.href = '/admin';
    },
    refresh: async btn => { setBusy(btn, true); await loadAll(); setBusy(btn, false); T.toast('Dane odświeżone'); },

    /* --- wyniki --- */
    'discard-results': () => { S.resultEdits.clear(); render(); },
    'save-results': async btn => {
        const items = [...S.resultEdits.entries()].map(([id, v]) => ({ m: matchById(id), h: intOrNull(v.h), a: intOrNull(v.a) })).filter(x => x.m);
        const bad = items.filter(x => x.h === null || x.a === null);
        if (bad.length) return T.toast(`Uzupełnij oba pola (0–75): ${bad.map(x => label(x.m)).join(', ')}. Wynik usuwasz przez „Edytuj”.`, 'err');
        const now = T.now();
        const future = items.filter(x => new Date(x.m.matchDate).getTime() > now);
        const odd = items.filter(x => x.h + x.a > 90 || x.h + x.a < 48);
        if (future.length && !(await confirmBox({ title: 'Mecz jeszcze się nie odbył', message: `${future.map(x => esc(label(x.m))).join(', ')} — start dopiero ${T.fmtDateTime(future[0].m.matchDate)}. Na pewno zapisać wynik?`, confirm: 'Zapisz mimo to' }))) return;
        if (odd.length && !(await confirmBox({ title: 'Nietypowa suma punktów', message: `${odd.map(x => `${esc(label(x.m))} ${x.h}:${x.a} (suma ${x.h + x.a})`).join(', ')}. Pełny mecz to 90 pkt, zaliczony od 8 biegów (48 pkt).`, confirm: 'Zapisz mimo to', danger: true }))) return;
        await act('/api/admin/results-bulk', { results: items.map(x => ({ matchId: x.m._id, homeScore: x.h, awayScore: x.a })), notify: notifyOn() },
            { btn, onDone: () => S.resultEdits.clear() });
    },
    'draft-approve': async btn => {
        const box = btn.closest('[data-draft]');
        const id = btn.dataset.id;
        const d = S.drafts.find(x => x._id === id);
        const h = intOrNull(box.querySelector('[data-draft-h]').value), a = intOrNull(box.querySelector('[data-draft-a]').value);
        if (h === null || a === null) return T.toast('Wpisz oba wyniki (0–75).', 'err');
        const changed = d && (h !== d.homeScore || a !== d.awayScore);
        let force = false;
        if (d && (d.blockers || []).length && !changed) {
            force = await confirmBox({ title: 'Wynik nie przeszedł kontroli', message: `${esc((d.blockers || []).join(' '))} Zatwierdzić bez poprawek?`, confirm: 'Zatwierdź mimo to', danger: true });
            if (!force) return;
        }
        await act('/api/admin/drafts/approve', { id, homeScore: h, awayScore: a, force, notify: notifyOn() }, { btn });
    },
    'draft-reject': async btn => { await act('/api/admin/drafts/reject', { id: btn.dataset.id }, { btn }); },
    'drafts-approve-all': async btn => {
        if (!(await confirmBox({ title: 'Zatwierdzić wyniki?', message: 'Zostaną zatwierdzone wszystkie wyniki bez uwag krytycznych (⛔). Punkty graczy przeliczą się od razu.', confirm: 'Zatwierdź' }))) return;
        await act('/api/admin/drafts/approve-all', { notify: notifyOn() }, { btn });
    },
    'scrape-now': async btn => { T.toast('Pobieram wyniki…'); await act('/api/admin/jobs/scrape', {}, { btn }); },
    'copy-reminder': async btn => {
        const m = matchById(btn.dataset.id);
        const who = activePlayers().filter(p => !predOf(p.nickname, m._id)).map(p => p.nickname);
        const text = `⏰ Typy na ${m.homeTeam} – ${m.awayTeam} (${T.fmtDay(m.matchDate)} ${T.fmtTime(m.matchDate)}) zamykają się o ${T.fmtTime(T.lockTime(m, lockMin()))}.\nBrakuje: ${who.join(', ')}\n${location.origin}`;
        await copyText(text, 'Przypomnienie skopiowane — wklej na grupę');
    },

    /* --- mecze --- */
    'toggle-preds': btn => {
        const id = btn.dataset.id;
        if (S.openPreds.has(id)) S.openPreds.delete(id); else S.openPreds.add(id);
        const card = btn.closest('[data-card]');
        card.outerHTML = matchCard(matchById(id));
    },
    'edit-match': btn => openMatchEditor(btn.dataset.id, btn.dataset.focus),
    'save-match': btn => saveMatch(btn),
    'add-match': () => openAddMatch(),
    'add-match-save': async btn => {
        const q = id => sheet.el.querySelector(id);
        if (!q('#am-date').value) return T.toast('Podaj datę i godzinę.', 'err');
        const out = await act('/api/admin/match-add', {
            round: q('#am-round').value, homeTeam: q('#am-home').value, awayTeam: q('#am-away').value,
            matchDate: fromLocalInput(q('#am-date').value), isMatchOfTheRound: q('#am-motr').checked
        }, { btn });
        if (out) { closeSheet(); go(`mecze/${Number(q('#am-round') ? q('#am-round').value : S.round)}`); }
    },
    walkover: async btn => {
        const m = matchById(btn.dataset.id);
        const h = Number(btn.dataset.h), a = Number(btn.dataset.a);
        if (!(await confirmBox({ title: 'Walkower?', message: `${esc(label(m))} ${h}:${a}. Wynik trafi do tabeli ligi, typy graczy zostaną anulowane.`, confirm: 'Zapisz walkower', danger: true }))) return;
        await act('/api/admin/result', { matchId: m._id, homeScore: h, awayScore: a, walkover: true }, { btn });
    },
    'walkover-undo': async btn => {
        if (!(await confirmBox({ title: 'Cofnąć walkower?', message: 'Wynik zostanie usunięty, a typy znów będą się liczyć po wpisaniu prawdziwego wyniku.', confirm: 'Cofnij walkower' }))) return;
        await act('/api/admin/result', { matchId: btn.dataset.id, clear: true }, { btn });
    },
    'clear-result': async btn => {
        const m = matchById(btn.dataset.id);
        if (!(await confirmBox({ title: 'Wyczyścić wynik?', message: `${esc(label(m))} ${m.homeScore}:${m.awayScore} — punkty graczy za ten mecz zostaną wycofane.`, confirm: 'Wyczyść', danger: true }))) return;
        await act('/api/admin/result', { matchId: m._id, clear: true }, { btn });
    },
    'delete-match': async btn => {
        const m = matchById(btn.dataset.id);
        const typed = S.predictions.filter(p => p.matchId === m._id).length;
        if (!(await confirmBox({ title: 'Usunąć mecz?', message: `${esc(label(m))} zniknie z terminarza${typed ? ` razem z ${typed} typami graczy` : ''}. Tego nie da się cofnąć (chyba że z kopii zapasowej).`, confirm: 'Usuń mecz', danger: true }))) return;
        const out = await act('/api/admin/match-delete', { matchId: m._id }, { btn });
        if (out) closeSheet();
    },

    /* --- typy (admin) --- */
    'save-tip': async btn => {
        const row = btn.closest('[data-tip]');
        const [nick, matchId] = btn.dataset.key.split('|');
        const h = intOrNull(row.querySelector('[data-tip-h]').value), a = intOrNull(row.querySelector('[data-tip-a]').value);
        if (h === null || a === null) return T.toast('Typ: dwie liczby 0–75.', 'err');
        await act('/api/admin/predict', { nickname: nick, matchId, homePred: h, awayPred: a, usedJoker: row.querySelector('[data-tip-j]').checked }, { btn });
    },
    'delete-tip': async btn => {
        const [nick, matchId] = btn.dataset.key.split('|');
        if (!(await confirmBox({ title: 'Usunąć typ?', message: `Typ gracza ${esc(nick)} na ${esc(label(matchById(matchId)))}.`, confirm: 'Usuń', danger: true }))) return;
        await act('/api/admin/predict-delete', { nickname: nick, matchId }, { btn });
    },

    /* --- gracze --- */
    'player-filter': btn => { S.playerFilter = btn.dataset.filter; render(); },
    'open-player': btn => openPlayer(btn.dataset.nick),
    'add-player': () => openAddPlayer(),
    'add-player-save': async btn => {
        const nick = sheet.el.querySelector('#np-nick').value.trim();
        if (!nick) return T.toast('Podaj pseudonim.', 'err');
        const out = await act('/api/admin/player', { nickname: nick, fullName: sheet.el.querySelector('#np-name').value.trim() }, { btn });
        if (out) {
            const link = playerLink(out.token);
            sheet.el.querySelector('.sheet-body').innerHTML = `
                <p class="text-sm mb-2">✅ <strong>${esc(nick)}</strong> dodany. Wyślij mu prywatnie link — to jego hasło:</p>
                <input type="text" readonly class="input font-mono text-xs" value="${esc(link)}" onfocus="this.select()" aria-label="Link gracza">
                <div class="flex flex-wrap gap-2 mt-3">
                    <button data-act="copy-raw" data-text="${esc(link)}" class="btn-primary btn-sm">Kopiuj link</button>
                    <a class="btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Twój panel typera (nie udostępniaj nikomu): ${link}`)}">WhatsApp</a>
                </div>`;
            sheet.el.querySelector('.sheet-foot').innerHTML = '<button data-act="close-sheet" class="btn-primary flex-1">Gotowe</button>';
        }
    },
    'copy-raw': btn => copyText(btn.dataset.text, 'Link skopiowany'),
    'copy-link': btn => {
        const p = S.players.find(x => x.nickname === btn.dataset.nick);
        if (p) copyText(playerLink(p.token), `Link dla ${p.nickname} skopiowany`);
    },
    'new-token': async btn => {
        if (!(await confirmBox({ title: 'Nowy link?', message: `Stary link gracza ${esc(btn.dataset.nick)} przestanie działać (także ikona na jego telefonie). Wyślij mu nowy.`, confirm: 'Generuj nowy link', danger: true }))) return;
        await act('/api/admin/player/token', { nickname: btn.dataset.nick }, { btn });
    },
    'toggle-active': async el => {
        const ok = await act('/api/admin/player/toggle', { nickname: el.dataset.nick });
        if (!ok) el.checked = !el.checked;
    },
    'toggle-season': async el => {
        const ok = await act('/api/admin/player/season', { nickname: el.dataset.nick, year: S.season, join: el.checked });
        if (!ok) el.checked = !el.checked;
    },
    'rename-player': async btn => {
        const oldNick = btn.dataset.nick;
        const newNick = sheet.el.querySelector('#pl-nick').value.trim();
        const fullName = sheet.el.querySelector('#pl-name').value.trim();
        if (!newNick) return T.toast('Pseudonim nie może być pusty.', 'err');
        if (newNick !== oldNick && !(await confirmBox({ title: 'Zmienić pseudonim?', message: `${esc(oldNick)} → ${esc(newNick)}. Typy, punkty i puchar zostaną przeniesione, link się nie zmienia.`, confirm: 'Zmień' }))) return;
        if (sheet.setPlayer) sheet.setPlayer(newNick);
        const out = await act('/api/admin/player/rename', { nickname: oldNick, newNickname: newNick, fullName }, { btn });
        if (!out && sheet && sheet.setPlayer) sheet.setPlayer(oldNick);
    },
    'save-longterm': async btn => {
        const q = id => sheet.el.querySelector(id).value;
        await act('/api/admin/longterm', { nickname: btn.dataset.nick, champion: q('#pl-lt-c'), bronze: q('#pl-lt-b'), relegation: q('#pl-lt-r') }, { btn });
    },
    'push-test-player': async btn => { await act('/api/admin/push/test', { nickname: btn.dataset.nick }, { btn, reload: false }); },
    'delete-player-season': async btn => {
        const nick = btn.dataset.nick;
        if (!(await confirmBox({ title: `Usunąć ${esc(nick)} z sezonu ${S.season}?`, message: 'Typy i typy sezonowe z tego sezonu zostaną usunięte. Historia innych sezonów zostaje.', confirm: 'Usuń z sezonu', danger: true }))) return;
        await act('/api/admin/delete-player', { nickname: nick, onlySeason: S.season }, { btn });
    },
    'delete-player': async btn => {
        const nick = btn.dataset.nick;
        if (!(await confirmBox({ title: `Usunąć ${esc(nick)} całkowicie?`, message: 'Gracz zniknie ze wszystkich sezonów razem z typami i punktami. Tego nie da się cofnąć (chyba że z kopii zapasowej).', confirm: 'Usuń na zawsze', danger: true }))) return;
        const out = await act('/api/admin/delete-player', { nickname: nick }, { btn });
        if (out) closeSheet();
    },

    /* --- puchar --- */
    'cup-delete': async btn => {
        if (!(await confirmBox({ title: 'Usunąć parę?', message: 'Para zniknie z drabinki.', confirm: 'Usuń', danger: true }))) return;
        await act('/api/admin/cup-delete', { id: btn.dataset.id }, { btn });
    },
    'cup-autoscore': async btn => { await act('/api/admin/cup-autoscore', {}, { btn }); },
    'cup-generate': async btn => {
        const v = id => document.getElementById(id).value;
        if (!v('cg-stage').trim()) return T.toast('Podaj nazwę fazy, np. Ćwierćfinał.', 'err');
        await act('/api/admin/cup-generate', { stage: v('cg-stage').trim(), roundNumber: v('cg-round'), count: v('cg-count') }, { btn });
    },
    'cup-save': async btn => {
        const v = id => document.getElementById(id).value;
        await act('/api/admin/cup-match', { stage: v('cm-stage').trim(), roundNumber: v('cm-round'), player1: v('cm-p1'), player2: v('cm-p2'), score1: v('cm-s1'), score2: v('cm-s2'), autoScore: document.getElementById('cm-auto').checked }, { btn });
    },

    /* --- sezon --- */
    'lock-preset': btn => { document.getElementById('set-lock').value = btn.dataset.v; },
    'save-lock': async btn => {
        const v = document.getElementById('set-lock').value;
        if (v === '' || Number(v) < 0) return T.toast('Podaj liczbę minut (0 lub więcej).', 'err');
        await act('/api/admin/season/settings', { lockMinutes: Number(v) }, { btn });
    },
    'save-scoring': async btn => {
        const scoring = {};
        document.querySelectorAll('[data-score]').forEach(i => { scoring[i.dataset.score] = i.value; });
        if (Object.values(scoring).some(v => v === '' || Number(v) < 0)) return T.toast('Uzupełnij wszystkie pola punktacji.', 'err');
        if (!(await confirmBox({ title: 'Zmienić punktację?', message: 'Wszystkie typy sezonu zostaną przeliczone według nowych zasad. Gracze zobaczą nowe punkty od razu.', confirm: 'Zapisz i przelicz', danger: true }))) return;
        await act('/api/admin/season/settings', { scoring }, { btn });
    },
    'adj-add': () => {
        const tpl = document.getElementById('adj-template');
        document.getElementById('adj-list').insertAdjacentHTML('beforeend', tpl.innerHTML);
    },
    'adj-remove': btn => btn.closest('[data-adj]').remove(),
    'adj-save': async btn => {
        const rows = [...document.querySelectorAll('#adj-list [data-adj]')].map(r => ({
            team: r.querySelector('[data-adj-team]').value,
            points: Number(r.querySelector('[data-adj-points]').value),
            reason: r.querySelector('[data-adj-reason]').value.trim()
        }));
        const bad = rows.filter(r => !r.points);
        if (bad.length) return T.toast('Każda korekta musi mieć liczbę punktów (np. -2 albo 1).', 'err');
        await act('/api/admin/season/settings', { standingsAdjustments: rows }, { btn });
    },
    'save-auto': async btn => {
        const urls = document.getElementById('auto-urls').value.split('\n').map(x => x.trim()).filter(Boolean);
        const wrong = urls.filter(u => !/^https?:\/\//.test(u));
        if (wrong.length) return T.toast(`Adres musi zaczynać się od https://: ${wrong[0]}`, 'err');
        const aliases = {};
        document.querySelectorAll('[data-alias]').forEach(i => { const list = i.value.split(',').map(x => x.trim()).filter(Boolean); if (list.length) aliases[i.dataset.alias] = list; });
        await act('/api/admin/season/settings', { scraperUrls: urls, teamAliases: aliases }, { btn });
    },
    'edit-season': async btn => {
        S.season = Number(btn.dataset.year);
        localStorage.setItem('adminSeason', S.season);
        S.round = null;
        await loadAll();
        T.toast(`Edytujesz sezon ${S.season}`);
    },
    'activate-season': async btn => {
        const y = btn.dataset.year;
        if (!(await confirmBox({ title: `Aktywować sezon ${y}?`, message: 'Strona główna i panele graczy przełączą się na ten sezon. Poprzedni trafi do archiwum.', confirm: 'Aktywuj' }))) return;
        await act('/api/admin/season/activate', { year: Number(y) }, { btn });
    },
    'reopen-season': async btn => { await act('/api/admin/season/reopen', { season: Number(btn.dataset.year) }, { btn }); },
    'new-season': async btn => {
        const year = Number(document.getElementById('ns-year').value);
        const teams = document.getElementById('ns-teams').value.split('\n').map(t => t.trim()).filter(Boolean);
        if (!year) return T.toast('Podaj rok sezonu.', 'err');
        if (S.seasons.some(s => s.year === year)) return T.toast(`Sezon ${year} już istnieje — wybierz go z listy.`, 'err');
        const activate = btn.dataset.activate === '1';
        if (activate && !(await confirmBox({ title: `Aktywować sezon ${year}?`, message: 'Gracze od razu zobaczą nowy sezon (na razie bez terminarza).', confirm: 'Zapisz i aktywuj' }))) return;
        const out = await act('/api/admin/season', {
            season: undefined, year, label: document.getElementById('ns-label').value.trim() || `PGE Ekstraliga ${year}`,
            lockMinutes: document.getElementById('ns-lock').value, teams, copyPlayers: document.getElementById('ns-copy').checked, activate
        }, { btn, onDone: () => { S.season = year; S.round = null; localStorage.setItem('adminSeason', year); } });
        if (out) go('sezon/sezony');
    },
    'schedule-preview': async btn => {
        const body = schedulePayload();
        if (!body) return;
        setBusy(btn, true);
        try {
            const out = await api('POST', '/api/admin/generate-schedule', { ...body, dryRun: true });
            const pre = document.getElementById('gen-preview');
            pre.classList.remove('hidden');
            pre.textContent = out.schedule.map(m => `R${String(m.round).padStart(2, '0')}  ${T.fmtDay(m.matchDate)} ${T.fmtTime(m.matchDate)}  ${m.homeTeam} – ${m.awayTeam}`).join('\n');
            T.toast(out.message);
        } catch (e) { T.toast(e.message, 'err'); } finally { setBusy(btn, false); }
    },
    'schedule-save': async btn => {
        const body = schedulePayload();
        if (!body) return;
        const replace = btn.dataset.replace === '1';
        if (replace && !(await confirmBox({ title: 'Zastąpić terminarz?', message: `Wszystkie mecze sezonu ${S.season} i typy graczy zostaną usunięte i wygenerowane od nowa.`, confirm: 'Zastąp', danger: true }))) return;
        await act('/api/admin/generate-schedule', { ...body, replace }, { btn });
    },
    'schedule-import': async btn => {
        let schedule;
        try { schedule = JSON.parse(document.getElementById('schedule-json').value); } catch (e) { return T.toast('To nie jest poprawny JSON.', 'err'); }
        await act('/api/admin/load-schedule', { schedule }, { btn });
    },
    'finish-season': async btn => {
        const v = id => document.getElementById(id).value;
        const mark = document.getElementById('fin-mark').checked;
        if (!v('fin-c') && !v('fin-b') && !v('fin-r')) return T.toast('Wskaż przynajmniej jedną drużynę.', 'err');
        if (!(await confirmBox({ title: 'Rozliczyć typy sezonowe?', message: `Mistrz: ${esc(v('fin-c') || '—')}, brąz: ${esc(v('fin-b') || '—')}, spadek: ${esc(v('fin-r') || '—')}.${mark ? ' Sezon zostanie zamknięty.' : ''}`, confirm: 'Rozlicz' }))) return;
        await act('/api/admin/season/finish', { champion: v('fin-c'), bronze: v('fin-b'), relegation: v('fin-r'), markFinished: mark }, { btn });
    },

    /* --- system --- */
    'admin-push': async btn => {
        setBusy(btn, true);
        try { const out = await T.enablePush('/api/admin/push/subscribe', {}, { 'x-admin-token': S.token }); T.toast(out.message); await loadAll(); }
        catch (e) { T.toast(e.message, 'err'); } finally { if (btn.isConnected) setBusy(btn, false); }
    },
    'admin-push-test': async btn => { await act('/api/admin/push/test', {}, { btn, reload: false }); },
    'run-reminders': async btn => { await act('/api/admin/jobs/reminders', {}, { btn }); },
    recalc: async btn => { await act('/api/admin/recalculate', {}, { btn }); },
    'fix-duplicates': async btn => { await act('/api/admin/fix-duplicates', {}, { btn }); },
    'clean-rounds': async btn => {
        const from = Number(document.getElementById('clean-from').value);
        const n = S.data.matches.filter(m => m.round >= from).length;
        if (!from || !n) return T.toast('Brak meczów od tej kolejki.', 'err');
        if (!(await confirmBox({ title: `Usunąć ${n} meczów?`, message: `Wszystkie mecze od kolejki ${from} w górę zostaną usunięte razem z typami graczy.`, confirm: 'Usuń', danger: true }))) return;
        await act('/api/admin/clean-rounds', { from }, { btn });
    },
    backup: async btn => {
        setBusy(btn, true);
        try {
            const res = await fetch('/api/admin/backup', { headers: { 'x-admin-token': S.token } });
            if (!res.ok) throw new Error('Nie udało się pobrać kopii');
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `typer-kopia-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            T.toast('Kopia pobrana');
        } catch (e) { T.toast(e.message, 'err'); } finally { setBusy(btn, false); }
    },
    restore: async btn => {
        const file = document.getElementById('restore-file').files[0];
        if (!file) return T.toast('Wybierz plik kopii.', 'err');
        let backup;
        try { backup = JSON.parse(await file.text()); } catch (e) { return T.toast('Plik nie jest poprawnym JSON-em.', 'err'); }
        const info = `${(backup.matches || []).length} meczów, ${(backup.predictions || []).length} typów, ${(backup.players || []).length} graczy${backup.exportedAt ? `, z ${T.fmtDateTime(backup.exportedAt)}` : ''}`;
        if (!(await confirmBox({ title: 'Przywrócić kopię?', message: `${info}. Dokumenty o tych samych ID zostaną nadpisane.`, confirm: 'Przywróć', danger: true }))) return;
        await act('/api/admin/restore', { backup, mode: 'merge' }, { btn });
    }
};

function schedulePayload() {
    const teams = document.getElementById('ns-teams').value.split('\n').map(t => t.trim()).filter(Boolean);
    const startDate = document.getElementById('gen-start').value;
    if (!startDate) { T.toast('Wybierz poniedziałek pierwszej kolejki.', 'err'); return null; }
    const slots = [];
    document.querySelectorAll('[data-slot-day]').forEach(sel => {
        const time = document.querySelector(`[data-slot-time="${sel.dataset.slotDay}"]`).value;
        if (time) slots.push({ dayOffset: Number(sel.value), time });
    });
    return {
        season: S.season,
        teams: teams.length ? teams : seasonTeams(),
        startDate,
        slots,
        skipWeeks: document.getElementById('gen-skip').value.split(',').map(n => Number(n.trim())).filter(Boolean)
    };
}
