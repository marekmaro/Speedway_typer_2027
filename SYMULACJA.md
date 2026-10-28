# Symulacja ligi — Żużlowy Typer

Wygenerowano poleceniem `npm run symulacja` (seed 2027). Cały sezon trwał w symulacji 7.1 s, Monte Carlo 2000 sezonów — 8.4 s.

**Jak to działa.** Symulacja uruchamia prawdziwą aplikację (`server.js`, wszystkie trasy API) na bazie w pamięci i przesuwa zegar serwera. Typerzy wysyłają typy tak jak telefon (`/api/public/submit-all`), admin zatwierdza wyniki ze scrapera, przekłada mecze po deszczu, wpisuje walkowery, rozstawia Puchar Typerów, dodaje play-off i zamyka sezon. Wyniki meczów powstają bieg po biegu (15 biegów, 3-2-1-0, upadki i defekty), a scraper czyta je z dwóch fikcyjnych portali (tabela całego sezonu i lista ostatnich wyników — z literówkami, opóźnieniami i awarią). Po każdej kolejce symulacja **niezależnie** przelicza punkty, ranking, tabelę i puchar i porównuje je z tym, co pokazuje API.

**Wynik: ✅ wszystko zgodne** — 51 487 sprawdzeń w 1071 zdarzeniach.

## 1. Sezon 2027 rozegrany w aplikacji

- **907** zapisanych typów w **397** zapisach, **26** typów odrzuconych po blokadzie, 4 rezygnacji (wyczyszczone pola), 1 typ podany SMS-em i wpisany przez admina
- Joker: 14 ustawień/przeniesień, 1 odmowa przeniesienia z rozpoczętego meczu, Joker zwrócony po walkowerze
- Wyniki: 140 uruchomień scrapera, 63 wyników do zatwierdzenia, 56 zatwierdzonych przyciskiem „Zatwierdź wszystkie bez uwag”, 7 pojedynczo (po sprawdzeniu protokołu), 2 wpisanych ręcznie (brak w źródłach)
- Deszcz i zdarzenia: 2 przełożenia przed blokadą, 3 po blokadzie (typy zamrożone, 4 nieudane próby zmiany), 2 walkowery (w tym jeden po proteście, już po rozliczeniu), 1 korekta wyniku przez ligę
- Powiadomienia: 89 przypomnień o brakujących typach, łącznie 516 wiadomości push; admin logował się 51 razy (sesja wygasa po 8 h)
- Inne: 67 prób podejrzenia cudzych typów przed blokadą (zawsze zakryte), 2 zapisy wstrzymanego gracza (odrzucone), typy sezonowe po starcie ligi — odrzucone

### Tabela po rundzie zasadniczej

| # | Drużyna | M | Pkt | Bonus | +/- |
|---|---|---|---|---|---|
| 1 | Sparta Wrocław | 14 | **29** | 7 | +200 |
| 2 | Motor Lublin | 14 | **27** | 5 | +164 |
| 3 | Toruń | 14 | **26** | 5 | +103 |
| 4 | Włókniarz Częstochowa | 14 | **17** | 3 | -48 |
| 5 | Stal Gorzów | 14 | **13** | 3 | -58 |
| 6 | Falubaz Zielona Góra | 14 | **10** | 2 | -110 |
| 7 | Unia Leszno | 14 | **9** | 1 | -128 |
| 8 | GKM Grudziądz | 14 | **7** | 0 | -123 |

**Play-off:** 🥇 Mistrz Polski **Motor Lublin**, 🥉 brąz Toruń, 5. miejsce Stal Gorzów, spadek GKM Grudziądz.

### Ranking typerów na koniec sezonu

