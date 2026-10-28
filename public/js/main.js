/* Strona główna typera. Cała matematyka (tabela, ranking, punkty) przychodzi
   z serwera - frontend tylko rysuje. Sekcje przełączane hashem (#mecze, #ranking...),
   więc działa przycisk "wstecz" i skróty z ikony aplikacji. */

let D = null;              // ostatnie dane z /api/public/data
let selectedRound = null;  // null = automatycznie najbliższa kolejka
let seasonParam = new URLSearchParams(location.search).get('season');
let allTimeLoaded = false;
let deferredInstall = null;

const TABS = ['start', 'mecze', 'tabela', 'ranking', 'puchar', 'wiecej'];
let ME = null;             // panel gracza, gdy telefon zna jego link (powitanie na stronie startowej)
const esc = T.escapeHtml;
const profileUrl = nick => `/gracz.html?nick=${encodeURIComponent(nick)}${seasonParam ? `&season=${seasonParam}` : ''}`;

document.addEventListener('DOMContentLoaded', () => {
    T.registerSW();
    window.addEventListener('hashchange', showTab);
    document.getElementById('season-select').addEventListener('change', e => {
        seasonParam = e.target.value;
        selectedRound = null;
        history.replaceState(null, '', `?season=${seasonParam}${location.hash}`);
        load();
    });
    ['h2h-a', 'h2h-b', 'h2h-all'].forEach(id => document.getElementById(id).addEventListener('change', loadH2H));

    const token = T.storedToken();
    if (token) {
        const href = `/typuj.html?id=${encodeURIComponent(token)}`;
        // na telefonie wystarczy pływający przycisk "Typuj", na komputerze - przycisk w nagłówku
        const panel = document.getElementById('my-panel'), fab = document.getElementById('my-fab');
        panel.href = fab.href = href;
        panel.classList.add('md:inline-flex');
        fab.classList.remove('hidden');
    }
    setupInstall();
    showTab();
    load();
    setInterval(updateCountdown, 1000);
    setInterval(() => { if (!document.hidden) load(); }, 120000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
});

function currentTab() {
    const h = location.hash.replace('#', '');
    return TABS.includes(h) ? h : 'start';
}

function showTab() {
    const tab = currentTab();
    TABS.forEach(t => document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab));
    document.querySelectorAll('[data-tab]').forEach(a => {
        if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (tab === 'wiecej' && !allTimeLoaded) loadAllTime();
    window.scrollTo({ top: 0 });
}

async function load() {
    try {
        const started = Date.now();
        D = await T.getJson('/api/public/data' + (seasonParam ? `?season=${seasonParam}` : ''));
        T.syncClock(D.serverTime, started);
        document.getElementById('load-error').classList.add('hidden');
        renderSeasonPicker();
        renderFinale();
        renderStart();
        renderLeagueTable();
        renderRoundNav();
        renderMatches();
        renderRanking();
        renderRoundWinners();
        renderLongTerm();
        renderCup();
        renderFullSchedule();
        fillH2HSelects();
        updateCountdown();
        loadMe();
    } catch (err) {
        const box = document.getElementById('load-error');
        box.textContent = `Nie udało się pobrać danych: ${err.message}`;
        box.classList.remove('hidden');
    }
}

/* ---------------- nagłówek / sezony ---------------- */
function renderSeasonPicker() {
    const sel = document.getElementById('season-select');
    sel.innerHTML = D.seasons.map(s =>
        `<option value="${s.year}" ${s.year === D.season.year ? 'selected' : ''}>${esc(s.label)}${s.isFinished ? ' (archiwum)' : ''}</option>`).join('');
    document.getElementById('page-title').textContent = D.season.label || `Typer ${D.season.year}`;
    const flag = document.getElementById('season-flag');
    if (D.season.isFinished) flag.textContent = '🏁 zakończony';
    else if (D.season.isActive) flag.textContent = '🟢 trwa';
    else flag.textContent = 'przygotowanie';
    document.getElementById('season-empty').classList.toggle('hidden', D.matches.length > 0);
}

function nextOpenMatch() {
    const now = T.now();
    return D.matches
        .filter(m => !m.isPostponed && !m.voidPredictions && !T.isLocked(m, D.season.lockMinutes, now))
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0] || null;
}

function updateCountdown() {
    const el = document.getElementById('countdown-timer');
    const info = document.getElementById('countdown-match');
    const lights = document.getElementById('countdown-lights');
    if (!D || !el) return;
    const m = nextOpenMatch();
    if (!m) {
        el.textContent = '—';
        el.classList.add('idle');
        lights.innerHTML = T.startLights(null).html;
        info.textContent = D.season.isFinished ? 'Sezon zakończony — do zobaczenia w kolejnym!' : D.matches.length ? 'Brak otwartych meczów' : 'Brak terminarza';
        return;
    }
    const lock = T.lockTime(m, D.season.lockMinutes);
    el.textContent = T.countdown(lock) || '—';
    el.classList.remove('idle');
    lights.innerHTML = T.startLights(lock - T.now()).html;
    info.textContent = `${T.shortName(m.homeTeam)} – ${T.shortName(m.awayTeam)} · ${T.fmtDay(m.matchDate)} ${T.fmtTime(m.matchDate)}`;
}

/* ---------------- Mistrz Typera (po zamknięciu sezonu) ---------------- */
function renderFinale() {
    const box = document.getElementById('finale-banner');
    const f = D.finale;
    if (!f) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const names = f.champions.map(esc).join(' i ');
    const podium = f.podium.filter(p => p.position > 1);
    box.classList.remove('hidden');
    box.innerHTML = `
    <div class="champ-card">
        <div class="flex items-center gap-4">
            <div class="trophy" aria-hidden="true">🏆</div>
            <div class="min-w-0 flex-1">
                <div class="text-[11px] font-bold uppercase tracking-wider text-gold">Mistrz Typera · ${esc(D.season.label)}</div>
                <div class="display text-3xl sm:text-4xl mt-1 truncate">${names}</div>
                <div class="text-sm text-white/75 mt-1">${f.podium.filter(p => p.position === 1).map(p => `${p.points} pkt · ${p.perfects} dokładnych`).join(' / ')}
                    ${f.hasSurprise ? ` · 🎁 ${f.revealed.length >= f.champions.length ? 'niespodzianka odebrana' : 'na mistrza czeka niespodzianka'}` : ''}</div>
            </div>
            <div class="hidden sm:flex -space-x-2">${f.champions.map(n => T.helmet(n, { size: 'xl', medal: 1 })).join('')}</div>
        </div>
        ${podium.length ? `<div class="mt-4 flex flex-wrap gap-2">${podium.map(p => `
            <a href="${profileUrl(p.nickname)}" class="inline-flex items-center gap-2 rounded-full bg-white/10 pl-1 pr-3 py-1 text-sm font-bold">
                ${T.helmet(p.nickname, { size: 'sm', medal: p.position })}${p.position === 2 ? '🥈' : '🥉'} ${esc(p.nickname)} · ${p.points}</a>`).join('')}</div>` : ''}
    </div>`;
    if (T.once(`finale-confetti-${f.year}`)) T.confetti();
}

/* ---------------- start (strona główna) ---------------- */

/** Gracz, którego link zna ten telefon: powitanie i brakujące typy. Bez linku - zwykłe powitanie. */
async function loadMe() {
    const token = T.storedToken();
    if (!token) return;
    try {
        ME = await T.getJson(`/api/public/player-data?token=${encodeURIComponent(token)}${seasonParam ? `&season=${seasonParam}` : ''}`);
        renderStart();
    } catch (e) { ME = null; }
}

function renderStart() {
    const token = T.storedToken();
    const lead = document.getElementById('start-lead');
    const cta = document.getElementById('start-cta');
    if (ME && ME.player) {
        const now = T.now();
        const open = ME.matches.filter(m => !m.isPostponed && !m.voidPredictions && !T.isLocked(m, ME.season.lockMinutes, now));
        const missing = open.filter(m => !ME.predictions.some(p => p.matchId === m._id));
        const next = missing.sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
        const r = ME.ranking;
        document.getElementById('h-start').textContent = `Cześć, ${ME.player.nickname}! 👋`;
        lead.innerHTML = `${r.position ? `Jesteś <strong class="text-ink">${r.position}. z ${r.totalPlayers}</strong> (${r.points} pkt). ` : ''}`
            + (D.season.isFinished ? 'Sezon zakończony — zobacz podium w rankingu.'
                : missing.length ? `<strong class="text-warn">Brakuje Ci ${missing.length} ${missing.length === 1 ? 'typu' : 'typów'}</strong> — najbliższy: ${esc(T.shortName(next.homeTeam))} – ${esc(T.shortName(next.awayTeam))}, ${T.fmtDay(next.matchDate)} ${T.fmtTime(next.matchDate)}.`
                    : open.length ? '<strong class="text-ok">Masz typy na wszystkie otwarte mecze ✓</strong>' : 'Na razie nie ma otwartych meczów.');
        cta.innerHTML = `<a href="/typuj.html?id=${encodeURIComponent(token)}" class="btn-primary btn-sm">🏁 ${missing.length ? 'Typuj teraz' : 'Moje typy'}</a>
            <a href="/zasady" class="btn-ghost btn-sm">📜 Zasady gry</a>
            <a href="/gracz.html?nick=${encodeURIComponent(ME.player.nickname)}" class="btn-ghost btn-sm">📈 Mój profil</a>`;
    } else if (!token) {
        cta.innerHTML = `<a href="/zasady" class="btn-primary btn-sm">📜 Zasady gry</a>
            <a href="#ranking" class="btn-ghost btn-sm">📊 Ranking</a>
            <span class="text-xs text-muted self-center">Chcesz grać? Poproś admina o swój link.</span>`;
    }
    if (!D) return;

    // najbliższa kolejka (albo trwająca)
    const round = activeRound();
    const rm = D.matches.filter(m => m.round === round).sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    document.getElementById('start-round-title').textContent = `🏁 ${T.roundName(round, D.season.stageNames)}`;
    const now = T.now();
    document.getElementById('start-round').innerHTML = rm.length ? rm.map(m => {
        const st = T.matchStatus(m, D.season.lockMinutes, now);
        return `<li class="py-2.5">
            <a href="#mecze" onclick="changeRound(${m.round})" class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm">
                <span class="flex items-center justify-end gap-1.5 min-w-0"><span class="font-bold truncate">${esc(T.shortName(m.homeTeam))}</span>${T.logoHtml(m.homeTeam)}</span>
                ${T.hasResult(m) ? `<span class="led-box text-sm !px-2 !py-0.5">${m.homeScore}:${m.awayScore}</span>`
                    : `<span class="text-center"><span class="block text-xs font-black tabular-nums">${T.fmtTime(m.matchDate)}</span><span class="block text-[10px] text-muted">${T.fmtDay(m.matchDate)}</span></span>`}
                <span class="flex items-center gap-1.5 min-w-0">${T.logoHtml(m.awayTeam)}<span class="font-bold truncate">${esc(T.shortName(m.awayTeam))}</span></span>
            </a>
            <div class="text-center mt-1"><span class="${st.cls} !text-[10px] !py-0.5">${esc(st.text)}</span>${m.isMatchOfTheRound ? ' <span class="kask-badge !text-[10px] !py-0.5">⭐ Kask</span>' : ''}</div>
        </li>`;
    }).join('') : '<li class="py-3 text-sm text-muted">Terminarz nie jest jeszcze wgrany.</li>';

    // czołówka
    const top = D.ranking.slice(0, 5);
    document.getElementById('start-top').innerHTML = top.length ? top.map(p => `
        <li><a href="${profileUrl(p.nickname)}" class="flex items-center gap-3 py-2">
            <span class="rank-pos ${p.points > 0 ? (p.position === 1 ? 'top' : p.position === 2 ? 'p2' : p.position === 3 ? 'p3' : '') : ''} !w-7 !h-7 !text-xs">${p.position ?? '–'}</span>
            ${T.helmet(p.nickname, { size: 'sm' })}
            <span class="flex-1 min-w-0 font-bold truncate">${esc(p.nickname)}</span>
            <span class="text-lg font-black tabular-nums">${p.points}</span>
        </a></li>`).join('') : '<li class="py-3 text-sm text-muted">Brak graczy w tym sezonie.</li>';

    // ostatnie wyniki
    const played = D.matches.filter(T.hasResult).sort((a, b) => new Date(b.matchDate) - new Date(a.matchDate)).slice(0, 4);
    document.getElementById('start-results').innerHTML = played.length ? played.map(m => `
        <li class="flex items-center gap-2 py-2 text-sm">
            <span class="text-[11px] font-bold text-muted w-8 shrink-0">R${m.round}</span>
            <span class="flex-1 min-w-0 truncate text-right font-semibold">${esc(T.shortName(m.homeTeam))}</span>
            <span class="led-box text-sm !px-2 !py-0.5">${m.homeScore}:${m.awayScore}</span>
            <span class="flex-1 min-w-0 truncate font-semibold">${esc(T.shortName(m.awayTeam))}</span>
        </li>`).join('') : '<li class="py-3 text-sm text-muted">Jeszcze nie rozegrano żadnego meczu.</li>';

    // sezon w liczbach
    const done = D.matches.filter(T.hasResult).length;
    const exact = D.ranking.reduce((sum, p) => sum + (p.perfects || 0), 0);
    const leader = D.ranking[0] && D.ranking[0].points > 0 ? D.ranking[0] : null;
    const tile = (icon, value, label, color) => `<div class="kpi" style="--k: var(--${color})"><span class="kpi-icon" aria-hidden="true">${icon}</span>
        <div class="text-xl font-black tabular-nums truncate pr-6">${value}</div><div class="text-[11px] font-semibold text-muted">${label}</div></div>`;
    document.getElementById('start-stats').innerHTML = [
        tile('👥', D.ranking.length, 'typerów', 'gate-blue'),
        tile('🏁', `${done}/${D.matches.length}`, 'rozegranych meczów', 'ok'),
        tile('🎯', exact, 'dokładnych trafień', 'brand'),
        tile('👑', leader ? esc(leader.nickname) : '—', leader ? `lider · ${leader.points} pkt` : 'lider', 'gold')
    ].join('');
}

/* ---------------- tabela ligowa ---------------- */
function renderLeagueTable() {
    const body = document.getElementById('league-table-body');
    if (!D.standings.length || !D.standings.some(t => t.matches)) {
        body.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-muted">Brak rozegranych meczów.</td></tr>';
    } else {
        const last = D.standings.length - 1;
        body.innerHTML = D.standings.map((t, i) => `
        <tr class="border-b border-line last:border-0 ${i < 4 ? 'zone-po' : i === last ? 'zone-down' : ''} ${i === 0 ? 'bg-gold/5' : ''}">
            <td class="pl-4 pr-1 py-2.5 font-black italic text-muted tabular-nums">${i + 1}</td>
            <td class="px-1 py-2.5">
                <span class="flex items-center gap-2 min-w-0">${T.logoHtml(t.name)}
                    <span class="font-bold truncate">${esc(T.shortName(t.name))}</span>
                    ${t.adjustment ? `<span class="chip-warn" title="${esc(t.adjustmentNotes.join('; '))}">${t.adjustment > 0 ? '+' : ''}${t.adjustment}</span>` : ''}
                </span>
            </td>
            <td class="px-1 py-2.5 text-center tabular-nums">${t.matches}</td>
            <td class="px-1 py-2.5 text-center tabular-nums text-muted hidden sm:table-cell">${t.bonus}</td>
            <td class="px-1 py-2.5 text-center tabular-nums text-xs ${t.diff > 0 ? 'text-ok' : t.diff < 0 ? 'text-bad' : 'text-muted'}">${t.diff > 0 ? '+' + t.diff : t.diff}</td>
            <td class="px-1 py-2.5 text-center hidden md:table-cell whitespace-nowrap">${formHtml(t.form)}</td>
            <td class="pl-1 pr-4 py-2.5 text-right font-black text-lg tabular-nums">${t.points}</td>
        </tr>`).join('');
    }
    const notes = D.standings.filter(t => t.adjustmentNotes && t.adjustmentNotes.length)
        .map(t => `${esc(T.shortName(t.name))}: ${esc(t.adjustmentNotes.join('; '))}`);
    const box = document.getElementById('table-notes');
    box.classList.toggle('hidden', !notes.length);
    box.innerHTML = notes.length ? `Korekty: ${notes.join(' · ')}` : '';
}

function formHtml(form) {
    const map = { W: ['form-w', 'Z'], L: ['form-l', 'P'], D: ['form-d', 'R'] };
    const cells = [...form];
    while (cells.length < 5) cells.unshift(null);
    return `<span class="inline-flex gap-0.5">${cells.map(f => {
        if (!f) return '<span class="form-dot form-none">-</span>';
        const [cls, label] = map[f];
        return `<span class="form-dot ${cls}">${label}</span>`;
    }).join('')}</span>`;
}

/* ---------------- mecze ---------------- */
function availableRounds() {
    return [...new Set(D.matches.map(m => m.round))].sort((a, b) => a - b);
}

function activeRound() {
    const pending = D.matches.filter(m => !T.hasResult(m) && !m.isPostponed && !m.voidPredictions)
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0];
    if (pending) return pending.round;
    const rounds = availableRounds();
    return rounds.length ? rounds[rounds.length - 1] : 1;
}

