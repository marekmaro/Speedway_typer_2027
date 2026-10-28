# Raport z testów — Żużlowy Typer 3

Stan na 28 października 2026. Wszystkie testy przechodzą: **196 automatycznych + 50 w przeglądarce** (pakiet E2E
uruchomiony dwa razy z rzędu, bez niestabilnych wyników) + **symulacja całego sezonu** (15 niezmienników,
51 487 sprawdzeń, 0 błędów) i Monte Carlo zasad (2000 sezonów) — szczegóły w [SYMULACJA.md](SYMULACJA.md).

| Pakiet | Plik | Liczba | Uruchomienie |
|---|---|---|---|
| Punktacja, regulamin, tabela, statystyki, parser scrapera | `test/scoring.test.js` | 63 | `npm test` |
| API (blokady, joker, admin) | `test/api.test.js` | 46 | `npm test` |
| Scenariusze z życia typera (cała aplikacja) | `test/scenarios.test.js` | 87 | `npm test` |
| Przeglądarka: strona (Start, zakładki, zasady), panel gracza, PWA, panel admina, Mistrz Typera | `test/e2e.test.js` | 50 | `npm run test:e2e` |
| Cały sezon przez API + Monte Carlo zasad | `scripts/symulacja.js` | 15 niezmienników | `npm run symulacja` |

Scenariusze API przechodzą także przy serwerze w strefach UTC, America/New_York i Asia/Tokyo.

## Co jest sprawdzone

**Typowanie:** zapis przed blokadą i odrzucenie po niej (stary typ zostaje), blokada 1 min co do sekund,
błędne wartości (puste, ułamki, tekst, ujemne, > 75), usuwanie typu przez wyczyszczenie pól, typ na mecz
z innego sezonu, ukrywanie cudzych typów przed blokadą (strona, profil, H2H) i ich odsłonięcie po blokadzie,
wstrzymany gracz, zły/stary link, gracz spoza sezonu, typy sezonowe (tylko drużyny z sezonu, zamykanie).

**Joker:** postawienie, przeniesienie, rezygnacja; zmiana wyniku nie zdejmuje jokera; zablokowany joker nie
przechodzi; joker nie trafi na mecz zablokowany / przełożony / anulowany; joker wymaga typu; dwa jokery
w jednym zapisie; joker z walkowera wraca; Joker × Złoty Kask = 12 pkt.

**Deszcz i sytuacje żużlowe:** przełożenie przed i po blokadzie (zamrożenie), „termin nieznany” przed
i po blokadzie, odmrożenie przez admina, walkower i jego cofnięcie, wyczyszczenie wyniku walkowera,
mecz odwołany i przywrócony, mecz przerwany po 11 biegach, Złoty Kask przyznany po wyniku, kolizja kolejek,
korekty tabeli.

**Wyniki i scraper:** zakres wyników, wyniki kolejki (zmienione / bez zmian / błędne), scraper pomija mecze
w trakcie, draft nie wpisuje wyniku, aktualizacja draftu, ręczny wynik odrzuca draft, korekta zatwierdzonego
wyniku, blokery (suma > 90) i świadome „force”, „zatwierdź wszystkie”, awaria jednego z kilku źródeł,
usuwanie draftów z meczem.

**Gracze, sezony, system:** dodawanie i walidacja, reset linku, zmiana pseudonimu z przeniesieniem typów,
pucharu i subskrypcji, usuwanie z sezonu / całkowite, typ wpisany przez admina; nowy sezon, pusty sezon,
generator terminarza w czasie polskim (także przy zmianie czasu), import JSON, dodawanie meczu, zmiana
punktacji z przeliczeniem, blokada 0 min, zamknięcie i otwarcie sezonu; przypomnienia push (tylko
potrzebujący, bez powtórek), push z punktami (raz), usuwanie martwych subskrypcji, alert o awarii scrapera
(raz dziennie); kopia zapasowa → przywrócenie, cron z sekretem, limit prób logowania, manifest PWA,
wersjonowanie plików, świeża instalacja i migracja z v1, konfiguracja buildu na Render.

