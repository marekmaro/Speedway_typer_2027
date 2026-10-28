/* Panel gracza (magiczny link). Typy zapisują się same; serwer pilnuje blokad i jokera.

   Zasady zapisu:
   - wysyłamy tylko mecze, które gracz zmienił (pending) - drugie, nieodświeżone urządzenie
     nie nadpisze więc nowszych typów starymi wartościami,
   - wpisane, ale niezapisane liczby przeżywają odświeżenie ekranu (np. po autozapisie innego meczu),
   - wyczyszczenie obu pól = rezygnacja z typu (tylko przed blokadą). */

const token = new URLSearchParams(location.search).get('id');
let D = null;
let viewSeason = null;   // null = sezon aktywny
let selectedRound = null;
let saveTimer = null;
let saving = false;
let deferredInstall = null;
let lockRefreshing = false;
const pending = new Map(); // matchId -> { home, away, joker } - wpisane, jeszcze nie zapisane
let ltDirty = false;
const esc = T.escapeHtml;

const isDirty = () => pending.size > 0 || ltDirty;

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
    setInterval(() => { if (!document.hidden && !isDirty() && !saving) refresh(); }, 120000);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) flushSave();             // gracz chowa aplikację - zapisz od razu
        else if (!isDirty() && !saving) refresh();
    });
    window.addEventListener('online', () => { if (isDirty()) flushSave(); });
    // Bezpiecznik: gracz zamyka stronę z niezapisanymi typami
    window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
});

function playerDataUrl() {
    return `/api/public/player-data?token=${encodeURIComponent(token)}` + (viewSeason ? `&season=${viewSeason}` : '');
}

async function fetchData() {
    const started = Date.now();
    const data = await T.getJson(playerDataUrl());
    T.syncClock(data.serverTime, started);
    return data;
}

window.changeSeason = async function (year) {
    await flushSave();
    viewSeason = Number(year);
    selectedRound = null;
    pending.clear();
    ltDirty = false;
    await load();
};

async function load() {
    try {
        D = await fetchData();
        renderAll();
    } catch (e) {
        D = null;
        document.querySelector('main').innerHTML = `<div class="card card-pad text-center font-bold text-bad">${esc(e.message)}</div>`;
    }
}

async function refresh() {
    try {
        const keepRound = selectedRound || activeRound();
        D = await fetchData();
        selectedRound = keepRound;
        renderAll();
    } catch (e) { /* cicho - spróbujemy później */ }
}

function renderAll() {
    renderHeader();
    renderChampion();
    renderRoundWin();
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
    document.getElementById('p-helmet').innerHTML = T.helmet(D.player.nickname, { size: 'lg', medal: D.medal || null });
    document.getElementById('p-rank').textContent = r.position ? `${r.position}/${r.totalPlayers}` : '–';
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

    // Pościg w rankingu. "Ex aequo" tylko przy pełnym remisie - przy równych punktach decydują dokładne trafienia.
    const chase = document.getElementById('p-chasing');
    if (r.chasing && r.chasing.samePosition) chase.textContent = `🤝 Ex aequo z: ${r.chasing.nickname}`;
    else if (r.chasing && r.chasing.gap === 0) chase.textContent = `🎯 Tyle samo punktów co ${r.chasing.nickname} — wyżej przez dokładne trafienia`;
    else if (r.chasing) chase.textContent = `🔥 Gonisz: ${r.chasing.nickname} (−${r.chasing.gap} pkt)`;
    else if (r.totalPlayers > 1 && r.points > 0) {
        if (!r.chased) chase.textContent = '🏆 Prowadzisz!';
        else if (r.chased.samePosition) chase.textContent = `🏆 Prowadzisz ex aequo z: ${r.chased.nickname}`;
        else if (r.chased.gap === 0) chase.textContent = `🏆 Prowadzisz — tyle samo punktów co ${r.chased.nickname}, ale więcej dokładnych trafień`;
        else chase.textContent = `🏆 Prowadzisz (+${r.chased.gap} pkt przewagi)`;
    } else chase.textContent = '';

    const blocked = document.getElementById('blocked-box');
    const off = D.player.isActive === false;
    blocked.classList.toggle('hidden', !off && !D.season.isFinished);
    blocked.textContent = off ? 'Twoje konto jest wstrzymane — typy nie będą zapisywane. Odezwij się do admina.'
        : D.season.isFinished ? 'Ten sezon jest zakończony — to archiwum.' : '';
}

