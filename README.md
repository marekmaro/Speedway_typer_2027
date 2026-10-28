# Żużlowy Typer 3.0

Typer PGE Ekstraligi dla znajomych: terminarz, wyniki, ranking typerów, Joker, Złoty Kask,
typy sezonowe, Puchar Typerów i wiele sezonów. Wersja 3 dokłada: aplikację na telefon (PWA),
półautomatyczne pobieranie wyników, przypomnienia push, statystyki (forma, H2H, ranking
wszech czasów) i obsługę żużlowych sytuacji spornych (deszcz, walkower, korekty tabeli).

Wygląd „żużel pod światłami”: nocny stadion i tor w nagłówku, kolory kasków (gospodarze czerwony
i niebieski, goście biały i żółty), cyfry jak na tablicy wyników, światła startowe przy odliczaniu
blokady, kaski-awatary graczy, podium rankingu i pojedynki pucharowe „czerwony kask vs niebieski”.
Zwycięzca sezonu zostaje **Mistrzem Typera**: konfetti, zdrapka z niespodzianką od organizatora
i dyplom do pobrania (więcej niżej). Cały sezon jest sprawdzony **symulacją ligi** (`SYMULACJA.md`).

Strona główna otwiera się na zakładce **Start** (powitanie — po imieniu, gdy telefon zna link gracza —
bieżąca kolejka, czołówka, ostatnie wyniki, sezon w liczbach). **Zasady gry** mają osobną stronę
`/zasady` (też `/regulamin`): jak zacząć, punktacja z przykładami, Joker, puchar, deszcz, walkowery
i najczęstsze pytania — generowane z ustawień sezonu. Ten adres możesz wysłać nowemu graczowi.

**Stos:** Node.js 22 + Express · MongoDB (Mongoose) · HTML + vanilla JS + Tailwind CSS (budowany) ·
cheerio (scraper) · web-push (VAPID) · hosting Render + MongoDB Atlas.

---

## ⚠️ ZRÓB TO NAJPIERW (bezpieczeństwo)

W przekazanym projekcie były trzy dziury, które trzeba domknąć **przed** wrzuceniem nowej wersji:

1. **Zmień hasło do MongoDB Atlas.** Plik `db_adres.txt` zawierał pełny adres bazy z loginem
   i hasłem. Jeśli projekt był kiedykolwiek w publicznym repozytorium, przyjmij, że hasło jest
   spalone — boty skanują GitHuba właśnie w poszukiwaniu takich stringów.
   Atlas → Database Access → Edit user → Edit Password → nowe, długie hasło.
   Usunięcie pliku nie wystarczy, bo zostaje w historii gita.
2. **Usuń `db_adres.txt` i `1.py`** z projektu. Adres bazy trzyma się tylko w `.env`
   (jest już w `.gitignore`). Plik `1.py` był skryptem łatającym kod przez podmianę tekstu —
   w nowej wersji nie jest do niczego potrzebny.
3. **Ustaw nowe, mocne `ADMIN_PASSWORD`** w `.env`. Panel ma teraz limit 10 prób logowania na
   15 minut, ale krótkie hasło nadal jest ryzykiem.

Dodatkowo: **linki graczy (`/typuj.html?id=...`) są ich hasłami.** W wersji 1 wyciekały przez
publiczne API — każdy mógł pobrać wszystkie tokeny i edytować cudze typy. Jest to naprawione, ale
stare tokeny mógł ktoś już mieć. Po wdrożeniu warto w panelu (zakładka *Gracze*) kliknąć
„Nowy link" u każdego i rozesłać świeże adresy.

---

## Szybki start

```bash
npm install
cp .env.example .env     # uzupełnij MONGODB_URI i ADMIN_PASSWORD
npm run build:css        # Tailwind -> public/css/app.css (plik jest też w repo)
npm start                # http://localhost:3000
npm test                 # 196 testów (jednostkowe, API, 87 scenariuszy), bez bazy
npm run demo             # cała aplikacja na przykładowych danych, BEZ MongoDB (admin: "demo")
npm run symulacja        # cały sezon w aplikacji + Monte Carlo zasad -> SYMULACJA.md
npm run symulacja -- --serve   # ...i obejrzyj zakończony sezon (podium, zdrapka mistrza) na :3000
```

