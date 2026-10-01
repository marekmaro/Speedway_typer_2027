/* Panel administratora. Hasło wysyłane jest raz (login), dalej działa token sesji. */

let A = { season: null, seasons: [], matches: [], predictions: [], players: [], longTerms: [], cupMatches: [], ranking: [] };
let adminToken = sessionStorage.getItem('adminToken') || '';
let editSeason = Number(localStorage.getItem('adminSeason')) || null;

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
    document.querySelectorAll('.atab').forEach(btn => btn.addEventListener('click', () => switchTab(btn)));
    document.getElementById('season-picker').addEventListener('change', e => {
        editSeason = Number(e.target.value);
        localStorage.setItem('adminSeason', editSeason);
        refresh();
    });
    renderSlotInputs();

    if (adminToken) {
        try {
            await api('/api/admin/whoami', null, true, 'GET');
            showDashboard();
            return;
        } catch (e) { sessionStorage.removeItem('adminToken'); }
    }
    document.getElementById('admin-pass-input').focus();
});

function switchTab(btn) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById(btn.dataset.tab).classList.add('active');
    document.querySelectorAll('.atab').forEach(b => {
        b.classList.remove('bg-red-700');
        b.classList.add('bg-gray-300', '!text-gray-700');
    });
    btn.classList.add('bg-red-700');
    btn.classList.remove('bg-gray-300', '!text-gray-700');
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
    const data = await T.getJson(url);
    A = data;
    if (!editSeason) editSeason = data.season.year;

    // pełna lista graczy z tokenami (tylko dla admina)
    try { A.fullPlayers = await api('/api/admin/players', null, true, 'GET'); } catch (e) { A.fullPlayers = []; }
    try { A.seasonDetails = await api('/api/admin/seasons', null, true, 'GET'); } catch (e) { A.seasonDetails = []; }

    fillSeasonPicker();
    fillMatchSelects();
    fillPlayerSelects();
    fillTeamSelects();
    fillRoundSelects();
    renderBulkResults();
    renderPlayersList();
    renderPlayerTips();
    renderCupList();
    renderSeasonsList();
}

function fillSeasonPicker() {
    const sel = document.getElementById('season-picker');
    sel.innerHTML = A.seasons.map(s =>
        `<option value="${s.year}" ${s.year === (editSeason || A.season.year) ? 'selected' : ''}>${T.escapeHtml(s.label)}${s.isActive ? ' • aktywny' : ''}</option>`).join('');
    document.getElementById('gen-season').value = document.getElementById('gen-season').value || (editSeason || A.season.year);
}

function matchLabel(m) {
    const date = T.fmtDateTime(m.matchDate);
    const score = m.homeScore !== null ? `✅ ${m.homeScore}:${m.awayScore} ` : '';
    const flags = `${m.isMatchOfTheRound ? '⭐' : ''}${m.isPostponed ? '⛔' : ''}`;
    return `[${T.roundName(m.round, A.season.stageNames)}] ${score}${T.shortName(m.homeTeam)} vs ${T.shortName(m.awayTeam)} (${date}) ${flags}`;
}

function fillMatchSelects() {
    const sorted = [...A.matches].sort((a, b) => {
        const aDone = a.homeScore !== null, bDone = b.homeScore !== null;
        if (aDone !== bDone) return aDone ? 1 : -1;
        return new Date(a.matchDate) - new Date(b.matchDate);
    });
    const opts = '<option value="">— wybierz mecz —</option>' +
        sorted.map(m => `<option value="${m._id}">${T.escapeHtml(matchLabel(m))}</option>`).join('');
    ['result-select', 'edit-select'].forEach(id => {
        const el = document.getElementById(id);
        const keep = el.value;
        el.innerHTML = opts;
        if (keep) el.value = keep;
    });
}

function fillPlayerSelects() {
    const opts = '<option value="">— wybierz gracza —</option>' +
        A.players.map(p => `<option value="${T.escapeHtml(p.nickname)}">${T.escapeHtml(p.nickname)}</option>`).join('');
    ['tips-player', 'lt-player', 'cup-p1', 'cup-p2'].forEach(id => {
        const el = document.getElementById(id);
        const keep = el.value;
        el.innerHTML = opts;
        if (keep) el.value = keep;
    });
}