function nextOpenMatch() {
    const now = T.now();
    return (D.matches || [])
        .filter(m => !m.isPostponed && !m.voidPredictions && !T.isLocked(m, D.season.lockMinutes, now))
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0] || null;
}

function tick() {
    if (!D) return;
    const el = document.getElementById('countdown');
    const info = document.getElementById('countdown-match');
    const lights = document.getElementById('countdown-lights');
    const m = nextOpenMatch();
    if (!m) {
        el.textContent = '—'; el.classList.add('idle');
        info.textContent = D.season.isFinished ? 'Sezon zakończony' : 'Brak otwartych meczów';
        lights.innerHTML = T.startLights(null).html;
    } else {
        const lock = T.lockTime(m, D.season.lockMinutes);
        el.textContent = T.countdown(lock) || '—'; el.classList.remove('idle');
        info.textContent = `${T.shortName(m.homeTeam)} – ${T.shortName(m.awayTeam)}${hasPred(myPred(m._id)) ? ' · ✓ masz typ' : ' · brak typu!'}`;
        lights.innerHTML = T.startLights(lock - T.now()).html;
    }
    // Odliczanie na kartach + automatyczne zamknięcie karty, gdy minie blokada
    const now = T.now();
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
        const keep = s.value;
        s.innerHTML = opts;
        if (ltDirty) s.value = keep;                       // niezapisany wybór gracza ma pierwszeństwo
        else if (D.longTerm && D.longTerm[id]) s.value = D.longTerm[id];
        s.disabled = locked;
        s.onchange = locked ? null : () => { syncLtOptions(); ltDirty = true; markDirty(); scheduleSave(); };
    });
    syncLtOptions();
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

/** Regulamin: trzy RÓŻNE drużyny - drużyna wybrana w jednym polu jest niedostępna w pozostałych. */
function syncLtOptions() {
    const ids = ['champion', 'bronze', 'relegation'];
    const vals = ids.map(id => document.getElementById(`lt-${id}`).value);
    ids.forEach((id, i) => {
        [...document.getElementById(`lt-${id}`).options].forEach(o => {
            o.disabled = !!o.value && vals.some((v, j) => j !== i && v === o.value);
        });
    });
}

/* ---------------- kolejki ---------------- */
function rounds() { return [...new Set(D.matches.map(m => m.round))].sort((a, b) => a - b); }