Kontrola stanu: `GET /healthz` (baza, push, wersja plików).

### Testy w przeglądarce (opcjonalnie)

50 testów E2E klika aplikację w prawdziwym Chromium (widok telefonu i komputera): typowanie,
autozapis, joker, blokadę w trakcie, dwa telefony jednego gracza, brak sieci, źle ustawiony zegar,
PWA offline, cały panel admina oraz koniec sezonu (baner mistrza, zdrapka, dyplom). Wymagają Playwrighta, którego nie ma w zależnościach (żeby nie
spowalniał deployu):

```bash
npm i --no-save playwright && npx playwright install chromium
npm run test:e2e
```

## Wdrożenie na Render

1. **MongoDB Atlas:** darmowy klaster M0 w regionie *Frankfurt*, użytkownik bazy z długim hasłem,
   Network Access: `0.0.0.0/0` (Render nie ma stałego IP na planie free).
2. **Klucze push:** `npm run vapid` → zapisz `publicKey` i `privateKey`.
3. **Render → New → Blueprint** → wskaż repozytorium. `render.yaml` tworzy usługę web
   (Frankfurt, Node 22, build `npm ci --include=dev && npm run build:css`, health check `/healthz`).
   `--include=dev` jest potrzebne: Render ustawia `NODE_ENV=production` także przy budowaniu,
   a wtedy samo `npm ci` pominęłoby Tailwinda i build by się wysypał.
   W panelu uzupełnij sekrety: `MONGODB_URI`, `ADMIN_PASSWORD`, `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, opcjonalnie `SCRAPER_URLS`. `CRON_SECRET` Render wygeneruje sam.
4. **Zadania w tle na planie free.** Darmowa instancja zasypia po 15 min, więc wbudowany
   harmonogram wtedy nie działa. Workflow `.github/workflows/cron.yml` co 30 min (10–22 UTC,
   marzec–październik) budzi serwer i wywołuje `POST /api/cron/run`. W GitHub → *Settings → Secrets
   → Actions* dodaj `APP_URL` (adres z Render) i `CRON_SECRET` (skopiuj z Render).
   Alternatywy: cron-job.org z tym samym adresem i nagłówkiem `x-cron-secret`, albo plan *Starter*
   (bez usypiania, wtedy wystarczy wbudowany harmonogram).

Wszystkie zmienne opisuje `.env.example`.

> **Wgrywasz pliki przez stronę GitHuba („Add files via upload”)?** Pliki i katalogi zaczynające
> się od kropki nie przechodzą — w repozytorium brakuje wtedy `.github/workflows/cron.yml`
> (budzenie serwera i zadania w tle), `.gitignore` i `.env.example`. Workflow dodasz ręcznie:
> *Add file → Create new file*, nazwa `.github/workflows/cron.yml`, wklej zawartość pliku z paczki.
> Nigdy nie wgrywaj pliku `.env` ani katalogu `node_modules`.
> Zamiast GitHub Actions możesz użyć cron-job.org: co 30 min `POST https://TWOJ-ADRES.onrender.com/api/cron/run?job=all`
> z nagłówkiem `x-cron-secret: <CRON_SECRET>` (albo parametrem `&key=<CRON_SECRET>`).

## Zasady gry

Typuje się **wynik meczu** (np. 47:43). Punktacja i blokada są ustawiane per sezon w panelu
(*Sezon → Zasady*), a regulamin na stronie generuje się z tych ustawień.

- **5 pkt** dokładny wynik · **3 pkt** zwycięzca + dokładna różnica · **2 pkt** zwycięzca · **0** pudło
- **Tolerancja różnicy** (*Sezon → Zasady*, domyślnie 0): w żużlu typ i wynik prawie zawsze mają
  sumę 90, a wtedy ta sama różnica = ten sam wynik, więc 3 pkt prawie się nie zdarzają (symulacja:
  0% typów). Przy tolerancji 4 różnica typu może się różnić od różnicy meczu o 4 (np. 48:42 przy
  46:44) — 3 pkt dostaje ok. 20% typów. Zmiana przelicza sezon. Decyzja należy do grupy.
