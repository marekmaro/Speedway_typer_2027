/* Panel administratora. Hasło wysyłane jest raz (login), dalej działa token sesji. */

let A = { season: null, seasons: [], matches: [], predictions: [], players: [], longTerms: [], cupMatches: [], ranking: [] };
let adminToken = sessionStorage.getItem('adminToken') || '';
let editSeason = Number(localStorage.getItem('adminSeason')) || null;
const esc = T.escapeHtml;

const SLOT_DAYS = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];

/* ---------------- logowanie ---------------- */
async function loginAdmin() {
    const password = document.getElementById('admin-pass-input').value;
    const err = document.getElementById('login-error');
    err.textContent = '';
    try {
        const out = await T.postJson('/api/admin/login', { password });
        adminToken = out.token;
        sessionStorage.setItem('adminToken', adminToken);
        showDashboard();
    } catch (e) {
        err.textContent = e.message;
    }
}

async function logoutAdmin() {
    try { await api('/api/admin/logout', {}, true); } catch (e) { /* ignore */ }
    sessionStorage.removeItem('adminToken');
    location.reload();
}

function showDashboard() {
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    refresh();
}

document.addEventListener('DOMContentLoaded', async () => {
    T.registerSW();
    document.querySelectorAll('.atab').forEach(btn => btn.addEventListener('click', () => {
        history.replaceState(null, '', `#${btn.dataset.tab.replace('tab-', '')}`);
        switchTab(btn.dataset.tab);
    }));
    document.getElementById('season-picker').addEventListener('change', e => {
        editSeason = Number(e.target.value);
        localStorage.setItem('adminSeason', editSeason);
        refresh();
    });
    renderSlotInputs();
    const fromHash = `tab-${location.hash.replace('#', '')}`;
    switchTab(document.getElementById(fromHash) ? fromHash : 'tab-drafts');

    if (adminToken) {
        try {
            await api('/api/admin/whoami', null, true, 'GET');
            showDashboard();
            return;
        } catch (e) { sessionStorage.removeItem('adminToken'); }
    }
    document.getElementById('admin-pass-input').focus();
});

function switchTab(id) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.toggle('hidden', el.id !== id));
    document.querySelectorAll('.atab').forEach(b => {
        if (b.dataset.tab === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
}

/* ---------------- warstwa API ---------------- */
async function api(url, body, silent = false, method = 'POST') {
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
            body: method === 'GET' ? undefined : JSON.stringify(body || {})
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            sessionStorage.removeItem('adminToken');
            T.toast('Sesja wygasła — zaloguj się ponownie.', 'err');
            setTimeout(() => location.reload(), 1200);
            throw new Error('Sesja wygasła');
        }
        if (!res.ok) throw new Error(data.error || `Błąd ${res.status}`);
        if (!silent) {
            T.toast(data.message || 'Gotowe');
            await refresh();
        }
        return data;
    } catch (e) {
        if (!silent) T.toast(e.message, 'err');
        throw e;
    }
}

function withSeason(body) { return { season: editSeason || undefined, ...body }; }

/* ---------------- pobranie danych ---------------- */
async function refresh() {
    const url = '/api/public/data' + (editSeason ? `?season=${editSeason}` : '');
    A = await T.getJson(url);
    if (!editSeason) editSeason = A.season.year;

    const [players, seasons, drafts, jobs, preds] = await Promise.all([
        api('/api/admin/players', null, true, 'GET').catch(() => []),
        api('/api/admin/seasons', null, true, 'GET').catch(() => []),
        api('/api/admin/drafts', null, true, 'GET').catch(() => []),
        api('/api/admin/jobs', null, true, 'GET').catch(() => null),
        api(`/api/admin/predictions?season=${editSeason}`, null, true, 'GET').catch(() => null)
    ]);
    if (preds) A.predictions = preds; // admin widzi typy także przed blokadą
    A.fullPlayers = players;
    A.seasonDetails = seasons;
    A.drafts = drafts;
    A.jobs = jobs;

    fillSeasonPicker();
    fillMatchSelects();
    fillPlayerSelects();
    fillTeamSelects();
    fillRoundSelects();
    renderDrafts();
    renderBulkResults();
    renderPlayersList();
    renderPlayerTips();
    renderCupList();
    renderSeasonsList();
    renderSeasonSettings();
    renderJobs();
}

function fillSeasonPicker() {
    const sel = document.getElementById('season-picker');
    sel.innerHTML = A.seasons.map(s =>
        `<option value="${s.year}" ${s.year === (editSeason || A.season.year) ? 'selected' : ''}>${esc(s.label)}${s.isActive ? ' • aktywny' : ''}</option>`).join('');
    const gen = document.getElementById('gen-season');
    gen.value = gen.value || (editSeason || A.season.year);
}

function matchLabel(m) {
    const score = T.hasResult(m) ? `✅ ${m.homeScore}:${m.awayScore} ` : '';
    const flags = `${m.isMatchOfTheRound ? '⭐' : ''}${m.isPostponed ? '⛔' : ''}${m.predictionsFrozen ? '🔒' : ''}${m.voidPredictions ? '∅' : ''}`;
    return `[R${m.round}] ${score}${T.shortName(m.homeTeam)} – ${T.shortName(m.awayTeam)} (${T.fmtDateTime(m.matchDate)}) ${flags}`;
}

