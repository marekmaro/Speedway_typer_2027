/* Strona główna typera. Cała matematyka (tabela, ranking, punkty) przychodzi
   z serwera - frontend tylko rysuje. */

let D = null;              // ostatnie dane z /api/public/data
let selectedRound = null;  // null = automatycznie najbliższa kolejka
let seasonParam = new URLSearchParams(location.search).get('season');

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    document.getElementById('season-select').addEventListener('change', e => {
        seasonParam = e.target.value;
        selectedRound = null;
        history.replaceState(null, '', `?season=${seasonParam}`);
        load();
    });
    load();
    setInterval(updateCountdown, 1000);
    setInterval(load, 120000); // odświeżanie w tle co 2 minuty
});

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(tabId).classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach(b => {
        const on = b.dataset.tab === tabId;
        b.classList.toggle('bg-blue-700', on);
        b.classList.toggle('text-white', on);
        b.classList.toggle('bg-gray-200', !on);
        b.classList.toggle('text-gray-700', !on);
    });
}

async function load() {
    try {
        D = await T.getJson('/api/public/data' + (seasonParam ? `?season=${seasonParam}` : ''));
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
        updateCountdown();
    } catch (err) {
        document.getElementById('matches-container').innerHTML =
            `<p class="text-red-600 font-bold p-4">Nie udało się pobrać danych: ${T.escapeHtml(err.message)}</p>`;
    }
}

/* ---------------- nagłówek / sezony ---------------- */
function renderSeasonPicker() {
    const sel = document.getElementById('season-select');
    sel.innerHTML = D.seasons.map(s =>
        `<option value="${s.year}" ${s.year === D.season.year ? 'selected' : ''}>${T.escapeHtml(s.label)}</option>`).join('');
    document.getElementById('page-title').textContent = D.season.label || `Typer ${D.season.year}`;
    const flag = document.getElementById('season-flag');
    if (D.season.isFinished) { flag.textContent = 'ARCHIWUM'; flag.className = 'text-[10px] font-bold px-2 py-1 rounded bg-gray-500/60'; }
    else if (D.season.isActive) { flag.textContent = 'TRWA'; flag.className = 'text-[10px] font-bold px-2 py-1 rounded bg-green-500/80'; }
    else { flag.textContent = 'PRZYGOTOWANIE'; flag.className = 'text-[10px] font-bold px-2 py-1 rounded bg-yellow-500/80'; }

    document.getElementById('season-empty').classList.toggle('hidden', D.matches.length > 0);
}

function nextMatch() {
    const now = Date.now();
    return D.matches
        .filter(m => !m.isPostponed && m.homeScore === null && new Date(m.matchDate).getTime() > now)
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))[0] || null;
}

function updateCountdown() {
    const el = document.getElementById('countdown-timer');
    const info = document.getElementById('countdown-match');
    if (!D || !el) return;
    const m = nextMatch();
    if (!m) { el.textContent = '—'; info.textContent = D.matches.length ? 'Koniec sezonu' : 'Brak terminarza'; return; }
    const left = T.countdown(T.lockTime(m, D.season.lockHours));
    el.innerHTML = left ? left : '<span class="text-red-400 text-lg">TYPY ZABLOKOWANE</span>';
    info.textContent = `${T.shortName(m.homeTeam)} – ${T.shortName(m.awayTeam)} · ${T.fmtDateTime(m.matchDate)}`;
}

/* ---------------- tabela ligowa ---------------- */
function renderLeagueTable() {
    const body = document.getElementById('league-table-body');
    if (!D.standings.length) {
        body.innerHTML = '<tr><td colspan="7" class="py-6 text-center italic text-gray-500">Brak rozegranych meczów.</td></tr>';
        return;
    }
    body.innerHTML = D.standings.map((t, i) => `
        <tr class="border-b hover:bg-gray-50">
            <td class="px-2 py-2 font-bold text-gray-500">${i + 1}.</td>
            <td class="px-2 py-2 font-semibold">
                <span class="flex items-center gap-2">${T.logoHtml(t.name)}<span class="truncate">${T.escapeHtml(T.shortName(t.name))}</span></span>
            </td>
            <td class="px-2 py-2 text-center">${t.matches}</td>
            <td class="px-2 py-2 text-center font-extrabold text-blue-800">${t.points}</td>
            <td class="px-2 py-2 text-center hidden sm:table-cell text-xs text-gray-500">${t.bonus}</td>
            <td class="px-2 py-2 text-center hidden md:table-cell text-xs">${t.diff > 0 ? '+' + t.diff : t.diff}</td>
            <td class="px-2 py-2 text-center hidden md:table-cell whitespace-nowrap">${formHtml(t.form)}</td>
        </tr>`).join('');
}

