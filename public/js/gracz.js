/* Profil typera: kafelki, wykres formy (SVG bez bibliotek), droga w rankingu, H2H, historia typów. */

const params = new URLSearchParams(location.search);
const nick = params.get('nick') || '';
const season = params.get('season');
const esc = T.escapeHtml;
let P = null;

document.addEventListener('DOMContentLoaded', async () => {
    T.registerSW();
    if (!nick) return showError('Brak gracza w adresie.');
    try {
        P = await T.getJson(`/api/public/profile?nickname=${encodeURIComponent(nick)}${season ? `&season=${season}` : ''}`);
    } catch (e) { return showError(e.message); }
    document.title = `${P.nickname} — Żużlowy Typer`;
    renderHeader();
    renderTiles();
    renderAchievements();
    renderCharts();
    renderHistory();
    setupRival();
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(renderCharts, 150); });
});

function showError(msg) {
    const box = document.getElementById('g-error');
    box.textContent = msg;
    box.classList.remove('hidden');
}

function renderHeader() {
    const s = P.summary;
    document.getElementById('g-nick').textContent = P.nickname;
    document.getElementById('g-helmet').innerHTML = T.helmet(P.nickname, { size: 'xl', medal: P.medal || null });
    document.getElementById('g-season').textContent = P.season.label;
    document.getElementById('g-points').textContent = s.points;
    document.getElementById('g-pos').textContent = `pkt · ${s.position}. miejsce z ${s.totalPlayers}`;
    const medal = { 1: '🏆 Mistrz Typera', 2: '🥈 Wicemistrz', 3: '🥉 Brązowy medal' }[P.medal];
    document.getElementById('g-medal').innerHTML = medal ? `<span class="chip-gold">${medal} ${P.season.year}</span>` : '';
}

/**
 * Osiągnięcia liczone z jawnych typów i przebiegu sezonu. Zablokowane są wyszarzone -
 * żeby było widać, o co jeszcze można powalczyć.
 */
function renderAchievements() {
    const s = P.summary;
    const hist = P.history.filter(h => h.outcome).slice().sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));
    let streak = 0, best = 0;
    hist.forEach(h => { streak = h.outcome === 'miss' ? 0 : streak + 1; best = Math.max(best, streak); });
    const kask = hist.filter(h => h.isMatchOfTheRound && (h.outcome === 'exact' || h.outcome === 'diff')).length;
    const pos = P.progress.map(p => p.position);
    const jump = pos.reduce((m, p, i) => (i ? Math.max(m, pos[i - 1] - p) : m), 0);
    const wins = (P.roundWins || []).length;
    const list = [
        { icon: '🎯', name: 'Snajper', desc: 'trzy dokładne wyniki w sezonie', got: s.perfects >= 3, note: `${s.perfects}/3` },
        { icon: '👑', name: 'Zwycięzca kolejki', desc: 'najwięcej punktów w kolejce', got: wins > 0, note: wins ? `×${wins}` : '' },
        { icon: '🔥', name: 'Seria', desc: '5 typów z rzędu z dobrym zwycięzcą', got: best >= 5, note: `rekord ${best}` },
        { icon: '🃏', name: 'As w rękawie', desc: 'Joker wart co najmniej 10 pkt', got: s.jokerPoints >= 10, note: s.jokerUsed ? `+${s.jokerPoints}` : '' },
        { icon: '⭐', name: 'Złoty Kask', desc: 'premia za trafienie meczu kolejki', got: kask > 0, note: kask ? `×${kask}` : '' },
        { icon: '🚀', name: 'Rakieta', desc: 'awans o 3 miejsca w jednej kolejce', got: jump >= 3, note: jump ? `+${jump}` : '' },
        { icon: '🥇', name: 'Lider', desc: 'prowadzenie w rankingu po kolejce', got: pos.includes(1) },
        { icon: '🏆', name: 'Mistrz Typera', desc: 'wygrana całego sezonu', got: P.medal === 1 }
    ];
    document.getElementById('g-achievements').innerHTML = list.map(a => `
        <div class="ach ${a.got ? '' : 'locked'}">
            <span class="ach-icon" aria-hidden="true">${a.icon}</span>
            <span class="min-w-0 flex-1"><span class="block font-black">${a.name}</span><span class="text-xs text-muted">${a.desc}</span></span>
            ${a.note ? `<span class="chip-muted">${a.note}</span>` : ''}${a.got ? '<span class="sr-only">zdobyte</span>' : '<span class="sr-only">jeszcze nie</span>'}
        </div>`).join('');
}