function activeRound() {
    const now = T.now();
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
    const now = T.now();
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
    const now = T.now();
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
    const now = T.now();
    const readOnly = D.player.isActive === false || D.season.isFinished;
    // Joker zaznaczony, ale jeszcze niezapisany, "wygrywa" z tym z serwera
    const pendingJoker = [...pending.entries()].find(([, v]) => v.joker === true);

    if (!matches.length) { box.innerHTML = '<p class="text-sm text-muted text-center py-6">Brak meczów w tej kolejce.</p>'; return; }

    box.innerHTML = matches.map(match => {
        const locked = readOnly || match.voidPredictions || T.isLocked(match, D.season.lockMinutes, now);
        const p = myPred(match._id);
        const filled = hasPred(p);
        const st = T.matchStatus(match, D.season.lockMinutes, now);
        const draft = !locked && pending.get(match._id);
        const homeVal = draft ? draft.home : p.homePred;
        const awayVal = draft ? draft.away : p.awayPred;
        const jokerOn = pendingJoker ? pendingJoker[0] === match._id
            : (draft && draft.joker !== undefined ? draft.joker : !!p.usedJoker);

        let jokerHtml = '';
        if (locked) {
            jokerHtml = p.usedJoker ? '<p class="mt-3 text-center"><span class="chip-gold">🃏 Joker na tym meczu</span></p>' : '';
        } else if (jk.used && jk.frozen && jk.matchId !== match._id) {
            jokerHtml = '';
        } else {
            jokerHtml = `
            <label class="joker-card">
                <input type="checkbox" class="joker-checkbox w-5 h-5 accent-[rgb(var(--gold))]" data-match="${match._id}" ${jokerOn ? 'checked' : ''} onchange="onJokerChange(this)">
                🃏 Joker ×${D.season.scoring.jokerMultiplier}${jk.used && jk.matchId !== match._id ? ' <span class="hint font-semibold normal-case not-italic text-muted">(przeniesie z innego meczu)</span>' : ''}
            </label>`;
        }

        const pts = p.pointsEarned !== null && p.pointsEarned !== undefined ? p.pointsEarned : null;
        const result = T.hasResult(match)
            ? `<div class="mt-4 flex items-center justify-center gap-3">
                 <span class="text-[11px] font-bold uppercase tracking-wider text-muted">Wynik</span>
                 <span class="led-box text-xl">${match.homeScore}:${match.awayScore}</span>
                 ${pts !== null ? `<span class="pts-stamp big ${pts > 0 ? 'text-ok' : 'text-faint'}">+${pts} pkt</span>` : ''}
               </div>` : '';

        const input = (cls, val, label) => `<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off"
            aria-label="${label}" class="${cls} score-input ${filled ? 'filled' : ''}"
            value="${val ?? ''}" placeholder="–" ${locked ? 'disabled' : ''} oninput="sanitize(this)" onfocus="this.select()">`;
        const team = (name, side) => `<div class="flex flex-col items-center gap-1 min-w-0">${T.logoHtml(name, 'team-logo-lg')}
            <span class="text-xs font-black text-center leading-tight">${esc(T.shortName(name))}</span>
            <span class="text-[9px] font-bold uppercase tracking-wider text-faint">${side}</span></div>`;

        return `
        <article class="race-card match-card ${match.isMatchOfTheRound ? 'kask' : ''}" data-id="${match._id}">
            <div class="gate-stripe"></div>
            <div class="card-pad">
                <div class="flex items-center justify-between gap-2 mb-3">
                    <span class="text-xs font-bold text-muted">${T.fmtDay(match.matchDate)} · ${T.fmtTime(match.matchDate)}</span>
                    <span class="flex items-center gap-1.5">
                        ${match.isMatchOfTheRound ? '<span class="kask-badge">⭐ Kask</span>' : ''}
                        <span class="lock-label ${st.cls}">${esc(st.text)}</span>
                    </span>
                </div>
                <div class="grid grid-cols-[1fr_auto_auto_auto_1fr] items-center gap-2">
                    ${team(match.homeTeam, 'gospodarz')}
                    ${input('home-pred', homeVal, `Gospodarze: ${esc(match.homeTeam)}`)}
                    <span class="text-2xl font-black text-faint">:</span>
                    ${input('away-pred', awayVal, `Goście: ${esc(match.awayTeam)}`)}
                    ${team(match.awayTeam, 'gość')}
                </div>
                ${!locked ? '<div class="sum-meter" aria-hidden="true"><i style="width:0"></i></div><p class="sum-hint mt-1.5 text-center text-xs text-muted"></p>' : ''}
                ${match.originalDate ? `<p class="mt-2 text-center text-xs text-muted">🌧️ Przełożony z ${T.fmtDateTime(match.originalDate)}${match.predictionsFrozen ? ' — typy zamrożone, bo były już jawne' : ''}</p>` : ''}
                ${match.note ? `<p class="mt-1 text-center text-xs text-muted italic">${esc(match.note)}</p>` : ''}
                ${result}
                ${jokerHtml}
            </div>
        </article>`;
    }).join('');
    box.querySelectorAll('.match-card').forEach(updateSumHint);
}

