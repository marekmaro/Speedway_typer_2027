/* Panel gracza (magiczny link). Typy zapisują się same; serwer pilnuje blokad i jokera. */

const token = new URLSearchParams(location.search).get('id');
let D = null;
let viewSeason = null;   // null = sezon aktywny
let selectedRound = null;
let saveTimer = null;
let dirty = false;
let saving = false;
let deferredInstall = null;
let lockRefreshing = false;
const esc = T.escapeHtml;

document.addEventListener('DOMContentLoaded', async () => {
    if (!token) {
        document.querySelector('main').innerHTML = '<div class="card card-pad text-center font-bold text-bad">Brak klucza dostępu. Użyj linku od administratora.</div>';
        return;
    }
    T.registerSW();
    await load();
    if (D) {
        T.rememberToken(token);
        setupPush();
        setupInstall();
    }
    setInterval(tick, 1000);
    setInterval(() => { if (!document.hidden && !dirty && !saving) refresh(); }, 120000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !dirty && !saving) refresh(); });
    // Bezpiecznik: gracz zamyka stronę z niezapisanymi typami
    window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
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
        renderAll();
    } catch (e) {
        D = null;
        document.querySelector('main').innerHTML = `<div class="card card-pad text-center font-bold text-bad">${esc(e.message)}</div>`;
    }
}

async function refresh() {
    try {
        const keepRound = selectedRound || activeRound();
        D = await T.getJson(playerDataUrl());
        selectedRound = keepRound;
        renderAll();
    } catch (e) { /* cicho - spróbujemy później */ }
}

function renderAll() {
    renderHeader();
    renderLongTerm();
    renderRoundNav();
    renderMatches();
    renderMyForm();
    renderMissing();
    tick();
}

/* ---------------- nagłówek ---------------- */
function renderHeader() {
    const r = D.ranking;
    document.getElementById('p-nick').textContent = D.player.nickname;
    document.getElementById('p-rank').textContent = `${r.position}/${r.totalPlayers}`;
    document.getElementById('p-pts').textContent = r.points;
    document.getElementById('p-snipers').textContent = r.snipers;
    document.getElementById('p-avg').textContent = r.avgPerMatch;
    document.getElementById('profile-link').href = `/gracz.html?nick=${encodeURIComponent(D.player.nickname)}&season=${D.season.year}`;

    const seasonBox = document.getElementById('p-season');
    const list = D.playerSeasons || [];
    if (list.length > 1) {
        seasonBox.innerHTML = `<label class="sr-only" for="season-sel">Sezon</label><select id="season-sel" onchange="changeSeason(this.value)" class="bg-white/10 rounded-md px-1.5 py-0.5 text-xs font-bold text-white border-0">
            ${list.map(s => `<option value="${s.year}" ${s.year === D.season.year ? 'selected' : ''}>${esc(s.label)}${s.isFinished ? ' (archiwum)' : ''}</option>`).join('')}
        </select>`;
    } else {
        seasonBox.textContent = D.season.label || `Sezon ${D.season.year}`;
    }

    const chase = document.getElementById('p-chasing');
    if (r.chasing && r.chasing.gap === 0) chase.textContent = `🤝 Ex aequo z: ${r.chasing.nickname}`;
    else if (r.chasing) chase.textContent = `🔥 Gonisz: ${r.chasing.nickname} (−${r.chasing.gap} pkt)`;
    else if (r.totalPlayers > 1 && r.points > 0) chase.textContent = r.chased ? `🏆 Prowadzisz (+${r.chased.gap} pkt przewagi)` : '🏆 Prowadzisz!';
    else chase.textContent = '';

    const blocked = document.getElementById('blocked-box');
    const off = D.player.isActive === false;
    blocked.classList.toggle('hidden', !off && !D.season.isFinished);
    blocked.textContent = off ? 'Twoje konto jest wstrzymane — typy nie będą zapisywane. Odezwij się do admina.'
        : D.season.isFinished ? 'Ten sezon jest zakończony — to archiwum.' : '';
}

