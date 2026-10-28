/* Raport z symulacji (SYMULACJA.md) - generowany przy każdym uruchomieniu `npm run symulacja`. */

const fmtDay = t => new Date(t).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short' });
const fmtDT = t => new Date(t).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const short = t => String(t).replace(/^(Orlen Oil|Betard|PRES Grupa Deweloperska|Gezet|Bayersystem|Krono-Plast|Stelmet|Fogo)\s+/, '');
const pct = v => `${v.toFixed(v < 10 ? 1 : 0)}%`;
const num = (v, d = 1) => v.toFixed(d).replace('.', ',');

function buildReport({ season, mc, seed, seasonMs, mcMs }) {
    const s = season;
    const fails = Object.values(s.inv).reduce((a, x) => a + x.fails, 0);
    const checks = Object.values(s.inv).reduce((a, x) => a + x.checks, 0);
    const byNick = Object.fromEntries(s.players.map(p => [p.nick, p]));
    const L = [];
    const out = x => L.push(x);

    out('# Symulacja ligi — Żużlowy Typer');
    out('');
    out(`Wygenerowano poleceniem \`npm run symulacja\` (seed ${seed}). Cały sezon trwał w symulacji ${(seasonMs / 1000).toFixed(1)} s, Monte Carlo ${mc ? `${mc.runs} sezonów — ${(mcMs / 1000).toFixed(1)} s` : 'pominięte'}.`);
    out('');
    out('**Jak to działa.** Symulacja uruchamia prawdziwą aplikację (`server.js`, wszystkie trasy API) na bazie w pamięci i przesuwa zegar serwera. ' +
        'Typerzy wysyłają typy tak jak telefon (`/api/public/submit-all`), admin zatwierdza wyniki ze scrapera, przekłada mecze po deszczu, wpisuje walkowery, ' +
        'rozstawia Puchar Typerów, dodaje play-off i zamyka sezon. Wyniki meczów powstają bieg po biegu (15 biegów, 3-2-1-0, upadki i defekty), ' +
        'a scraper czyta je z dwóch fikcyjnych portali (tabela całego sezonu i lista ostatnich wyników — z literówkami, opóźnieniami i awarią). ' +
        'Po każdej kolejce symulacja **niezależnie** przelicza punkty, ranking, tabelę i puchar i porównuje je z tym, co pokazuje API.');
    out('');
    out(`**Wynik: ${fails ? `❌ ${fails} niezgodności` : '✅ wszystko zgodne'}** — ${checks.toLocaleString('pl-PL')} sprawdzeń w ${s.events} zdarzeniach.`);
    out('');

    /* ---------- sezon ---------- */
    const st = s.stats;
    out('## 1. Sezon 2027 rozegrany w aplikacji');
    out('');
    out(`- **${st.saved}** zapisanych typów w **${st.submits}** zapisach, **${st.lateRejected}** typów odrzuconych po blokadzie, ${st.cleared} rezygnacji (wyczyszczone pola), ${st.adminTips} typ podany SMS-em i wpisany przez admina`);
    out(`- Joker: ${st.jokerMoves} ustawień/przeniesień, ${st.jokerRejected} odmowa przeniesienia z rozpoczętego meczu, Joker zwrócony po walkowerze`);
    out(`- Wyniki: ${st.scrapes} uruchomień scrapera, ${st.draftsCreated} wyników do zatwierdzenia, ${st.approvedAll} zatwierdzonych przyciskiem „Zatwierdź wszystkie bez uwag”, ${st.approvedManual} pojedynczo (po sprawdzeniu protokołu), ${st.manualResults} wpisanych ręcznie (brak w źródłach)`);
    out(`- Deszcz i zdarzenia: ${st.postponedBefore} przełożenia przed blokadą, ${st.postponedAfter} po blokadzie (typy zamrożone, ${st.frozenTried} nieudane próby zmiany), ${st.walkovers} walkowery (w tym jeden po proteście, już po rozliczeniu), ${st.corrections} korekta wyniku przez ligę`);
    out(`- Powiadomienia: ${st.reminders} przypomnień o brakujących typach, łącznie ${s.pushes} wiadomości push; admin logował się ${s.logins} razy (sesja wygasa po 8 h)`);
    out(`- Inne: ${st.peeks} prób podejrzenia cudzych typów przed blokadą (zawsze zakryte), ${st.pausedTried} zapisy wstrzymanego gracza (odrzucone), typy sezonowe po starcie ligi — odrzucone`);
    out('');

    out('### Tabela po rundzie zasadniczej');
    out('');
    out('| # | Drużyna | M | Pkt | Bonus | +/- |');
    out('|---|---|---|---|---|---|');
    s.apiStandings.forEach((t, i) => out(`| ${i + 1} | ${short(t.name)} | ${t.matches} | **${t.points}** | ${t.bonus} | ${t.diff > 0 ? '+' : ''}${t.diff} |`));
    out('');
    if (s.ltResults) {
        out(`**Play-off:** 🥇 Mistrz Polski **${short(s.ltResults.champion)}**, 🥉 brąz ${short(s.ltResults.bronze)}, 5. miejsce ${short(s.fifth)}, spadek ${short(s.ltResults.relegation)}.`);
        out('');
    }

    out('### Ranking typerów na koniec sezonu');
    out('');
    out('| # | Typer | Styl | Pkt | 🎯 | ± | Joker | Sezonowe |');
    out('|---|---|---|---|---|---|---|---|');
    s.ranking.forEach(r => out(`| ${r.position} | **${r.nickname}** | ${(byNick[r.nickname] || {}).desc || ''} | **${r.points}** | ${r.perfects} | ${r.diffs} | ${r.jokerUsed ? `+${r.jokerPoints}` : '—'} | ${r.longTermPoints ? `+${r.longTermPoints}` : '—'} |`));
    out('');
    if (s.finale) {
        out(`🏆 **Mistrz Typera: ${s.finale.champions.join(', ')}.** Admin zamknął sezon, mistrz dostał powiadomienie „Zostałeś Mistrzem Typera!”, ` +
            `zdrapał w swoim panelu kartę z niespodzianką („${s.PRIZE}”), a admin widzi, że ją odebrał. Pozostali gracze widzą podium, ale nie treść nagrody — ` +
            'próba odkrycia jej cudzym linkiem kończy się odmową.');
        out('');
    }

    out('### Puchar Typerów');
    out('');
    const stages = [...new Set((s.cup || []).map(c => c.stage))];
    stages.forEach(stage => {
        const rows = s.cup.filter(c => c.stage === stage);
        const why = { exact: ' (remis — więcej dokładnych)', error: ` (remis — mniejsza pomyłka)`, seed: ' (pełny remis — wyżej rozstawiony)' };
        out(`- **${stage}** (R${rows[0].roundNumber}): ${rows.map(c => `${c.winner === c.player1 ? `**${c.player1}**` : c.player1} ${c.score1}:${c.score2} ${c.winner === c.player2 ? `**${c.player2}**` : c.player2}${why[c.decidedBy] || ''}${c.decidedBy === 'error' ? ` [${c.error1}:${c.error2}]` : ''}`).join(' · ')}`);
    });
    out('');

    out('### Kolejka po kolejce');
    out('');
    out('| Kolejka | Termin | Zwycięzca kolejki | Czołówka po kolejce |');
    out('|---|---|---|---|');
    s.roundLog.forEach(r => out(`| ${r.round <= 14 ? `R${r.round}` : `R${r.round} · ${r.name}`} | ${fmtDay(r.from)}${fmtDay(r.to) !== fmtDay(r.from) ? ` – ${fmtDay(r.to)}` : ''} | ${r.winners.join(', ') || '—'} (${r.winnerPoints}) | ${r.top.join(', ')} |`));
    out('');

    out('### Dziennik sezonu');
    out('');
    s.story.forEach(e => out(`- ${fmtDT(e.at)} — ${e.text}`));
    out('');

    /* ---------- niezmienniki ---------- */
    out('## 2. Co sprawdzała symulacja');
    out('');
    out('| | Niezmiennik | Sprawdzeń | Błędy |');
    out('|---|---|---|---|');
    Object.entries(s.INV).forEach(([k, d]) => out(`| ${k} | ${d} | ${s.inv[k].checks.toLocaleString('pl-PL')} | ${s.inv[k].fails ? `❌ ${s.inv[k].fails}` : '✅ 0'} |`));
    out('');
    if (s.problems.length) {
        out('**Niezgodności:**');
        out('');
        s.problems.slice(0, 50).forEach(p => out(`- ${p}`));
        out('');
    }

    out('### Błędy, które symulacja znalazła (już naprawione)');
    out('');
    out('Pierwsze uruchomienie pokazało 9 wyników wpisanych niezgodnie z oficjalnym protokołem (niezmiennik I13) i powtarzający się w dzienniku ten sam błędny wynik do zatwierdzenia. Po naprawie wszystkie niezmienniki przechodzą:');
    out('');
    out('1. **„Zatwierdź wszystkie bez uwag” zatwierdzało też wyniki z ostrzeżeniem** (np. „źródła podają różne wyniki”) — wpisywał się błędny wynik z pierwszego portalu. Teraz ten przycisk bierze tylko wyniki bez żadnych uwag; resztę admin zatwierdza pojedynczo.');
    out('2. **W play-off scraper przypisywał nowemu meczowi stary wynik z rundy zasadniczej** — portal z tabelą całego sezonu ma oba mecze tych samych drużyn. Teraz wiersz z wynikiem znanym z innego meczu tej pary jest pomijany.');
    out('3. **Poprawiony przez admina odczyt wracał przy każdym pobraniu** (literówka portalu wracała jako nowy wynik do zatwierdzenia przez dwa tygodnie). Teraz zapamiętujemy, co odczytano ze źródła, i ten sam błędny odczyt już nie wraca.');
    out('4. Drobne: powiadomienia push skracały nazwy drużyn inaczej niż strona („Deweloperska Toruń”) — teraz jedna reguła dla serwera i przeglądarki.');
    out('5. **Zasady pucharu**: Monte Carlo pokazało, że dogrywka „dokładne trafienia → wyżej rozstawiony” oddaje rozstawieniu co trzeci pojedynek (jedna kolejka to tylko 4 mecze). Dodany krok „mniejsza łączna pomyłka” (suma różnic między typami a wynikami, mecz bez typu = 90) — regulamin na stronie zaktualizowany.');
    out('');
    out('Znane ograniczenie (bezpieczne): gdy mecz play-off kończy się **dokładnie takim samym wynikiem** jak mecz tych drużyn z rundy zasadniczej, scraper uzna wiersz za stary i nie zaproponuje wyniku — admin wpisze go ręcznie (Pulpit pokazuje mecz jako „bez wyniku”). Lepiej przeoczyć wynik niż wpisać zły.');
    out('');

    /* ---------- Monte Carlo ---------- */
    if (mc) {
        out(`## 3. Monte Carlo zasad — ${mc.runs.toLocaleString('pl-PL')} sezonów`);
        out('');
        out('Te same style typowania, te same zasady punktacji co w aplikacji (5/3/2/0, Złoty Kask +1, Joker ×2, typy sezonowe po 10 pkt), ' +
            'ale tysiące różnych sezonów. Odpowiada na pytanie, czy zasady nagradzają umiejętność, i jak często regulamin musi rozstrzygać remisy.');
        out('');
        out('| Typer | Tytuł | Podium | Puchar | Śr. pkt | Śr. miejsce | 🎯 / sezon | Pkt / typ | Joker | Kask | Sezonowe | Wygrywa z Ekspertem |');
        out('|---|---|---|---|---|---|---|---|---|---|---|---|');
        mc.per.forEach(p => out(`| **${p.nick}** | ${pct(p.titlePct)} | ${pct(p.podiumPct)} | ${pct(p.cupPct)} | ${num(p.avgPoints, 0)} | ${num(p.avgPos)} | ${num(p.avgExact)} | ${num(p.perMatch, 2)} | +${num(p.avgJoker)} | +${num(p.avgKask)} | +${num(p.avgLt)} | ${p.beatExpertPct === null ? '—' : pct(p.beatExpertPct)} |`));
        out('');
        out('**Remisy i rozstrzygnięcia**');
        out('');
        out(`- Mistrz ma średnio ${num(mc.avgWinner, 0)} pkt i ${num(mc.avgMargin)} pkt przewagi nad drugim miejscem.`);
        out(`- Równe punkty na szczycie: ${pct(mc.topTiePct)} sezonów — rozstrzygają dokładne trafienia (${pct(mc.decidedByExactPct)}), potem trafienia różnicy (${pct(mc.decidedByDiffPct)}). Dwóch mistrzów ex aequo: ${pct(mc.coChampionsPct)}.`);
        out(`- Zwycięzca kolejki ex aequo (kilku z tym samym wynikiem): ${pct(mc.roundTiePct)} kolejek.`);
        out(`- Puchar Typerów: ${pct(mc.cupPct.points)} pojedynków rozstrzygają punkty, ${pct(mc.cupPct.exact)} — dokładne trafienia, ${pct(mc.cupPct.error)} — mniejsza łączna pomyłka, ${pct(mc.cupPct.seed)} — rozstawienie (gracze z identycznymi typami).`);
        out('');
        out('**Ile znaczą premie (ten sam sezon, inne zasady)**');
        out('');
        out(`- Bez typów sezonowych mistrz byłby inny w ${pct(mc.ltChangedPct)} sezonów; przy 5 pkt zamiast 10 — w ${pct(mc.lt5ChangedPct)}.`);
        out(`- Bez Jokera — inny mistrz w ${pct(mc.jokerChangedPct)} sezonów; bez Złotego Kasku — w ${pct(mc.kaskChangedPct)}.`);
        out('');
        out('**Wnioski**');
        out('');
        const P = n => mc.per.find(p => p.nick === n);
        const best = mc.per[0], expert = P('Ekspert'), rnd = P('Losowy'), k4644 = P('Pan4644'), remis = P('Remisiarz'), late = P('Spóźnialski'), forget = P('Zapominalski');
        const skilled = ['Ekspert', 'Poprawiacz', 'Statystyk'].reduce((a, n) => a + P(n).titlePct, 0);
        out(`- **Wygrywa umiejętność.** Trzej typerzy „z głową” (Ekspert, Poprawiacz, Statystyk) zdobywają razem ${pct(skilled)} tytułów; najczęściej ${best.nick} (${pct(best.titlePct)}), Ekspert jest na podium w ${pct(expert.podiumPct)} sezonów. Losowy typer: ${pct(rnd.titlePct)} tytułów, średnio ${num(rnd.avgPoints, 0)} pkt — przypadek nie wygrywa sezonu.`);
        out(`- **Szczęście też gra rolę**: nawet Ekspert wygrywa tylko co ${Math.round(100 / Math.max(expert.titlePct, 0.1))}. sezon, a mistrz ma średnio ${num(mc.avgMargin)} pkt przewagi — kilka dobrych typów w końcówce zmienia kolejność.`);
        out(`- **„Zawsze 46:44 dla gospodarzy”** daje więcej niż losowanie (${num(k4644.avgPoints, 0)} vs ${num(rnd.avgPoints, 0)} pkt), ale do Eksperta brakuje ~${num(expert.avgPoints - k4644.avgPoints, 0)} pkt (tytuł: ${pct(k4644.titlePct)}).`);
        out(`- **Typowanie remisów się nie opłaca** (Remisiarz: ${num(remis.perMatch, 2)} pkt na typ wobec ${num(expert.perMatch, 2)} Eksperta) — remis zdarza się w ok. 5% meczów.`);
        out(`- **Regularność jest ważniejsza niż geniusz**: Spóźnialski typuje prawie jak Ekspert (${num(late.perMatch, 2)} pkt na typ), ale traci co trzeci typ przez blokadę — średnio ${num(late.avgPoints, 0)} pkt. Zapominalski (${num(forget.perMatch, 2)} pkt na typ, ale co trzeci mecz bez typu) — ${num(forget.avgPoints, 0)} pkt. Przypomnienia push mają sens.`);
        out(`- **Typy sezonowe (do 30 pkt) zmieniają mistrza w ${pct(mc.ltChangedPct)} sezonów.** To dużo — sezon wygrywa się w dużej mierze w marcu, przy wyborze mistrza, brązu i spadkowicza. Jeśli grupa uważa, że to za dużo: Sezon → Zasady → „Typ sezonowy (każdy)” = 5 pkt zmniejsza ich wpływ do ${pct(mc.lt5ChangedPct)} (zmiana przelicza sezon).`);
        out(`- **Joker i Złoty Kask są przyprawą, nie loterią**: zmieniają mistrza w ${pct(mc.jokerChangedPct)} i ${pct(mc.kaskChangedPct)} sezonów.`);
        out(`- **Remisy w rankingu**: regulamin rozstrzyga ${pct(mc.decidedByExactPct + mc.decidedByDiffPct)} sezonów (dokładne trafienia, różnica), ex aequo zostaje w ${pct(mc.coChampionsPct)} — wtedy jest dwóch mistrzów i obaj dostają niespodziankę.`);
        out(`- **Puchar Typerów**: jedna kolejka to tylko 4 mecze, więc remisy są częste. Pierwsza wersja dogrywki (dokładne → rozstawienie) oddawała co trzeci pojedynek rozstawieniu; po dodaniu „mniejszej łącznej pomyłki” rozstawienie decyduje w ${pct(mc.cupPct.seed)} pojedynków — prawie tylko wtedy, gdy obaj typowali identycznie.`);
        out('');
    }

    out('---');
    out('');
    out('Uruchomienie: `npm run symulacja` (opcje: `--seed 7` inny sezon, `--mc 5000` więcej sezonów Monte Carlo, `--serve` — po symulacji serwer zostaje na http://localhost:3000 i można obejrzeć zakończony sezon, podium i niespodziankę mistrza w przeglądarce).');
    out('');
    return L.join('\n');
}

module.exports = { buildReport };