| # | Typer | Styl | Pkt | 🎯 | ± | Joker | Sezonowe |
|---|---|---|---|---|---|---|---|
| 1 | **Poprawiacz** | poprawia typy kilka razy, czasem czyści i wpisuje od nowa | **138** | 8 | 1 | +4 | +20 |
| 2 | **Ekspert** | zna siłę drużyn (z niewielkim błędem), Joker na najpewniejszy mecz | **125** | 4 | 0 | +4 | +20 |
| 2 | **Podglądacz** | chce zerknąć na cudze typy przed blokadą (nie widzi nic) i typuje 46:44 | **125** | 4 | 0 | +4 | +30 |
| 4 | **Statystyk** | liczy z tabeli ligi (punkty i małe punkty na mecz) | **120** | 4 | 0 | +4 | +10 |
| 5 | **Jokerowiec** | przekłada Jokera między meczami, próbuje przenieść zablokowanego | **116** | 4 | 0 | +4 | +10 |
| 6 | **KibicMotoru** | Motor zawsze wygrywa 54:36, reszta „na gospodarza” | **108** | 1 | 1 | +4 | +20 |
| 7 | **Pan4644** | zawsze 46:44 dla gospodarzy | **105** | 4 | 0 | +4 | +10 |
| 8 | **Gospodarz** | zawsze 50:40 dla gospodarzy | **98** | 6 | 0 | +0 | — |
| 9 | **Remisiarz** | przy wyrównanych parach typuje remis 45:45 | **87** | 5 | 0 | — | — |
| 10 | **Nowy** | dołącza po 5. kolejce, typy sezonowe już zamknięte | **77** | 2 | 1 | +4 | — |
| 11 | **Spóźnialski** | dobry typer, ale typuje w ostatniej chwili — co trzeci typ po blokadzie | **76** | 4 | 0 | +4 | — |
| 12 | **Losowy** | losowy wynik z sumą 90 | **69** | 2 | 0 | +0 | — |
| 13 | **Zapominalski** | pomija co trzeci mecz, raz podał typ SMS-em, wstrzymany na 2 kolejki | **53** | 1 | 0 | — | — |

🏆 **Mistrz Typera: Poprawiacz.** Admin zamknął sezon, mistrz dostał powiadomienie „Zostałeś Mistrzem Typera!”, zdrapał w swoim panelu kartę z niespodzianką („Złoty kask z autografami całej drużyny mistrza + 2 bilety na finał w przyszłym sezonie”), a admin widzi, że ją odebrał. Pozostali gracze widzą podium, ale nie treść nagrody — próba odkrycia jej cudzym linkiem kończy się odmową.

### Puchar Typerów

- **Ćwierćfinał** (R6): Pan4644 6:6 **KibicMotoru** (remis — mniejsza pomyłka) [40:28] · Podglądacz 6:9 **Remisiarz** · **Statystyk** 10:6 Jokerowiec · Poprawiacz 6:9 **Gospodarz**
- **Półfinał** (R9): **KibicMotoru** 7:4 Gospodarz · Remisiarz 4:12 **Statystyk**
- **Finał** (R12): KibicMotoru 2:4 **Statystyk**

### Kolejka po kolejce