window.changeRound = function (r) { selectedRound = r; renderRoundNav(); renderMatches(); };

function renderRoundNav() {
    const rounds = availableRounds();
    const nav = document.getElementById('round-nav');
    if (!rounds.length) { nav.innerHTML = ''; return; }
    const current = selectedRound || activeRound();
    nav.innerHTML = rounds.map(r => {
        const name = T.roundName(r, D.season.stageNames);
        const short = /^Runda \d+$/.test(name) ? `R${r}` : name;
        const done = D.matches.filter(m => m.round === r).every(m => T.hasResult(m) || m.voidPredictions);
        return `<button role="tab" class="round-chip gap-1" aria-current="${r === current}" onclick="changeRound(${r})" title="${esc(name)}">${esc(short)}${done ? '<span class="text-[10px] opacity-60" aria-label="rozegrana">✓</span>' : ''}</button>`;
    }).join('');
    const active = nav.querySelector('[aria-current="true"]');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
    document.getElementById('round-title').textContent = T.roundName(current, D.season.stageNames);
    const ms = D.matches.filter(m => m.round === current);
    const played = ms.filter(T.hasResult).length;
    const rw = (D.roundWinners || []).find(x => x.round === current);
    document.getElementById('round-sub').textContent = `${ms.length} ${ms.length === 1 ? 'mecz' : ms.length < 5 ? 'mecze' : 'meczów'} · rozegrane ${played}/${ms.length}`
        + (rw ? ` · 👑 ${rw.winners.join(', ')} (${rw.points})${rw.complete ? '' : ' na razie'}` : '');
}