/** Podpowiedź: pełny mecz to 90 pkt (15 biegów x 6) + pasek sumy. */
function updateSumHint(card) {
    const hint = card.querySelector('.sum-hint');
    if (!hint) return;
    const h = card.querySelector('.home-pred').value, a = card.querySelector('.away-pred').value;
    const meter = card.querySelector('.sum-meter');
    const sum = (Number(h) || 0) + (Number(a) || 0);
    if (meter) {
        meter.firstElementChild.style.width = `${Math.min(100, (sum / 90) * 100)}%`;
        meter.className = `sum-meter ${h !== '' && a !== '' ? (sum === 90 ? 'ok' : sum > 90 ? 'over' : '') : ''}`;
    }
    if (h === '' && a === '') {
        const had = hasPred(myPred(card.dataset.id));
        hint.textContent = had && pending.has(card.dataset.id) ? 'Puste pola = typ zostanie usunięty' : 'Pełny mecz: suma 90 pkt (np. 46:44, 50:40)';
        hint.className = `sum-hint mt-1.5 text-center text-xs ${had && pending.has(card.dataset.id) ? 'text-warn font-bold' : 'text-muted'}`;
        return;
    }
    if (h === '' || a === '') { hint.textContent = 'Wpisz oba wyniki — niepełny typ nie zostanie zapisany'; hint.className = 'sum-hint mt-1.5 text-center text-xs text-warn font-bold'; return; }
    hint.textContent = sum === 90 ? 'Suma 90 ✓' : `Suma ${sum} (pełny mecz to 90)`;
    hint.className = `sum-hint mt-1.5 text-center text-xs ${sum === 90 ? 'text-ok font-bold' : sum > 90 ? 'text-bad font-bold' : 'text-muted'}`;
}

/** Zapamiętuje to, co gracz wpisał w karcie (jeszcze niezapisane). */
function capture(card) {
    const h = card.querySelector('.home-pred'), a = card.querySelector('.away-pred'), j = card.querySelector('.joker-checkbox');
    if (!h || h.disabled) return;
    pending.set(card.dataset.id, { home: h.value, away: a.value, joker: j ? j.checked : undefined });
}

window.sanitize = function (input) {
    let v = input.value.replace(/[^0-9]/g, '');
    if (v !== '' && Number(v) > 75) v = '75';
    input.value = v;
    const card = input.closest('.match-card');
    capture(card);
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

window.onJokerChange = function (cb) {
    const card = cb.closest('.match-card');
    const h = card.querySelector('.home-pred').value, a = card.querySelector('.away-pred').value;
    if (cb.checked && (h === '' || a === '')) {
        cb.checked = false;
        T.toast('Najpierw wpisz typ na ten mecz, potem dodaj Jokera.', 'err');
        return;
    }
    document.querySelectorAll('.joker-checkbox').forEach(other => {
        if (other !== cb && other.checked) { other.checked = false; capture(other.closest('.match-card')); }
    });
    capture(card);
    markDirty();
    scheduleSave(300);
};

/* ---------------- zapis ---------------- */
function setState(text, cls = 'text-muted') {
    const el = document.getElementById('save-state');
    el.className = `text-xs font-bold w-28 shrink-0 ${cls}`;
    el.textContent = text;
}

function markDirty() { setState('Niezapisane…', 'text-warn'); }

function scheduleSave(delay = 1200) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { save(); }, delay);
}

async function flushSave() {
    clearTimeout(saveTimer);
    if (isDirty()) await save();
}

/** Tylko zmienione mecze. Zwraca też listę niepełnych typów (jedno pole puste). */
function buildPayload() {
    const payload = { token, season: D.season.year, predictions: [] };
    const incomplete = [];
    if (ltDirty && D.longTermOpen) {
        payload.longTerm = {
            champion: document.getElementById('lt-champion').value,
            bronze: document.getElementById('lt-bronze').value,
            relegation: document.getElementById('lt-relegation').value
        };
    }
    for (const [matchId, v] of pending) {
        const match = D.matches.find(m => m._id === matchId);
        if (!match) { pending.delete(matchId); continue; }
        const saved = myPred(matchId);
        if (v.home === '' && v.away === '') {
            if (hasPred(saved)) payload.predictions.push({ matchId, clear: true });
            else pending.delete(matchId); // nic do zrobienia
            continue;
        }
        if (v.home === '' || v.away === '') { incomplete.push(match); continue; }
        payload.predictions.push({
            matchId,
            homePred: parseInt(v.home, 10),
            awayPred: parseInt(v.away, 10),
            // joker nieruszany w tej karcie = taki, jak na serwerze (inaczej zmiana wyniku zdjęłaby jokera)
            usedJoker: v.joker !== undefined ? v.joker : !!saved.usedJoker
        });
    }
    return { payload, incomplete };
}