| Kolejka | Termin | Zwycięzca kolejki | Czołówka po kolejce |
|---|---|---|---|
| R1 | 9 kwi – 11 kwi | Gospodarz, KibicMotoru, Pan4644, Podglądacz, Statystyk (8) | Gospodarz 8, KibicMotoru 8, Pan4644 8 |
| R2 | 16 kwi – 18 kwi | Spóźnialski (11) | Pan4644 17, Podglądacz 17, Spóźnialski 15 |
| R3 | 23 kwi – 25 kwi | Poprawiacz (12) | Pan4644 24, Podglądacz 24, Poprawiacz 22 |
| R4 | 30 kwi – 5 maj | Remisiarz (9) | Podglądacz 30, Pan4644 28, Poprawiacz 26 |
| R5 | 7 maj – 9 maj | Statystyk (9) | Pan4644 34, Podglądacz 34, Statystyk 34 |
| R6 | 21 maj – 23 maj | Statystyk (10) | Statystyk 44, Pan4644 40, Podglądacz 40 |
| R7 | 28 maj – 1 cze | Poprawiacz (11) | Statystyk 50, Poprawiacz 49, Pan4644 44 |
| R8 | 4 cze – 6 cze | Poprawiacz, Jokerowiec (9) | Poprawiacz 58, Statystyk 56, Jokerowiec 50 |
| R9 | 11 cze – 13 cze | Poprawiacz (13) | Poprawiacz 71, Statystyk 68, Jokerowiec 62 |
| R10 | 18 cze – 20 cze | Gospodarz (12) | Poprawiacz 80, Statystyk 76, Jokerowiec 66 |
| R11 | 2 lip – 6 lip | Remisiarz (12) | Poprawiacz 82, Statystyk 82, Jokerowiec 70 |
| R12 | 9 lip – 15 lip | Poprawiacz (7) | Poprawiacz 89, Statystyk 86, Jokerowiec 76 |
| R13 | 16 lip – 18 lip | Gospodarz, Ekspert, Pan4644, Podglądacz (7) | Poprawiacz 91, Statystyk 90, Gospodarz 80 |
| R14 | 23 lip – 25 lip | Poprawiacz (11) | Poprawiacz 102, Statystyk 96, Gospodarz 86 |
| R15 · Mecze o 5. miejsce | 30 lip | Nowy, Losowy (2) | Poprawiacz 102, Statystyk 96, Gospodarz 86 |
| R16 · Mecze o 5. miejsce (rewanże) | 6 sie | Poprawiacz, Statystyk, Jokerowiec, Ekspert, Gospodarz, Pan4644, Podglądacz, KibicMotoru, Remisiarz, Nowy, Losowy, Zapominalski (2) | Poprawiacz 106, Statystyk 100, Jokerowiec 90 |
| R17 · Półfinały | 1 sie | Jokerowiec (4) | Poprawiacz 104, Statystyk 98, Jokerowiec 88 |
| R18 · Półfinały (rewanże) | 8 sie | Poprawiacz, Statystyk, Jokerowiec, Ekspert, Gospodarz, Pan4644, Podglądacz, KibicMotoru, Remisiarz, Nowy (4) | Poprawiacz 110, Statystyk 104, Jokerowiec 94 |
| R19 · Finał i mecz o 3. miejsce | 15 sie | Poprawiacz, Jokerowiec, Ekspert, Nowy (4) | Poprawiacz 114, Statystyk 106, Jokerowiec 98 |
| R20 · Finał i mecz o 3. miejsce (rewanże) | 22 sie | Jokerowiec, Ekspert, Pan4644, Podglądacz (8) | Poprawiacz 118, Statystyk 110, Jokerowiec 106 |

### Dziennik sezonu

