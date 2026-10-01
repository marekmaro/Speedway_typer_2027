/* Panel gracza. Jedyna kopia tego pliku (w v1 były dwie, z różnymi blokadami!). */

const token = new URLSearchParams(location.search).get('id');
let D = null;
let viewSeason = null;   // null = sezon aktywny
let selectedRound = null;
let saveTimer = null;
let dirty = false;
let saving = false;

document.addEventListener('DOMContentLoaded', async () => {
    if (!token) {
        document.body.innerHTML = '<div class="p-10 text-center font-bold text-red-600">Brak klucza dostępu. Użyj linku od administratora.</div>';
        return;
    }
    await load();
    setInterval(tick, 1000);
    // Bezpiecznik: gdy gracz zamyka stronę z niezapisanymi typami
    window.addEventListener('beforeunload', e => {
        if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
});

function playerDataUrl() {
    return `/api/public/player-data?token=${encodeURIComponent(token)}` + (viewSeason ? `&season=${viewSeason}` : '');
}

window.changeSeason = async function (year) {
    await flushSave();
    viewSeason = Number(year);
    selectedRound = null;
    await load();
};

async function load() {
    try {
        D = await T.getJson(playerDataUrl());
        renderHeader();
        renderLongTerm();
        renderRoundNav();
        renderMatches();
        renderMyForm();
        renderMissing();
        tick();
    } catch (e) {
        document.body.innerHTML = `<div class="p-10 text-center font-bold text-red-600">Błąd ładowania: ${T.escapeHtml(e.message)}</div>`;
    }
}

/* ---------------- nagłówek ---------------- */
function renderHeader() {
    const r = D.ranking;
    document.getElementById('p-nick').textContent = D.player.nickname;
    document.getElementById('p-rank').textContent = `${r.position}/${r.totalPlayers}`;
    document.getElementById('p-pts').textContent = r.points;
    document.getElementById('p-snipers').textContent = r.snipers;
    document.getElementById('p-avg').textContent = r.avgPerMatch;
    const seasonBox = document.getElementById('p-season');
    const list = D.playerSeasons || [];
    if (list.length > 1) {
        seasonBox.innerHTML = `<select onchange="changeSeason(this.value)" class="bg-blue-950/60 border border-blue-500/40 rounded px-1 py-0.5 text-[10px] font-bold text-blue-100">
            ${list.map(s => `<option value="${s.year}" ${s.year === D.season.year ? 'selected' : ''}>${T.escapeHtml(s.label)}${s.isFinished ? ' (archiwum)' : ''}</option>`).join('')}
        </select>`;
    } else {
        seasonBox.textContent = D.season.label || `Sezon ${D.season.year}`;
    }

    const chase = document.getElementById('p-chasing');
    if (r.chasing) chase.textContent = `🔥 Gonisz: ${r.chasing.nickname} (-${r.chasing.gap} pkt)`;
    else if (r.totalPlayers > 1) chase.textContent = r.chased ? `🏆 Jesteś liderem! (+${r.chased.gap} pkt przewagi)` : '🏆 Jesteś liderem!';
    else chase.textContent = '';
}

function nextOpenMatch() {
    const now = Date.now();
    return (D.matches || [])
        .filter(m => !m.isPostponed && T.lockTime(m, D.season.lockHours) > now)
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0] || null;
}

function tick() {
    if (!D) return;
    const el = document.getElementById('countdown');
    const info = document.getElementById('countdown-match');
    const m = nextOpenMatch();
    if (!m) { el.textContent = '—'; info.textContent = 'Wszystko zablokowane'; return; }
    el.textContent = T.countdown(T.lockTime(m, D.season.lockHours)) || '—';
    info.textContent = `${T.shortName(m.homeTeam)} – ${T.shortName(m.awayTeam)}`;
}

/* ---------------- typy sezonowe ---------------- */
function renderLongTerm() {
    const teams = (D.season.teams && D.season.teams.length)
        ? D.season.teams
        : [...new Set(D.matches.flatMap(m => [m.homeTeam, m.awayTeam]))].sort((a, b) => a.localeCompare(b, 'pl'));

    const opts = '<option value="">— wybierz drużynę —</option>' +
        teams.map(t => `<option value="${T.escapeHtml(t)}">${T.escapeHtml(t)}</option>`).join('');

    const locked = !D.longTermOpen;
    ['champion', 'bronze', 'relegation'].forEach(id => {
        const s = document.getElementById(`lt-${id}`);
        s.innerHTML = opts;
        if (D.longTerm && D.longTerm[id]) s.value = D.longTerm[id];
        s.disabled = locked;
        s.classList.toggle('bg-gray-200', locked);
        s.classList.toggle('cursor-not-allowed', locked);
        s.onchange = locked ? null : () => { markDirty(); scheduleSave(); };
    });

    const status = document.getElementById('lt-status');
    const info = document.getElementById('lt-info');
    if (locked) {
        status.textContent = 'ZABLOKOWANE';
        status.className = 'text-[10px] bg-red-100 text-red-800 border border-red-300 px-2 py-0.5 rounded-full font-bold';
        info.textContent = '🔒 Typy sezonowe zamknęły się przed pierwszym meczem sezonu.';
    } else {
        status.textContent = 'OTWARTE';
        status.className = 'text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold';
        info.textContent = D.longTermLockAt
            ? `⚠️ Można zmieniać do ${T.fmtDateTime(D.longTermLockAt)}. Za każde trafienie +${D.season.scoring.longTermEach} pkt.`
            : '⚠️ Wytypuj przed startem sezonu.';
    }
}

/* ---------------- kolejki ---------------- */
function rounds() { return [...new Set(D.matches.map(m => m.round))].sort((a, b) => a - b); }

function activeRound() {
    const now = Date.now();
    const open = D.matches.filter(m => !m.isPostponed && T.lockTime(m, D.season.lockHours) > now)
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
    if (open) return open.round;
    const pending = D.matches.filter(m => m.homeScore === null)
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
    if (pending) return pending.round;
    const all = rounds();
    return all.length ? all[all.length - 1] : 1;
}

window.changeRound = async function (r) {
    await flushSave();
    selectedRound = r;
    renderRoundNav();
    renderMatches();
};

function renderRoundNav() {
    const all = rounds();
    const nav = document.getElementById('round-nav');
    if (!all.length) { nav.innerHTML = '<p class="text-sm text-gray-500 italic">Terminarz nie jest jeszcze wgrany.</p>'; return; }
    const current = selectedRound || activeRound();
    const i = all.indexOf(current);
    const prev = i > 0 ? all[i - 1] : null;
    const next = i >= 0 && i < all.length - 1 ? all[i + 1] : null;

    nav.innerHTML = `
        <button onclick="changeRound(${prev})" class="px-3 py-2 bg-white rounded-lg shadow-sm border font-bold text-blue-600 ${prev ? 'hover:bg-blue-50' : 'opacity-30'}" ${prev ? '' : 'disabled'}>&laquo;</button>
        <select onchange="changeRound(Number(this.value))" class="flex-1 text-center font-black text-blue-900 uppercase tracking-wide text-xs bg-white border rounded-lg py-2 px-1 shadow-sm">
            ${all.map(r => `<option value="${r}" ${r === current ? 'selected' : ''}>${T.escapeHtml(T.roundName(r, D.season.stageNames))}</option>`).join('')}
        </select>
        <button onclick="changeRound(${next})" class="px-3 py-2 bg-white rounded-lg shadow-sm border font-bold text-blue-600 ${next ? 'hover:bg-blue-50' : 'opacity-30'}" ${next ? '' : 'disabled'}>&raquo;</button>`;
}

function myPred(matchId) {
    return D.predictions.find(p => p.matchId === matchId) || {};
}

function jokerInfo() {
    const now = Date.now();
    const jokerPred = D.predictions.find(p => p.usedJoker);
    if (!jokerPred) return { used: false, frozen: false, matchId: null };
    const m = D.matches.find(x => x._id === jokerPred.matchId);
    return {
        used: true,
        matchId: jokerPred.matchId,
        frozen: m ? T.isLocked(m, D.season.lockHours, now) : true,
        match: m
    };
}

function renderMatches() {
    const box = document.getElementById('prediction-form');
    const current = selectedRound || activeRound();
    const matches = D.matches.filter(m => m.round === current)
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    const jk = jokerInfo();
    const now = Date.now();

    if (!matches.length) { box.innerHTML = '<p class="text-sm text-gray-500 italic text-center py-6">Brak meczów w tej kolejce.</p>'; return; }

    box.innerHTML = matches.map(match => {
        const locked = T.isLocked(match, D.season.lockHours, now);
        const p = myPred(match._id);
        const hasPred = p.homePred !== undefined && p.homePred !== null;
        const settled = match.homeScore !== null;

        let jokerHtml = '';
        if (locked) {
            jokerHtml = p.usedJoker ? '<div class="mt-3 text-center text-xs font-bold text-yellow-600 border-t pt-2">⭐ JOKER AKTYWNY</div>' : '';
        } else if (jk.used && jk.frozen && jk.matchId !== match._id) {
            jokerHtml = '<div class="text-[10px] font-bold text-gray-400 mt-3 text-center border-t pt-2">Joker jest już wykorzystany w tym sezonie.</div>';
        } else {
            jokerHtml = `
            <div class="mt-3 pt-2 border-t border-gray-100 flex justify-center items-center gap-2">
                <input type="checkbox" id="joker-${match._id}" class="joker-checkbox w-5 h-5 accent-yellow-500" data-match="${match._id}" ${p.usedJoker ? 'checked' : ''} onchange="onJokerChange('${match._id}')">
                <label for="joker-${match._id}" class="text-xs font-bold text-yellow-600 cursor-pointer">UŻYWAM JOKERA (x${D.season.scoring.jokerMultiplier})</label>
            </div>`;
        }

        const pointsBadge = settled && p.pointsEarned !== null && p.pointsEarned !== undefined
            ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded ${p.pointsEarned > 0 ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-600'}">+${p.pointsEarned} pkt</span>`
            : '';

        const lockLabel = locked
            ? (settled ? `<span class="text-blue-700 font-bold">WYNIK ${match.homeScore}:${match.awayScore}</span>` : '<span class="text-red-500 font-bold">🔒 ZABLOKOWANE</span>')
            : `<span class="text-green-600 font-bold">otwarte · ${T.countdown(T.lockTime(match, D.season.lockHours)) || ''}</span>`;

        const input = (cls, val, place) => `<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2"
            class="${cls} pred-input w-14 p-2 border-2 ${hasPred ? 'border-blue-300' : 'border-gray-200'} rounded text-center font-extrabold bg-white focus:border-blue-500 outline-none shrink-0"
            value="${val ?? ''}" placeholder="${place}" ${locked ? 'disabled' : ''}
            oninput="sanitize(this)">`;

        return `
        <div class="bg-white p-3 rounded-xl shadow-sm border-l-4 ${locked ? 'border-gray-300' : (hasPred ? 'border-green-500' : 'border-blue-500')} match-card" data-id="${match._id}">
            <div class="flex justify-between items-center text-[10px] text-gray-500 mb-3 border-b pb-1 font-bold uppercase tracking-wider gap-1">
                <span>${T.fmtDay(match.matchDate)} ${new Date(match.matchDate).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>
                <span class="flex items-center gap-1">${match.isMatchOfTheRound ? '<span class="gold-helmet">ZŁOTY KASK</span>' : ''}${pointsBadge}</span>
            </div>
            <div class="flex items-center gap-2">
                <div class="flex justify-between items-center flex-1 bg-gray-50 p-2 rounded gap-2 min-w-0">
                    <span class="font-bold text-sm text-gray-800 truncate">${T.escapeHtml(T.shortName(match.homeTeam))}</span>
                    ${input('home-pred', p.homePred, 'G')}
                </div>
                <span class="font-extrabold text-gray-300">:</span>
                <div class="flex justify-between items-center flex-1 bg-gray-50 p-2 rounded gap-2 min-w-0 flex-row-reverse">
                    <span class="font-bold text-sm text-gray-800 truncate text-right">${T.escapeHtml(T.shortName(match.awayTeam))}</span>
                    ${input('away-pred', p.awayPred, 'G')}
                </div>
            </div>
            ${match.isPostponed ? '<p class="text-[10px] text-center text-red-500 font-bold uppercase mt-2">Mecz przełożony — czekaj na nową datę</p>' : ''}
            ${jokerHtml}
            <p class="text-[10px] text-center mt-2">${lockLabel}</p>
        </div>`;
    }).join('');
}

window.sanitize = function (input) {
    let v = input.value.replace(/[^0-9]/g, '');
    if (v !== '' && Number(v) > 75) v = '75';
    input.value = v;
    markDirty();
    scheduleSave();
};

window.onJokerChange = function (matchId) {
    document.querySelectorAll('.joker-checkbox').forEach(cb => {
        if (cb.dataset.match !== matchId) cb.checked = false;
    });
    markDirty();
    scheduleSave(300);
};

/* ---------------- zapis ---------------- */
function setState(text, cls = 'text-gray-400') {
    const el = document.getElementById('save-state');
    el.className = `text-[10px] font-bold uppercase w-28 shrink-0 ${cls}`;
    el.textContent = text;
}

function markDirty() { dirty = true; setState('Niezapisane…', 'text-orange-500'); }

function scheduleSave(delay = 1200) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { save(); }, delay);
}