async function save(manual = false) {
    if (saving) { scheduleSave(800); return null; }
    if (!D) return null;
    const { payload, incomplete } = buildPayload();
    const nothingToSend = !payload.predictions.length && !payload.longTerm;
    if (nothingToSend) {
        if (incomplete.length) {
            setState('Uzupełnij typ', 'text-warn');
            if (manual) T.toast(`Uzupełnij oba pola: ${incomplete.map(m => `${T.shortName(m.homeTeam)} – ${T.shortName(m.awayTeam)}`).join(', ')}`, 'err');
        } else {
            setState('✓ Zapisane', 'text-ok');
            if (manual) T.toast('Wszystko już zapisane');
        }
        return null;
    }

    saving = true;
    setState('Zapisuję…', 'text-brand');
    // Migawka wysłanych wartości: jeśli gracz pisze dalej w trakcie zapisu, nie zgubimy zmian
    const sent = new Map(payload.predictions.map(p => [p.matchId, JSON.stringify(pending.get(p.matchId))]));
    const ltSent = !!payload.longTerm;
    try {
        const out = await T.postJson('/api/public/submit-all', payload);
        sent.forEach((snap, id) => { if (JSON.stringify(pending.get(id)) === snap) pending.delete(id); });
        (out.skippedMatches || []).forEach(sk => pending.delete(sk.matchId)); // zablokowane - i tak nie przejdą
        if (ltSent) ltDirty = false;
        (out.warnings || []).forEach(w => T.toast(w, 'err'));

        // Odświeżamy dane, aby zobaczyć stan po stronie serwera (np. przeniesiony joker)
        const keepRound = selectedRound || activeRound();
        const active = document.activeElement;
        const focusCard = active && active.closest ? active.closest('.match-card') : null;
        const focusSide = active && active.classList && active.classList.contains('away-pred') ? 'away' : 'home';
        D = await fetchData();
        selectedRound = keepRound;
        renderHeader(); renderRoundNav(); renderMatches(); renderMyForm(); renderMissing();
        if (focusCard) {
            const el = document.querySelector(`.match-card[data-id="${focusCard.dataset.id}"] .${focusSide}-pred`);
            if (el && !el.disabled) { el.focus({ preventScroll: true }); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) { /* ignore */ } }
        }

        if (out.skipped) setState('⚠ Część niezapisana', 'text-bad');
        else if (incomplete.length) setState('Uzupełnij typ', 'text-warn');
        else if (isDirty()) setState('Niezapisane…', 'text-warn');
        else setState('✓ Zapisane', 'text-ok');

        if (manual) {
            const parts = [`Zapisano ${out.saved} ${out.saved === 1 ? 'typ' : 'typów'}`];
            if (out.deleted) parts.push(`usunięto ${out.deleted}`);
            if (out.skipped) parts.push(`pominięto ${out.skipped} (blokada)`);
            if (incomplete.length) parts.push(`niepełne: ${incomplete.length}`);
            T.toast(parts.join(', '), out.skipped || incomplete.length ? 'err' : 'ok');
        }
        if (isDirty() && !incomplete.length) scheduleSave(600); // coś doszło w trakcie zapisu
        return out;
    } catch (e) {
        const offline = !navigator.onLine || /fetch|network/i.test(e.message);
        setState(offline ? 'Brak sieci — ponowię' : '✕ Błąd zapisu', 'text-bad');
        T.toast(offline ? 'Brak połączenia — typy zapiszą się, gdy wróci sieć.' : `Nie zapisano: ${e.message}`, 'err');
        if (offline) scheduleSave(10000);
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
    const now = T.now();
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
            <span class="text-xs font-black tabular-nums">${f.points}</span>
            <div class="w-full max-w-[28px] rounded-t-md bg-gradient-to-t from-brand to-gold" style="height:${Math.max(4, (f.points / max) * 56)}px"></div>
            <span class="text-[11px] text-muted font-bold">R${f.round}</span>
        </div>`).join('');
    const wins = (r.roundWins || []).length;
    box.innerHTML = `
        ${bars ? `<div class="flex items-end gap-2 h-24 border-b border-line pb-0 mb-3" role="img" aria-label="Punkty w ostatnich kolejkach">${bars}</div>` : '<p class="text-muted mb-3">Brak rozliczonych kolejek.</p>'}
        <dl class="grid grid-cols-2 gap-2">
            <div class="rounded-xl bg-raised p-2.5"><dt class="eyebrow">Najlepsza kolejka</dt><dd class="font-bold">${r.bestRound && r.bestRound.round ? `R${r.bestRound.round} — ${r.bestRound.points} pkt` : '—'}</dd></div>
            <div class="rounded-xl bg-raised p-2.5"><dt class="eyebrow">Skuteczność</dt><dd class="font-bold">${r.hitRate}%</dd></div>
            <div class="rounded-xl bg-raised p-2.5"><dt class="eyebrow">Lider</dt><dd class="font-bold truncate">${r.leader ? `${esc(r.leader.nickname)} (${r.leader.points})` : '—'}</dd></div>
            <div class="rounded-xl bg-raised p-2.5"><dt class="eyebrow">Joker</dt><dd class="font-bold truncate">${jokerStateText()}</dd></div>
            <div class="rounded-xl bg-raised p-2.5 col-span-2"><dt class="eyebrow">Wygrane kolejki</dt><dd class="font-bold">${wins ? `👑 ×${wins} (${r.roundWins.map(x => `R${x}`).join(', ')})` : '— jeszcze żadnej'}</dd></div>
        </dl>`;
}

function jokerStateText() {
    const jk = jokerInfo();
    if (!jk.used) return 'wolny';
    if (!jk.match) return 'ustawiony';
    const name = `${T.shortName(jk.match.homeTeam)}–${T.shortName(jk.match.awayTeam)}`;
    return jk.frozen ? `zużyty (${esc(name)})` : `na ${esc(name)}`;
}

/* ---------------- Mistrz Typera: niespodzianka, dyplom, wygrana kolejka ---------------- */

const MEDAL_TITLE = { 1: 'MISTRZ TYPERA', 2: 'WICEMISTRZ TYPERA', 3: 'BRĄZOWY MEDAL TYPERA' };

function renderChampion() {
    const box = document.getElementById('champ-box');
    const c = D.champion;
    if (c) {
        const surprise = !!(c.prize || c.message);
        box.classList.remove('hidden');
        box.innerHTML = `
        <div class="champ-card text-center">
            <div class="trophy" aria-hidden="true">🏆</div>
            <div class="text-[11px] font-bold uppercase tracking-wider text-gold mt-2">${esc(c.label)}</div>
            <h2 class="display text-3xl mt-1">Mistrz Typera!</h2>
            <p class="text-sm text-white/80 mt-1">${c.coChampions.length ? `Tytuł ex aequo z: ${c.coChampions.map(esc).join(', ')}. Gratulacje!` : 'Wygrałeś cały sezon. Gratulacje!'}</p>
            <div class="flex flex-wrap justify-center gap-2 mt-4">
                ${surprise ? `<button id="champ-open" class="btn-gold">${c.revealed ? '🎁 Twoja niespodzianka' : '🎁 Odbierz niespodziankę'}</button>` : ''}
                <button id="champ-diploma" class="btn bg-white/10 text-white">📜 Dyplom</button>
            </div>
        </div>`;
        if (surprise) document.getElementById('champ-open').onclick = openSurprise;
        document.getElementById('champ-diploma').onclick = downloadDiploma;
        // pierwsze wejście mistrza po zamknięciu sezonu: konfetti i zdrapka same się otwierają
        if (surprise && !c.revealed && T.once(`champ-auto-${D.season.year}-${D.player.nickname}`)) { T.confetti(); setTimeout(openSurprise, 600); }
        return;
    }
    if (D.medal === 2 || D.medal === 3) {
        box.classList.remove('hidden');
        box.innerHTML = `
        <div class="card card-pad flex items-center gap-3">
            <span class="text-4xl" aria-hidden="true">${D.medal === 2 ? '🥈' : '🥉'}</span>
            <div class="flex-1 min-w-0"><div class="font-black italic uppercase">${D.medal === 2 ? 'Wicemistrz' : 'Brązowy medal'} sezonu</div>
                <div class="text-sm text-muted">${D.ranking.position}. miejsce · ${D.ranking.points} pkt — miejsce na podium!</div></div>
            <button id="champ-diploma" class="btn-ghost btn-sm">📜 Dyplom</button>
        </div>`;
        document.getElementById('champ-diploma').onclick = downloadDiploma;
        if (T.once(`medal-${D.season.year}-${D.player.nickname}`)) T.confetti(1600);
        return;
    }
    box.classList.add('hidden');
    box.innerHTML = '';
}

async function downloadDiploma() {
    const pos = D.champion ? 1 : D.medal;
    try {
        const blob = await T.diploma({
            nick: D.player.nickname, title: MEDAL_TITLE[pos], subtitle: D.season.label, season: D.season.year,
            points: D.ranking.points, perfects: D.ranking.snipers, position: pos,
            date: new Date(T.now()).toLocaleDateString('pl-PL')
        });
        const out = await T.shareOrDownload(blob, `dyplom-${D.player.nickname}-${D.season.year}.png`, `${MEDAL_TITLE[pos]} ${D.season.year} — ${D.player.nickname}`);
        if (out === 'downloaded') T.toast('Dyplom pobrany 📜');
    } catch (e) { T.toast('Nie udało się przygotować dyplomu.', 'err'); }
}

/** Zdrapka z niespodzianką (palec / mysz) + przycisk "Odkryj od razu" dla klawiatury i czytników ekranu. */
function openSurprise() {
    const c = D.champion;
    if (!c || document.getElementById('surprise')) return;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop';
    wrap.id = 'surprise';
    wrap.innerHTML = `
        <div class="sheet sm:max-w-md" role="dialog" aria-modal="true" aria-labelledby="sv-title">
            <div class="sheet-body text-center">
                <div class="text-5xl pop" aria-hidden="true">🏆</div>
                <h2 id="sv-title" class="display text-2xl mt-2">Niespodzianka dla Mistrza</h2>
                <p id="sv-lead" class="text-sm text-muted mt-1">${c.revealed ? 'Oto Twoja nagroda:' : 'Zdrap kartę palcem (albo myszką) i zobacz, co wygrałeś!'}</p>
                <div class="scratch mt-4">
                    <div class="scratch-prize" id="sv-prize" ${c.revealed ? '' : 'aria-hidden="true"'}>
                        <div class="text-3xl" aria-hidden="true">🎁</div>
                        <div class="display text-lg leading-snug mt-1">${esc(c.prize || 'Tytuł Mistrza Typera!')}</div>
                    </div>
                    ${c.revealed ? '' : '<canvas id="sv-canvas"></canvas>'}
                </div>
                ${c.message ? `<p id="sv-msg" class="text-sm text-muted mt-3 whitespace-pre-line ${c.revealed ? '' : 'invisible'}">💬 ${esc(c.message)}</p>` : ''}
                ${c.revealed ? '' : '<button id="reveal-now" class="btn-ghost btn-sm mt-3">Odkryj od razu</button>'}
            </div>
            <div class="sheet-foot">
                <button class="btn-ghost flex-1" id="sv-close">Zamknij</button>
                <button class="btn-gold flex-1" id="sv-diploma">📜 Dyplom</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    const close = () => { wrap.remove(); document.body.style.overflow = ''; };
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap.querySelector('#sv-close').onclick = close;
    wrap.querySelector('#sv-diploma').onclick = downloadDiploma;
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    if (!c.revealed) {
        setupScratch(wrap.querySelector('#sv-canvas'), reveal);
        wrap.querySelector('#reveal-now').onclick = reveal;
    }
    (wrap.querySelector('#reveal-now') || wrap.querySelector('#sv-close')).focus();

    let done = false;
    async function reveal() {
        if (done) return;
        done = true;
        const cv = wrap.querySelector('#sv-canvas');
        if (cv) { cv.style.transition = 'opacity .5s'; cv.style.opacity = '0'; setTimeout(() => cv.remove(), 520); }
        wrap.querySelector('#sv-prize').removeAttribute('aria-hidden');
        const msg = wrap.querySelector('#sv-msg');
        if (msg) msg.classList.remove('invisible');
        const btn = wrap.querySelector('#reveal-now');
        if (btn) btn.remove();
        wrap.querySelector('#sv-lead').textContent = 'Gratulacje, Mistrzu! 🎉';
        T.confetti();
        try { await T.postJson('/api/public/champion/reveal', { token, season: D.season.year }); } catch (e) { /* zapis odkrycia nie jest krytyczny */ }
        c.revealed = true;
        renderChampion();
    }
}