- 09.04, 14:59 — Poprawiacz czyści typ na Motor Lublin – Falubaz Zielona Góra (rezygnacja)
- 09.04, 18:39 — Spóźnialski wysyła typy sezonowe 40 min po starcie ligi — odrzucone
- 16.04, 21:50 — admin poprawia wynik ze scrapera Motor Lublin – GKM Grudziądz: 62:82 → 62:28 (Wynik powyżej 75 pkt.)
- 22.04, 22:00 — walkower: Unia Leszno nie przyjeżdża do meczu Motor Lublin – Unia Leszno — typy anulowane, Joker KibicaMotoru wraca
- 30.04, 14:30 — Włókniarz Częstochowa – Unia Leszno: Prognoza: ulewa — mecz przełożony, termin wkrótce — przed blokadą, typy nadal otwarte i ukryte
- 02.05, 19:20 — Zapominalski podaje typ 47:43 SMS-em przed meczem Sparta Wrocław – Falubaz Zielona Góra — admin wpisuje go po blokadzie
- 02.05, 20:30 — Włókniarz Częstochowa – Unia Leszno: nowy termin 05.05, 20:30
- 04.05, 17:59 — Jokerowiec stawia Jokera na Falubaz Zielona Góra – GKM Grudziądz
- 06.05, 17:59 — Jokerowiec przenosi Jokera na Motor Lublin – Włókniarz Częstochowa
- 07.05, 18:30 — Jokerowiec próbuje przenieść Jokera z rozpoczętego meczu — odmowa: „Joker jest już wykorzystany w rozegranym meczu - nie można go przenieść.”
- 08.05, 11:30 — brak wyniku KS Toruń – Stal Gorzów w źródłach — admin wpisuje ręcznie 52:38
- 09.05, 23:05 — do gry dołącza Nowy (typy sezonowe już zamknięte)
- 09.05, 23:05 — Puchar Typerów — Ćwierćfinał (R6): Pan4644 vs KibicMotoru, Podglądacz vs Remisiarz, Statystyk vs Jokerowiec, Poprawiacz vs Gospodarz
- 21.05, 15:29 — Poprawiacz czyści typ z Jokerem (Sparta Wrocław – Włókniarz Częstochowa) — Joker wraca do puli
- 23.05, 19:50 — admin poprawia wynik ze scrapera Stal Gorzów – Falubaz Zielona Góra: 51:39 → 50:40 (Źródła podają różne wyniki: 51:39 / 50:40.)
- 23.05, 23:05 — Puchar Typerów — Półfinał (R9): KibicMotoru vs Gospodarz, Remisiarz vs Statystyk
- 28.05, 20:50 — Falubaz Zielona Góra – KS Toruń: Deszcz — mecz przełożony (tor nie nadaje się do jazdy) — po blokadzie, typy zamrożone (12)
- 29.05, 22:30 — Falubaz Zielona Góra – KS Toruń: nowy termin 01.06, 22:30 (typy zamrożone)
- 04.06, 17:30 — Sparta Wrocław – GKM Grudziądz: nowy termin 06.06, 23:30
- 08.06, 19:15 — korekta wyniku Włókniarz Częstochowa – Stal Gorzów po decyzji ligi → 44:43, punkty przeliczone
- 11.06, 20:30 — Falubaz Zielona Góra – Unia Leszno przerwany po 11 biegach (deszcz) przy stanie 36:30 — wynik zaliczony
- 13.06, 23:05 — Puchar Typerów — Finał (R12): KibicMotoru vs Statystyk
- 14.06, 17:59 — admin wstrzymuje konto Zapominalskiego (wpisowe)
- 18.06, 14:59 — Poprawiacz czyści typ na Unia Leszno – Motor Lublin (rezygnacja)
- 02.07, 14:59 — Poprawiacz czyści typ na Stal Gorzów – Motor Lublin (rezygnacja)
- 02.07, 18:20 — Stal Gorzów – Motor Lublin: Deszcz — mecz przełożony (tor nie nadaje się do jazdy) — po blokadzie, typy zamrożone (11)
- 03.07, 20:00 — Stal Gorzów – Motor Lublin: nowy termin 06.07, 20:00 (typy zamrożone)
- 05.07, 17:59 — Zapominalski znów aktywny
- 09.07, 20:30 — Stal Gorzów – KS Toruń przerwany po 7 biegach (22:20) — za mało biegów, powtórka
- 10.07, 00:30 — Stal Gorzów – KS Toruń: Przerwany po 7 biegach — powtórka — po blokadzie, typy zamrożone (12)
- 12.07, 20:30 — Stal Gorzów – KS Toruń: nowy termin 15.07, 20:30 (typy zamrożone)
- 19.07, 20:30 — protest: Włókniarz Częstochowa – Sparta Wrocław zweryfikowany jako walkower 0:40 — 4 graczy traci punkty za ten mecz
- 25.07, 23:05 — koniec rundy zasadniczej: 1. Sparta Wrocław, 2. Motor Lublin, 3. KS Toruń, 4. Włókniarz Częstochowa · spadek: GKM Grudziądz
- 02.08, 11:30 — brak wyniku KS Toruń – Motor Lublin w źródłach — admin wpisuje ręcznie 41:49
- 08.08, 23:05 — finał: Sparta Wrocław – Motor Lublin, o brąz: Włókniarz Częstochowa – KS Toruń
- 23.08, 23:05 — 🏆 Mistrz Polski: Motor Lublin (finał z Sparta Wrocław), brąz: KS Toruń, spadek: GKM Grudziądz
- 23.08, 23:05 — admin zamyka sezon: Rozliczono 10 graczy (przyznano 120 pkt). Mistrz Typera: Poprawiacz (powiadomienia: 7).
- 24.08, 07:05 — 🎁 Poprawiacz zdrapuje kartę: „Złoty kask z autografami całej drużyny mistrza + 2 bilety na finał w przyszłym sezonie”

## 2. Co sprawdzała symulacja