function nextOpenMatch() {
    const now = Date.now();
    return (D.matches || [])
        .filter(m => !m.isPostponed && !m.voidPredictions && !T.isLocked(m, D.season.lockMinutes, now))
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0] || null;
}

function tick() {
    if (!D) return;
    const el = document.getElementById('countdown');
    const info = document.getElementById('countdown-match');
    const m = nextOpenMatch();
    if (!m) { el.textContent = '—'; info.textContent = 'Brak otwartych meczów'; }
    else {
        el.textContent = T.countdown(T.lockTime(m, D.season.lockMinutes)) || '—';
        info.textContent = `${T.shortName(m.homeTeam)} – ${T.shortName(m.awayTeam)}`;
    }
    // Odliczanie na kartach + automatyczne zamknięcie karty, gdy minie blokada
    const now = Date.now();
    document.querySelectorAll('.match-card').forEach(card => {
        const match = D.matches.find(x => x._id === card.dataset.id);
        if (!match) return;
        const label = card.querySelector('.lock-label');
        const st = T.matchStatus(match, D.season.lockMinutes, now);
        if (label && label.textContent !== st.text) { label.textContent = st.text; label.className = `lock-label ${st.cls}`; }
        const input = card.querySelector('.home-pred');
        if (input && !input.disabled && T.isLocked(match, D.season.lockMinutes, now) && !lockRefreshing) {
            lockRefreshing = true;
            flushSave().then(refresh).finally(() => { lockRefreshing = false; });
        }
    });
}

/* ---------------- typy sezonowe ---------------- */
function renderLongTerm() {
    const teams = (D.season.teams && D.season.teams.length)
        ? D.season.teams
        : [...new Set(D.matches.flatMap(m => [m.homeTeam, m.awayTeam]))].sort((a, b) => a.localeCompare(b, 'pl'));

    const opts = '<option value="">— wybierz drużynę —</option>' +
        teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');

    const locked = !D.longTermOpen;
    const card = document.getElementById('lt-card');
    ['champion', 'bronze', 'relegation'].forEach(id => {
        const s = document.getElementById(`lt-${id}`);
        s.innerHTML = opts;
        if (D.longTerm && D.longTerm[id]) s.value = D.longTerm[id];
        s.disabled = locked;
        s.onchange = locked ? null : () => { markDirty(); scheduleSave(); };
    });
    const missing = !locked && !(D.longTerm && D.longTerm.champion && D.longTerm.bronze && D.longTerm.relegation);
    if (missing) card.open = true;

    const status = document.getElementById('lt-status');
    const info = document.getElementById('lt-info');
    if (locked) {
        status.textContent = 'zamknięte';
        status.className = 'chip-muted';
        info.textContent = 'Typy sezonowe zamknęły się przed pierwszym meczem sezonu.';
    } else {
        status.textContent = missing ? 'do uzupełnienia' : 'otwarte';
        status.className = missing ? 'chip-warn' : 'chip-ok';
        info.textContent = D.longTermLockAt
            ? `Możesz zmieniać do ${T.fmtDateTime(D.longTermLockAt)}. Za każde trafienie +${D.season.scoring.longTermEach} pkt.`
            : 'Wytypuj przed startem sezonu.';
    }
}

/* ---------------- kolejki ---------------- */
function rounds() { return [...new Set(D.matches.map(m => m.round))].sort((a, b) => a - b); }