function renderTiles() {
    const s = P.summary, sc = P.season.scoring;
    const tile = (label, value, sub = '') => `<div class="kpi"><div class="eyebrow">${label}</div>
        <div class="text-2xl font-black tabular-nums mt-0.5">${value}</div>${sub ? `<div class="text-xs text-muted">${sub}</div>` : ''}</div>`;
    document.getElementById('g-tiles').innerHTML = [
        tile('Dokładne', s.perfects, `po ${sc.exact} pkt`),
        tile('Zwycięzca + różnica', s.diffs, `po ${sc.diff} pkt`),
        tile('Zwycięzca', s.winners, `po ${sc.winner} pkt`),
        tile('Pudła', s.misses, `z ${s.settled} rozliczonych`),
        tile('Średnio / mecz', s.avgPerMatch),
        tile('Skuteczność', `${s.hitRate}%`, 'trafiony zwycięzca'),
        tile('Najlepsza kolejka', s.bestRound.round ? `${s.bestRound.points}` : '—', s.bestRound.round ? `R${s.bestRound.round}` : ''),
        tile('Joker', s.jokerUsed ? `+${s.jokerPoints}` : 'wolny', s.longTermPoints ? `typy sezonowe +${s.longTermPoints}` : '')
    ].join('');
}

/* ---------------- wykresy ---------------- */

const SVGNS = 'http://www.w3.org/2000/svg';
const css = name => `rgb(var(--${name}))`;

/** Okrągły koniec osi, żeby połowa też była liczbą całkowitą (0 / 5 / 10, 0 / 10 / 20). */
function niceMax(v) {
    if (v <= 10) return 10;
    return Math.ceil(v / 10) * 10;
}

/** Wspólna podpowiedź (tooltip) dla wykresów - mysz i dotyk. */
function attachTip(container, svg, columns) {
    let tip = container.querySelector('.chart-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip hidden'; container.appendChild(tip); }
    const hide = () => { tip.classList.add('hidden'); svg.querySelectorAll('[data-col]').forEach(el => el.style.opacity = ''); };
    columns.forEach(col => {
        const show = () => {
            tip.innerHTML = col.html;
            tip.classList.remove('hidden');
            const w = container.clientWidth;
            const left = Math.min(Math.max(col.cx - tip.offsetWidth / 2, 0), w - tip.offsetWidth);
            tip.style.left = `${left}px`;
            tip.style.top = `${Math.max(col.cy - tip.offsetHeight - 10, 0)}px`;
            svg.querySelectorAll('[data-col]').forEach(el => { el.style.opacity = el.dataset.col === String(col.key) ? '' : '.35'; });
        };
        col.hit.addEventListener('pointerenter', show);
        col.hit.addEventListener('pointerdown', show);
        col.hit.addEventListener('pointerleave', hide);
    });
    container.addEventListener('pointerleave', hide);
}

function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
}

function renderCharts() {
    const data = P.progress;
    ['chart-points', 'chart-position'].forEach(id => { document.getElementById(id).innerHTML = ''; });
    if (!data.length) {
        ['chart-points', 'chart-position'].forEach(id => {
            document.getElementById(id).innerHTML = '<p class="text-sm text-muted">Brak rozliczonych kolejek.</p>';
        });
        return;
    }
    pointsChart(document.getElementById('chart-points'), data);
    positionChart(document.getElementById('chart-position'), data);
}