function fillTeamSelects() {
    const teams = (A.season.teams && A.season.teams.length)
        ? A.season.teams
        : [...new Set(A.matches.flatMap(m => [m.homeTeam, m.awayTeam]))];
    const opts = '<option value="">—</option>' + teams.map(t => `<option value="${T.escapeHtml(t)}">${T.escapeHtml(t)}</option>`).join('');
    ['lt-gold', 'lt-bronze', 'lt-releg', 'fin-gold', 'fin-bronze', 'fin-releg', 'add-home', 'add-away'].forEach(id => {
        const el = document.getElementById(id);
        const keep = el.value;
        el.innerHTML = opts;
        if (keep) el.value = keep;
    });
    ['fin-gold', 'fin-bronze', 'fin-releg'].forEach(id => {
        const key = { 'fin-gold': 'champion', 'fin-bronze': 'bronze', 'fin-releg': 'relegation' }[id];
        if (A.season.results && A.season.results[key]) document.getElementById(id).value = A.season.results[key];
    });
}

function fillRoundSelects() {
    const rounds = [...new Set(A.matches.map(m => m.round))].sort((a, b) => a - b);
    const opts = rounds.map(r => `<option value="${r}">${T.escapeHtml(T.roundName(r, A.season.stageNames))}</option>`).join('');
    ['bulk-round', 'tips-round', 'cup-round', 'cupg-round'].forEach(id => {
        const el = document.getElementById(id);
        const keep = el.value;
        el.innerHTML = (id === 'tips-round' ? '<option value="">wszystkie kolejki</option>' : '') + opts;
        if (keep) el.value = keep;
    });
    if (!document.getElementById('bulk-round').value && rounds.length) {
        const pending = A.matches.filter(m => m.homeScore === null).sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
        document.getElementById('bulk-round').value = pending ? pending.round : rounds[rounds.length - 1];
    }
}

/* ---------------- 1. WYNIKI ---------------- */
function renderBulkResults() {
    const round = Number(document.getElementById('bulk-round').value);
    const box = document.getElementById('bulk-results');
    const matches = A.matches.filter(m => m.round === round).sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    if (!matches.length) { box.innerHTML = '<p class="text-sm italic text-gray-500">Brak meczów.</p>'; return; }
    box.innerHTML = matches.map(m => `
        <div class="flex items-center gap-2 bg-gray-50 p-2 rounded border" data-bulk="${m._id}">
            <span class="text-[10px] text-gray-400 w-24 shrink-0">${T.fmtDay(m.matchDate)}</span>
            <span class="flex-1 text-sm font-bold truncate">${T.escapeHtml(T.shortName(m.homeTeam))} – ${T.escapeHtml(T.shortName(m.awayTeam))}</span>
            ${m.isMatchOfTheRound ? '<span class="gold-helmet">KASK</span>' : ''}
            <input type="number" class="inp w-16 text-center font-bold bulk-home" value="${m.homeScore ?? ''}">
            <input type="number" class="inp w-16 text-center font-bold bulk-away" value="${m.awayScore ?? ''}">
        </div>`).join('');
}

async function saveBulkResults() {
    const results = [];
    document.querySelectorAll('[data-bulk]').forEach(row => {
        const h = row.querySelector('.bulk-home').value;
        const a = row.querySelector('.bulk-away').value;
        if (h !== '' && a !== '') results.push({ matchId: row.dataset.bulk, homeScore: Number(h), awayScore: Number(a) });
    });
    if (!results.length) return T.toast('Nie wpisałeś żadnego wyniku.', 'err');
    await api('/api/admin/results-bulk', { results });
}

function loadResult() {
    const m = A.matches.find(x => x._id === document.getElementById('result-select').value);
    document.getElementById('res-home').value = m && m.homeScore !== null ? m.homeScore : '';
    document.getElementById('res-away').value = m && m.awayScore !== null ? m.awayScore : '';
}

async function saveResult() {
    const matchId = document.getElementById('result-select').value;
    const homeScore = document.getElementById('res-home').value;
    const awayScore = document.getElementById('res-away').value;
    if (!matchId || homeScore === '' || awayScore === '') return T.toast('Wybierz mecz i wpisz oba wyniki.', 'err');
    await api('/api/admin/result', { matchId, homeScore: Number(homeScore), awayScore: Number(awayScore) });
}

async function clearResult() {
    const matchId = document.getElementById('result-select').value;
    if (!matchId || !confirm('Wycofać wynik tego meczu i punkty graczy?')) return;
    await api('/api/admin/result', { matchId, clear: true });
}

