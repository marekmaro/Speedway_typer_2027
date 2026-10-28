/* ------------------------------------------------------------------
   Regulamin generowany z ustawień sezonu (blokada, punktacja, tolerancja, przypomnienia).
   Jedno źródło dla strony "Zasady" (/zasady) - każde zdanie ma pokrycie w logice serwera
   (services/scoring.js, routes/publicRoutes.js), w testach (test/scenarios.test.js)
   i w symulacji całego sezonu (npm run symulacja).
------------------------------------------------------------------- */
window.R = (function () {
    const b = t => `<strong class="text-ink">${t}</strong>`;

    function numbers(season) {
        const s = season.scoring;
        return {
            s,
            lock: T.lockLabel(season.lockMinutes),
            remind: T.lockLabel(season.reminderMinutes || 120),
            max: (s.exact + s.motrBonus) * s.jokerMultiplier,
            tol: Number(s.diffTolerance) || 0
        };
    }

    /** Typ za "zwycięzca + różnica" w przykładzie: przy tolerancji - typ z sumą 90 mieszczący się w ±tol. */
    const nearTyp = tol => (tol >= 2 ? `${46 + Math.floor(tol / 2)}:${44 - Math.floor(tol / 2)}` : '47:45');

    /** Najważniejsze liczby sezonu - kafelki na górze strony z zasadami. */
    function facts(season) {
        const { s, lock, max } = numbers(season);
        return [
            ['⏱️', lock, 'blokada przed 1. biegiem'],
            ['🎯', `${s.exact} pkt`, 'za dokładny wynik'],
            ['🃏', `×${s.jokerMultiplier}`, 'Joker raz w sezonie'],
            ['🏆', `${max} pkt`, 'maks. z jednego meczu']
        ];
    }

    function tiles(season) {
        const { s, tol } = numbers(season);
        return [[s.exact, 'dokładny wynik'], [s.diff, `zwycięzca + różnica${tol ? ` ±${tol}` : ''}`], [s.winner, 'zwycięzca'], [0, 'pudło']];
    }

    /** Przykład punktacji przy wyniku 46:44 (gospodarze wygrali 2 punktami). */
    function examples(season) {
        const { s, tol } = numbers(season);
        const near = nearTyp(tol);
        return [
            ['46:44', s.exact, 'dokładny wynik'],
            [near, s.diff, tol ? `dobry zwycięzca, różnica ${Math.abs(Number(near.split(':')[0]) - Number(near.split(':')[1]))} mieści się w ±${tol} od 2` : 'dobry zwycięzca i ta sama różnica (2 pkt)'],
            ['54:36', s.winner, 'dobry zwycięzca, inna różnica'],
            ['45:45', 0, 'remis, a gospodarze wygrali'],
            ['44:46', 0, 'zły zwycięzca']
        ];
    }

    function sections(season) {
        const { s, lock, remind, max, tol } = numbers(season);
        return [
            { id: 'typowanie', icon: '🕒', title: 'Typowanie', items: [
                `Typujesz przez swój prywatny link (najlepiej dodany do ekranu głównego) — najpóźniej ${b(`${lock} przed pierwszym biegiem`)} meczu.`,
                'Blokadę sprawdza serwer, według czasu serwera — zły zegarek w telefonie nic nie zmienia.',
                'Typy innych są zakryte do blokady. Wcześniej widać tylko, kto już wytypował.',
                'Zapis jest automatyczny. Do blokady typ możesz zmieniać, a wyczyszczenie obu pól usuwa typ.',
                'Typ to dwie liczby 0–75. Brak typu = 0 pkt.',
                `Po włączeniu powiadomień dostaniesz przypomnienie ${remind} przed blokadą, jeśli nie masz typu.`
            ] },
            { id: 'punkty', icon: '🎯', title: 'Punkty za mecz', scoring: true, items: [
                `Przykład przy wyniku 46:44: typ 46:44 → ${b(s.exact)} · ${nearTyp(tol)} → ${b(s.diff)} · 54:36 → ${b(s.winner)} · 44:46 → ${b(0)}.`,
                tol ? `„Różnica” liczy się z tolerancją ${b(`±${tol} pkt`)}: różnica Twojego typu może się różnić od różnicy meczu najwyżej o ${tol}.` : '',
                `Remis: trafiony remis z innym wynikiem (np. 45:45 przy 44:44) = ${b(s.diff)} pkt. Typ na remis, gdy ktoś wygrał = 0 pkt.`
            ] },
            { id: 'premie', icon: '⭐', title: 'Premie', items: [
                `${b(`Joker x${s.jokerMultiplier}`)} — raz w sezonie mnożysz dorobek z jednego meczu (razem z premią Złotego Kasku). Wymaga wpisanego typu. Można go przenosić, dopóki mecz z Jokerem nie jest zablokowany.`,
                `${b('Złoty Kask')} — wyróżniony mecz kolejki: trafienie za ${s.exact} lub ${s.diff} pkt daje ${b(`+${s.motrBonus}`)}.`,
                `Maksimum z jednego meczu: ${b(`${max} pkt`)}.`
            ] },
            { id: 'sezonowe', icon: '🔮', title: `Typy sezonowe (do ${s.longTermEach * 3} pkt)`, items: [
                `Mistrz Polski, brązowy medalista i spadkowicz — po ${b(`+${s.longTermEach}`)} pkt za każde trafienie.`,
                'Trzy różne drużyny. Typujesz do blokady pierwszego meczu sezonu — potem typy wszystkich stają się widoczne.',
                'Rozliczenie po zakończeniu sezonu, według ostatecznych wyników ligi.'
            ] },
            { id: 'ranking', icon: '📊', title: 'Ranking', items: [
                'Liczą się punkty za mecze plus typy sezonowe.',
                `Przy równej liczbie punktów wyżej jest ten, kto ma ${b('więcej dokładnych trafień')}, a potem ${b('więcej trafień „zwycięzca + różnica”')}. Pełny remis = ex aequo.`,
                'Mecze play-off (np. półfinały, finał) typujesz i punktujesz jak każde inne.',
                'Zwycięzca kolejki: najwięcej punktów w kolejce (przy remisie — kilku zwycięzców). Ostateczny po rozliczeniu całej kolejki.'
            ] },
            { id: 'puchar', icon: '🏆', title: 'Puchar Typerów', items: [
                'Pary według rankingu: 1. z ostatnim, 2. z przedostatnim…',
                'Wygrywa ten, kto w wyznaczonej kolejce zdobędzie więcej punktów (z Jokerem i Kaskiem). Rozstrzygnięcie po rozliczeniu całej kolejki.',
                `Remis: więcej dokładnych trafień w tej kolejce, potem ${b('mniejsza łączna pomyłka')} (suma różnic między typami a wynikami, mecz bez typu = 90), a gdy i to równe — ${b('wyżej rozstawiony')}.`
            ] },
            { id: 'deszcz', icon: '🌧️', title: 'Sytuacje żużlowe', items: [
                `Mecz przełożony ${b('przed')} blokadą — typy zostają i możesz je zmieniać do nowej blokady (także gdy nowy termin jeszcze nie jest znany).`,
                `Mecz przełożony ${b('po')} blokadzie (np. deszcz w dniu meczu) — typy były już jawne, więc zostają zamrożone do nowego terminu.`,
                'Mecz przerwany po co najmniej 8 biegach — liczy się wynik zaliczony przez ligę. Przerwany wcześniej — traktujemy jak przełożony.',
                'Walkower albo mecz odwołany — typy anulowane (nikt nie dostaje punktów), a Joker wraca do gracza. Dotyczy też walkowera przyznanego później, np. po proteście.',
                'Tabela ligi: 2 pkt za zwycięstwo, 1 za remis, +1 za wygrany dwumecz (suma małych punktów z obu meczów). Play-off nie wlicza się do tabeli.'
            ] },
            { id: 'mistrz', icon: '👑', title: 'Mistrz Typera', items: [
                `Zwycięzca sezonu zostaje ${b('Mistrzem Typera')}: trafia do galerii mistrzów, dostaje dyplom i niespodziankę od organizatora 🎁 (zdrapka w jego panelu). Podium dostaje medale i dyplomy.`,
                'Wyniki zatwierdza admin (także te pobrane automatycznie) — jego decyzja jest ostateczna. Mistrza ogłaszamy po zamknięciu sezonu.'
            ] }
        ];
    }

    /** Najczęstsze pytania nowych graczy. */
    function faq(season) {
        const { s, lock, remind } = numbers(season);
        return [
            ['Jak zacząć grać?', 'Poproś admina o swój link do typowania. Otwórz go na telefonie i dodaj do ekranu głównego — ikona otworzy od razu Twój panel.'],
            ['Zapomniałem wytypować. Co teraz?', `Za mecz bez typu dostajesz 0 pkt. Żeby nie zapominać, włącz w panelu powiadomienia — przypomnienie przyjdzie ${remind} przed blokadą. Jeśli przed blokadą podałeś typ adminowi (np. SMS-em), admin może go wpisać za Ciebie.`],
            ['Czy mogę zmienić typ?', `Tak, ile razy chcesz — do blokady (${lock} przed pierwszym biegiem). Wyczyszczenie obu pól usuwa typ.`],
            ['Czy ktoś widzi mój typ, zanim mecz się zacznie?', 'Nie. Do blokady inni widzą tylko, że już wytypowałeś (🔒). Typy wszystkich odsłaniają się w chwili blokady.'],
            ['Mecz przełożono przez deszcz. Co z moim typem?', 'Typ zostaje. Jeśli mecz przełożono przed blokadą, możesz go jeszcze zmienić. Jeśli po blokadzie (typy były już jawne), typ jest zamrożony do nowego terminu.'],
            ['Mam źle ustawiony zegarek w telefonie.', 'Nic nie szkodzi — odliczanie i blokadę liczy serwer według swojego czasu.'],
            ['Jak użyć Jokera?', `Wpisz typ i zaznacz „Joker” na wybranym meczu — punkty z tego meczu liczą się ×${s.jokerMultiplier}. Masz jednego na sezon; możesz go przełożyć na inny mecz, dopóki mecz z Jokerem się nie zaczął.`],
            ['Zgubiłem link albo ktoś go poznał.', 'Napisz do admina — wygeneruje nowy link, a stary przestanie działać.'],
            ['Co dostaje zwycięzca?', 'Tytuł Mistrza Typera, miejsce w galerii mistrzów, dyplom i niespodziankę od organizatora, którą odkrywa w swoim panelu na zdrapce.']
        ];
    }

    return { facts, tiles, examples, sections, faq };
})();