- **Złoty Kask:** w wyróżnionym meczu kolejki trafienie za 5 lub 3 pkt daje **+1**
- **Joker:** raz w sezonie ×2 za jeden mecz (maks. 12 pkt)
- **Typy sezonowe:** mistrz / brąz / spadek po **+10** — trzy różne drużyny, typowane przed pierwszym meczem
- **Ranking:** punkty → więcej dokładnych → więcej trafień różnicy; pełny remis = ex aequo
- **Zwycięzca kolejki:** najwięcej punktów w kolejce, ostateczny po rozliczeniu całej kolejki
- **Puchar Typerów:** pary według rankingu, wygrywa lepszy wynik w wyznaczonej kolejce; remis →
  więcej dokładnych → mniejsza łączna pomyłka (suma |typ − wynik|, mecz bez typu = 90) → wyżej rozstawiony
- **Mistrz Typera:** po zamknięciu sezonu przez admina; medal za podium wymaga punktów
- **Blokada:** domyślnie **1 minuta przed pierwszym biegiem** (nowe sezony). Sezony z wersji 2
  zachowują swoje 24 h, dopóki admin tego nie zmieni.

### Sytuacje żużlowe

| Sytuacja | Jak to działa |
|---|---|
| Mecz przełożony **przed** blokadą | Typy zostają (wiszą na ID meczu, nie na dacie). Gracze mogą je zmieniać do nowej blokady. Pierwotna data jest pokazywana. |
| Mecz przełożony **po** blokadzie (deszcz w dniu meczu) | Typy były już jawne → przy zmianie daty zostają **zamrożone** automatycznie. Admin może je świadomie odmrozić. |
| Przełożony, termin nieznany | *Mecze → Edytuj → „Przełożony, termin nieznany”*. Ustawione przed blokadą: typy zostają otwarte i ukryte, nawet gdy minie stara data. Ustawione po blokadzie: typy zamrożone. Mecz trafia na Pulpit do „ustal nowy termin”. |
| Mecz przerwany po ≥ 8 biegach | Wpisz wynik zaliczony przez ligę (np. 40:38) i notatkę. Scraper i panel oznaczają sumę < 84 jako „do sprawdzenia”. |
| Walkower | *Mecze → Edytuj → Walkower dla…* (40:0 albo 0:40): wynik liczy się do tabeli ligi, typy są anulowane, a Joker wraca do gracza. Można go cofnąć. Działa też po rozliczeniu (weryfikacja po proteście) — punkty za mecz znikają. |
| Mecz odwołany na stałe | *Mecze → Edytuj → „Mecz odwołany — anuluj typy”*. |
| Punkt bonusowy za dwumecz | Liczony automatycznie (suma małych punktów z obu meczów; remis = brak bonusu). |
| Decyzje „przy zielonym stoliku” | *Sezon → Tabela → Korekty*: drużyna, punkty, powód. Korekta jest widoczna pod tabelą z opisem. |

## Wyniki: scraper + zatwierdzanie (półautomat)

Nie ma oficjalnego API, a portale zmieniają HTML. Dlatego scraper **nigdy nie wpisuje wyniku sam**:

1. Co godzinę (albo przez cron/przycisk) pobiera strony z `SCRAPER_URLS` lub z ustawień sezonu.
2. Bierze tylko mecze, które zaczęły się ≥ 150 min temu (żeby nie złapać stanu w trakcie meczu).
3. Nie zależy od klas CSS: dzieli stronę na małe bloki tekstu i szuka w nich **dokładnie dwóch
   drużyn z terminarza** i wyniku `NN:NN` (godziny typu `20:30` są odrzucane). Drużyny rozpoznaje
   po charakterystycznych słowach nazwy (miasto, przydomek), więc zmiana sponsora nie przeszkadza.
   Kolejność drużyn rozstrzyga, który mecz dwumeczu to jest. Dodatkowe nazwy ustawisz w
   *Sezon → Wyniki auto* (np. „Apator” dla Torunia).
4. Kontrola sensowności: suma > 90 (15 biegów × 6) albo < 48 (mniej niż 8 biegów) **blokuje**
   zatwierdzenie bez korekty. Suma < 84, remis albo wynik drużyny spoza 30–60 dają ostrzeżenie.
   Rozbieżności między źródłami są wypisywane.