function setupScratch(canvas, onDone) {
    const box = canvas.parentElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = box.clientWidth, h = box.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#a16207'); grad.addColorStop(0.5, '#facc15'); grad.addColorStop(1, '#a16207');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(66,32,6,.85)'; g.textAlign = 'center';
    g.font = '900 italic 22px system-ui, sans-serif'; g.fillText('ZDRAP MNIE', w / 2, h / 2 - 4);
    g.font = '600 13px system-ui, sans-serif'; g.fillText('🏁 nagroda Mistrza Typera 🏁', w / 2, h / 2 + 20);
    g.globalCompositeOperation = 'destination-out';
    let down = false, moves = 0;
    const scratch = e => {
        const r = canvas.getBoundingClientRect();
        g.beginPath(); g.arc(e.clientX - r.left, e.clientY - r.top, 22, 0, Math.PI * 2); g.fill();
        if (++moves % 12 === 0 && cleared() > 0.5) onDone();
    };
    const cleared = () => {
        const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
        let clear = 0, total = 0;
        for (let i = 3; i < data.length; i += 4 * 40) { total++; if (data[i] === 0) clear++; }
        return clear / total;
    };
    canvas.addEventListener('pointerdown', e => { down = true; canvas.setPointerCapture(e.pointerId); scratch(e); });
    canvas.addEventListener('pointermove', e => { if (down) scratch(e); });
    canvas.addEventListener('pointerup', () => { down = false; });
}