function teamSide(name, side) {
    return `<div class="flex flex-col items-center gap-1.5 min-w-0 flex-1">
        ${T.logoHtml(name, 'team-logo-lg')}
        <span class="team-name">${esc(T.shortName(name))}</span>
        <span class="text-[10px] font-bold uppercase tracking-wider text-faint">${side}</span>
    </div>`;
}

function renderMatches() {
    const container = document.getElementById('matches-container');
    if (!D.matches.length) { container.innerHTML = ''; return; }
    const current = selectedRound || activeRound();
    const now = T.now();
    const matches = D.matches.filter(m => m.round === current)
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));

    container.innerHTML = matches.map(match => {
        const st = T.matchStatus(match, D.season.lockMinutes, now);
        const preds = D.predictions.filter(p => p.matchId === match._id)
            .sort((a, b) => (b.pointsEarned || 0) - (a.pointsEarned || 0) || a.nickname.localeCompare(b.nickname, 'pl'));
        const hidden = preds.length && preds.every(p => p.hidden);
        // "na torze" tylko w czasie meczu (ok. 2,5 h od pierwszego biegu); później status mówi "czeka na wynik"
        const startMs = new Date(match.matchDate).getTime();
        const live = !T.hasResult(match) && !match.isPostponed && !match.voidPredictions && startMs <= now && now - startMs < 150 * 60 * 1000;

        const rows = preds.map(p => {
            const typ = p.hidden ? '<span class="text-faint" title="ukryty do blokady">🔒</span>' : `<span class="font-led font-bold tabular-nums">${p.homePred}:${p.awayPred}</span>`;
            const joker = p.usedJoker ? '<span class="chip-gold">🃏 Joker</span>' : '';
            const pts = p.pointsEarned !== null && p.pointsEarned !== undefined
                ? `<span class="pts-stamp ${p.pointsEarned > 0 ? 'text-ok' : 'text-faint'}">+${p.pointsEarned}</span>` : '';
            return `<li class="flex items-center gap-2 py-1.5">
                ${T.helmet(p.nickname, { size: 'sm' })}
                <a href="${profileUrl(p.nickname)}" class="flex-1 truncate font-semibold hover:text-brand">${esc(p.nickname)}</a>
                ${joker}${typ}<span class="w-12 text-right">${pts}</span>
            </li>`;
        }).join('');

        const score = T.hasResult(match)
            ? `<div class="led-box text-3xl px-4 py-2">${match.homeScore}<span class="opacity-50 mx-0.5">:</span>${match.awayScore}</div>`
            : `<div class="text-center"><div class="led-box idle text-lg">${T.fmtTime(match.matchDate)}</div><div class="text-[11px] text-muted font-semibold mt-1">${T.fmtDay(match.matchDate)}</div></div>`;

        return `
        <article class="race-card ${match.isMatchOfTheRound ? 'kask' : ''}">
            <div class="gate-stripe"></div>
            <div class="flex items-center justify-between gap-2 px-4 pt-3">
                <span class="${live ? 'chip-live' : st.cls}">${esc(live ? 'Na torze' : st.text)}</span>
                ${match.isMatchOfTheRound ? '<span class="kask-badge" title="Trafienie za 5 lub 3 pkt daje +1">⭐ Złoty Kask</span>' : ''}
            </div>
            <div class="flex items-center gap-2 px-4 py-4">
                ${teamSide(match.homeTeam, 'gospodarz')}
                <div class="shrink-0 px-1 flex flex-col items-center gap-1">${score}</div>
                ${teamSide(match.awayTeam, 'gość')}
            </div>
            ${match.originalDate ? `<p class="px-4 -mt-2 mb-2 text-xs text-muted text-center">🌧️ Przełożony z ${T.fmtDateTime(match.originalDate)}</p>` : ''}
            ${match.note ? `<p class="px-4 -mt-1 mb-3 text-xs text-muted text-center italic">${esc(match.note)}</p>` : ''}
            ${preds.length ? `
            <details class="border-t border-line group" ${T.hasResult(match) ? 'open' : ''}>
                <summary class="px-4 py-2.5 flex items-center justify-between cursor-pointer list-none text-sm font-bold text-muted">
                    <span>Typy (${preds.length})${hidden ? ' · 🔒 ukryte do blokady' : ''}</span>
                    <span class="group-open:rotate-180 transition">▾</span>
                </summary>
                <ul class="px-4 pb-3 text-sm divide-y divide-line/60">${rows}</ul>
            </details>` : '<p class="border-t border-line px-4 py-2.5 text-sm text-faint">Nikt jeszcze nie wytypował.</p>'}
        </article>`;
    }).join('');
}