async function flushSave() {
    clearTimeout(saveTimer);
    if (dirty) await save();
}

function buildPayload() {
    const payload = { token, season: D.season.year, predictions: [] };
    if (D.longTermOpen) {
        payload.longTerm = {
            champion: document.getElementById('lt-champion').value,
            bronze: document.getElementById('lt-bronze').value,
            relegation: document.getElementById('lt-relegation').value
        };
    }
    document.querySelectorAll('.match-card').forEach(card => {
        const h = card.querySelector('.home-pred');
        const a = card.querySelector('.away-pred');
        const j = card.querySelector('.joker-checkbox');
        if (!h || !a || h.disabled) return;
        if (h.value === '' || a.value === '') return;
        payload.predictions.push({
            matchId: card.dataset.id,
            homePred: parseInt(h.value, 10),
            awayPred: parseInt(a.value, 10),
            usedJoker: j ? j.checked : false
        });
    });
    return payload;
}

async function save(showModal = false) {
    if (saving) { scheduleSave(800); return null; }
    saving = true;
    setState('Zapisuję…', 'text-blue-500');
    try {
        const out = await T.postJson('/api/public/submit-all', buildPayload());
        dirty = false;
        setState('✅ Zapisane', 'text-green-600');
        (out.warnings || []).forEach(w => T.toast(w, 'err'));
        // Odświeżamy dane, aby zobaczyć stan po stronie serwera (np. przeniesiony joker)
        const keepRound = selectedRound || activeRound();
        D = await T.getJson(playerDataUrl());
        selectedRound = keepRound;
        renderHeader(); renderRoundNav(); renderMatches(); renderMyForm(); renderMissing();
        if (showModal) {
            document.getElementById('success-detail').textContent =
                `Zapisano ${out.saved} ${out.saved === 1 ? 'typ' : 'typów'}${out.skipped ? `, pominięto ${out.skipped} (blokada)` : ''}.`;
            const modal = document.getElementById('success-modal');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        } else {
            T.toast('Typy zapisane automatycznie');
        }
        return out;
    } catch (e) {
        setState('❌ Błąd zapisu', 'text-red-600');
        T.toast(`Nie zapisano: ${e.message}`, 'err');
        return null;
    } finally {
        saving = false;
    }
}