function fillSelect(id, html) {
    const el = document.getElementById(id);
    const keep = el.value;
    el.innerHTML = html;
    if (keep && [...el.options].some(o => o.value === keep)) el.value = keep;
}

function fillMatchSelects() {
    const sorted = [...A.matches].sort((a, b) => {
        const aDone = T.hasResult(a), bDone = T.hasResult(b);
        if (aDone !== bDone) return aDone ? 1 : -1;
        return new Date(a.matchDate) - new Date(b.matchDate);
    });
    const opts = '<option value="">— wybierz mecz —</option>' +
        sorted.map(m => `<option value="${m._id}">${esc(matchLabel(m))}</option>`).join('');
    ['result-select', 'edit-select'].forEach(id => fillSelect(id, opts));
}

function fillPlayerSelects() {
    const opts = '<option value="">— wybierz gracza —</option>' +
        A.players.map(p => `<option value="${esc(p.nickname)}">${esc(p.nickname)}</option>`).join('');
    ['tips-player', 'lt-player', 'cup-p1', 'cup-p2'].forEach(id => fillSelect(id, opts));
}

function seasonTeams() {
    return (A.season.teams && A.season.teams.length) ? A.season.teams : [...new Set(A.matches.flatMap(m => [m.homeTeam, m.awayTeam]))];
}

function fillTeamSelects() {
    const opts = '<option value="">—</option>' + seasonTeams().map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    ['lt-gold', 'lt-bronze', 'lt-releg', 'fin-gold', 'fin-bronze', 'fin-releg', 'add-home', 'add-away'].forEach(id => fillSelect(id, opts));
    ['fin-gold', 'fin-bronze', 'fin-releg'].forEach(id => {
        const key = { 'fin-gold': 'champion', 'fin-bronze': 'bronze', 'fin-releg': 'relegation' }[id];
        if (A.season.results && A.season.results[key]) document.getElementById(id).value = A.season.results[key];
    });
}

function fillRoundSelects() {
    const rounds = [...new Set(A.matches.map(m => m.round))].sort((a, b) => a - b);
    const opts = rounds.map(r => `<option value="${r}">${esc(T.roundName(r, A.season.stageNames))}</option>`).join('');
    ['bulk-round', 'tips-round', 'cup-round', 'cupg-round'].forEach(id => fillSelect(id, (id === 'tips-round' ? '<option value="">wszystkie kolejki</option>' : '') + opts));
    const bulk = document.getElementById('bulk-round');
    if (!bulk.dataset.touched && rounds.length) {
        const pending = A.matches.filter(m => !T.hasResult(m) && new Date(m.matchDate) < new Date())
            .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0]
            || A.matches.filter(m => !T.hasResult(m)).sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
        bulk.value = pending ? pending.round : rounds[rounds.length - 1];
    }
    bulk.onchange = () => { bulk.dataset.touched = '1'; renderBulkResults(); };
}

/* ---------------- DO ZATWIERDZENIA ---------------- */
function renderDrafts() {
    const list = A.drafts || [];
    const badge = document.getElementById('drafts-badge');
    badge.textContent = list.length;
    badge.classList.toggle('hidden', !list.length);
    const box = document.getElementById('drafts-list');
    if (!list.length) {
        const last = A.jobs && A.jobs.runs.find(r => r.job === 'scrape');
        box.innerHTML = `<div class="card card-pad text-sm text-muted">Brak wyników do zatwierdzenia.${last ? ` Ostatnie pobranie: ${T.fmtDateTime(last.createdAt)} — ${esc(last.summary)}` : ''}</div>`;
        return;
    }
    box.innerHTML = list.map(d => {
        const m = d.match || {};
        const total = d.homeScore + d.awayScore;
        const blocked = (d.blockers || []).length > 0;
        return `
        <article class="card card-pad ${blocked ? 'border-bad/50' : (d.warnings || []).length ? 'border-warn/50' : 'border-ok/40'}">
            <div class="flex items-center justify-between gap-2 mb-2">
                <span class="eyebrow">R${m.round || '?'} · ${m.matchDate ? T.fmtDateTime(m.matchDate) : ''}${m.isMatchOfTheRound ? ' · ⭐ Kask' : ''}</span>
                <a href="${esc(d.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer" class="text-xs font-bold text-brand truncate max-w-[45%]">${esc(d.source || 'źródło')} ↗</a>
            </div>
            <div class="grid grid-cols-[1fr_auto_auto_auto_1fr] items-center gap-2">
                <span class="text-right font-bold text-sm">${esc(T.shortName(m.homeTeam || '?'))}</span>
                <input type="number" inputmode="numeric" class="score-input" id="dh-${d._id}" value="${d.homeScore}" aria-label="Gospodarze">
                <span class="text-xl font-black text-faint">:</span>
                <input type="number" inputmode="numeric" class="score-input" id="da-${d._id}" value="${d.awayScore}" aria-label="Goście">
                <span class="font-bold text-sm">${esc(T.shortName(m.awayTeam || '?'))}</span>
            </div>
            <p class="text-center text-xs text-muted mt-1">suma ${total} / 90${T.hasResult(m) ? ` · obecnie w bazie ${m.homeScore}:${m.awayScore}` : ''}</p>
            ${(d.blockers || []).map(b => `<p class="mt-2 text-sm font-bold text-bad">⛔ ${esc(b)}</p>`).join('')}
            ${(d.warnings || []).map(w => `<p class="mt-1 text-sm text-warn">⚠️ ${esc(w)}</p>`).join('')}
            ${d.snippet ? `<blockquote class="mt-2 rounded-xl bg-raised px-3 py-2 text-xs text-muted border-l-4 border-line">„${esc(d.snippet)}”</blockquote>` : ''}
            <div class="flex gap-2 mt-3">
                <button onclick="approveDraft('${d._id}', ${blocked})" class="btn-ok flex-1">✓ Zatwierdź</button>
                <button onclick="rejectDraft('${d._id}')" class="btn-ghost">Odrzuć</button>
            </div>
        </article>`;
    }).join('');
}