/* ---------------- ranking ---------------- */
function renderRanking() {
    const list = document.getElementById('ranking-list');
    const podiumCard = document.getElementById('podium-card');
    if (!D.ranking.length) {
        list.innerHTML = '<li class="p-6 text-center text-muted">Brak graczy w tym sezonie.</li>';
        podiumCard.classList.add('hidden');
        return;
    }
    const trend = t => t > 0 ? `<span class="text-ok text-xs font-black" title="awans o ${t}">▲${t}</span>`
        : t < 0 ? `<span class="text-bad text-xs font-black" title="spadek o ${-t}">▼${-t}</span>` : '';
    const posCls = p => (p === 1 ? 'top' : p === 2 ? 'p2' : p === 3 ? 'p3' : '');
    list.innerHTML = D.ranking.map(p => `
        <li>
            <a href="${profileUrl(p.nickname)}" class="rank-row">
                <span class="rank-pos ${p.points > 0 ? posCls(p.position) : ''}">${p.position ?? '–'}</span>
                ${T.helmet(p.nickname, { medal: D.finale && p.position <= 3 && p.points > 0 ? p.position : null })}
                <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-2"><span class="font-bold truncate">${esc(p.nickname)}</span>${trend(p.trend)}
                        ${p.jokerUsed ? `<span class="chip-gold" title="Joker">🃏 ${p.jokerPoints}</span>` : ''}</span>
                    <span class="block text-xs text-muted tabular-nums">
                        🎯 ${p.perfects} · ± ${p.diffs} · ✓ ${p.winners} · śr. ${p.avgPerMatch}${p.longTermPoints ? ` · sezon +${p.longTermPoints}` : ''}
                    </span>
                </span>
                <span class="text-2xl font-black tabular-nums">${p.points}</span>
            </a>
        </li>`).join('');

    // podium: trzech najlepszych (gdy ktoś już ma punkty)
    const top = D.ranking.filter(p => p.points > 0).slice(0, 3);
    podiumCard.classList.toggle('hidden', top.length < 2);
    if (top.length >= 2) {
        // wysokość stopnia wg miejsca na podium, kolor wg faktycznej pozycji (ex aequo = ten sam medal)
        const step = (p, cls) => p ? `
            <a href="${profileUrl(p.nickname)}" class="podium-step ${cls}" data-pos="${Math.min(3, p.position)}">
                ${T.helmet(p.nickname, { size: cls === 'p1' ? 'xl' : 'lg', medal: Math.min(3, p.position) })}
                <span class="mt-1.5 font-black truncate max-w-full">${esc(p.nickname)}</span>
                <span class="text-xs text-muted tabular-nums">${p.points} pkt</span>
                <span class="podium-block"><span class="text-3xl">${p.position}</span></span>
            </a>` : '<span></span>';
        document.getElementById('podium').innerHTML = step(top[1], 'p2') + step(top[0], 'p1') + step(top[2], 'p3');
    }
}

