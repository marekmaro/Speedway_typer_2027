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
        const a = document.getElementById('my-panel');
        a.href = `/typuj.html?id=${encodeURIComponent(token)}`;
        a.classList.remove('hidden');
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
        `<option value="${s.year}" ${s.year === D.season.year ? 'selected' : ''}>Sezon ${s.year}${s.isFinished ? ' (archiwum)' : ''}</option>`).join('');
    document.getElementById('page-title').textContent = D.season.label || `Typer ${D.season.year}`;
    const flag = document.getElementById('season-flag');
    if (D.season.isFinished) flag.textContent = 'archiwum';
    else if (D.season.isActive) flag.textContent = 'trwa';
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
    if (!D || !el) return;
    const m = nextOpenMatch();
    if (!m) { el.textContent = '—'; info.textContent = D.matches.length ? 'Brak otwartych meczów' : 'Brak terminarza'; return; }
    el.textContent = T.countdown(T.lockTime(m, D.season.lockMinutes)) || '—';
    info.textContent = `${T.shortName(m.homeTeam)} – ${T.shortName(m.awayTeam)} · ${T.fmtDay(m.matchDate)} ${T.fmtTime(m.matchDate)}`;
}

/* ---------------- tabela ligowa ---------------- */
function renderLeagueTable() {
    const body = document.getElementById('league-table-body');
    if (!D.standings.length || !D.standings.some(t => t.matches)) {
        body.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-muted">Brak rozegranych meczów.</td></tr>';
    } else {
        body.innerHTML = D.standings.map((t, i) => `
        <tr class="border-b border-line last:border-0 ${i === 0 ? 'bg-gold/5' : ''}">
            <td class="pl-4 pr-1 py-2.5 font-bold text-muted tabular-nums">${i + 1}</td>
            <td class="px-1 py-2.5">
                <span class="flex items-center gap-2 min-w-0">${T.logoHtml(t.name)}
                    <span class="font-semibold truncate">${esc(T.shortName(t.name))}</span>
                    ${t.adjustment ? `<span class="chip-warn" title="${esc(t.adjustmentNotes.join('; '))}">${t.adjustment > 0 ? '+' : ''}${t.adjustment}</span>` : ''}
                </span>
            </td>
            <td class="px-1 py-2.5 text-center tabular-nums">${t.matches}</td>
            <td class="px-1 py-2.5 text-center tabular-nums text-muted hidden sm:table-cell">${t.bonus}</td>
            <td class="px-1 py-2.5 text-center tabular-nums text-xs ${t.diff > 0 ? 'text-ok' : t.diff < 0 ? 'text-bad' : 'text-muted'}">${t.diff > 0 ? '+' + t.diff : t.diff}</td>
            <td class="px-1 py-2.5 text-center hidden md:table-cell whitespace-nowrap">${formHtml(t.form)}</td>
            <td class="pl-1 pr-4 py-2.5 text-right font-black text-base tabular-nums">${t.points}</td>
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
        return `<button role="tab" class="round-chip" aria-current="${r === current}" onclick="changeRound(${r})" title="${esc(name)}">${esc(short)}</button>`;
    }).join('');
    const active = nav.querySelector('[aria-current="true"]');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
    document.getElementById('round-title').textContent = T.roundName(current, D.season.stageNames);
}

function teamSide(name, align) {
    return `<div class="flex flex-col items-center gap-1.5 min-w-0 flex-1 ${align}">
        ${T.logoHtml(name, 'team-logo-lg')}
        <span class="text-sm font-bold leading-tight text-center break-words">${esc(T.shortName(name))}</span>
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

        const rows = preds.map(p => {
            const typ = p.hidden ? '<span class="text-faint">🔒</span>' : `<span class="font-mono font-bold tabular-nums">${p.homePred}:${p.awayPred}</span>`;
            const joker = p.usedJoker ? '<span class="chip-gold">JOKER</span>' : '';
            const pts = p.pointsEarned !== null && p.pointsEarned !== undefined
                ? `<span class="chip ${p.pointsEarned > 0 ? 'chip-ok' : 'chip-muted'} tabular-nums">+${p.pointsEarned}</span>` : '';
            return `<li class="flex items-center gap-2 py-1.5">
                <a href="/gracz.html?nick=${encodeURIComponent(p.nickname)}${seasonParam ? `&season=${seasonParam}` : ''}" class="flex-1 truncate font-semibold hover:text-brand">${esc(p.nickname)}</a>
                ${joker}${typ}<span class="w-10 text-right">${pts}</span>
            </li>`;
        }).join('');

        const score = T.hasResult(match)
            ? `<div class="text-3xl font-black tabular-nums tracking-tight">${match.homeScore}<span class="text-faint mx-0.5">:</span>${match.awayScore}</div>`
            : `<div class="text-center"><div class="text-lg font-black">${T.fmtTime(match.matchDate)}</div><div class="text-[11px] text-muted font-semibold">${T.fmtDay(match.matchDate)}</div></div>`;

        return `
        <article class="card overflow-hidden ${match.isMatchOfTheRound ? 'ring-2 ring-gold/60' : ''}">
            <div class="flex items-center justify-between gap-2 px-4 pt-3">
                <span class="${st.cls}">${esc(st.text)}</span>
                ${match.isMatchOfTheRound ? '<span class="chip-gold">⭐ Złoty Kask +1</span>' : ''}
            </div>
            <div class="flex items-center gap-2 px-4 py-4">
                ${teamSide(match.homeTeam, '')}
                <div class="shrink-0 px-1">${score}</div>
                ${teamSide(match.awayTeam, '')}
            </div>
            ${match.originalDate ? `<p class="px-4 -mt-2 mb-2 text-xs text-muted text-center">Przełożony z ${T.fmtDateTime(match.originalDate)}</p>` : ''}
            ${match.note ? `<p class="px-4 -mt-1 mb-3 text-xs text-muted text-center italic">${esc(match.note)}</p>` : ''}
            ${preds.length ? `
            <details class="border-t border-line group" ${T.hasResult(match) ? 'open' : ''}>
                <summary class="px-4 py-2.5 flex items-center justify-between cursor-pointer list-none text-sm font-bold text-muted">
                    <span>Typy (${preds.length})${hidden ? ' · ukryte do blokady' : ''}</span>
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
    if (!D.ranking.length) { list.innerHTML = '<li class="p-6 text-center text-muted">Brak graczy w tym sezonie.</li>'; return; }
    const medal = p => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : p);
    const trend = t => t > 0 ? `<span class="text-ok text-xs font-bold" title="awans o ${t}">▲${t}</span>`
        : t < 0 ? `<span class="text-bad text-xs font-bold" title="spadek o ${-t}">▼${-t}</span>` : '';
    list.innerHTML = D.ranking.map(p => `
        <li>
            <a href="/gracz.html?nick=${encodeURIComponent(p.nickname)}${seasonParam ? `&season=${seasonParam}` : ''}"
               class="flex items-center gap-3 px-4 py-3 hover:bg-raised active:bg-raised">
                <span class="w-8 text-center text-lg font-black tabular-nums ${p.position > 3 ? 'text-muted text-base' : ''}">${medal(p.position)}</span>
                <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-2"><span class="font-bold truncate">${esc(p.nickname)}</span>${trend(p.trend)}
                        ${p.jokerUsed ? `<span class="chip-gold" title="Joker">⭐ ${p.jokerPoints}</span>` : ''}</span>
                    <span class="block text-xs text-muted tabular-nums">
                        🎯 ${p.perfects} · ${D.season.scoring.diff} pkt: ${p.diffs} · ${D.season.scoring.winner} pkt: ${p.winners} · śr. ${p.avgPerMatch}
                        ${p.longTermPoints ? ` · sezon +${p.longTermPoints}` : ''}
                    </span>
                </span>
                <span class="text-2xl font-black tabular-nums">${p.points}</span>
            </a>
        </li>`).join('');
}

function renderRoundWinners() {
    const box = document.getElementById('round-winners');
    if (!D.roundWinners.length) { box.innerHTML = '<p class="text-sm text-muted">Jeszcze nie rozegrano żadnej kolejki.</p>'; return; }
    box.innerHTML = D.roundWinners.slice().reverse().map(r => `
        <div class="shrink-0 snap-start rounded-xl border border-gold/30 bg-gold/5 px-3 py-2 min-w-[8rem]">
            <div class="eyebrow">${esc(T.roundName(r.round, D.season.stageNames))}</div>
            <div class="font-bold">${esc(r.winners.join(', '))}</div>
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
        <span class="truncate ${actual && team === actual ? 'font-bold text-ok' : ''}">${esc(team ? T.shortName(team) : '—')}</span></div>`;
    box.innerHTML = D.longTerms.map(lt => `
        <div class="rounded-xl border border-line bg-raised p-3 space-y-1">
            <div class="flex items-center justify-between"><strong>${esc(lt.nickname)}</strong>
                ${lt.pointsEarned ? `<span class="chip-ok">+${lt.pointsEarned}</span>` : ''}</div>
            ${row('🥇', lt.champion, res.champion)}${row('🥉', lt.bronze, res.bronze)}${row('⬇️', lt.relegation, res.relegation)}
        </div>`).join('');
}

function renderCup() {
    const box = document.getElementById('cup-container');
    if (!D.cupMatches.length) { box.innerHTML = '<p class="text-sm text-muted sm:col-span-2 text-center py-6">Drabinka pucharowa jest pusta.</p>'; return; }
    box.innerHTML = D.cupMatches.map(c => {
        const done = c.score1 !== null && c.score2 !== null;
        const w1 = done && c.score1 > c.score2, w2 = done && c.score2 > c.score1;
        return `
        <div class="card card-pad">
            <div class="eyebrow text-center mb-3">${esc(String(c.stage))}${c.roundNumber ? ` · ${esc(T.roundName(c.roundNumber, D.season.stageNames))}` : ''}</div>
            <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div class="text-right font-bold truncate ${w1 ? 'text-ok' : ''}">${w1 ? '👑 ' : ''}${esc(c.player1)}</div>
                <div class="rounded-lg bg-raised border border-line px-3 py-1 font-black tabular-nums">${done ? `${c.score1}:${c.score2}` : '–:–'}</div>
                <div class="font-bold truncate ${w2 ? 'text-ok' : ''}">${esc(c.player2)}${w2 ? ' 👑' : ''}</div>
            </div>
        </div>`;
    }).join('');
}

/* ---------------- więcej: H2H, all-time, terminarz, regulamin ---------------- */
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
        <div class="grid grid-cols-3 text-center">
            <div><div class="text-3xl font-black tabular-nums">${h.winsA}</div><div class="text-xs text-muted">wygrane ${esc(a)}</div></div>
            <div><div class="text-3xl font-black tabular-nums text-muted">${h.draws}</div><div class="text-xs text-muted">remisy</div></div>
            <div><div class="text-3xl font-black tabular-nums">${h.winsB}</div><div class="text-xs text-muted">wygrane ${esc(b)}</div></div>
        </div>
        <div class="flex h-2 rounded-full overflow-hidden mt-3 gap-0.5" role="img" aria-label="Bilans ${h.winsA}-${h.draws}-${h.winsB}">
            <span class="bg-ink" style="width:${pct(h.winsA)}"></span><span class="bg-line" style="width:${pct(h.draws)}"></span><span class="bg-brand" style="width:${pct(h.winsB)}"></span>
        </div>
        <p class="text-sm text-muted mt-3 text-center">Punkty w ${h.matches} wspólnych meczach: <strong class="text-ink">${h.pointsA}</strong> – <strong class="text-ink">${h.pointsB}</strong> · dokładne trafienia ${h.exactA} – ${h.exactB}</p>
        <ul class="mt-3 text-sm divide-y divide-line max-h-72 overflow-y-auto">
            ${h.rows.slice(0, 30).map(r => `<li class="py-2 flex items-center gap-2">
                <span class="flex-1 min-w-0 truncate">${esc(T.shortName(r.homeTeam))} – ${esc(T.shortName(r.awayTeam))} <span class="text-muted tabular-nums">${r.homeScore}:${r.awayScore}</span></span>
                <span class="tabular-nums ${r.a.points > r.b.points ? 'font-black' : 'text-muted'}">${r.a.homePred}:${r.a.awayPred} (+${r.a.points})</span>
                <span class="tabular-nums ${r.b.points > r.a.points ? 'font-black' : 'text-muted'}">${r.b.homePred}:${r.b.awayPred} (+${r.b.points})</span>
            </li>`).join('')}
        </ul>`;
    } catch (e) { box.innerHTML = `<p class="text-sm text-bad">${esc(e.message)}</p>`; }
}

async function loadAllTime() {
    const list = document.getElementById('alltime-list');
    try {
        const data = await T.getJson('/api/public/alltime');
        allTimeLoaded = true;
        if (!data.ranking.length) { list.innerHTML = '<li class="p-4 text-sm text-muted">Brak rozliczonych typów.</li>'; return; }
        list.innerHTML = data.ranking.map(p => `
            <li class="flex items-center gap-3 px-4 py-3">
                <span class="w-6 text-center font-black text-muted tabular-nums">${p.position}</span>
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
                <span class="text-center tabular-nums font-bold ${T.hasResult(m) ? '' : 'text-muted text-xs font-semibold'}">${T.hasResult(m) ? `${m.homeScore}:${m.awayScore}` : `${T.fmtDay(m.matchDate)} ${T.fmtTime(m.matchDate)}`}</span>
                <span class="truncate">${esc(T.shortName(m.awayTeam))}</span>
            </li>`).join('');
        return `<div><h4 class="eyebrow mb-1">${esc(T.roundName(r, D.season.stageNames))}</h4><ul class="divide-y divide-line">${rows}</ul></div>`;
    }).join('');
}

function renderRules() {
    const s = D.season.scoring;
    const lock = T.lockLabel(D.season.lockMinutes);
    const h = (t) => `<h4 class="font-extrabold text-base mb-1.5">${t}</h4>`;
    const ul = items => `<ul class="list-disc pl-5 space-y-1 text-muted">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
    document.getElementById('rules-content').innerHTML = `
    <div>${h('🕒 Zgłaszanie typów')}${ul([
        `Typujesz przez swój prywatny link (najlepiej dodany do ekranu głównego telefonu) — najpóźniej <strong class="text-ink">${lock} przed pierwszym biegiem</strong>.`,
        'Blokadę sprawdza serwer, nie przeglądarka. Typy innych są zakryte do momentu blokady.',
        'Zapis jest automatyczny po wpisaniu wyniku.'
    ])}</div>
    <div>${h('🎯 Punktacja')}
        <div class="grid grid-cols-4 gap-2 text-center">
            <div class="rounded-xl bg-raised p-2"><div class="text-xl font-black">${s.exact}</div><div class="text-[11px] text-muted">dokładny wynik</div></div>
            <div class="rounded-xl bg-raised p-2"><div class="text-xl font-black">${s.diff}</div><div class="text-[11px] text-muted">zwycięzca + różnica</div></div>
            <div class="rounded-xl bg-raised p-2"><div class="text-xl font-black">${s.winner}</div><div class="text-[11px] text-muted">zwycięzca</div></div>
            <div class="rounded-xl bg-raised p-2"><div class="text-xl font-black">0</div><div class="text-[11px] text-muted">pudło</div></div>
        </div></div>
    <div>${h('⭐ Premie')}${ul([
        `<strong class="text-ink">Joker (x${s.jokerMultiplier})</strong> — raz w sezonie mnożysz dorobek z jednego meczu. Można go przenosić, dopóki wybrany mecz nie jest zablokowany.`,
        `<strong class="text-ink">Złoty Kask</strong> — w wyróżnionym meczu kolejki trafienie za ${s.exact} lub ${s.diff} pkt daje <strong class="text-ink">+${s.motrBonus}</strong>.`,
        `Maksimum z jednego meczu: <strong class="text-ink">${(s.exact + s.motrBonus) * s.jokerMultiplier} pkt</strong>.`
    ])}</div>
    <div>${h(`🔮 Typy sezonowe (do ${s.longTermEach * 3} pkt)`)}${ul([
        `Mistrz Polski, brązowy medalista i spadkowicz — po +${s.longTermEach} pkt.`,
        'Typujesz przed pierwszym meczem sezonu.'
    ])}</div>
    <div>${h('🏆 Puchar Typerów')}${ul([
        'Pary rozstawiane według rankingu (1 vs ostatni itd.).',
        'Wygrywa ten, kto w wyznaczonej kolejce zdobędzie więcej punktów.'
    ])}</div>
    <div>${h('🌧️ Sytuacje żużlowe')}${ul([
        'Mecz przełożony <strong class="text-ink">przed</strong> blokadą: typy zostają i możesz je zmieniać do nowej blokady.',
        'Mecz przełożony <strong class="text-ink">po</strong> blokadzie (np. deszcz w dniu meczu): typy były już jawne, więc zostają zamrożone do nowego terminu.',
        'Mecz przerwany po co najmniej 8 biegach: liczy się wynik zatwierdzony przez ligę.',
        'Walkower lub mecz odwołany na stałe: typy są anulowane, a Joker wraca do gracza.',
        'Remis w rankingu rozstrzyga liczba dokładnych trafień, potem trafień różnicy.',
        'Wyniki zatwierdza admin (także te pobrane automatycznie) — jego decyzja jest ostateczna.'
    ])}</div>`;
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