async function approveDraft(id, blocked) {
    const homeScore = Number(document.getElementById(`dh-${id}`).value);
    const awayScore = Number(document.getElementById(`da-${id}`).value);
    const d = A.drafts.find(x => x._id === id);
    const changed = d && (homeScore !== d.homeScore || awayScore !== d.awayScore);
    const force = blocked && !changed && confirm('Ten wynik nie przeszedł kontroli sensowności. Na pewno zatwierdzić bez zmian?');
    if (blocked && !changed && !force) return;
    await api('/api/admin/drafts/approve', { id, homeScore, awayScore, force, notify: document.getElementById('drafts-notify').checked });
}
async function rejectDraft(id) { await api('/api/admin/drafts/reject', { id }); }
async function approveAll() {
    if (!confirm('Zatwierdzić wszystkie wyniki bez uwag krytycznych (⛔)? Punkty zostaną przeliczone.')) return;
    await api('/api/admin/drafts/approve-all', { notify: document.getElementById('drafts-notify').checked });
}
async function runScrape() { T.toast('Pobieram wyniki…'); await api('/api/admin/jobs/scrape', withSeason({})); }

/* ---------------- WYNIKI ---------------- */
function renderBulkResults() {
    const round = Number(document.getElementById('bulk-round').value);
    const box = document.getElementById('bulk-results');
    const matches = A.matches.filter(m => m.round === round).sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    if (!matches.length) { box.innerHTML = '<p class="text-sm text-muted">Brak meczów.</p>'; return; }
    box.innerHTML = matches.map(m => `
        <div class="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl bg-raised border border-line p-2" data-bulk="${m._id}">
            <div class="min-w-0">
                <div class="text-sm font-bold truncate">${esc(T.shortName(m.homeTeam))} – ${esc(T.shortName(m.awayTeam))}</div>
                <div class="text-xs text-muted">${T.fmtDay(m.matchDate)} ${T.fmtTime(m.matchDate)}${m.isMatchOfTheRound ? ' · ⭐' : ''}${m.isWalkover ? ' · walkower' : ''}${m.resultSource === 'scraper' ? ' · ze scrapera' : ''}</div>
            </div>
            <input type="number" inputmode="numeric" class="input w-16 text-center font-black bulk-home" value="${m.homeScore ?? ''}" aria-label="Gospodarze">
            <input type="number" inputmode="numeric" class="input w-16 text-center font-black bulk-away" value="${m.awayScore ?? ''}" aria-label="Goście">
        </div>`).join('');
}

async function saveBulkResults() {
    const results = [];
    let suspicious = [];
    document.querySelectorAll('[data-bulk]').forEach(row => {
        const h = row.querySelector('.bulk-home').value;
        const a = row.querySelector('.bulk-away').value;
        if (h !== '' && a !== '') {
            results.push({ matchId: row.dataset.bulk, homeScore: Number(h), awayScore: Number(a) });
            if (Number(h) + Number(a) > 90) suspicious.push(`${h}:${a}`);
        }
    });
    if (!results.length) return T.toast('Nie wpisałeś żadnego wyniku.', 'err');
    if (suspicious.length && !confirm(`Suma powyżej 90 pkt (${suspicious.join(', ')}) — to niemożliwe w 15 biegach. Zapisać mimo to?`)) return;
    await api('/api/admin/results-bulk', { results, notify: document.getElementById('bulk-notify').checked });
}

function loadResult() {
    const m = A.matches.find(x => x._id === document.getElementById('result-select').value);
    document.getElementById('res-home').value = m && T.hasResult(m) ? m.homeScore : '';
    document.getElementById('res-away').value = m && T.hasResult(m) ? m.awayScore : '';
    document.getElementById('res-walkover').checked = !!(m && m.isWalkover);
}