function formHtml(form) {
    const map = { W: ['form-w', 'Z'], L: ['form-l', 'P'], D: ['form-d', 'R'] };
    const cells = [...form];
    while (cells.length < 5) cells.unshift(null);
    return cells.map(f => {
        if (!f) return '<span class="form-circle form-none">-</span>';
        const [cls, label] = map[f];
        return `<span class="form-circle ${cls}">${label}</span>`;
    }).join('');
}

/* ---------------- terminarz bieżącej kolejki ---------------- */
function availableRounds() {
    return [...new Set(D.matches.map(m => m.round))].sort((a, b) => a - b);
}

function activeRound() {
    const pending = D.matches.filter(m => m.homeScore === null && !m.isPostponed)
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
    const idx = rounds.indexOf(current);
    const prev = idx > 0 ? rounds[idx - 1] : null;
    const next = idx >= 0 && idx < rounds.length - 1 ? rounds[idx + 1] : null;

    nav.innerHTML = `
        <button onclick="changeRound(${prev})" class="px-3 py-1.5 bg-blue-600 text-white rounded shadow-sm text-xs font-bold hover:bg-blue-700 disabled:bg-gray-300" ${prev ? '' : 'disabled'}>&laquo; Poprzednia</button>
        <div class="text-center">
            <div class="font-extrabold text-blue-900 tracking-wider uppercase text-sm">${T.escapeHtml(T.roundName(current, D.season.stageNames))}</div>
            <select onchange="changeRound(Number(this.value))" class="mt-1 text-[11px] border rounded px-1 py-0.5 bg-white">
                ${rounds.map(r => `<option value="${r}" ${r === current ? 'selected' : ''}>${T.escapeHtml(T.roundName(r, D.season.stageNames))}</option>`).join('')}
            </select>
        </div>
        <button onclick="changeRound(${next})" class="px-3 py-1.5 bg-blue-600 text-white rounded shadow-sm text-xs font-bold hover:bg-blue-700 disabled:bg-gray-300" ${next ? '' : 'disabled'}>Następna &raquo;</button>`;
}

function renderMatches() {
    const container = document.getElementById('matches-container');
    if (!D.matches.length) { container.innerHTML = ''; return; }
    const current = selectedRound || activeRound();
    const matches = D.matches.filter(m => m.round === current)
        .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate));

    container.innerHTML = matches.map(match => {
        const locked = T.isLocked(match, D.season.lockHours);
        const preds = D.predictions.filter(p => p.matchId === match._id)
            .sort((a, b) => (b.pointsEarned || 0) - (a.pointsEarned || 0) || a.nickname.localeCompare(b.nickname, 'pl'));

        const rows = preds.map(p => {
            const text = p.hidden ? '🔒 <span class="text-gray-400 italic">ukryty</span>' : `${p.homePred}:${p.awayPred}`;
            const joker = p.usedJoker ? '<span class="ml-1 text-[9px] bg-yellow-100 text-yellow-700 px-1 rounded font-bold border border-yellow-300">JOKER</span>' : '';
            const badge = p.pointsEarned !== null && p.pointsEarned !== undefined
                ? `<span class="font-bold px-1.5 py-0.5 rounded border text-[10px] ${p.pointsEarned > 0 ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-50 text-red-500 border-red-100'}">+${p.pointsEarned} pkt</span>`
                : '';
            return `<li class="flex items-center bg-white p-1 rounded shadow-sm border border-gray-50">
                <span class="font-bold text-blue-900 w-1/3 truncate pr-2">${T.escapeHtml(p.nickname)}</span>
                <span class="w-1/3 text-center font-mono font-semibold">${text}${joker}</span>
                <span class="w-1/3 flex justify-end">${badge}</span>
            </li>`;
        }).join('');

        return `
        <div class="border rounded-lg p-4 shadow-sm bg-white ${match.isMatchOfTheRound ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200'}">
            <div class="text-xs text-gray-500 mb-2 pb-2 border-b flex justify-between items-center gap-2">
                <span>${T.fmtDay(match.matchDate)} · ${new Date(match.matchDate).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>
                <span class="flex items-center gap-1">
                    ${match.isMatchOfTheRound ? '<span class="gold-helmet">ZŁOTY KASK +1</span>' : ''}
                    ${match.isPostponed ? '<span class="text-red-500 font-bold">ODWOŁANY</span>' : ''}
                    ${!locked && !match.isPostponed ? '<span class="text-green-600 font-bold">OTWARTY</span>' : ''}
                </span>
            </div>
            <div class="flex justify-between items-center text-sm md:text-base font-bold text-gray-800 mb-1">
                <div class="w-5/12 text-right flex items-center justify-end gap-2">
                    <span class="truncate">${T.escapeHtml(T.shortName(match.homeTeam))}</span>${T.logoHtml(match.homeTeam, 'team-logo-lg')}
                </div>
                <div class="w-2/12 text-center text-lg bg-gray-100 rounded px-1 py-1 text-blue-900 font-extrabold border border-gray-200">
                    ${match.homeScore !== null ? `${match.homeScore}:${match.awayScore}` : 'vs'}
                </div>
                <div class="w-5/12 text-left flex items-center justify-start gap-2">
                    ${T.logoHtml(match.awayTeam, 'team-logo-lg')}<span class="truncate">${T.escapeHtml(T.shortName(match.awayTeam))}</span>
                </div>
            </div>
            ${match.note ? `<p class="text-[10px] text-center text-gray-500 italic">${T.escapeHtml(match.note)}</p>` : ''}
            ${preds.length ? `<div class="bg-gray-50 p-2 rounded text-xs mt-3 border border-gray-100">
                <h4 class="font-bold mb-1 text-gray-600 border-b pb-1">Typy (${preds.length})</h4>
                <ul class="space-y-1 mt-1">${rows}</ul></div>`
            : '<p class="text-[11px] text-center text-gray-400 italic mt-3">Nikt jeszcze nie wytypował.</p>'}
        </div>`;
    }).join('');
}