function renderRoundWinners() {
    const box = document.getElementById('round-winners');
    if (!D.roundWinners.length) { box.innerHTML = '<p class="text-sm text-muted">Jeszcze nie rozegrano żadnej kolejki.</p>'; return; }
    box.innerHTML = D.roundWinners.slice().reverse().map(r => `
        <div class="shrink-0 snap-start rounded-xl border ${r.complete ? 'border-gold/40 bg-gold/5' : 'border-line bg-raised'} px-3 py-2 min-w-[9rem]">
            <div class="eyebrow">${esc(T.roundName(r.round, D.season.stageNames))}${r.complete ? '' : ' · trwa'}</div>
            <div class="flex items-center gap-1.5 mt-1">${r.winners.slice(0, 3).map(n => T.helmet(n, { size: 'sm' })).join('')}</div>
            <div class="font-bold truncate mt-1">${esc(r.winners.join(', '))}</div>
            <div class="text-xs text-muted">${r.points} pkt</div>
        </div>`).join('');
}

function renderLongTerm() {
    const box = document.getElementById('longterm-container');
    if (!D.longTerms.length) { box.innerHTML = '<p class="text-sm text-muted">Brak zgłoszonych typów.</p>'; return; }
    if (D.longTermOpen) {
        box.innerHTML = `<p class="text-sm text-muted sm:col-span-3">🔒 Zakryte do startu sezonu. Zgłosili już: <strong class="text-ink">${D.longTerms.map(l => esc(l.nickname)).join(', ')}</strong>.</p>`;
        return;
    }
    const res = D.season.results || {};
    const row = (icon, team, actual) => `<div class="flex items-center gap-2 text-sm">
        <span class="w-5">${icon}</span>${team ? T.logoHtml(team) : ''}
        <span class="truncate ${actual && team === actual ? 'font-bold text-ok' : ''}">${esc(team ? T.shortName(team) : '—')}${actual && team === actual ? ' ✓' : ''}</span></div>`;
    box.innerHTML = D.longTerms.map(lt => `
        <div class="rounded-xl border border-line bg-raised p-3 space-y-1">
            <div class="flex items-center gap-2">${T.helmet(lt.nickname, { size: 'sm' })}<strong class="flex-1 truncate">${esc(lt.nickname)}</strong>
                ${lt.pointsEarned ? `<span class="chip-ok">+${lt.pointsEarned}</span>` : ''}</div>
            ${row('🥇', lt.champion, res.champion)}${row('🥉', lt.bronze, res.bronze)}${row('⬇️', lt.relegation, res.relegation)}
        </div>`).join('');
}