| | Niezmiennik | Sprawdzeń | Błędy |
|---|---|---|---|
| I1 | Suma punktów w rankingu = punkty za mecze + typy sezonowe | 320 | ✅ 0 |
| I2 | Kolejność i miejsca w rankingu według regulaminu (punkty → dokładne → różnica, ex aequo tylko przy pełnym remisie) | 910 | ✅ 0 |
| I3 | Punkty każdego typu zgodne z niezależnym przeliczeniem (5/3/2/0, Złoty Kask, Joker) | 12 594 | ✅ 0 |
| I4 | Joker: najwyżej jeden aktywny na gracza, przenoszenie zgodne z regulaminem, wraca po walkowerze | 599 | ✅ 0 |
| I5 | Blokada: typ po blokadzie odrzucony, wcześniejszy typ nietknięty; zapisane dokładnie to, co gracz wysłał | 26 953 | ✅ 0 |
| I6 | Cudze typy ukryte przed blokadą (strona główna), jawne po blokadzie | 131 | ✅ 0 |
| I7 | Tabela ligi zgodna z niezależnym przeliczeniem (2/1/0, bonus za dwumecz, bez play-off) | 200 | ✅ 0 |
| I8 | Przełożenie przed blokadą = typy otwarte, po blokadzie = zamrożone | 9 | ✅ 0 |
| I9 | Walkower: typy anulowane (także po rozliczeniu), mecz liczy się do tabeli | 318 | ✅ 0 |
| I10 | Zwycięzca kolejki = najwięcej punktów w kolejce (remis = kilku), ostateczny po całej kolejce | 570 | ✅ 0 |
| I11 | Puchar: zwycięzca według punktów w kolejce, potem dokładnych, mniejszej łącznej pomyłki, rozstawienia | 125 | ✅ 0 |
| I12 | Przypomnienia push: tylko do graczy bez typu, każdy mecz raz | 229 | ✅ 0 |
| I13 | Wyniki ze scrapera trafiają do meczu dopiero po zatwierdzeniu i są zgodne z oficjalnym wynikiem; mecz w trakcie jest ignorowany | 8174 | ✅ 0 |
| I14 | Typy sezonowe: zakryte do startu, jawne potem, +10 pkt za każde trafienie po zamknięciu sezonu | 324 | ✅ 0 |
| I15 | Mistrz Typera i niespodzianka: tylko po zamknięciu sezonu, tylko dla zwycięzcy, nagroda tajna dla innych | 31 | ✅ 0 |

### Błędy, które symulacja znalazła (już naprawione)

Pierwsze uruchomienie pokazało 9 wyników wpisanych niezgodnie z oficjalnym protokołem (niezmiennik I13) i powtarzający się w dzienniku ten sam błędny wynik do zatwierdzenia. Po naprawie wszystkie niezmienniki przechodzą:

1. **„Zatwierdź wszystkie bez uwag” zatwierdzało też wyniki z ostrzeżeniem** (np. „źródła podają różne wyniki”) — wpisywał się błędny wynik z pierwszego portalu. Teraz ten przycisk bierze tylko wyniki bez żadnych uwag; resztę admin zatwierdza pojedynczo.
2. **W play-off scraper przypisywał nowemu meczowi stary wynik z rundy zasadniczej** — portal z tabelą całego sezonu ma oba mecze tych samych drużyn. Teraz wiersz z wynikiem znanym z innego meczu tej pary jest pomijany.
3. **Poprawiony przez admina odczyt wracał przy każdym pobraniu** (literówka portalu wracała jako nowy wynik do zatwierdzenia przez dwa tygodnie). Teraz zapamiętujemy, co odczytano ze źródła, i ten sam błędny odczyt już nie wraca.
4. Drobne: powiadomienia push skracały nazwy drużyn inaczej niż strona („Deweloperska Toruń”) — teraz jedna reguła dla serwera i przeglądarki.
5. **Zasady pucharu**: Monte Carlo pokazało, że dogrywka „dokładne trafienia → wyżej rozstawiony” oddaje rozstawieniu co trzeci pojedynek (jedna kolejka to tylko 4 mecze). Dodany krok „mniejsza łączna pomyłka” (suma różnic między typami a wynikami, mecz bez typu = 90) — regulamin na stronie zaktualizowany.