function activeRound() {
    const now = Date.now();
    const open = D.matches.filter(m => !m.isPostponed && !m.voidPredictions && !T.isLocked(m, D.season.lockMinutes, now))
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
    if (open) return open.round;
    const pending = D.matches.filter(m => !T.hasResult(m))
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
    if (!all.length) { nav.innerHTML = '<p class="text-sm text-muted">Terminarz nie jest jeszcze wgrany.</p>'; return; }
    const current = selectedRound || activeRound();
    const now = Date.now();
    nav.innerHTML = all.map(r => {
        const name = T.roundName(r, D.season.stageNames);
        const short = /^Runda \d+$/.test(name) ? `R${r}` : name;
        // kropka = w tej kolejce brakuje Twojego typu na otwarty mecz
        const gap = D.matches.some(m => m.round === r && !m.isPostponed && !m.voidPredictions
            && !T.isLocked(m, D.season.lockMinutes, now) && !hasPred(myPred(m._id)));
        return `<button role="tab" class="round-chip gap-1.5" aria-current="${r === current}" onclick="changeRound(${r})" title="${esc(name)}">
            ${esc(short)}${gap ? '<span class="w-2 h-2 rounded-full bg-warn" aria-label="brak typów"></span>' : ''}</button>`;
    }).join('');
    const active = nav.querySelector('[aria-current="true"]');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
    document.getElementById('round-title').textContent = T.roundName(current, D.season.stageNames);
}

function myPred(matchId) { return D.predictions.find(p => p.matchId === matchId) || {}; }
function hasPred(p) { return p.homePred !== undefined && p.homePred !== null; }

function jokerInfo() {
    const now = Date.now();
    const jokerPred = D.predictions.find(p => p.usedJoker && !(D.matches.find(x => x._id === p.matchId) || {}).voidPredictions);
    if (!jokerPred) return { used: false, frozen: false, matchId: null };
    const m = D.matches.find(x => x._id === jokerPred.matchId);
    return { used: true, matchId: jokerPred.matchId, frozen: m ? T.isLocked(m, D.season.lockMinutes, now) : true, match: m };
}