/* ---------------- puchar ---------------- */
const CUP_WHY = { exact: 'remis — więcej dokładnych trafień', error: 'remis — mniejsza pomyłka w typach', seed: 'pełny remis — wyżej rozstawiony' };

function renderCup() {
    const box = document.getElementById('cup-container');
    if (!D.cupMatches.length) { box.innerHTML = '<p class="text-sm text-muted sm:col-span-2 text-center py-6">Drabinka pucharowa jest pusta.</p>'; return; }
    const stages = [...new Set(D.cupMatches.map(c => c.stage))];
    box.innerHTML = stages.map(stage => {
        const duels = D.cupMatches.filter(c => c.stage === stage);
        return `<h3 class="sm:col-span-2 display text-lg mt-2 flex items-center gap-2">${esc(String(stage))}
            ${duels[0].roundNumber ? `<span class="chip-muted not-italic normal-case">${esc(T.roundName(duels[0].roundNumber, D.season.stageNames))}</span>` : ''}</h3>`
            + duels.map(duelCard).join('');
    }).join('');
}

function duelCard(c) {
    const has = c.score1 !== null && c.score2 !== null;
    const w1 = c.winner && c.winner === c.player1, w2 = c.winner && c.winner === c.player2;
    // pole A (czerwony kask) = wyżej rozstawiony, pole B = niebieski
    const side = (nick, helmetCls, win, gate) => `
        <a href="${profileUrl(nick)}" class="flex flex-col items-center gap-1 min-w-0 text-center ${win ? 'text-ok' : c.winner ? 'opacity-60' : ''}">
            <span class="helmet ${helmetCls} helmet-lg" aria-hidden="true"><span>${esc(T.nickInitials(nick))}</span></span>
            <span class="block w-full font-black truncate">${win ? '👑 ' : ''}${esc(nick)}</span>
            <span class="text-[10px] font-bold uppercase tracking-wider text-faint">${gate}</span>
        </a>`;
    const state = c.live ? '<span class="chip-live">trwa kolejka</span>' : c.finished ? '<span class="chip-ok">rozstrzygnięty</span>' : '<span class="chip-muted">czeka na kolejkę</span>';
    return `
    <div class="card duel">
        <div class="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
            ${side(c.player1, 'h-red', w1, 'pole A')}
            <div class="flex flex-col items-center gap-2 pt-2">${state}<div class="led-box ${has ? '' : 'idle'} text-xl">${has ? `${c.score1}:${c.score2}` : '–:–'}</div></div>
            ${side(c.player2, 'h-blue', w2, 'pole B')}
        </div>
        ${c.decidedBy && CUP_WHY[c.decidedBy] ? `<p class="text-center text-xs font-semibold text-muted mt-3">⚖️ ${CUP_WHY[c.decidedBy]}</p>` : ''}
    </div>`;
}