5. Powstaje **draft**, a admin dostaje push. Na *Pulpicie* („Wyniki do zatwierdzenia”) widać wynik,
   fragment tekstu ze źródła i uwagi. „Zatwierdź” (można poprawić liczby) wpisuje wynik, przelicza
   punkty i wysyła graczom push z ich punktami. Odrzucony albo poprawiony odczyt nie wraca.
   **„Zatwierdź wszystkie bez uwag”** bierze tylko wyniki bez blokad i bez ostrzeżeń — wynik
   z uwagą (np. źródła podają różne liczby) zatwierdzasz pojedynczo.
   Wiersz z wynikiem znanym z innego meczu tej samej pary (np. z rundy zasadniczej, gdy portal
   pokazuje cały sezon, a drużyny grają w play-off) jest pomijany.
6. Gdy żadne źródło nic nie zwróci (zmienił się układ strony), admin dostaje raz dziennie alert.
   Zawsze można wpisać wyniki ręcznie (*Mecze* albo „Mecze bez wyniku” na Pulpicie).

> Źródła wyników trzeba wskazać samemu i sprawdzić ich regulamin. Parser jest przetestowany na
> przykładowym HTML; na konkretnej stronie sprawdź go przyciskiem *Pobierz teraz* i dziennikiem w *System*.

## Aplikacja na telefon (PWA) i powiadomienia

- `manifest.webmanifest` jest generowany dynamicznie: gdy gracz doda do ekranu głównego **swój
  link** (`/typuj.html?id=…`), ikona otwiera od razu jego panel, bez paska przeglądarki.
- Service worker (`public/sw.js`): szybki start, ostatnie dane offline. Panel admina i zapisy
  nigdy nie idą przez cache. Wersję plików (`?v=…` w adresach i nazwę cache) serwer liczy sam
  z zawartości CSS/JS, więc po każdym deployu telefony graczy od razu dostają nowe pliki.
- **Przypomnienia:** 2 h przed blokadą (`REMINDER_MINUTES`) gracz bez typu dostaje push z listą
  meczów, raz na mecz. Gracz włącza je w swoim panelu. Na iPhonie działają po dodaniu do ekranu
  głównego (iOS 16.4+).
- **Admin:** *System → Powiadamiaj ten telefon* — alert o nowych wynikach do zatwierdzenia.

## Mistrz Typera i niespodzianka 🎁

1. *Sezon → Sezony → Zakończenie sezonu i Mistrz Typera*: wpisz **nagrodę** (np. „kask z autografem”)
   i **wiadomość** od organizatora, *Zapisz niespodziankę*. Panel pokazuje, kto byłby mistrzem,
   gdyby zamknąć sezon teraz.
2. Wskaż mistrza Polski, brąz i spadkowicza (trzy różne drużyny), włącz *Zamknij sezon i ogłoś
   Mistrza Typera* i kliknij *Rozlicz typy sezonowe*.
3. Mistrz dostaje push „Zostałeś Mistrzem Typera!”, a pozostali — o końcu sezonu (raz).
   Na stronie głównej jest baner mistrza z konfetti i podium, w galerii mistrzów — nowy wpis.
4. W **panelu mistrza** sama otwiera się **zdrapka**: zdrapuje kartę palcem i widzi nagrodę oraz
   wiadomość (przycisk „Odkryj od razu” działa też bez dotyku). Admin widzi, że niespodzianka została
   odebrana. Nagrody nie widzi nikt poza mistrzem — ani na stronie, ani cudzym linkiem.
5. Mistrz i podium mogą pobrać **dyplom** (PNG; na telefonie od razu „Udostępnij”).
   Przy pełnym remisie na szczycie jest dwóch mistrzów i obaj dostają niespodziankę.

W trakcie sezonu zwycięzca kolejki widzi w swoim panelu baner „👑 Zwycięzca kolejki”, a profil
gracza ma **osiągnięcia** (Snajper, Seria, As w rękawie, Złoty Kask, Rakieta, Lider, Mistrz Typera).

## Symulacja ligi