window.saveAll = async function () {
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.textContent = 'ZAPISYWANIE…';
    clearTimeout(saveTimer);
    await save(true);
    btn.disabled = false;
    btn.textContent = 'Zapisz moje typy';
};

window.closeModal = function () {
    const modal = document.getElementById('success-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

/* ---------------- podsumowania ---------------- */
function renderMissing() {
    const box = document.getElementById('missing-box');
    const now = Date.now();
    const open = D.matches.filter(m => !m.isPostponed && !T.isLocked(m, D.season.lockHours, now));
    const missing = open.filter(m => {
        const p = myPred(m._id);
        return p.homePred === undefined || p.homePred === null;
    });
    if (!missing.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const byRound = {};
    missing.forEach(m => { byRound[m.round] = (byRound[m.round] || 0) + 1; });
    const list = Object.entries(byRound)
        .map(([r, n]) => `${T.roundName(Number(r), D.season.stageNames)}: ${n}`).join(' · ');
    box.innerHTML = `⚠️ Masz jeszcze ${missing.length} niewytypowanych meczów — ${T.escapeHtml(list)}`;
}

function renderMyForm() {
    const box = document.getElementById('my-form');
    const r = D.ranking;
    const form = (r.form || []).map(f =>
        `<span class="inline-block bg-blue-50 border border-blue-100 rounded px-2 py-1 mr-1 mb-1">R${f.round}: <strong>${f.points} pkt</strong></span>`).join('');
    box.innerHTML = `
        <p class="mb-2">${form || 'Brak rozliczonych kolejek.'}</p>
        <div class="grid grid-cols-2 gap-2 mt-3">
            <div class="bg-gray-50 p-2 rounded"><div class="text-[10px] uppercase text-gray-400 font-bold">Najlepsza kolejka</div>
                <div class="font-bold text-gray-800">${r.bestRound && r.bestRound.round ? `R${r.bestRound.round} — ${r.bestRound.points} pkt` : '—'}</div></div>
            <div class="bg-gray-50 p-2 rounded"><div class="text-[10px] uppercase text-gray-400 font-bold">Skuteczność</div>
                <div class="font-bold text-gray-800">${r.hitRate}%</div></div>
            <div class="bg-gray-50 p-2 rounded"><div class="text-[10px] uppercase text-gray-400 font-bold">Lider</div>
                <div class="font-bold text-gray-800">${r.leader ? `${T.escapeHtml(r.leader.nickname)} (${r.leader.points})` : '—'}</div></div>
            <div class="bg-gray-50 p-2 rounded"><div class="text-[10px] uppercase text-gray-400 font-bold">Joker</div>
                <div class="font-bold text-gray-800">${jokerStateText()}</div></div>
        </div>`;
}

function jokerStateText() {
    const jk = jokerInfo();
    if (!jk.used) return 'wolny';
    if (!jk.match) return 'ustawiony';
    const name = `${T.shortName(jk.match.homeTeam)}–${T.shortName(jk.match.awayTeam)}`;
    return jk.frozen ? `zużyty (${T.escapeHtml(name)})` : `na ${T.escapeHtml(name)}`;
}