/* ---------------- więcej: H2H, all-time, galeria, terminarz, regulamin ---------------- */
function fillH2HSelects() {
    const nicks = D.ranking.map(r => r.nickname);
    const a = document.getElementById('h2h-a'), b = document.getElementById('h2h-b');
    const keepA = a.value, keepB = b.value;
    const opts = nicks.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    a.innerHTML = opts; b.innerHTML = opts;
    a.value = nicks.includes(keepA) ? keepA : nicks[0] || '';
    b.value = nicks.includes(keepB) ? keepB : nicks[1] || '';
    if (!keepA && nicks.length > 1) loadH2H();
}

async function loadH2H() {
    const a = document.getElementById('h2h-a').value, b = document.getElementById('h2h-b').value;
    const box = document.getElementById('h2h-result');
    if (!a || !b || a === b) { box.innerHTML = '<p class="text-sm text-muted">Wybierz dwóch różnych graczy.</p>'; return; }
    const scope = document.getElementById('h2h-all').checked ? 'all' : (D && D.season.year);
    try {
        const h = await T.getJson(`/api/public/h2h?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&season=${scope}`);
        if (!h.matches) { box.innerHTML = '<p class="text-sm text-muted">Brak wspólnych rozliczonych meczów.</p>'; return; }
        const bar = h.winsA + h.draws + h.winsB;
        const pct = n => `${(n / bar) * 100}%`;
        box.innerHTML = `
        <div class="grid grid-cols-3 items-center text-center">
            <div class="flex flex-col items-center gap-1"><span class="helmet h-red helmet-lg" aria-hidden="true"><span>${esc(T.nickInitials(a))}</span></span>
                <div class="text-3xl font-black tabular-nums">${h.winsA}</div><div class="text-xs text-muted">wygrane ${esc(a)}</div></div>
            <div><div class="text-3xl font-black tabular-nums text-muted">${h.draws}</div><div class="text-xs text-muted">remisy</div></div>
            <div class="flex flex-col items-center gap-1"><span class="helmet h-blue helmet-lg" aria-hidden="true"><span>${esc(T.nickInitials(b))}</span></span>
                <div class="text-3xl font-black tabular-nums">${h.winsB}</div><div class="text-xs text-muted">wygrane ${esc(b)}</div></div>
        </div>
        <div class="flex h-2.5 rounded-full overflow-hidden mt-3 gap-0.5" role="img" aria-label="Bilans ${h.winsA}-${h.draws}-${h.winsB}">
            <span class="bg-gate-red" style="width:${pct(h.winsA)}"></span><span class="bg-line" style="width:${pct(h.draws)}"></span><span class="bg-gate-blue" style="width:${pct(h.winsB)}"></span>
        </div>
        <p class="text-sm text-muted mt-3 text-center">Punkty w ${h.matches} wspólnych meczach: <strong class="text-ink">${h.pointsA}</strong> – <strong class="text-ink">${h.pointsB}</strong> · dokładne trafienia ${h.exactA} – ${h.exactB}</p>
        <ul class="mt-3 text-sm divide-y divide-line max-h-72 overflow-y-auto">
            ${h.rows.slice(0, 30).map(r => `<li class="py-2 flex items-center gap-2">
                <span class="flex-1 min-w-0 truncate">${esc(T.shortName(r.homeTeam))} – ${esc(T.shortName(r.awayTeam))} <span class="text-muted tabular-nums">${r.homeScore}:${r.awayScore}</span></span>
                <span class="tabular-nums ${r.a.points > r.b.points ? 'font-black text-gate-red' : 'text-muted'}">${r.a.homePred}:${r.a.awayPred} (+${r.a.points})</span>
                <span class="tabular-nums ${r.b.points > r.a.points ? 'font-black text-gate-blue' : 'text-muted'}">${r.b.homePred}:${r.b.awayPred} (+${r.b.points})</span>
            </li>`).join('')}
        </ul>`;
    } catch (e) { box.innerHTML = `<p class="text-sm text-bad">${esc(e.message)}</p>`; }
}