function renderMatches() {
    const box = document.getElementById('prediction-form');
    const current = selectedRound || activeRound();
    const matches = D.matches.filter(m => m.round === current)
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    const jk = jokerInfo();
    const now = Date.now();
    const readOnly = D.player.isActive === false || D.season.isFinished;

    if (!matches.length) { box.innerHTML = '<p class="text-sm text-muted text-center py-6">Brak meczów w tej kolejce.</p>'; return; }

    box.innerHTML = matches.map(match => {
        const locked = readOnly || match.voidPredictions || T.isLocked(match, D.season.lockMinutes, now);
        const p = myPred(match._id);
        const filled = hasPred(p);
        const st = T.matchStatus(match, D.season.lockMinutes, now);

        let jokerHtml = '';
        if (locked) {
            jokerHtml = p.usedJoker ? '<p class="mt-3 text-center chip-gold mx-auto w-fit">⭐ Joker na tym meczu</p>' : '';
        } else if (jk.used && jk.frozen && jk.matchId !== match._id) {
            jokerHtml = '';
        } else {
            jokerHtml = `
            <label class="mt-3 flex items-center justify-center gap-2 rounded-xl border border-dashed border-gold/50 py-2 text-sm font-bold text-gold cursor-pointer has-[:checked]:bg-gold/10 has-[:checked]:border-solid">
                <input type="checkbox" class="joker-checkbox w-5 h-5 accent-[rgb(var(--gold))]" data-match="${match._id}" ${p.usedJoker ? 'checked' : ''} onchange="onJokerChange('${match._id}')">
                ⭐ Joker x${D.season.scoring.jokerMultiplier}${jk.used && jk.matchId !== match._id ? ' <span class="font-semibold text-muted">(przeniesie z innego meczu)</span>' : ''}
            </label>`;
        }

        const result = T.hasResult(match)
            ? `<div class="mt-3 flex items-center justify-center gap-2 text-sm">
                 <span class="text-muted">Wynik</span><strong class="tabular-nums">${match.homeScore}:${match.awayScore}</strong>
                 ${p.pointsEarned !== null && p.pointsEarned !== undefined ? `<span class="chip ${p.pointsEarned > 0 ? 'chip-ok' : 'chip-muted'}">+${p.pointsEarned} pkt</span>` : ''}
               </div>` : '';

        const input = (cls, val, label) => `<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off"
            aria-label="${label}" class="${cls} score-input ${filled ? 'filled' : ''}"
            value="${val ?? ''}" placeholder="–" ${locked ? 'disabled' : ''} oninput="sanitize(this)" onfocus="this.select()">`;

        return `
        <article class="card card-pad match-card ${match.isMatchOfTheRound ? 'ring-2 ring-gold/60' : ''}" data-id="${match._id}">
            <div class="flex items-center justify-between gap-2 mb-3">
                <span class="text-xs font-bold text-muted">${T.fmtDay(match.matchDate)} · ${T.fmtTime(match.matchDate)}</span>
                <span class="flex items-center gap-1.5">
                    ${match.isMatchOfTheRound ? '<span class="chip-gold">⭐ Kask</span>' : ''}
                    <span class="lock-label ${st.cls}">${esc(st.text)}</span>
                </span>
            </div>
            <div class="grid grid-cols-[1fr_auto_auto_auto_1fr] items-center gap-2">
                <div class="flex flex-col items-center gap-1 min-w-0">${T.logoHtml(match.homeTeam, 'team-logo-lg')}<span class="text-xs font-bold text-center leading-tight">${esc(T.shortName(match.homeTeam))}</span></div>
                ${input('home-pred', p.homePred, `Gospodarze: ${esc(match.homeTeam)}`)}
                <span class="text-2xl font-black text-faint">:</span>
                ${input('away-pred', p.awayPred, `Goście: ${esc(match.awayTeam)}`)}
                <div class="flex flex-col items-center gap-1 min-w-0">${T.logoHtml(match.awayTeam, 'team-logo-lg')}<span class="text-xs font-bold text-center leading-tight">${esc(T.shortName(match.awayTeam))}</span></div>
            </div>
            ${!locked ? '<p class="sum-hint mt-2 text-center text-xs text-muted"></p>' : ''}
            ${match.originalDate ? `<p class="mt-2 text-center text-xs text-muted">Przełożony z ${T.fmtDateTime(match.originalDate)}${match.predictionsFrozen ? ' — typy zamrożone, bo były już jawne' : ''}</p>` : ''}
            ${match.note ? `<p class="mt-1 text-center text-xs text-muted italic">${esc(match.note)}</p>` : ''}
            ${result}
            ${jokerHtml}
        </article>`;
    }).join('');
    box.querySelectorAll('.match-card').forEach(updateSumHint);
}

/** Podpowiedź: pełny mecz to 90 pkt (15 biegów x 6). */
function updateSumHint(card) {
    const hint = card.querySelector('.sum-hint');
    if (!hint) return;
    const h = card.querySelector('.home-pred').value, a = card.querySelector('.away-pred').value;
    if (h === '' || a === '') { hint.textContent = 'Pełny mecz: suma 90 pkt (np. 46:44, 50:40)'; hint.className = 'sum-hint mt-2 text-center text-xs text-muted'; return; }
    const sum = Number(h) + Number(a);
    hint.textContent = sum === 90 ? 'Suma 90 ✓' : `Suma ${sum} (pełny mecz to 90)`;
    hint.className = `sum-hint mt-2 text-center text-xs ${sum === 90 ? 'text-ok' : sum > 90 ? 'text-bad font-bold' : 'text-muted'}`;
}

window.sanitize = function (input) {
    let v = input.value.replace(/[^0-9]/g, '');
    if (v !== '' && Number(v) > 75) v = '75';
    input.value = v;
    const card = input.closest('.match-card');
    updateSumHint(card);
    // Po dwóch cyfrach przeskok do kolejnego pola - typowanie kolejki bez dotykania ekranu między polami
    if (v.length === 2) {
        const all = [...document.querySelectorAll('.score-input:not([disabled])')];
        const next = all[all.indexOf(input) + 1];
        if (next) next.focus();
    }
    markDirty();
    scheduleSave();
};