`npm run symulacja` przeprowadza cały sezon w prawdziwej aplikacji: 13 typerów o różnych stylach
(ekspert, kibic Motoru, „zawsze 46:44”, spóźnialski, zapominalski, podglądacz cudzych typów…),
mecze bieg po biegu, deszcz przed i po blokadzie, mecz przerwany, walkowery, korekta wyniku,
scraper czytający fikcyjne portale (z literówkami i awarią), Puchar Typerów, play-off i zamknięcie
sezonu z niespodzianką. Po każdej kolejce **niezależnie** przelicza punkty, ranking, tabelę i puchar
(15 niezmienników, ok. 50 tys. sprawdzeń). Monte Carlo (2000 sezonów) sprawdza zasady: czy wygrywa
umiejętność, jak często regulamin rozstrzyga remisy, ile znaczą Joker, Kask i typy sezonowe.
Symulacja działa też w CI (raport do pobrania). Wyniki i wnioski: **[SYMULACJA.md](SYMULACJA.md)**.

## Statystyki graczy

- **Profil typera** (`/gracz.html?nick=…`, klik w ranking): kafelki, wykres punktów w kolejkach
  na tle średniej ligi, wykres miejsca po każdej kolejce, historia typów (tylko po blokadzie),
  szybkie H2H.
- **H2H** (*Więcej*): bilans dwóch graczy na wspólnych meczach, w sezonie albo ze wszystkich sezonów.
- **Ranking wszech czasów:** suma ze wszystkich sezonów, tytuły mistrza typera, średnia, skuteczność.
- **Ranking sezonu** ze strzałkami awansu/spadku względem poprzedniej kolejki.

## Panel administratora (`/admin`)

Panel jest ułożony wokół tego, co admin robi najczęściej. Na telefonie nawigacja jest na dole,
na komputerze po lewej. Szczegóły meczu i gracza otwierają się w szufladzie, a każda nieodwracalna
operacja pyta o potwierdzenie.

| Sekcja | Co tam jest |
|---|---|
| **Pulpit** | „Do zrobienia”: wyniki ze scrapera do zatwierdzenia (z poprawką liczb), mecze bez wyniku (wpisujesz od razu), przełożone bez terminu („Ustal termin”), kto nie wytypował meczów z najbliższych 48 h (przycisk „Kopiuj przypomnienie” na grupę), stan systemu. Licznik spraw jest na ikonie Pulpitu. |
| **Mecze** | Kolejka po kolejce. Wynik wpisujesz na karcie meczu — pojawia się pasek „Zapisz wyniki” (z ostrzeżeniem przy sumie > 90 albo meczu z przyszłości). „Typy” pod meczem: typy wszystkich graczy, możesz wpisać typ za gracza (SMS). „Edytuj”: termin, przełożenie, Złoty Kask, zamrożenie, walkower, anulowanie typów, notatka, kolejka, usunięcie. |
| **Gracze** | Wyszukiwarka i filtry (w sezonie / wszyscy / wstrzymani). Karta gracza: link (kopiuj, WhatsApp, **nowy link = reset hasła**), konto aktywne/wstrzymane, udział w sezonie, zmiana pseudonimu (typy i punkty się przenoszą), typy gracza i typy sezonowe, test powiadomienia, usuwanie. |
| **Puchar** | Drabinka ze zwycięzcami i sposobem rozstrzygnięcia remisu, rozstawienie według rankingu, para ręcznie (gracz 1 = wyżej rozstawiony), przeliczenie z kolejek. |
| **Sezon** | *Zasady* (blokada w minutach z szybkim wyborem, punktacja i tolerancja różnicy z przeliczeniem), *Tabela* (korekty z powodem + podgląd), *Wyniki auto* (źródła i inne nazwy drużyn dla scrapera, dziennik pobrań), *Sezony* (lista, nowy sezon, generator terminarza, import JSON, zakończenie sezonu i Mistrz Typera z niespodzianką). |
| **System** | Powiadomienia (ten telefon, test, przypomnienia teraz), dziennik zadań w tle, kopia zapasowa i przywracanie, narzędzia, strefa ryzyka. |

Gdy edytujesz sezon inny niż aktywny (albo zakończony), na górze jest wyraźne ostrzeżenie.

## Jak przygotować nowy sezon