/* ---------------- ranking typerów ---------------- */
function renderRanking() {
    const body = document.getElementById('player-stats-body');
    if (!D.ranking.length) {
        body.innerHTML = '<tr><td colspan="10" class="text-center py-6 italic text-gray-500">Brak graczy w tym sezonie.</td></tr>';
        return;
    }
    const medal = p => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : `${p}.`);
    body.innerHTML = D.ranking.map(p => `
        <tr class="border-b hover:bg-gray-50 ${p.position <= 3 ? 'rank-' + p.position : ''}">
            <td class="px-3 py-3 font-bold">${medal(p.position)}</td>
            <td class="px-3 py-3 font-bold text-gray-800">${T.escapeHtml(p.nickname)}
                ${p.longTermPoints ? `<span class="ml-1 text-[9px] bg-purple-100 text-purple-700 px-1 rounded font-bold">+${p.longTermPoints} LT</span>` : ''}
            </td>
            <td class="px-3 py-3 text-center font-extrabold text-blue-800 text-lg">${p.points}</td>
            <td class="px-3 py-3 text-center font-bold text-green-600">${p.perfects}</td>
            <td class="px-3 py-3 text-center font-bold text-blue-500">${p.diffs}</td>
            <td class="px-3 py-3 text-center hidden sm:table-cell text-yellow-600 font-bold">${p.winners}</td>
            <td class="px-3 py-3 text-center hidden md:table-cell">${p.avgPerMatch}</td>
            <td class="px-3 py-3 text-center hidden md:table-cell">${p.hitRate}%</td>
            <td class="px-3 py-3 text-center hidden lg:table-cell">${p.jokerUsed ? `⭐ ${p.jokerPoints} pkt` : '<span class="text-gray-300">—</span>'}</td>
            <td class="px-3 py-3 text-center hidden lg:table-cell text-xs">${p.bestRound.round ? `R${p.bestRound.round} (${p.bestRound.points})` : '—'}</td>
        </tr>`).join('');
}

function renderRoundWinners() {
    const box = document.getElementById('round-winners');
    if (!D.roundWinners.length) { box.innerHTML = '<p class="text-gray-500 italic">Jeszcze nie rozegrano żadnej kolejki.</p>'; return; }
    box.innerHTML = D.roundWinners.map(r => `
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
            <div class="text-[10px] uppercase font-bold text-yellow-700">${T.escapeHtml(T.roundName(r.round, D.season.stageNames))}</div>
            <div class="font-bold text-gray-800">${T.escapeHtml(r.winners.join(', '))}</div>
            <div class="text-[10px] text-gray-500">${r.points} pkt</div>
        </div>`).join('');
}