window.onJokerChange = function (matchId) {
    document.querySelectorAll('.joker-checkbox').forEach(cb => { if (cb.dataset.match !== matchId) cb.checked = false; });
    markDirty();
    scheduleSave(300);
};

/* ---------------- zapis ---------------- */
function setState(text, cls = 'text-muted') {
    const el = document.getElementById('save-state');
    el.className = `text-xs font-bold w-28 shrink-0 ${cls}`;
    el.textContent = text;
}

function markDirty() { dirty = true; setState('Niezapisane…', 'text-warn'); }

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

async function save(manual = false) {
    if (saving) { scheduleSave(800); return null; }
    saving = true;
    setState('Zapisuję…', 'text-brand');
    try {
        const out = await T.postJson('/api/public/submit-all', buildPayload());
        dirty = false;
        setState('✓ Zapisane', 'text-ok');
        (out.warnings || []).forEach(w => T.toast(w, 'err'));
        // Odświeżamy dane, aby zobaczyć stan po stronie serwera (np. przeniesiony joker)
        const keepRound = selectedRound || activeRound();
        const focusedId = document.activeElement && document.activeElement.closest && document.activeElement.closest('.match-card');
        const focusSide = document.activeElement && document.activeElement.classList.contains('away-pred') ? 'away' : 'home';
        D = await T.getJson(playerDataUrl());
        selectedRound = keepRound;
        renderHeader(); renderRoundNav(); renderMatches(); renderMyForm(); renderMissing();
        if (focusedId) {
            const el = document.querySelector(`.match-card[data-id="${focusedId.dataset.id}"] .${focusSide}-pred`);
            if (el && !el.disabled) el.focus({ preventScroll: true });
        }
        if (manual) T.toast(`Zapisano ${out.saved} ${out.saved === 1 ? 'typ' : 'typów'}${out.skipped ? `, pominięto ${out.skipped} (blokada)` : ''}`);
        return out;
    } catch (e) {
        setState('✕ Błąd zapisu', 'text-bad');
        T.toast(`Nie zapisano: ${e.message}`, 'err');
        return null;
    } finally {
        saving = false;
    }
}

window.saveAll = async function () {
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.textContent = 'Zapisuję…';
    clearTimeout(saveTimer);
    await save(true);
    btn.disabled = false;
    btn.textContent = 'Zapisz typy';
};

/* ---------------- podsumowania ---------------- */
function renderMissing() {
    const box = document.getElementById('missing-box');
    const now = Date.now();
    const missing = D.matches.filter(m => !m.isPostponed && !m.voidPredictions && !T.isLocked(m, D.season.lockMinutes, now) && !hasPred(myPred(m._id)));
    if (!missing.length || D.player.isActive === false) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const soonest = missing.sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
    box.innerHTML = `⚠️ Brakuje Ci ${missing.length} ${missing.length === 1 ? 'typu' : 'typów'}. Najbliższy: ${esc(T.shortName(soonest.homeTeam))} – ${esc(T.shortName(soonest.awayTeam))}
        <button class="underline ml-1" onclick="changeRound(${soonest.round})">pokaż</button>`;
}

function renderMyForm() {
    const box = document.getElementById('my-form');
    const r = D.ranking;
    const max = Math.max(1, ...(r.form || []).map(f => f.points));
    const bars = (r.form || []).map(f => `
        <div class="flex flex-col items-center gap-1 flex-1">
            <span class="text-xs font-bold tabular-nums">${f.points}</span>
            <div class="w-full max-w-[28px] rounded-t bg-brand" style="height:${Math.max(4, (f.points / max) * 56)}px"></div>
            <span class="text-[11px] text-muted">R${f.round}</span>
        </div>`).join('');
    box.innerHTML = `
        ${bars ? `<div class="flex items-end gap-2 h-24 border-b border-line pb-0 mb-3" role="img" aria-label="Punkty w ostatnich kolejkach">${bars}</div>` : '<p class="text-muted mb-3">Brak rozliczonych kolejek.</p>'}
        <dl class="grid grid-cols-2 gap-2">
            <div class="rounded-xl bg-raised p-2.5"><dt class="eyebrow">Najlepsza kolejka</dt><dd class="font-bold">${r.bestRound && r.bestRound.round ? `R${r.bestRound.round} — ${r.bestRound.points} pkt` : '—'}</dd></div>
            <div class="rounded-xl bg-raised p-2.5"><dt class="eyebrow">Skuteczność</dt><dd class="font-bold">${r.hitRate}%</dd></div>
            <div class="rounded-xl bg-raised p-2.5"><dt class="eyebrow">Lider</dt><dd class="font-bold truncate">${r.leader ? `${esc(r.leader.nickname)} (${r.leader.points})` : '—'}</dd></div>
            <div class="rounded-xl bg-raised p-2.5"><dt class="eyebrow">Joker</dt><dd class="font-bold truncate">${jokerStateText()}</dd></div>
        </dl>`;
}