/** Słupki: punkty w kolejce; przerywana linia: średnia ligi. Jedna seria -> bez legendy. */
function pointsChart(box, data) {
    const W = box.clientWidth || 320, H = 200;
    const m = { t: 16, r: 8, b: 26, l: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = niceMax(Math.max(...data.map(d => Math.max(d.points, d.leagueAvg || 0))));
    const band = iw / data.length;
    const bw = Math.max(4, Math.min(24, band - 4));
    const y = v => m.t + ih - (v / max) * ih;
    const x = i => m.l + band * i + band / 2;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
        'aria-label': `Punkty ${P.nickname} w kolejkach: ${data.map(d => `R${d.round} ${d.points}`).join(', ')}` });
    // siatka (dyskretna)
    const ticks = [0, max / 2, max];
    ticks.forEach(t => {
        el('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), style: `stroke:${css('line')};stroke-width:1` }, svg);
        const lbl = el('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end', style: `fill:${css('muted')};font-size:11px` }, svg);
        lbl.textContent = Math.round(t);
    });
    // słupki z zaokrągleniem 4px tylko na górze, osadzone na osi
    data.forEach((d, i) => {
        const h = Math.max(0, y(0) - y(d.points));
        const r = Math.min(4, h, bw / 2);
        const x0 = x(i) - bw / 2, y0 = y(d.points);
        const path = h > 0
            ? `M${x0},${y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${y(0)} Z`
            : `M${x0},${y(0)} H${x0 + bw}`;
        el('path', { d: path, 'data-col': d.round, style: `fill:${css('brand')};stroke:${css('brand')};stroke-width:${h > 0 ? 0 : 2}` }, svg);
        if (data.length <= 16 || i % 2 === 0) {
            const lbl = el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', style: `fill:${css('muted')};font-size:11px` }, svg);
            lbl.textContent = `R${d.round}`;
        }
    });
    // średnia ligi - linia odniesienia, opisana bezpośrednio
    const avgPts = data.map((d, i) => `${x(i)},${y(d.leagueAvg || 0)}`).join(' ');
    el('polyline', { points: avgPts, fill: 'none', style: `stroke:${css('ink')};stroke-width:2;stroke-dasharray:4 4;opacity:.55` }, svg);
    const last = data[data.length - 1];
    const avgLbl = el('text', { x: Math.min(x(data.length - 1) + 6, W - m.r), y: y(last.leagueAvg || 0) - 6, 'text-anchor': 'end', style: `fill:${css('muted')};font-size:11px;font-weight:600` }, svg);
    avgLbl.textContent = 'średnia';

    // strefy trafienia większe niż słupek (cała kolumna)
    const cols = data.map((d, i) => {
        const hit = el('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent' }, svg);
        const diff = Math.round((d.points - (d.leagueAvg || 0)) * 10) / 10;
        return {
            key: d.round, hit, cx: x(i), cy: y(Math.max(d.points, d.leagueAvg || 0)),
            html: `<strong>R${d.round}</strong> · ${d.points} pkt<br><span style="opacity:.75">średnia ${d.leagueAvg} (${diff >= 0 ? '+' : ''}${diff}) · łącznie ${d.total}</span>`
        };
    });
    box.appendChild(svg);
    attachTip(box, svg, cols);
}

/** Linia: miejsce po każdej kolejce (oś odwrócona, 1. miejsce na górze). */
function positionChart(box, data) {
    const W = box.clientWidth || 320, H = 170;
    const m = { t: 14, r: 12, b: 26, l: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const worst = Math.max(P.summary.totalPlayers, ...data.map(d => d.position));
    const y = p => m.t + ((p - 1) / Math.max(1, worst - 1)) * ih;
    const x = i => data.length === 1 ? m.l + iw / 2 : m.l + (iw * i) / (data.length - 1);

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
        'aria-label': `Miejsce ${P.nickname} po kolejkach: ${data.map(d => `R${d.round} ${d.position}.`).join(', ')}` });
    [1, Math.ceil(worst / 2), worst].filter((v, i, a) => a.indexOf(v) === i).forEach(p => {
        el('line', { x1: m.l, x2: W - m.r, y1: y(p), y2: y(p), style: `stroke:${css('line')};stroke-width:1` }, svg);
        const lbl = el('text', { x: m.l - 6, y: y(p) + 4, 'text-anchor': 'end', style: `fill:${css('muted')};font-size:11px` }, svg);
        lbl.textContent = `${p}.`;
    });
    el('polyline', { points: data.map((d, i) => `${x(i)},${y(d.position)}`).join(' '), fill: 'none',
        style: `stroke:${css('brand')};stroke-width:2;stroke-linejoin:round;stroke-linecap:round` }, svg);
    data.forEach((d, i) => {
        el('circle', { cx: x(i), cy: y(d.position), r: 4, 'data-col': d.round, style: `fill:${css('brand')};stroke:${css('surface')};stroke-width:2` }, svg);
        if (data.length <= 16 || i % 2 === 0) {
            const lbl = el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', style: `fill:${css('muted')};font-size:11px` }, svg);
            lbl.textContent = `R${d.round}`;
        }
    });
    // etykieta tylko przy ostatnim punkcie (bez liczby przy każdym)
    const last = data[data.length - 1];
    const tl = el('text', { x: x(data.length - 1) - 8, y: y(last.position) - 8, 'text-anchor': 'end', style: `fill:${css('ink')};font-size:12px;font-weight:800` }, svg);
    tl.textContent = `${last.position}.`;

    const step = data.length > 1 ? iw / (data.length - 1) : iw;
    const cols = data.map((d, i) => ({
        key: d.round, cx: x(i), cy: y(d.position),
        hit: el('rect', { x: x(i) - step / 2, y: 0, width: step, height: H, fill: 'transparent' }, svg),
        html: `<strong>Po R${d.round}</strong>: ${d.position}. miejsce<br><span style="opacity:.75">${d.total} pkt łącznie</span>`
    }));
    box.appendChild(svg);
    attachTip(box, svg, cols);
}