**Regulamin = działanie aplikacji:** każde zdanie regulaminu na stronie ma test: przykład punktacji, remis
w rankingu (dokładne → różnica → ex aequo), zwycięzca kolejki ostateczny po całej kolejce, puchar liczony
na bieżąco (korekta wyniku zmienia drabinkę), remis w pucharze (dokładne → mniejsza pomyłka → rozstawienie),
trzy różne drużyny w typach sezonowych (gracz, admin, wyniki sezonu), czas przypomnień, tolerancja różnicy.

**Koniec sezonu i Mistrz Typera:** brak mistrza w trakcie sezonu, niespodzianka niewidoczna na stronie
i dla innych graczy, push do mistrza i do reszty (raz, także po ponownym zamknięciu), podium i medale
(bez medalu za 0 pkt), odkrycie tylko przez mistrza (zapisane dla admina), dwóch mistrzów ex aequo,
ponowne otwarcie sezonu chowa mistrza, galeria mistrzów; w przeglądarce: baner z konfetti, zdrapka,
„Odkryj od razu”, dyplom do pobrania, baner wygranej kolejki, blokada powtórzonej drużyny w typach
sezonowych, osiągnięcia w profilu.

**Symulacja ligi:** 13 typerów przez cały sezon (typy jak z telefonu, spóźnione po blokadzie, poprawiane,
czyszczone, Joker przenoszony i zablokowany, typ SMS-em wpisany przez admina, wstrzymane konto), deszcz
przed i po blokadzie, termin nieznany, mecz przerwany po 11 i po 7 biegach, walkower i walkower po
proteście, korekta wyniku, scraper na dwóch portalach (literówka, różne wyniki, awaria, opóźnienie, wynik
na żywo), puchar, play-off, zamknięcie sezonu z niespodzianką. Po każdej kolejce niezależne przeliczenie.

**W przeglądarce (telefon Pixel 5 i ekran 1280 px):** brak błędów JS i poziomego przewijania na wszystkich
stronach i widokach admina, nawigacja i „wstecz”, profil z wykresami i podpowiedziami, autozapis
i autoprzeskok pól, joker, blokada w trakcie oglądania, dwa telefony jednego gracza, brak sieci i powrót,
zegar telefonu przestawiony o 5 min, panel offline z service workera, pełne ścieżki admina (zatwierdzanie,
wyniki, potwierdzenia, typ za gracza, przełożenia, walkower, gracze, sezon, puchar, kopia, wygasła sesja).

## Znalezione i naprawione błędy