function renderLongTerm() {
    const box = document.getElementById('longterm-container');
    if (!D.longTerms.length) { box.innerHTML = '<p class="text-gray-500 italic">Brak zgłoszonych typów.</p>'; return; }
    if (D.longTermOpen) {
        box.innerHTML = `<div class="md:col-span-3 bg-blue-50 border border-blue-200 p-4 rounded text-sm text-blue-900">
            🔒 Typy sezonowe są zakryte do startu sezonu. Zgłosili je już: <strong>${D.longTerms.map(l => T.escapeHtml(l.nickname)).join(', ')}</strong>.</div>`;
        return;
    }
    const row = (icon, team) => `<p class="flex items-center gap-2 mb-1"><span class="w-4">${icon}</span>${team ? T.logoHtml(team, 'w-4 h-4 object-contain') : ''}
        <span class="text-xs font-bold">${T.escapeHtml(team ? T.shortName(team) : '—')}</span></p>`;
    box.innerHTML = D.longTerms.map(lt => `
        <div class="bg-gray-50 p-3 rounded border border-gray-200 shadow-sm">
            <strong class="text-blue-900 block mb-2 border-b pb-1">${T.escapeHtml(lt.nickname)}</strong>
            ${row('🥇', lt.champion)}${row('🥉', lt.bronze)}${row('⬇️', lt.relegation)}
            ${lt.pointsEarned ? `<span class="text-green-600 font-bold block mt-1">✔ +${lt.pointsEarned} pkt</span>` : ''}
        </div>`).join('');
}

function renderCup() {
    const box = document.getElementById('cup-container');
    if (!D.cupMatches.length) {
        box.innerHTML = '<p class="text-gray-500 italic md:col-span-2 text-center">Drabinka pucharowa jest pusta.</p>';
        return;
    }
    box.innerHTML = D.cupMatches.map(c => {
        const done = c.score1 !== null && c.score2 !== null;
        const w1 = done && c.score1 > c.score2, w2 = done && c.score2 > c.score1;
        return `
        <div class="bg-blue-50 border border-blue-200 p-4 rounded-lg shadow-sm">
            <div class="text-center text-xs text-blue-800 font-bold mb-3 border-b border-blue-200 pb-1">
                ${T.escapeHtml(String(c.stage).toUpperCase())}${c.roundNumber ? ` · ${T.escapeHtml(T.roundName(c.roundNumber, D.season.stageNames))}` : ''}
            </div>
            <div class="flex justify-between items-center text-base md:text-lg">
                <div class="w-2/5 text-right font-bold truncate ${w1 ? 'text-green-700' : ''}">${w1 ? '👑 ' : ''}${T.escapeHtml(c.player1)}</div>
                <div class="w-1/5 text-center bg-white border border-gray-300 rounded font-mono font-bold mx-2">${done ? `${c.score1}:${c.score2}` : '– : –'}</div>
                <div class="w-2/5 text-left font-bold truncate ${w2 ? 'text-green-700' : ''}">${T.escapeHtml(c.player2)}${w2 ? ' 👑' : ''}</div>
            </div>
        </div>`;
    }).join('');
}

function renderFullSchedule() {
    const box = document.getElementById('full-schedule');
    if (!D.matches.length) { box.innerHTML = '<p class="text-gray-500 italic">Terminarz nie został jeszcze wgrany.</p>'; return; }
    box.innerHTML = availableRounds().map(r => {
        const rows = D.matches.filter(m => m.round === r)
            .sort((a, b) => new Date(a.matchDate) - new Date(b.matchDate))
            .map(m => `
            <div class="flex justify-between items-center bg-white p-2 rounded border border-gray-100 gap-2">
                <div class="w-2/5 flex items-center justify-end gap-2 font-semibold text-gray-700 text-xs md:text-sm text-right">
                    <span class="truncate">${T.escapeHtml(T.shortName(m.homeTeam))}</span>${T.logoHtml(m.homeTeam)}
                </div>
                <div class="w-1/5 text-center font-extrabold ${m.homeScore !== null ? 'text-blue-800 bg-gray-100 rounded' : 'text-gray-300'}">
                    ${m.homeScore !== null ? `${m.homeScore}:${m.awayScore}` : T.fmtDay(m.matchDate)}
                </div>
                <div class="w-2/5 flex items-center justify-start gap-2 font-semibold text-gray-700 text-xs md:text-sm">
                    ${T.logoHtml(m.awayTeam)}<span class="truncate">${T.escapeHtml(T.shortName(m.awayTeam))}</span>
                </div>
            </div>`).join('');
        return `<div class="bg-gray-50 p-4 rounded border-l-4 border-blue-600 shadow-sm">
            <h3 class="font-bold text-lg text-blue-900 mb-3 text-center border-b pb-2">${T.escapeHtml(T.roundName(r, D.season.stageNames))}</h3>
            <div class="space-y-2">${rows}</div>
        </div>`;
    }).join('');
}