async function saveResult() {
    const matchId = document.getElementById('result-select').value;
    const homeScore = document.getElementById('res-home').value;
    const awayScore = document.getElementById('res-away').value;
    if (!matchId || homeScore === '' || awayScore === '') return T.toast('Wybierz mecz i wpisz oba wyniki.', 'err');
    await api('/api/admin/result', {
        matchId, homeScore: Number(homeScore), awayScore: Number(awayScore),
        walkover: document.getElementById('res-walkover').checked,
        notify: document.getElementById('res-notify').checked
    });
}

async function clearResult() {
    const matchId = document.getElementById('result-select').value;
    if (!matchId || !confirm('Wycofać wynik tego meczu i punkty graczy?')) return;
    await api('/api/admin/result', { matchId, clear: true });
}

/* ---------------- TERMINARZ ---------------- */
function toLocalInput(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function loadMatchSettings() {
    const m = A.matches.find(x => x._id === document.getElementById('edit-select').value);
    if (!m) return;
    document.getElementById('edit-date').value = toLocalInput(m.matchDate);
    document.getElementById('edit-round').value = m.round;
    document.getElementById('edit-motr').checked = !!m.isMatchOfTheRound;
    document.getElementById('edit-postponed').checked = !!m.isPostponed;
    document.getElementById('edit-frozen').checked = !!m.predictionsFrozen;
    document.getElementById('edit-void').checked = !!m.voidPredictions;
    document.getElementById('edit-note').value = m.note || '';
    const preds = A.predictions.filter(p => p.matchId === m._id).length;
    document.getElementById('edit-info').textContent = [
        `${preds} typów`,
        m.originalDate ? `pierwotny termin: ${T.fmtDateTime(m.originalDate)}` : '',
        `blokada: ${T.fmtDateTime(T.lockTime(m, A.season.lockMinutes))}`
    ].filter(Boolean).join(' · ');
}

async function saveMatchEdit() {
    const matchId = document.getElementById('edit-select').value;
    if (!matchId) return T.toast('Wybierz mecz.', 'err');
    const m = A.matches.find(x => x._id === matchId);
    const body = {
        matchId,
        matchDate: document.getElementById('edit-date').value ? new Date(document.getElementById('edit-date').value).toISOString() : undefined,
        round: Number(document.getElementById('edit-round').value) || undefined,
        isMatchOfTheRound: document.getElementById('edit-motr').checked,
        isPostponed: document.getElementById('edit-postponed').checked,
        voidPredictions: document.getElementById('edit-void').checked,
        note: document.getElementById('edit-note').value
    };
    // Zamrożenie wysyłamy tylko, gdy admin świadomie je zmienił - inaczej serwer sam decyduje przy przełożeniu
    const frozen = document.getElementById('edit-frozen').checked;
    if (m && frozen !== !!m.predictionsFrozen) {
        if (!frozen && !confirm('Odmrozić typy? Gracze widzieli już cudze typy na ten mecz.')) return;
        body.predictionsFrozen = frozen;
    }
    await api('/api/admin/match-edit', body);
}

async function deleteMatch() {
    const matchId = document.getElementById('edit-select').value;
    if (!matchId || !confirm('Usunąć mecz wraz z typami graczy?')) return;
    await api('/api/admin/match-delete', { matchId });
}

async function addMatch() {
    const date = document.getElementById('add-date').value;
    await api('/api/admin/match-add', withSeason({
        round: document.getElementById('add-round').value,
        homeTeam: document.getElementById('add-home').value,
        awayTeam: document.getElementById('add-away').value,
        matchDate: date ? new Date(date).toISOString() : ''
    }));
}

/* ---------------- GRACZE ---------------- */
async function addPlayer() {
    const fullName = document.getElementById('new-fullname').value.trim();
    const nickname = document.getElementById('new-nickname').value.trim();
    if (!nickname) return T.toast('Podaj pseudonim.', 'err');
    await api('/api/admin/player', withSeason({ fullName, nickname }));
    document.getElementById('new-fullname').value = '';
    document.getElementById('new-nickname').value = '';
}

function playerLink(token) { return `${location.origin}/typuj.html?id=${token}`; }

function renderPlayersList() {
    const box = document.getElementById('players-list');
    const list = A.fullPlayers || [];
    if (!list.length) { box.innerHTML = '<p class="text-sm text-muted">Brak graczy.</p>'; return; }
    box.innerHTML = list.map(p => {
        const inSeason = p.seasons.includes(editSeason);
        const nick = esc(p.nickname).replace(/'/g, '&#39;');
        return `
        <div class="rounded-xl border border-line bg-raised p-3 ${p.isActive ? '' : 'opacity-70'}">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <strong>${esc(p.nickname)}</strong> <span class="text-muted text-sm">${esc(p.fullName || '')}</span>
                    ${p.isActive ? '' : '<span class="chip-bad ml-1">wstrzymany</span>'}
                    <div class="text-xs text-muted">sezony: ${p.seasons.join(', ') || '—'} · ostatnio: ${p.lastSeenAt ? T.fmtDateTime(p.lastSeenAt) : 'nigdy'}</div>
                </div>
            </div>
            <div class="flex flex-wrap gap-1.5 mt-2">
                <button onclick="copyLink('${p.token}','${nick}')" class="btn-primary btn-sm">Kopiuj link</button>
                <a href="https://wa.me/?text=${encodeURIComponent('Twój panel typera (nie udostępniaj): ' + playerLink(p.token))}" target="_blank" rel="noopener" class="btn-ghost btn-sm">WhatsApp</a>
                <button onclick="toggleSeason('${nick}',${!inSeason})" class="btn-ghost btn-sm">${inSeason ? 'Wypisz z sezonu' : 'Dopisz do sezonu'}</button>
                <button onclick="newToken('${nick}')" class="btn-ghost btn-sm">Nowy link</button>
                <button onclick="togglePlayer('${nick}')" class="btn-ghost btn-sm">${p.isActive ? 'Wstrzymaj' : 'Przywróć'}</button>
                <button onclick="pushTestPlayer('${nick}')" class="btn-ghost btn-sm">Test push</button>
                <button onclick="deletePlayer('${nick}')" class="btn-danger btn-sm">Usuń</button>
            </div>
        </div>`;
    }).join('');
}

function copyLink(token, nick) {
    const link = playerLink(token);
    navigator.clipboard.writeText(link)
        .then(() => T.toast(`Skopiowano link dla ${nick}`))
        .catch(() => prompt('Skopiuj link ręcznie:', link));
}

async function newToken(nickname) {
    if (!confirm(`Wygenerować nowy link dla ${nickname}? Stary przestanie działać.`)) return;
    await api('/api/admin/player/token', { nickname });
}
async function togglePlayer(nickname) { await api('/api/admin/player/toggle', { nickname }); }
async function toggleSeason(nickname, join) { await api('/api/admin/player/season', { nickname, year: editSeason, join }); }
async function pushTestPlayer(nickname) { await api('/api/admin/push/test', { nickname }, false); }

async function deletePlayer(nickname) {
    const onlySeason = confirm(`OK = usuń ${nickname} tylko z sezonu ${editSeason}.\nAnuluj = przejdź do usunięcia z całej historii.`);
    if (onlySeason) return api('/api/admin/delete-player', { nickname, onlySeason: editSeason });
    if (confirm(`Usunąć ${nickname} BEZPOWROTNIE ze wszystkich sezonów?`)) {
        await api('/api/admin/delete-player', { nickname });
    }
}

/* ---------------- TYPY ---------------- */
function renderPlayerTips() {
    const nickname = document.getElementById('tips-player').value;
    const round = document.getElementById('tips-round').value;
    const box = document.getElementById('tips-container');
    if (!nickname) { box.innerHTML = '<p class="text-sm text-muted text-center py-4">Wybierz gracza.</p>'; return; }

    const matches = A.matches
        .filter(m => !round || m.round === Number(round))
        .sort((a, b) => a.round - b.round || new Date(a.matchDate) - new Date(b.matchDate));
    const nick = esc(nickname).replace(/'/g, '&#39;');

    box.innerHTML = matches.map(m => {
        const p = A.predictions.find(x => x.nickname === nickname && x.matchId === m._id) || {};
        const val = v => (v === null || v === undefined ? '' : v);
        return `
        <div class="rounded-xl border border-line bg-raised p-2.5">
            <div class="text-sm font-bold">${esc(T.shortName(m.homeTeam))} – ${esc(T.shortName(m.awayTeam))}
                <span class="text-xs text-muted font-semibold">R${m.round} · ${T.fmtDay(m.matchDate)}${T.hasResult(m) ? ` · ${m.homeScore}:${m.awayScore}` : ''}</span>
                ${p.hidden ? '<span class="chip-muted">ukryty</span>' : ''}</div>
            <div class="flex flex-wrap items-center gap-2 mt-2">
                <input type="number" inputmode="numeric" id="tip-h-${m._id}" value="${val(p.homePred)}" class="input w-16 text-center font-bold" aria-label="Gospodarze">
                <span class="font-black text-faint">:</span>
                <input type="number" inputmode="numeric" id="tip-a-${m._id}" value="${val(p.awayPred)}" class="input w-16 text-center font-bold" aria-label="Goście">
                <label class="flex items-center gap-1 text-xs font-bold text-gold"><input type="checkbox" id="tip-j-${m._id}" ${p.usedJoker ? 'checked' : ''} class="w-5 h-5"> Joker</label>
                ${p.pointsEarned !== null && p.pointsEarned !== undefined ? `<span class="chip-ok">+${p.pointsEarned}</span>` : ''}
                <span class="flex-1"></span>
                <button onclick="saveTip('${m._id}','${nick}')" class="btn-primary btn-sm">Zapisz</button>
                ${p.homePred !== undefined || p.hidden ? `<button onclick="deleteTip('${m._id}','${nick}')" class="btn-ghost btn-sm" aria-label="Usuń typ">✕</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function saveTip(matchId, nickname) {
    const h = document.getElementById(`tip-h-${matchId}`).value;
    const a = document.getElementById(`tip-a-${matchId}`).value;
    if (h === '' || a === '') return T.toast('Podaj pełny typ.', 'err');
    await api('/api/admin/predict', withSeason({
        nickname, matchId, homePred: Number(h), awayPred: Number(a),
        usedJoker: document.getElementById(`tip-j-${matchId}`).checked
    }));
}

async function deleteTip(matchId, nickname) {
    if (!confirm('Usunąć ten typ?')) return;
    await api('/api/admin/predict-delete', withSeason({ nickname, matchId }));
}

function loadLongTerm() {
    const nickname = document.getElementById('lt-player').value;
    const lt = (A.longTerms || []).find(l => l.nickname === nickname) || {};
    document.getElementById('lt-gold').value = lt.champion || '';
    document.getElementById('lt-bronze').value = lt.bronze || '';
    document.getElementById('lt-releg').value = lt.relegation || '';
}

async function saveLongTerm() {
    const nickname = document.getElementById('lt-player').value;
    if (!nickname) return T.toast('Wybierz gracza.', 'err');
    await api('/api/admin/longterm', withSeason({
        nickname,
        champion: document.getElementById('lt-gold').value,
        bronze: document.getElementById('lt-bronze').value,
        relegation: document.getElementById('lt-releg').value
    }));
}

/* ---------------- PUCHAR ---------------- */
async function generateCup() {
    await api('/api/admin/cup-generate', withSeason({
        stage: document.getElementById('cupg-stage').value,
        roundNumber: document.getElementById('cupg-round').value,
        count: document.getElementById('cupg-count').value
    }));
}

async function saveCup() {
    await api('/api/admin/cup-match', withSeason({
        stage: document.getElementById('cup-stage').value,
        roundNumber: document.getElementById('cup-round').value,
        player1: document.getElementById('cup-p1').value,
        player2: document.getElementById('cup-p2').value,
        score1: document.getElementById('cup-s1').value,
        score2: document.getElementById('cup-s2').value,
        autoScore: document.getElementById('cup-auto').checked
    }));
}

async function autoscoreCup() { await api('/api/admin/cup-autoscore', withSeason({})); }

function renderCupList() {
    const box = document.getElementById('cup-list');
    if (!A.cupMatches.length) { box.innerHTML = '<p class="text-sm text-muted">Drabinka pusta.</p>'; return; }
    box.innerHTML = A.cupMatches.map(c => `
        <div class="flex items-center justify-between gap-2 rounded-xl border border-line bg-raised p-2.5 text-sm">
            <span class="min-w-0"><strong>${esc(c.stage)}</strong> ${c.roundNumber ? `· R${c.roundNumber}` : ''}<br>
                <span class="tabular-nums">${esc(c.player1)} ${c.score1 ?? '–'} : ${c.score2 ?? '–'} ${esc(c.player2)}</span></span>
            <button onclick="deleteCup('${c._id}')" class="btn-danger btn-sm" aria-label="Usuń parę">✕</button>
        </div>`).join('');
}

async function deleteCup(id) { if (confirm('Usunąć parę?')) await api('/api/admin/cup-delete', { id }); }

/* ---------------- SEZONY ---------------- */
function renderSeasonsList() {
    const box = document.getElementById('seasons-list');
    const list = A.seasonDetails || [];
    if (!list.length) { box.innerHTML = '<p class="text-sm text-muted">Brak sezonów.</p>'; return; }
    box.innerHTML = list.map(s => `
        <div class="rounded-xl border border-line bg-raised p-3 ${s.year === editSeason ? 'ring-2 ring-brand/40' : ''}">
            <div class="flex flex-wrap items-center gap-2">
                <strong>${esc(s.label || 'Sezon ' + s.year)}</strong>
                ${s.isActive ? '<span class="chip-ok">aktywny</span>' : ''}
                ${s.isFinished ? '<span class="chip-muted">archiwum</span>' : ''}
                ${s.year === editSeason ? '<span class="chip-brand">edytowany</span>' : ''}
            </div>
            <div class="text-xs text-muted">${s.matches} meczów · ${s.predictions} typów · blokada ${T.lockLabel(s.lockMinutes)} przed startem · ${s.teams.length} drużyn</div>
            <div class="flex flex-wrap gap-1.5 mt-2">
                ${s.isActive ? '' : `<button onclick="activateSeason(${s.year})" class="btn-ok btn-sm">Ustaw aktywny</button>`}
                ${s.isFinished ? `<button onclick="reopenSeason(${s.year})" class="btn-ghost btn-sm">Otwórz ponownie</button>` : ''}
                ${s.year === editSeason ? '' : `<button onclick="editThisSeason(${s.year})" class="btn-ghost btn-sm">Edytuj ten sezon</button>`}
            </div>
        </div>`).join('');
}

function currentSeasonDetails() { return (A.seasonDetails || []).find(s => s.year === editSeason) || null; }

function renderSeasonSettings() {
    const s = currentSeasonDetails();
    if (!s) return;
    const set = (id, v) => { const el = document.getElementById(id); if (document.activeElement !== el) el.value = v; };
    set('set-lock', s.lockMinutes);
    set('set-exact', s.scoring.exact); set('set-diff', s.scoring.diff); set('set-winner', s.scoring.winner);
    set('set-motr', s.scoring.motrBonus); set('set-joker', s.scoring.jokerMultiplier); set('set-lt', s.scoring.longTermEach);
    set('set-adjust', (s.standingsAdjustments || []).map(a => `${a.team} ; ${a.points} ; ${a.reason || ''}`).join('\n'));
    set('set-aliases', Object.entries(s.teamAliases || {}).map(([t, list]) => `${t} = ${list.join(', ')}`).join('\n'));
    set('set-urls', (s.scraperUrls || []).join('\n'));
    const env = A.jobs && A.jobs.scraper ? A.jobs.scraper.envUrls : [];
    document.getElementById('set-urls-env').textContent = env.length
        ? `Puste = źródła z SCRAPER_URLS: ${env.join(', ')}` : 'Brak źródeł w SCRAPER_URLS — wpisz adresy tutaj albo w zmiennych środowiskowych.';
}

async function saveSeasonSettings() {
    const s = currentSeasonDetails();
    const scoring = {
        exact: document.getElementById('set-exact').value, diff: document.getElementById('set-diff').value,
        winner: document.getElementById('set-winner').value, motrBonus: document.getElementById('set-motr').value,
        jokerMultiplier: document.getElementById('set-joker').value, longTermEach: document.getElementById('set-lt').value
    };
    const scoringChanged = s && Object.entries(scoring).some(([k, v]) => Number(v) !== Number(s.scoring[k]));
    if (scoringChanged && !confirm('Zmieniasz punktację — cały sezon zostanie przeliczony. Kontynuować?')) return;

    const teams = seasonTeams();
    const adjustments = document.getElementById('set-adjust').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [team, points, ...reason] = l.split(';').map(x => x.trim());
        return { team, points: Number(points), reason: reason.join(';') };
    });
    const unknown = adjustments.filter(a => !teams.includes(a.team)).map(a => a.team);
    if (unknown.length && !confirm(`Nieznane drużyny w korektach: ${unknown.join(', ')}. Zapisać mimo to?`)) return;

    const aliases = {};
    document.getElementById('set-aliases').value.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
        const [team, rest] = l.split('=').map(x => (x || '').trim());
        if (team && rest) aliases[team] = rest.split(',').map(x => x.trim()).filter(Boolean);
    });

    await api('/api/admin/season/settings', withSeason({
        lockMinutes: document.getElementById('set-lock').value,
        scoring: scoringChanged ? scoring : undefined,
        standingsAdjustments: adjustments,
        teamAliases: aliases,
        scraperUrls: document.getElementById('set-urls').value.split('\n').map(x => x.trim()).filter(Boolean)
    }));
}

function editThisSeason(year) {
    editSeason = year;
    localStorage.setItem('adminSeason', year);
    refresh();
    T.toast(`Panel przestawiony na sezon ${year}`);
}

async function activateSeason(year) {
    if (!confirm(`Ustawić sezon ${year} jako aktywny? Strona główna zacznie go pokazywać domyślnie.`)) return;
    await api('/api/admin/season/activate', { year });
}

async function reopenSeason(year) { await api('/api/admin/season/reopen', { season: year }); }

function copyTeamsFromCurrent() { document.getElementById('ns-teams').value = seasonTeams().join('\n'); }

async function saveNewSeason(activate) {
    const year = Number(document.getElementById('ns-year').value);
    const teams = document.getElementById('ns-teams').value.split('\n').map(t => t.trim()).filter(Boolean);
    if (!year) return T.toast('Podaj rok sezonu.', 'err');
    if (activate && !confirm(`Sezon ${year} stanie się domyślnym na stronie głównej. Kontynuować?`)) return;
    const out = await api('/api/admin/season', {
        year,
        label: document.getElementById('ns-label').value,
        lockMinutes: document.getElementById('ns-lock').value,
        teams,
        copyPlayers: document.getElementById('ns-copy').checked,
        activate
    });
    if (out) {
        document.getElementById('gen-season').value = year;
        editThisSeason(year);
    }
}

function renderSlotInputs() {
    const box = document.getElementById('gen-slots');
    const defaults = [[4, '18:00'], [4, '20:30'], [6, '16:00'], [6, '19:15']];
    box.innerHTML = defaults.map(([day, time], i) => `
        <div class="flex gap-2">
            <select id="slot-day-${i}" class="input" aria-label="Dzień meczu ${i + 1}">
                ${SLOT_DAYS.map((d, di) => `<option value="${di}" ${di === day ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
            <input type="time" id="slot-time-${i}" value="${time}" class="input w-32" aria-label="Godzina meczu ${i + 1}">
        </div>`).join('');
}

function readSlots() {
    const slots = [];
    for (let i = 0; i < 4; i++) {
        const day = document.getElementById(`slot-day-${i}`);
        const time = document.getElementById(`slot-time-${i}`);
        if (day && time && time.value) slots.push({ dayOffset: Number(day.value), time: time.value });
    }
    return slots;
}

function genPayload() {
    const teams = document.getElementById('ns-teams').value.split('\n').map(t => t.trim()).filter(Boolean);
    return {
        season: Number(document.getElementById('gen-season').value) || editSeason,
        teams: teams.length ? teams : (A.season.teams || []),
        startDate: document.getElementById('gen-start').value,
        slots: readSlots(),
        skipWeeks: document.getElementById('gen-skip').value.split(',').map(n => Number(n.trim())).filter(Boolean)
    };
}

async function previewSchedule() {
    try {
        const out = await api('/api/admin/generate-schedule', { ...genPayload(), dryRun: true }, true);
        const pre = document.getElementById('gen-preview');
        pre.classList.remove('hidden');
        pre.textContent = out.schedule.map(m =>
            `R${String(m.round).padStart(2, '0')} ${new Date(m.matchDate).toLocaleString('pl-PL')}  ${m.homeTeam} – ${m.awayTeam}`).join('\n');
        T.toast(out.message);
    } catch (e) { T.toast(e.message, 'err'); }
}

async function saveSchedule(replace) {
    if (replace && !confirm('Zastąpić cały terminarz tego sezonu? Typy graczy z tego sezonu zostaną usunięte!')) return;
    await api('/api/admin/generate-schedule', { ...genPayload(), replace });
}

async function importSchedule() {
    let schedule;
    try { schedule = JSON.parse(document.getElementById('schedule-json').value); } catch (e) { return T.toast('Niepoprawny JSON.', 'err'); }
    await api('/api/admin/load-schedule', withSeason({ schedule }));
}

async function finishSeason() {
    if (!confirm('Rozliczyć typy sezonowe według wskazanych wyników?')) return;
    await api('/api/admin/season/finish', withSeason({
        champion: document.getElementById('fin-gold').value,
        bronze: document.getElementById('fin-bronze').value,
        relegation: document.getElementById('fin-releg').value,
        markFinished: document.getElementById('fin-mark').checked
    }));
}

/* ---------------- SYSTEM ---------------- */
function renderJobs() {
    const j = A.jobs;
    const status = document.getElementById('push-status');
    if (!j) { status.textContent = ''; return; }
    status.textContent = j.push.enabled
        ? `Push włączony · ${j.push.subscriptions} urządzeń (w tym ${j.push.admins} admina).`
        : 'Push wyłączony — ustaw VAPID_PUBLIC_KEY i VAPID_PRIVATE_KEY (npm run vapid).';
    const list = document.getElementById('jobs-list');
    list.innerHTML = j.runs.length ? j.runs.map(r => `
        <li class="py-2">
            <div class="flex items-center gap-2"><span class="${r.ok ? 'chip-ok' : 'chip-bad'}">${esc(r.job)}</span>
                <span class="text-xs text-muted">${T.fmtDateTime(r.createdAt)}</span></div>
            <div class="text-sm mt-0.5">${esc(r.summary || '')}</div>
            ${r.details && r.details.sourceErrors && r.details.sourceErrors.length ? `<div class="text-xs text-bad mt-0.5">${r.details.sourceErrors.map(esc).join('<br>')}</div>` : ''}
        </li>`).join('') : '<li class="py-2 text-muted">Jeszcze nic nie uruchomiono.</li>';
}

async function adminPushSubscribe() {
    try {
        const out = await T.enablePush('/api/admin/push/subscribe', {}, { 'x-admin-token': adminToken });
        T.toast(out.message);
        refresh();
    } catch (e) { T.toast(e.message, 'err'); }
}
async function adminPushTest() { await api('/api/admin/push/test', {}); }
async function runReminders() { await api('/api/admin/jobs/reminders', {}); }

async function recalc() { if (confirm('Przeliczyć punkty całego sezonu?')) await api('/api/admin/recalculate', withSeason({})); }
async function fixDuplicates() { await api('/api/admin/fix-duplicates', {}); }
async function cleanRounds() {
    const from = document.getElementById('clean-from').value;
    if (!confirm(`Usunąć wszystkie mecze od kolejki ${from} wraz z typami?`)) return;
    await api('/api/admin/clean-rounds', withSeason({ from }));
}

async function downloadBackup() {
    try {
        const res = await fetch('/api/admin/backup', { headers: { 'x-admin-token': adminToken } });
        if (!res.ok) throw new Error('Błąd pobierania kopii');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `typer-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        T.toast('Kopia pobrana');
    } catch (e) { T.toast(e.message, 'err'); }
}

async function restoreBackup() {
    const file = document.getElementById('restore-file').files[0];
    if (!file) return T.toast('Wybierz plik kopii.', 'err');
    if (!confirm('Przywrócić dane z pliku? Istniejące dokumenty o tych samych ID zostaną nadpisane.')) return;
    try {
        const backup = JSON.parse(await file.text());
        await api('/api/admin/restore', { backup, mode: 'merge' });
    } catch (e) { T.toast(`Błąd pliku: ${e.message}`, 'err'); }
}
