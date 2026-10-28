/* Strona główna typera. Cała matematyka (tabela, ranking, punkty) przychodzi
   z serwera - frontend tylko rysuje. Sekcje przełączane hashem (#mecze, #ranking...),
   więc działa przycisk "wstecz" i skróty z ikony aplikacji. */

let D = null;              // ostatnie dane z /api/public/data
let selectedRound = null;  // null = automatycznie najbliższa kolejka
let seasonParam = new URLSearchParams(location.search).get('season');
let allTimeLoaded = false;
let deferredInstall = null;

const TABS = ['mecze', 'tabela', 'ranking', 'puchar', 'wiecej'];
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
        ['my-panel', 'my-fab'].forEach(id => { const a = document.getElementById(id); a.href = href; a.classList.remove('hidden'); });
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
    return TABS.includes(h) ? h : 'mecze';
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
        renderLeagueTable();
        renderRoundNav();
        renderMatches();
        renderRanking();
        renderRoundWinners();
        renderLongTerm();
        renderCup();
        renderFullSchedule();
        renderRules();
        fillH2HSelects();
        updateCountdown();
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

/**
 * Regulamin generowany z ustawień sezonu. Każde zdanie ma pokrycie w logice serwera
 * (services/scoring.js, routes/publicRoutes.js), w testach (test/scenarios.test.js)
 * i w symulacji całego sezonu (npm run symulacja).
 */