| # | Błąd | Skutek | Naprawa |
|---|---|---|---|
| 1 | `npm ci` przy `NODE_ENV=production` pomijało Tailwinda | **pierwszy deploy na Render by się nie udał** | `npm ci --include=dev` w `render.yaml` |
| 2 | Hasło admina przyjmowane też w nagłówku `x-admin-password` | zgadywanie hasła bez limitu prób | furtka usunięta |
| 3 | Limit logowania liczony z podrabialnego `X-Forwarded-For` | obejście limitu prób | limit po `req.ip` |
| 4 | Autozapis odświeżał karty z serwera | wpisana liczba **znikała** po pauzie | niezapisane wartości przeżywają odświeżenie |
| 5 | Zapis wysyłał wszystkie widoczne mecze | stary ekran na drugim telefonie nadpisywał nowsze typy | wysyłane są tylko zmienione mecze |
| 6 | Zapis po blokadzie pokazywał „Zapisane” | gracz myślał, że typ wszedł | ostrzeżenie i stan „część niezapisana” |
| 7 | Brak ponowienia zapisu bez sieci | typ ginął w tramwaju bez zasięgu | ponowienie po powrocie sieci |
| 8 | Odliczanie z zegara telefonu | zła godzina w telefonie = blokada za wcześnie/za późno | synchronizacja z zegarem serwera |
| 9 | „Termin nieznany” przed blokadą blokował się ze starą datą | typy jawne, a potem niesłusznie zamrożone | stara data nie blokuje, brak zamrożenia |
| 10 | Generator terminarza w strefie serwera | na Render (UTC) mecze o 2 h za późno | godziny zawsze w czasie polskim |
| 11 | Po deployu stary CSS w cache PWA | „rozjechana” aplikacja u graczy | automatyczna wersja plików |
| 12 | Zmiana kolejki na zajętą | surowy błąd bazy | czytelny komunikat |
| 13 | Zastąpienie terminarza / usunięcie kolejek | osierocone wyniki ze scrapera | drafty usuwane razem z meczami |
| 14 | Wyczyszczenie wyniku walkowera | mecz zostawał „walkowerem” bez wyniku | walkower zdejmowany |
| 15 | Joker na mecz bez typu | dotychczasowy joker znikał | ostrzeżenie, joker zostaje |
| 16 | Świeża instalacja | sezon z blokadą 24 h i rokiem 2026 | bieżący rok, blokada 1 min |
| 17 | Gracz spoza sezonu | pozycja „7/6” | „–” do pierwszego typu |
| 18 | Panel admina: komunikat przed odświeżeniem danych | wpisywane pole mogło zostać nadpisane | komunikat po odświeżeniu + pasek postępu |
| 19 | Panel admina: pseudonim z apostrofem | psuł przyciski (onclick) | obsługa zdarzeń bez danych w kodzie |
| 20 | Domyślne sloty generatora (bez podanych godzin) | mecze w poniedziałek i środę | piątek i niedziela |
| 21 | Równe punkty w rankingu — brak reguły | kolejność „przypadkowa”, regulamin milczał | dokładne → różnica, ex aequo tylko przy pełnym remisie |
| 22 | Puchar liczony tylko przyciskiem „Przelicz” | po korekcie wyniku drabinka pokazywała stare punkty | wynik pucharu liczony na bieżąco z typów |
| 23 | Remis w pucharze nieopisany | nie wiadomo, kto przechodzi dalej | dokładne → mniejsza łączna pomyłka → wyżej rozstawiony |
| 24 | Typy sezonowe: ta sama drużyna jako mistrz i brąz | „pewne” punkty wbrew regulaminowi | odrzucane (gracz, admin i wyniki sezonu) |
| 25 | „Zatwierdź wszystkie bez uwag” brało też wyniki z ostrzeżeniem *(symulacja)* | **wpisywał się błędny wynik**, gdy źródła się różniły | tylko wyniki bez blokad i ostrzeżeń |
| 26 | Play-off: wiersz z wynikiem z rundy zasadniczej *(symulacja)* | **stary wynik przypisany nowemu meczowi** | wiersz ze znanym wynikiem tej pary pomijany |
| 27 | Poprawiony odczyt scrapera wracał *(symulacja)* | ta sama literówka do zatwierdzenia co godzinę przez 2 tygodnie | zapamiętany odczyt ze źródła |
| 28 | Push skracał nazwy inaczej niż strona *(symulacja)* | „Deweloperska Toruń” | wspólna reguła, test pilnuje zgodności |
| 29 | „Ex aequo z X” przy równych punktach, choć X jest wyżej przez dokładne | mylący napis w panelu gracza | „tyle samo punktów — wyżej przez dokładne” |
| 30 | Kategoria 3 pkt w żużlu prawie nie występuje *(Monte Carlo)* | środkowy próg punktacji martwy (0% typów) | opcjonalna tolerancja różnicy (domyślnie bez zmian) |

Błędy 25–28 znalazła symulacja całego sezonu (przy pierwszym uruchomieniu 9 wyników wpisanych niezgodnie
z oficjalnym protokołem), a 23 i 30 — Monte Carlo zasad. Każda poprawka ma test, który bez niej nie przechodzi. Błąd nr 1 odtworzyłem dodatkowo prawdziwym
`npm ci` z `NODE_ENV=production` (build kończył się `tailwindcss: not found`), a nr 4 — w przeglądarce
przed poprawką (wpisana cyfra rzeczywiście znikała).

## Czego nie da się tu sprawdzić

- **Scraper na prawdziwych portalach** — sieć środowiska testowego blokuje strony sportowe. Parser
  działa na przykładowym HTML; po wdrożeniu sprawdź go w *Sezon → Wyniki auto → Pobierz teraz*.
- **Dostarczenie powiadomień push na telefon** — testowana jest logika wysyłki (atrapa), nie serwery
  Google/Apple. Po wdrożeniu: *System → Powiadamiaj ten telefon → Wyślij test*.
- **Prawdziwe MongoDB** — testy używają atrapy bazy w pamięci. Zapytania są proste, ale pierwszy start
  na Atlasie warto obejrzeć w logach Render.