Znane ograniczenie (bezpieczne): gdy mecz play-off kończy się **dokładnie takim samym wynikiem** jak mecz tych drużyn z rundy zasadniczej, scraper uzna wiersz za stary i nie zaproponuje wyniku — admin wpisze go ręcznie (Pulpit pokazuje mecz jako „bez wyniku”). Lepiej przeoczyć wynik niż wpisać zły.

## 3. Monte Carlo zasad — 2000 sezonów

Te same style typowania, te same zasady punktacji co w aplikacji (5/3/2/0, Złoty Kask +1, Joker ×2, typy sezonowe po 10 pkt), ale tysiące różnych sezonów. Odpowiada na pytanie, czy zasady nagradzają umiejętność, i jak często regulamin musi rozstrzygać remisy.

| Typer | Tytuł | Podium | Puchar | Śr. pkt | Śr. miejsce | 🎯 / sezon | Pkt / typ | Joker | Kask | Sezonowe | Wygrywa z Ekspertem |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Ekspert** | 29% | 76% | 20% | 129 | 2,6 | 4,8 | 1,75 | +2,2 | +1,3 | +16,7 | — |
| **Poprawiacz** | 24% | 69% | 24% | 127 | 2,9 | 4,7 | 1,72 | +2,1 | +1,3 | +16,7 | 43% |
| **Statystyk** | 15% | 51% | 21% | 122 | 3,6 | 4,4 | 1,68 | +2,1 | +1,2 | +14,6 | 32% |
| **Jokerowiec** | 13% | 38% | 12% | 118 | 4,3 | 4,2 | 1,66 | +2,2 | +1,2 | +12,1 | 24% |
| **KibicMotoru** | 13% | 36% | 9.9% | 117 | 4,3 | 3,7 | 1,62 | +2,3 | +1,1 | +13,1 | 26% |
| **Podglądacz** | 3.0% | 18% | 3.9% | 111 | 5,4 | 3,2 | 1,49 | +2,0 | +0,8 | +15,2 | 13% |
| **Gospodarz** | 1.5% | 6.3% | 2.2% | 99 | 7,5 | 3,3 | 1,47 | +0,4 | +0,7 | +5,1 | 7.0% |
| **Remisiarz** | 0.8% | 3.4% | 1.4% | 95 | 8,2 | 4,6 | 1,36 | +0,0 | +1,3 | +7,8 | 3.4% |
| **Pan4644** | 0.5% | 3.2% | 4.0% | 99 | 7,5 | 3,2 | 1,49 | +2,0 | +0,8 | +3,7 | 4.5% |
| **Spóźnialski** | 0.3% | 1.1% | 0.4% | 89 | 9,1 | 3,2 | 1,70 | +1,7 | +1,0 | +13,1 | 2.3% |
| **Zapominalski** | 0.0% | 0.0% | 0.1% | 72 | 11,6 | 2,4 | 1,72 | +0,0 | +0,6 | +0,0 | 0.0% |
| **Losowy** | 0.0% | 0.0% | 0.1% | 71 | 11,6 | 2,3 | 1,05 | +1,1 | +0,6 | +3,5 | 0.0% |
| **Nowy** | 0.0% | 0.0% | 0.0% | 68 | 12,0 | 2,6 | 1,56 | +2,2 | +0,8 | +0,0 | 0.0% |

**Remisy i rozstrzygnięcia**

- Mistrz ma średnio 137 pkt i 7,5 pkt przewagi nad drugim miejscem.
- Równe punkty na szczycie: 5.3% sezonów — rozstrzygają dokładne trafienia (4.1%), potem trafienia różnicy (0.1%). Dwóch mistrzów ex aequo: 1.2%.
- Zwycięzca kolejki ex aequo (kilku z tym samym wynikiem): 36% kolejek.
- Puchar Typerów: 67% pojedynków rozstrzygają punkty, 0.1% — dokładne trafienia, 28% — mniejsza łączna pomyłka, 5.0% — rozstawienie (gracze z identycznymi typami).

**Ile znaczą premie (ten sam sezon, inne zasady)**

- Bez typów sezonowych mistrz byłby inny w 39% sezonów; przy 5 pkt zamiast 10 — w 17%.
- Bez Jokera — inny mistrz w 4.3% sezonów; bez Złotego Kasku — w 6.6%.

