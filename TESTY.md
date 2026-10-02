# Raport z testów — Żużlowy Typer 3

Stan na 2 października 2026. Wszystkie testy przechodzą: **175 automatycznych + 43 w przeglądarce** (pakiet E2E
uruchomiony dwa razy z rzędu, bez niestabilnych wyników).

| Pakiet | Plik | Liczba | Uruchomienie |
|---|---|---|---|
| Punktacja, tabela, statystyki, parser scrapera | `test/scoring.test.js` | 55 | `npm test` |
| API (blokady, joker, admin) | `test/api.test.js` | 46 | `npm test` |
| Scenariusze z życia typera (cała aplikacja) | `test/scenarios.test.js` | 74 | `npm test` |
| Przeglądarka: strona, panel gracza, PWA, panel admina | `test/e2e.test.js` | 43 | `npm run test:e2e` |

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

Każda poprawka ma test, który bez niej nie przechodzi. Błąd nr 1 odtworzyłem dodatkowo prawdziwym
`npm ci` z `NODE_ENV=production` (build kończył się `tailwindcss: not found`), a nr 4 — w przeglądarce
przed poprawką (wpisana cyfra rzeczywiście znikała).

## Czego nie da się tu sprawdzić

- **Scraper na prawdziwych portalach** — sieć środowiska testowego blokuje strony sportowe. Parser
  działa na przykładowym HTML; po wdrożeniu sprawdź go w *Sezon → Wyniki auto → Pobierz teraz*.
- **Dostarczenie powiadomień push na telefon** — testowana jest logika wysyłki (atrapa), nie serwery
  Google/Apple. Po wdrożeniu: *System → Powiadamiaj ten telefon → Wyślij test*.
- **Prawdziwe MongoDB** — testy używają atrapy bazy w pamięci. Zapytania są proste, ale pierwszy start
  na Atlasie warto obejrzeć w logach Render.