/** Baner "Wygrałeś kolejkę" - raz na kolejkę (zamknięcie zapamiętane na urządzeniu). */
function renderRoundWin() {
    const box = document.getElementById('round-win');
    const w = D.lastRoundWin;
    const key = w ? `roundwin-${D.season.year}-${w.round}` : '';
    let dismissed = false;
    try { dismissed = !!(key && localStorage.getItem(`${key}-x`)); } catch (e) { /* tryb prywatny */ }
    if (!w || dismissed || D.season.isFinished) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML = `<div class="rounded-2xl border border-gold/50 bg-gold/10 px-4 py-3 flex items-center gap-3 pop">
        <span class="text-3xl" aria-hidden="true">👑</span>
        <div class="flex-1 min-w-0"><div class="font-black">${w.shared ? 'Współzwycięzca' : 'Zwycięzca'} kolejki: ${esc(T.roundName(w.round, D.season.stageNames))}!</div>
            <div class="text-sm text-muted">${w.points} pkt — najlepszy wynik kolejki${w.shared ? ' (ex aequo)' : ''}.</div></div>
        <button class="btn-ghost btn-sm !px-2.5" aria-label="Zamknij" id="round-win-x">✕</button></div>`;
    document.getElementById('round-win-x').onclick = () => {
        try { localStorage.setItem(`${key}-x`, '1'); } catch (e) { /* ignore */ }
        box.classList.add('hidden');
    };
    if (T.once(key)) T.confetti(1800);
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