Bieżący sezon **zostaje nietknięty** — po przełączeniu trafia do archiwum i jest dostępny
z listy sezonów na stronie głównej oraz w panelu gracza.

1. **Panel → System → „Pobierz kopię (JSON)"** — zawsze przed większą operacją.
2. **Panel → Sezon → Sezony → Nowy sezon (krok 1):** rok, nazwa, ile minut przed pierwszym biegiem
   blokada (domyślnie 1), lista drużyn (jedna na linię — pole jest wypełnione drużynami bieżącego
   sezonu, podmieniasz spadkowicza na beniaminka). Zaznacz „przepisz graczy", jeśli
   grają ci sami ludzie. Zapisz jako **nieaktywny** — nikt jeszcze nic nie widzi.
3. **Nowy sezon (krok 2):** wpisz poniedziałek pierwszej kolejki, ustaw godziny meczów
   (domyślnie piątek 18:00 i 20:30, niedziela 16:00 i 19:15), podaj numery kolejek, po których
   ma być wolny tydzień, i kliknij **Podgląd**. Generator ułoży dwumecze każdy z każdym
   (8 drużyn = 14 kolejek po 4 mecze, każda para raz u siebie i raz na wyjeździe).
   Gdy wygląda dobrze — **Zapisz terminarz**.
   Alternatywa: wklej oficjalny terminarz jako JSON w polu importu.
4. **Mecze → Edytuj:** popraw pojedyncze daty i zaznacz mecze kolejki (Złoty Kask).
5. Gdy stary sezon się skończy: **Sezon → Sezony → Zakończenie sezonu** — wskaż mistrza, brąz
   i spadkowicza, rozlicz typy sezonowe, zaznacz „Zamknij sezon (archiwum)".
6. **„Ustaw aktywny"** przy nowym sezonie. Strona główna przełącza się na nowy sezon,
   gracze wchodzą tymi samymi linkami.

Faza play-off: kolejki, które mają własną nazwę w ustawieniach sezonu (domyślnie 15–20),
nie wchodzą do tabeli ligowej, ale normalnie się typuje i punktuje.

## Migracja z wersji 1

Nic nie musisz robić ręcznie. Przy pierwszym uruchomieniu serwer:

- dopisuje `season: 2026` (wartość z `LEGACY_SEASON`) do wszystkich starych meczów, typów,
  zakładów długoterminowych i par pucharowych,
- tworzy sezon 2026 i ustawia go jako aktywny,
- odczytuje listę drużyn z terminarza,
- przypisuje graczy do sezonu 2026,
- ostrzega w konsoli, jeśli w bazie są **zdublowane mecze** (zdarzało się przy wgrywaniu play-off).
  Duplikaty usuń w panelu → *Mecze* → „Edytuj” → „Usuń mecz", albo hurtem
  *System* → „Usuń kolejki”.

Kolejność wdrożenia, którą polecam: kopia zapasowa starej bazy → zmiana hasła Atlas →
wdrożenie 2.0 → sprawdzenie konsoli → regeneracja linków graczy.

## Wydajność

- Przeliczenie meczu/sezonu: jeden `bulkWrite` zamiast zapisu każdego typu osobno, a zapisywane są
  tylko typy, którym zmieniły się punkty.
- Zapis typów gracza: jeden `bulkWrite` na całą kolejkę.
- Rodzaj trafienia (`outcome`) jest zapisywany przy rozliczeniu, więc statystyki nie muszą łączyć typów z meczami.
- Strona główna, profile i H2H są w cache w pamięci (15 s), czyszczonym po każdym zapisie.
- Indeksy: `(sezon, gracz, mecz)` unikalny, `matchId`, `(sezon, data meczu)`.
- Obliczenia rankingu są liniowe względem liczby typów; przy kilkudziesięciu graczach to milisekundy.

## Struktura