async function loadAllTime() {
    const list = document.getElementById('alltime-list');
    const hall = document.getElementById('hall-of-fame');
    try {
        const data = await T.getJson('/api/public/alltime');
        allTimeLoaded = true;
        const champs = data.seasons.filter(s => s.winner && s.winner.length).sort((a, b) => b.year - a.year);
        hall.innerHTML = champs.length ? champs.map(s => `
            <div class="flex items-center gap-3 rounded-2xl border border-gold/40 bg-gold/5 p-3">
                <span class="text-3xl" aria-hidden="true">🏆</span>
                <div class="min-w-0 flex-1"><div class="eyebrow">${esc(s.label)}</div>
                    <div class="font-black truncate">${s.winner.map(esc).join(', ')}</div>
                    <div class="text-xs text-muted">${s.winnerPoints} pkt</div></div>
                <div class="flex -space-x-2">${s.winner.map(n => T.helmet(n, { size: 'lg', medal: 1 })).join('')}</div>
            </div>`).join('')
            : '<p class="text-sm text-muted sm:col-span-2">Pierwszy Mistrz Typera pojawi się tu po zamknięciu sezonu. Może to będziesz Ty? 🏁</p>';
        if (!data.ranking.length) { list.innerHTML = '<li class="p-4 text-sm text-muted">Brak rozliczonych typów.</li>'; return; }
        list.innerHTML = data.ranking.map(p => `
            <li class="flex items-center gap-3 px-4 py-3">
                <span class="w-6 text-center font-black italic text-muted tabular-nums">${p.position}</span>
                ${T.helmet(p.nickname, { size: 'sm' })}
                <span class="flex-1 min-w-0">
                    <span class="font-bold">${esc(p.nickname)}</span> ${p.titles.map(y => `<span class="chip-gold" title="Mistrz ${y}">🏆 ${y}</span>`).join(' ')}
                    <span class="block text-xs text-muted tabular-nums">${p.seasons.length} sez. · ${p.settled} typów · śr. ${p.avgPerMatch} · 🎯 ${p.perfects} · skut. ${p.hitRate}%</span>
                </span>
                <span class="text-xl font-black tabular-nums">${p.points}</span>
            </li>`).join('');
    } catch (e) { list.innerHTML = `<li class="p-4 text-sm text-bad">${esc(e.message)}</li>`; }
}

function renderFullSchedule() {
    const box = document.getElementById('full-schedule');
    if (!D.matches.length) { box.innerHTML = '<p class="text-sm text-muted">Terminarz nie został jeszcze wgrany.</p>'; return; }
    box.innerHTML = availableRounds().map(r => {
        const rows = D.matches.filter(m => m.round === r)
            .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))
            .map(m => `
            <li class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5 text-sm">
                <span class="text-right truncate">${esc(T.shortName(m.homeTeam))}</span>
                <span class="text-center tabular-nums font-bold ${T.hasResult(m) ? 'font-led' : 'text-muted text-xs font-semibold'}">${T.hasResult(m) ? `${m.homeScore}:${m.awayScore}` : `${T.fmtDay(m.matchDate)} ${T.fmtTime(m.matchDate)}`}</span>
                <span class="truncate">${esc(T.shortName(m.awayTeam))}</span>
            </li>`).join('');
        return `<div><h4 class="eyebrow mb-1">${esc(T.roundName(r, D.season.stageNames))}</h4><ul class="divide-y divide-line">${rows}</ul></div>`;
    }).join('');
}

/* ---------------- instalacja PWA ---------------- */
function setupInstall() {
    const card = document.getElementById('install-card');
    const text = document.getElementById('install-text');
    const btn = document.getElementById('install-btn');
    if (T.isStandalone()) return;
    if (T.isIOS()) {
        card.classList.remove('hidden');
        text.innerHTML = 'Na iPhonie: otwórz w Safari, dotknij <strong class="text-ink">Udostępnij</strong> → <strong class="text-ink">Do ekranu początkowego</strong>. Najlepiej zrób to ze swojego linku do typowania.';
    }
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredInstall = e;
        card.classList.remove('hidden');
        text.textContent = 'Aplikacja otworzy się bez paska przeglądarki, jak zwykła apka z telefonu.';
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