/* ---------------- 2. TERMINARZ ---------------- */
function loadMatchSettings() {
    const m = A.matches.find(x => x._id === document.getElementById('edit-select').value);
    if (!m) return;
    const d = new Date(m.matchDate);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('edit-date').value = d.toISOString().slice(0, 16);
    document.getElementById('edit-motr').checked = !!m.isMatchOfTheRound;
    document.getElementById('edit-postponed').checked = !!m.isPostponed;
    document.getElementById('edit-note').value = m.note || '';
}

async function saveMatchEdit() {
    const matchId = document.getElementById('edit-select').value;
    if (!matchId) return T.toast('Wybierz mecz.', 'err');
    await api('/api/admin/match-edit', {
        matchId,
        matchDate: document.getElementById('edit-date').value || undefined,
        isMatchOfTheRound: document.getElementById('edit-motr').checked,
        isPostponed: document.getElementById('edit-postponed').checked,
        note: document.getElementById('edit-note').value
    });
}

async function deleteMatch() {
    const matchId = document.getElementById('edit-select').value;
    if (!matchId || !confirm('Usunąć mecz wraz z typami graczy?')) return;
    await api('/api/admin/match-delete', { matchId });
}

async function addMatch() {
    await api('/api/admin/match-add', withSeason({
        round: document.getElementById('add-round').value,
        homeTeam: document.getElementById('add-home').value,
        awayTeam: document.getElementById('add-away').value,
        matchDate: document.getElementById('add-date').value
    }));
}

/* ---------------- 3. GRACZE ---------------- */
async function addPlayer() {
    const fullName = document.getElementById('new-fullname').value.trim();
    const nickname = document.getElementById('new-nickname').value.trim();
    if (!nickname) return T.toast('Podaj pseudonim.', 'err');
    await api('/api/admin/player', withSeason({ fullName, nickname }));
    document.getElementById('new-fullname').value = '';
    document.getElementById('new-nickname').value = '';
}