```
server.js                 start, manifest PWA, service worker, statyczne pliki
render.yaml               blueprint Render
config/index.js           stałe: punktacja, blokada, progi scrapera i przypomnień
models/Database.js        schematy Mongo (+ drafty wyników, subskrypcje push, dzienniki)
services/scoring.js       punkty, tabela, ranking, przebieg sezonu, H2H, all-time (czyste funkcje)
services/seasons.js       sezony, migracja, przeliczanie (bulkWrite)
services/results.js       zapis wyniku (ręczny i ze scrapera) + push z punktami
services/scraper.js       pobieranie wyników, dopasowanie drużyn, kontrola sensowności
services/push.js          Web Push (VAPID), deduplikacja powiadomień
services/jobs.js          scraper + przypomnienia, harmonogram
services/cache.js         cache odczytów
services/names.js         krótkie nazwy drużyn do powiadomień (ta sama reguła co w przeglądarce)
routes/                   API publiczne, admina i wyzwalacz cron
public/                   index (strona główna), zasady (regulamin), typuj (panel gracza), gracz (profil), admin, sw.js
src/app.css               źródło Tailwind (tokeny kolorów, jasny/ciemny motyw)
scripts/                  demo bez bazy (też dane do testów E2E), generator ikon, symulacja ligi
scripts/sim/              silnik meczu bieg po biegu, typerzy, sezon przez API, Monte Carlo, raport
test/                     scoring (jednostkowe), api + scenarios (integracyjne na atrapie bazy), e2e (przeglądarka)
.github/workflows/        testy + cron budzący Render
```

## Uwagi techniczne

- Logo drużyn są linkowane z zewnętrznego serwisu. Gdy nie działają, pojawia się plakietka z
  inicjałami. Docelowo lepiej wrzucić pliki do `public/logos/` i podmienić mapę `LOGOS` w `public/js/shared.js`.
- Sesje admina, limity żądań i cache są w pamięci procesu: przy jednej instancji (Render) to
  wystarcza. Restart wylogowuje panel.
- Limit prób logowania (10 na 15 min) liczy się po prawdziwym adresie klienta (`req.ip` przy
  `trust proxy`), więc nie da się go obejść podrabianym nagłówkiem `X-Forwarded-For`.
- Godziny meczów z generatora są liczone w czasie polskim niezależnie od strefy serwera.
  Zegar w aplikacji synchronizuje się z serwerem (telefon ze złą godziną nie zamknie typów za wcześnie).
- Po zmianie klas w HTML/JS uruchom `npm run build:css` (Render robi to przy każdym deployu).
- `test/fake-db.js` to atrapa Mongo dla testów i trybu demo — nie jest używana na produkcji.

### Co naprawiła wersja 2

| Problem w wersji 1 | Rozwiązanie |
|---|---|
| `/api/public/data` zwracało tokeny wszystkich graczy | publiczne API oddaje wyłącznie pseudonimy; tokeny tylko dla zalogowanego admina |
| Typy przed blokadą były widoczne w API („kłódka" tylko w HTML) | ukrywanie po stronie serwera — przed blokadą widać tylko, kto już wytypował |
| Dwie kopie `typuj.js` z blokadą 8 h i 24 h | jedna kopia w `public/js/typuj.js`, blokada z ustawień sezonu |
| Gracz widział otwarte pole, a serwer po cichu odrzucał typ | serwer zwraca liczbę zapisanych/pominiętych, panel pokazuje prawdziwy status |
| Joker mógł zostać użyty dwa razy | serwer pilnuje jednego jokera na sezon i zdejmuje go z poprzedniego meczu |
| Przycisk „Rozlicz sezon" wołał nieistniejący endpoint | działa i wymaga wskazania faktycznego mistrza / brązu / spadkowicza |
| Blokada typów sezonowych liczona z losowego meczu | liczona z chronologicznie pierwszego meczu sezonu |
| Duplikaty typów (np. „Ormani") | indeks unikalny `(sezon, gracz, mecz)` fizycznie ich nie dopuszcza |
| Hasło admina w `localStorage`, wysyłane przy każdym żądaniu | logowanie raz, potem token sesji (8 h), limit prób, porównanie odporne na timing |
| Brak walidacji po stronie serwera | wyniki i typy: tylko liczby całkowite 0–75 |
| Nazwy drużyn i rund w czterech plikach | jedno źródło: ustawienia sezonu + `public/js/shared.js` |
| Terminarz fazy finałowej wpisany na sztywno w HTML | generowany z danych, więc nie trzeba go przepisywać co rok |
| Brak logo dla nowej drużyny psuło widok | zastępcza plakietka z inicjałami |