/* ---------------- historia i H2H ---------------- */

function renderHistory() {
    const list = document.getElementById('g-history');
    if (!P.history.length) { list.innerHTML = '<li class="p-4 text-sm text-muted">Brak jawnych typów.</li>'; return; }
    const label = { exact: ['🎯', 'text-ok'], diff: ['±', 'text-ok'], winner: ['✓', 'text-muted'], miss: ['✕', 'text-bad'] };
    list.innerHTML = P.history.map(h => {
        const [icon, cls] = label[h.outcome] || ['…', 'chip-muted'];
        const pts = h.voided ? '<span class="chip-warn">anulowany</span>'
            : h.pointsEarned === null ? '<span class="chip-muted">czeka</span>'
                : `<span class="pts-stamp ${cls}">${icon} +${h.pointsEarned}</span>`;
        return `<li class="flex items-center gap-3 px-4 py-2.5">
            <span class="text-xs text-muted w-9 shrink-0">R${h.round}</span>
            <span class="flex-1 min-w-0">
                <span class="block truncate text-sm font-semibold">${esc(T.shortName(h.homeTeam))} – ${esc(T.shortName(h.awayTeam))}</span>
                <span class="text-xs text-muted tabular-nums">typ ${h.homePred}:${h.awayPred}${h.homeScore !== null ? ` · wynik ${h.homeScore}:${h.awayScore}` : ''}${h.usedJoker ? ' · ⭐ joker' : ''}${h.isMatchOfTheRound ? ' · Kask' : ''}</span>
            </span>
            ${pts}
        </li>`;
    }).join('');
}

function setupRival() {
    const sel = document.getElementById('g-rival');
    if (!P.rivals.length) { sel.closest('section').classList.add('hidden'); return; }
    sel.innerHTML = '<option value="">— wybierz gracza —</option>' + P.rivals.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    sel.addEventListener('change', async () => {
        const box = document.getElementById('g-h2h');
        if (!sel.value) { box.innerHTML = ''; return; }
        try {
            const h = await T.getJson(`/api/public/h2h?a=${encodeURIComponent(P.nickname)}&b=${encodeURIComponent(sel.value)}&season=${P.season.year}`);
            if (!h.matches) { box.innerHTML = '<p class="text-sm text-muted">Brak wspólnych rozliczonych meczów.</p>'; return; }
            box.innerHTML = `<div class="grid grid-cols-3 text-center">
                <div><div class="text-3xl font-black tabular-nums">${h.winsA}</div><div class="text-xs text-muted">wygrane</div></div>
                <div><div class="text-3xl font-black tabular-nums text-muted">${h.draws}</div><div class="text-xs text-muted">remisy</div></div>
                <div><div class="text-3xl font-black tabular-nums">${h.winsB}</div><div class="text-xs text-muted">porażki</div></div>
            </div>
            <p class="text-sm text-muted text-center mt-2">${h.matches} wspólnych meczów · punkty ${h.pointsA} – ${h.pointsB}</p>`;
        } catch (e) { box.innerHTML = `<p class="text-sm text-bad">${esc(e.message)}</p>`; }
    });
}