**Kategoria „zwycięzca + różnica” (3 pkt) w żużlu prawie nie istnieje**

W piłce nożnej „trafiona różnica” zdarza się często, ale w żużlu typ i wynik prawie zawsze mają sumę 90 — a przy tej samej sumie ta sama różnica oznacza ten sam wynik. Dlatego przy obecnych zasadach typy rozkładają się tak: dokładny 6.1%, **różnica 0.0%**, zwycięzca 60%, pudło 34%. 3 pkt wpadają tylko przy meczach z upadkami (suma 89) albo typie z inną sumą niż 90.

Nowe ustawienie sezonu **„Tolerancja różnicy”** (Sezon → Zasady, domyślnie 0 — czyli bez zmian) pozwala to naprawić. Przy **±4 pkt** (różnica typu najwyżej o 4 od różnicy meczu, czyli wynik gospodarzy ±2): dokładny 6.1%, **różnica 20%**, zwycięzca 41%, pudło 34%. Mistrz zmieniłby się w 24% sezonów, a tytuły Eksperta: 29% → 34% — „bycie blisko” zaczyna się opłacać, umiejętność waży trochę więcej.

**Wnioski**

- **Wygrywa umiejętność.** Trzej typerzy „z głową” (Ekspert, Poprawiacz, Statystyk) zdobywają razem 69% tytułów; najczęściej Ekspert (29%), Ekspert jest na podium w 76% sezonów. Losowy typer: 0.0% tytułów, średnio 71 pkt — przypadek nie wygrywa sezonu.
- **Szczęście też gra rolę**: nawet Ekspert wygrywa tylko co 3. sezon, a mistrz ma średnio 7,5 pkt przewagi — kilka dobrych typów w końcówce zmienia kolejność.
- **„Zawsze 46:44 dla gospodarzy”** daje więcej niż losowanie (99 vs 71 pkt), ale do Eksperta brakuje ~29 pkt (tytuł: 0.5%).
- **Typowanie remisów się nie opłaca** (Remisiarz: 1,36 pkt na typ wobec 1,75 Eksperta) — remis zdarza się w ok. 5% meczów.
- **Regularność jest ważniejsza niż geniusz**: Spóźnialski typuje prawie jak Ekspert (1,70 pkt na typ), ale traci co trzeci typ przez blokadę — średnio 89 pkt. Zapominalski (1,72 pkt na typ, ale co trzeci mecz bez typu) — 72 pkt. Przypomnienia push mają sens.
- **Typy sezonowe (do 30 pkt) zmieniają mistrza w 39% sezonów.** To dużo — sezon wygrywa się w dużej mierze w marcu, przy wyborze mistrza, brązu i spadkowicza. Jeśli grupa uważa, że to za dużo: Sezon → Zasady → „Typ sezonowy (każdy)” = 5 pkt zmniejsza ich wpływ do 17% (zmiana przelicza sezon).
- **Joker i Złoty Kask są przyprawą, nie loterią**: zmieniają mistrza w 4.3% i 6.6% sezonów.
- **Rekomendacja do decyzji grupy: tolerancja różnicy ±4.** Bez niej środkowy próg punktacji (3 pkt) jest martwy. To jedno pole w panelu, punkty sezonu przeliczą się same.
- **Remisy w rankingu**: regulamin rozstrzyga 4.2% sezonów (dokładne trafienia, różnica), ex aequo zostaje w 1.2% — wtedy jest dwóch mistrzów i obaj dostają niespodziankę.
- **Puchar Typerów**: jedna kolejka to tylko 4 mecze, więc remisy są częste. Pierwsza wersja dogrywki (dokładne → rozstawienie) oddawała co trzeci pojedynek rozstawieniu; po dodaniu „mniejszej łącznej pomyłki” rozstawienie decyduje w 5.0% pojedynków — prawie tylko wtedy, gdy obaj typowali identycznie.

---

Uruchomienie: `npm run symulacja` (opcje: `--seed 7` inny sezon, `--mc 5000` więcej sezonów Monte Carlo, `--serve` — po symulacji serwer zostaje na http://localhost:3000 i można obejrzeć zakończony sezon, podium i niespodziankę mistrza w przeglądarce).