function jokerStateText() {
    const jk = jokerInfo();
    if (!jk.used) return 'wolny';
    if (!jk.match) return 'ustawiony';
    const name = `${T.shortName(jk.match.homeTeam)}–${T.shortName(jk.match.awayTeam)}`;
    return jk.frozen ? `zużyty (${esc(name)})` : `na ${esc(name)}`;
}

/* ---------------- powiadomienia i instalacja ---------------- */
async function setupPush() {
    const card = document.getElementById('push-card');
    const btn = document.getElementById('push-btn');
    const text = document.getElementById('push-text');
    let dismissed = false;
    try { dismissed = localStorage.getItem('pushDismissed') === '1'; } catch (e) { /* ignore */ }
    if (!D.push || !D.push.enabled) return;

    const sub = await T.currentPush().catch(() => null);
    if (sub && Notification.permission === 'granted') {
        // Odśwież powiązanie subskrypcji z graczem (np. po regeneracji linku)
        T.postJson('/api/public/push/subscribe', { token, subscription: sub.toJSON() }).catch(() => {});
        return;
    }
    if (dismissed || (window.Notification && Notification.permission === 'denied')) return;
    if (!T.pushSupported()) {
        if (T.isIOS() && !T.isStandalone()) {
            card.classList.remove('hidden');
            text.innerHTML = 'Na iPhonie powiadomienia działają po dodaniu aplikacji do ekranu głównego: <strong class="text-ink">Udostępnij → Do ekranu początkowego</strong>, potem otwórz ją z ikony.';
            btn.classList.add('hidden');
        }
        return;
    }
    card.classList.remove('hidden');
    btn.onclick = async () => {
        btn.disabled = true;
        try {
            const out = await T.enablePush('/api/public/push/subscribe', { token });
            T.toast(out.message);
            card.classList.add('hidden');
        } catch (e) {
            T.toast(e.message, 'err');
        } finally { btn.disabled = false; }
    };
    document.getElementById('push-later').onclick = () => {
        card.classList.add('hidden');
        try { localStorage.setItem('pushDismissed', '1'); } catch (e) { /* ignore */ }
    };
}

function setupInstall() {
    if (T.isStandalone()) return;
    const card = document.getElementById('install-card');
    const text = document.getElementById('install-text');
    const btn = document.getElementById('install-btn');
    if (T.isIOS()) {
        card.classList.remove('hidden');
        text.innerHTML = 'Safari → <strong class="text-ink">Udostępnij</strong> → <strong class="text-ink">Do ekranu początkowego</strong>. Ikona otworzy od razu Twój panel, bez paska przeglądarki.';
    }
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredInstall = e;
        card.classList.remove('hidden');
        text.textContent = 'Ikona na ekranie głównym otworzy od razu Twój panel typowania.';
        btn.classList.remove('hidden');
    });
    btn.addEventListener('click', async () => {
        if (!deferredInstall) return;
        deferredInstall.prompt();
        await deferredInstall.userChoice;
        deferredInstall = null;
        card.classList.add('hidden');
    });
}