function renderPlayersList() {
    const box = document.getElementById('players-list');
    const list = A.fullPlayers || [];
    if (!list.length) { box.innerHTML = '<p class="text-sm italic text-gray-500">Brak graczy.</p>'; return; }
    box.innerHTML = list.map(p => {
        const link = `${location.origin}/typuj.html?id=${p.token}`;
        const inSeason = p.seasons.includes(editSeason);
        return `
        <div class="bg-blue-50 border border-blue-100 p-2 rounded text-xs">
            <div class="flex items-center justify-between gap-2 mb-1">
                <div class="min-w-0">
                    <strong class="text-gray-900">${T.escapeHtml(p.nickname)}</strong>
                    <span class="text-gray-400">${T.escapeHtml(p.fullName || '')}</span>
                    ${p.isActive ? '' : '<span class="ml-1 text-red-600 font-bold">(wstrzymany)</span>'}
                    <div class="text-[10px] text-gray-400">sezony: ${p.seasons.join(', ') || '—'}</div>
                </div>
                <div class="flex flex-wrap gap-1 shrink-0">
                    <button onclick="copyLink('${p.token}','${T.escapeHtml(p.nickname)}')" class="btn bg-blue-600 hover:bg-blue-800 !py-1 !px-2">Kopiuj link</button>
                    <a href="https://wa.me/?text=${encodeURIComponent('Twój panel typera: ' + link)}" target="_blank" rel="noopener" class="btn bg-green-600 hover:bg-green-700 !py-1 !px-2">WhatsApp</a>
                    <button onclick="toggleSeason('${T.escapeHtml(p.nickname)}',${!inSeason})" class="btn ${inSeason ? 'bg-gray-500' : 'bg-indigo-600'} !py-1 !px-2">${inSeason ? 'Wypisz z sezonu' : 'Dopisz do sezonu'}</button>
                    <button onclick="newToken('${T.escapeHtml(p.nickname)}')" class="btn bg-yellow-600 hover:bg-yellow-700 !py-1 !px-2">Nowy link</button>
                    <button onclick="togglePlayer('${T.escapeHtml(p.nickname)}')" class="btn bg-gray-600 !py-1 !px-2">${p.isActive ? 'Wstrzymaj' : 'Przywróć'}</button>
                    <button onclick="deletePlayer('${T.escapeHtml(p.nickname)}')" class="btn bg-red-600 hover:bg-red-800 !py-1 !px-2">Usuń</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function copyLink(token, nick) {
    const link = `${location.origin}/typuj.html?id=${token}`;
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

async function deletePlayer(nickname) {
    const onlySeason = confirm(`OK = usuń ${nickname} tylko z sezonu ${editSeason}.\nAnuluj = przejdź do usunięcia z całej historii.`);
    if (onlySeason) return api('/api/admin/delete-player', { nickname, onlySeason: editSeason });
    if (confirm(`Usunąć ${nickname} BEZPOWROTNIE ze wszystkich sezonów?`)) {
        await api('/api/admin/delete-player', { nickname });
    }
}

/* ---------------- 4. TYPY ---------------- */
function renderPlayerTips() {
    const nickname = document.getElementById('tips-player').value;
    const round = document.getElementById('tips-round').value;
    const box = document.getElementById('tips-container');
    if (!nickname) { box.innerHTML = '<p class="text-sm italic text-gray-500 text-center py-4">Wybierz gracza.</p>'; return; }

    const matches = A.matches
        .filter(m => !round || m.round === Number(round))
        .sort((a, b) => a.round - b.round || new Date(a.matchDate) - new Date(b.matchDate));

    box.innerHTML = matches.map(m => {
        const p = A.predictions.find(x => x.nickname === nickname && x.matchId === m._id) || {};
        const val = v => (v === null || v === undefined ? '' : v);
        return `
        <div class="flex flex-col md:flex-row md:items-center gap-2 bg-gray-50 p-2 rounded border">
            <div class="md:w-1/3 text-xs font-bold text-gray-700">
                <span class="text-purple-700 bg-purple-100 px-1 rounded">${T.escapeHtml(T.roundName(m.round, A.season.stageNames))}</span>
                <span class="text-gray-400">${T.fmtDay(m.matchDate)}</span>
                ${m.homeScore !== null ? `<span class="text-blue-700">(${m.homeScore}:${m.awayScore})</span>` : ''}
                <div>${T.escapeHtml(T.shortName(m.homeTeam))} – ${T.escapeHtml(T.shortName(m.awayTeam))}</div>
            </div>
            <div class="md:w-1/3 flex items-center justify-center gap-2">
                <input type="number" id="tip-h-${m._id}" value="${val(p.homePred)}" class="inp w-16 text-center font-bold">
                <span class="font-extrabold text-gray-400">:</span>
                <input type="number" id="tip-a-${m._id}" value="${val(p.awayPred)}" class="inp w-16 text-center font-bold">
                <label class="text-[10px] font-bold text-yellow-700 flex items-center gap-1 bg-yellow-50 px-1 py-1 rounded border border-yellow-200">
                    <input type="checkbox" id="tip-j-${m._id}" ${p.usedJoker ? 'checked' : ''} class="w-4 h-4"> JOKER
                </label>
            </div>
            <div class="md:w-1/3 flex gap-1 justify-end items-center">
                ${p.pointsEarned !== null && p.pointsEarned !== undefined ? `<span class="text-[10px] font-bold ${p.pointsEarned > 0 ? 'text-green-700' : 'text-red-600'}">+${p.pointsEarned} pkt</span>` : ''}
                <button onclick="saveTip('${m._id}','${T.escapeHtml(nickname)}')" class="btn bg-purple-600 hover:bg-purple-800 !py-1.5">Zapisz</button>
                ${p.homePred !== undefined ? `<button onclick="deleteTip('${m._id}','${T.escapeHtml(nickname)}')" class="btn bg-gray-400 hover:bg-gray-600 !py-1.5">✕</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function saveTip(matchId, nickname) {
    const h = document.getElementById(`tip-h-${matchId}`).value;
    const a = document.getElementById(`tip-a-${matchId}`).value;
    if (h === '' || a === '') return T.toast('Podaj pełny typ.', 'err');
    await api('/api/admin/predict', withSeason({
        nickname, matchId,
        homePred: Number(h), awayPred: Number(a),
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

/* ---------------- 5. PUCHAR ---------------- */
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
    if (!A.cupMatches.length) { box.innerHTML = '<p class="text-sm italic text-gray-500">Drabinka pusta.</p>'; return; }
    box.innerHTML = A.cupMatches.map(c => `
        <div class="flex items-center justify-between bg-orange-50 border border-orange-100 p-2 rounded text-sm">
            <span><strong>${T.escapeHtml(c.stage)}</strong> ${c.roundNumber ? `· R${c.roundNumber}` : ''}</span>
            <span class="font-mono font-bold">${T.escapeHtml(c.player1)} ${c.score1 ?? '–'} : ${c.score2 ?? '–'} ${T.escapeHtml(c.player2)}</span>
            <button onclick="deleteCup('${c._id}')" class="btn bg-red-500 hover:bg-red-700 !py-1 !px-2">✕</button>
        </div>`).join('');
}

async function deleteCup(id) { if (confirm('Usunąć parę?')) await api('/api/admin/cup-delete', { id }); }

/* ---------------- 6. SEZONY ---------------- */
function renderSeasonsList() {
    const box = document.getElementById('seasons-list');
    const list = A.seasonDetails || [];
    if (!list.length) { box.innerHTML = '<p class="text-sm italic text-gray-500">Brak sezonów.</p>'; return; }
    box.innerHTML = list.map(s => `
        <div class="flex flex-wrap items-center justify-between gap-2 bg-indigo-50 border border-indigo-100 p-3 rounded">
            <div>
                <strong class="text-indigo-900">${T.escapeHtml(s.label || 'Sezon ' + s.year)}</strong>
                ${s.isActive ? '<span class="ml-1 text-[10px] bg-green-600 text-white px-2 py-0.5 rounded font-bold">AKTYWNY</span>' : ''}
                ${s.isFinished ? '<span class="ml-1 text-[10px] bg-gray-600 text-white px-2 py-0.5 rounded font-bold">ARCHIWUM</span>' : ''}
                <div class="text-[11px] text-gray-500">${s.matches} meczów · ${s.predictions} typów · blokada ${s.lockHours} h · ${s.teams.length} drużyn</div>
            </div>
            <div class="flex gap-1">
                ${s.isActive ? '' : `<button onclick="activateSeason(${s.year})" class="btn bg-green-700 hover:bg-green-900 !py-1 !px-2">Ustaw aktywny</button>`}
                ${s.isFinished ? `<button onclick="reopenSeason(${s.year})" class="btn bg-yellow-600 !py-1 !px-2">Otwórz ponownie</button>` : ''}
                <button onclick="editThisSeason(${s.year})" class="btn bg-indigo-600 hover:bg-indigo-800 !py-1 !px-2">Edytuj ten sezon</button>
            </div>
        </div>`).join('');
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

function copyTeamsFromCurrent() {
    const teams = (A.season.teams && A.season.teams.length)
        ? A.season.teams
        : [...new Set(A.matches.flatMap(m => [m.homeTeam, m.awayTeam]))];
    document.getElementById('ns-teams').value = teams.join('\n');
}

async function saveNewSeason(activate) {
    const year = Number(document.getElementById('ns-year').value);
    const teams = document.getElementById('ns-teams').value.split('\n').map(t => t.trim()).filter(Boolean);
    if (!year) return T.toast('Podaj rok sezonu.', 'err');
    if (activate && !confirm(`Sezon ${year} stanie się domyślnym na stronie głównej. Kontynuować?`)) return;
    const out = await api('/api/admin/season', {
        year,
        label: document.getElementById('ns-label').value,
        lockHours: document.getElementById('ns-lock').value,
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
        <div class="flex gap-1">
            <select id="slot-day-${i}" class="inp">
                ${SLOT_DAYS.map((d, di) => `<option value="${di}" ${di === day ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
            <input type="time" id="slot-time-${i}" value="${time}" class="inp">
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
    const fallback = (A.season.teams || []);
    return {
        season: Number(document.getElementById('gen-season').value) || editSeason,
        teams: teams.length ? teams : fallback,
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
    const raw = document.getElementById('schedule-json').value;
    let schedule;
    try { schedule = JSON.parse(raw); } catch (e) { return T.toast('Niepoprawny JSON.', 'err'); }
    await api('/api/admin/load-schedule', withSeason({ schedule }));
}

async function finishSeason() {
    if (!confirm('Rozliczyć typy długoterminowe według wskazanych wyników?')) return;
    await api('/api/admin/season/finish', withSeason({
        champion: document.getElementById('fin-gold').value,
        bronze: document.getElementById('fin-bronze').value,
        relegation: document.getElementById('fin-releg').value,
        markFinished: document.getElementById('fin-mark').checked
    }));
}

/* ---------------- 7. SYSTEM ---------------- */
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