function rulesSections() {
    const s = D.season.scoring;
    const lock = T.lockLabel(D.season.lockMinutes);
    const remind = T.lockLabel(D.season.reminderMinutes || 120);
    const max = (s.exact + s.motrBonus) * s.jokerMultiplier;
    const tol = Number(s.diffTolerance) || 0;
    const b = t => `<strong class="text-ink">${t}</strong>`;
    // przykład typu za "zwycięzca + różnica": przy tolerancji - typ z sumą 90, którego różnica mieści się w ±tol
    const near = tol >= 2 ? `${46 + Math.floor(tol / 2)}:${44 - Math.floor(tol / 2)}` : '47:45';
    return [
        { icon: '🕒', title: 'Typowanie', items: [
            `Typujesz przez swój prywatny link (najlepiej dodany do ekranu głównego) — najpóźniej ${b(`${lock} przed pierwszym biegiem`)} meczu.`,
            'Blokadę sprawdza serwer, według czasu serwera — zły zegarek w telefonie nic nie zmienia.',
            'Typy innych są zakryte do blokady. Wcześniej widać tylko, kto już wytypował.',
            'Zapis jest automatyczny. Do blokady typ możesz zmieniać, a wyczyszczenie obu pól usuwa typ.',
            'Typ to dwie liczby 0–75. Brak typu = 0 pkt.',
            `Po włączeniu powiadomień dostaniesz przypomnienie ${remind} przed blokadą, jeśli nie masz typu.`
        ] },
        { icon: '🎯', title: 'Punkty za mecz', scoring: true, items: [
            `Przykład przy wyniku 46:44: typ 46:44 → ${b(s.exact)} · ${near} → ${b(s.diff)} · 54:36 → ${b(s.winner)} · 44:46 → ${b(0)}.`,
            tol ? `„Różnica” liczy się z tolerancją ${b(`±${tol} pkt`)}: różnica Twojego typu może się różnić od różnicy meczu najwyżej o ${tol}.` : '',
            `Remis: trafiony remis z innym wynikiem (np. 45:45 przy 44:44) = ${b(s.diff)} pkt. Typ na remis, gdy ktoś wygrał = 0 pkt.`
        ] },
        { icon: '⭐', title: 'Premie', items: [
            `${b(`Joker x${s.jokerMultiplier}`)} — raz w sezonie mnożysz dorobek z jednego meczu (razem z premią Złotego Kasku). Wymaga wpisanego typu. Można go przenosić, dopóki mecz z Jokerem nie jest zablokowany.`,
            `${b('Złoty Kask')} — wyróżniony mecz kolejki: trafienie za ${s.exact} lub ${s.diff} pkt daje ${b(`+${s.motrBonus}`)}.`,
            `Maksimum z jednego meczu: ${b(`${max} pkt`)}.`
        ] },
        { icon: '🔮', title: `Typy sezonowe (do ${s.longTermEach * 3} pkt)`, items: [
            `Mistrz Polski, brązowy medalista i spadkowicz — po ${b(`+${s.longTermEach}`)} pkt za każde trafienie.`,
            'Trzy różne drużyny. Typujesz do blokady pierwszego meczu sezonu — potem typy wszystkich stają się widoczne.',
            'Rozliczenie po zakończeniu sezonu, według ostatecznych wyników ligi.'
        ] },
        { icon: '📊', title: 'Ranking', items: [
            'Liczą się punkty za mecze plus typy sezonowe.',
            `Przy równej liczbie punktów wyżej jest ten, kto ma ${b('więcej dokładnych trafień')}, a potem ${b('więcej trafień „zwycięzca + różnica”')}. Pełny remis = ex aequo.`,
            'Mecze play-off (np. półfinały, finał) typujesz i punktujesz jak każde inne.',
            'Zwycięzca kolejki: najwięcej punktów w kolejce (przy remisie — kilku zwycięzców). Ostateczny po rozliczeniu całej kolejki.'
        ] },
        { icon: '🏆', title: 'Puchar Typerów', items: [
            'Pary według rankingu: 1. z ostatnim, 2. z przedostatnim…',
            'Wygrywa ten, kto w wyznaczonej kolejce zdobędzie więcej punktów (z Jokerem i Kaskiem). Rozstrzygnięcie po rozliczeniu całej kolejki.',
            `Remis: więcej dokładnych trafień w tej kolejce, potem ${b('mniejsza łączna pomyłka')} (suma różnic między typami a wynikami, mecz bez typu = 90), a gdy i to równe — ${b('wyżej rozstawiony')}.`
        ] },
        { icon: '🌧️', title: 'Sytuacje żużlowe', items: [
            `Mecz przełożony ${b('przed')} blokadą — typy zostają i możesz je zmieniać do nowej blokady (także gdy nowy termin jeszcze nie jest znany).`,
            `Mecz przełożony ${b('po')} blokadzie (np. deszcz w dniu meczu) — typy były już jawne, więc zostają zamrożone do nowego terminu.`,
            'Mecz przerwany po co najmniej 8 biegach — liczy się wynik zaliczony przez ligę. Przerwany wcześniej — traktujemy jak przełożony.',
            'Walkower albo mecz odwołany — typy anulowane (nikt nie dostaje punktów), a Joker wraca do gracza. Dotyczy też walkowera przyznanego później, np. po proteście.',
            'Tabela ligi: 2 pkt za zwycięstwo, 1 za remis, +1 za wygrany dwumecz (suma małych punktów z obu meczów). Play-off nie wlicza się do tabeli.'
        ] },
        { icon: '👑', title: 'Mistrz Typera', items: [
            `Zwycięzca sezonu zostaje ${b('Mistrzem Typera')}: trafia do galerii mistrzów, dostaje dyplom i niespodziankę od organizatora 🎁 (zdrapka w jego panelu). Podium dostaje medale i dyplomy.`,
            'Wyniki zatwierdza admin (także te pobrane automatycznie) — jego decyzja jest ostateczna. Mistrza ogłaszamy po zamknięciu sezonu.'
        ] }
    ];
}

function renderRules() {
    const s = D.season.scoring;
    const tol = Number(s.diffTolerance) || 0;
    const tiles = [[s.exact, 'dokładny wynik'], [s.diff, `zwycięzca + różnica${tol ? ` ±${tol}` : ''}`], [s.winner, 'zwycięzca'], [0, 'pudło']];
    document.getElementById('rules-content').innerHTML = rulesSections().map(sec => `
    <div class="rule-block ${sec.scoring ? 'md:col-span-2' : ''}">
        <h4 class="rule-title"><span aria-hidden="true">${sec.icon}</span> ${sec.title}</h4>
        ${sec.scoring ? `<div class="grid grid-cols-4 gap-2 text-center mb-3">${tiles.map(([v, t]) => `
            <div class="score-tile"><div class="led">${v}</div><div class="text-[11px] text-muted leading-tight mt-1">${t}</div></div>`).join('')}</div>` : ''}
        <ul class="rule-list">${sec.items.filter(Boolean).map(i => `<li>${i}</li>`).join('')}</ul>
    </div>`).join('');
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