function renderRules() {
    const s = D.season.scoring;
    const h = D.season.lockHours;
    document.getElementById('rules-content').innerHTML = `
    <div>
        <h3 class="font-bold text-xl mb-3 text-blue-800">🕒 1. Zgłaszanie typów</h3>
        <ul class="list-disc pl-6 space-y-2 text-gray-700">
            <li>Typy zapisujesz sam, przez swój prywatny link — najpóźniej <strong>${h} h przed pierwszym wyścigiem</strong> danego meczu.</li>
            <li>Po tym czasie pole typu się blokuje (blokada jest sprawdzana na serwerze, nie tylko w przeglądarce).</li>
            <li>Typy innych graczy są <strong>zakryte</strong> do momentu blokady — nikt nie podejrzy Twojego typu wcześniej.</li>
            <li>Zapis jest automatyczny: po wpisaniu wyniku panel sam wysyła typ.</li>
        </ul>
    </div>
    <div>
        <h3 class="font-bold text-xl mb-3 text-blue-800">🎯 2. Punktacja</h3>
        <div class="bg-gray-50 border-l-4 border-blue-500 p-4 rounded-r-lg space-y-2">
            <p><strong><span class="text-green-600 text-lg">${s.exact} pkt</span></strong> — dokładny wynik meczu.</p>
            <p><strong><span class="text-blue-600 text-lg">${s.diff} pkt</span></strong> — dobry zwycięzca i dokładna różnica punktowa.</p>
            <p><strong><span class="text-yellow-600 text-lg">${s.winner} pkt</span></strong> — dobry zwycięzca meczu.</p>
            <p><strong><span class="text-red-600 text-lg">0 pkt</span></strong> — pudło.</p>
        </div>
    </div>
    <div>
        <h3 class="font-bold text-xl mb-3 text-blue-800">⭐ 3. Premie</h3>
        <ul class="list-disc pl-6 space-y-2 text-gray-700">
            <li><strong>JOKER (x${s.jokerMultiplier}):</strong> raz w sezonie mnożysz dorobek z jednego meczu. Jokera można przenosić, dopóki wybrany mecz nie jest zablokowany.</li>
            <li><strong>ZŁOTY KASK:</strong> w wyróżnionym meczu kolejki trafienie ${s.exact} lub ${s.diff} pkt daje dodatkowe <strong>+${s.motrBonus} pkt</strong>.</li>
            <li>Maksymalny dorobek z jednego meczu: <strong>${(s.exact + s.motrBonus) * s.jokerMultiplier} pkt</strong> (dokładny wynik + Złoty Kask + Joker).</li>
        </ul>
    </div>
    <div>
        <h3 class="font-bold text-xl mb-3 text-blue-800">🔮 4. Zakłady długoterminowe (do ${s.longTermEach * 3} pkt)</h3>
        <ul class="list-disc pl-6 space-y-2 text-gray-700">
            <li>Mistrz Polski = +${s.longTermEach} pkt</li>
            <li>Brązowy medalista = +${s.longTermEach} pkt</li>
            <li>Drużyna spadająca = +${s.longTermEach} pkt</li>
            <li>Typujesz przed pierwszym meczem sezonu; potem pola są zamknięte.</li>
        </ul>
    </div>
    <div>
        <h3 class="font-bold text-xl mb-3 text-blue-800">🏆 5. Puchar Typerów</h3>
        <ul class="list-disc pl-6 space-y-2 text-gray-700">
            <li>Pary rozstawiane są według miejsca w rankingu (1 vs ostatni itd.).</li>
            <li>Wygrywa ten, kto w wyznaczonej kolejce zdobędzie więcej punktów meczowych.</li>
        </ul>
    </div>
    <div>
        <h3 class="font-bold text-xl mb-3 text-blue-800">⚖️ 6. Sytuacje sporne</h3>
        <ul class="list-disc pl-6 space-y-2 text-gray-700">
            <li>Mecz odwołany/przełożony: typy zostają ważne, blokada liczy się od nowej daty.</li>
            <li>Kolejność w remisie punktowym: więcej trafień dokładnych, potem trafień różnicy.</li>
            <li>Decyzja administratora jest ostateczna, ale każdą zmianę widać w historii typów.</li>
        </ul>
    </div>`;
}
