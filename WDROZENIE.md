# Jak postawić Żużlowego Typera w internecie — krok po kroku

Wszystko jest **za darmo**: Render (serwer), MongoDB Atlas (baza danych), GitHub (kod i budzik).
Zajmie to ok. 40 minut. Potrzebujesz tylko przeglądarki i notatnika na hasła.

> Zapisuj w notatniku: adres bazy (`MONGODB_URI`), hasło admina i adres strony z Render.
> To są tajne dane — nie wysyłaj ich nikomu i nie wgrywaj na GitHub.

| Krok | Co robisz | Czas |
|---|---|---|
| 1 | GitHub: najnowsza wersja do gałęzi `main` | 2 min |
| 2 | MongoDB Atlas: baza danych | 10 min |
| 3 | Render: serwer i adres strony | 10 min |
| 4 | GitHub: budzik dla serwera | 5 min |
| 5 | Panel admina: sezon, terminarz, gracze | 15 min |

---

## Krok 1. GitHub — najnowsza wersja do gałęzi `main` (2 min)

Render bierze kod z gałęzi `main`. Nowe zmiany trafiają najpierw do gałęzi
`claude/zuzel-prediction-app-4v7rxu`, a do `main` przenosisz je *pull requestem*.
Jeśli GitHub pisze „There isn't anything to compare”, to `main` jest aktualny — przejdź do kroku 2.

1. Wejdź na https://github.com/marekmaro/Speedway_typer_2027 i zaloguj się.
2. Jeśli na górze jest żółty pasek z zielonym przyciskiem **Compare & pull request** — kliknij go.
   Jeśli paska nie ma, otwórz:
   https://github.com/marekmaro/Speedway_typer_2027/pull/new/claude/zuzel-prediction-app-4v7rxu
3. Kliknij zielony **Create pull request** (jeśli pojawi się drugi raz, kliknij jeszcze raz).
4. Poczekaj, aż przy **Testy** pojawi się zielony ✓ (GitHub sam sprawdza aplikację, ok. 2 min).
5. Kliknij **Merge pull request**, potem **Confirm merge**. Gotowe.

Tak samo robisz przy każdej kolejnej zmianie, którą dla Ciebie przygotuję.

## Krok 2. Baza danych — MongoDB Atlas (10 min)

### A. Masz już bazę ze starej wersji typera

Użyj jej — nowa wersja sama przeniesie stare dane (trafią do sezonu 2026) i niczego nie usuwa.

1. Wejdź na https://cloud.mongodb.com i zaloguj się.
2. Z lewej (sekcja *Security*) **Database Access** → przy swoim użytkowniku **Edit** →
   **Edit Password** → **Autogenerate Secure Password** → **Copy** (wklej do notatnika) → **Update User**.
   Zmieniamy hasło, bo stare było zapisane w pliku `db_adres.txt` w starym projekcie.
3. Z lewej **Network Access**. Musi tam być wpis `0.0.0.0/0`. Jeśli go nie ma:
   **Add IP Address** → **Allow Access from Anywhere** → **Confirm**.
4. Weź stary adres bazy (z `db_adres.txt`, zaczyna się od `mongodb+srv://`) i podmień w nim
   **tylko hasło** — fragment między `:` a `@`. Nic więcej nie zmieniaj: nazwa po `.mongodb.net/`
   wskazuje bazę ze starymi danymi.

### B. Nie masz bazy — zakładasz nową

1. Wejdź na https://www.mongodb.com/cloud/atlas/register i załóż konto (można przez Google).
2. Wybierz darmowy plan **M0 (Free)**, dostawca **AWS**, region **Frankfurt (eu-central-1)** →
   **Create Deployment**.
3. Utwórz użytkownika bazy: nazwa np. `typer`, hasło — **Autogenerate**, skopiuj do notatnika →
   **Create Database User**. (Generowane hasło ma same litery i cyfry — znaki `@ : / ? #`
   w haśle psują adres.)
4. Wybierz sposób połączenia **Drivers** i skopiuj adres (zaczyna się od `mongodb+srv://`).
5. W notatniku zamień `<db_password>` na hasło, a przed znakiem `?` dopisz `zuzel-typer`. Przykład:
   `mongodb+srv://typer:Ab12Cd34@cluster0.abcde.mongodb.net/zuzel-typer?retryWrites=true&w=majority`
6. Z lewej **Network Access** → **Add IP Address** → **Allow Access from Anywhere** → **Confirm**.

Ten adres to Twój **MONGODB_URI**.

## Krok 3. Serwer — Render (10 min)

1. Wejdź na https://render.com → **Get Started** → zaloguj się przez **GitHub**.
2. U góry kliknij **+ New** → **Blueprint**.
3. Przy repozytorium `marekmaro/Speedway_typer_2027` kliknij **Connect**.
   Nie widzisz go? Kliknij **Configure GitHub**, zaznacz to repozytorium i wróć.
4. Wpisz nazwę (np. `typer`), gałąź zostaw **main**. Render pokaże usługę **zuzlowy-typer**
   i tylko dwa pola do uzupełnienia:
   - **MONGODB_URI** — adres z kroku 2,
   - **ADMIN_PASSWORD** — wymyśl długie hasło do panelu admina (zapisz je!).

   Resztę ustawiają same Render i serwer: sekret budzika (`CRON_SECRET`) i klucze powiadomień
   (generują się przy pierwszym starcie i zostają w bazie).
5. Kliknij **Deploy Blueprint** i poczekaj 3–5 minut, aż usługa będzie zielona (**Live**).
6. Kliknij usługę **zuzlowy-typer**. U góry jest adres strony, np. `https://zuzlowy-typer.onrender.com`
   (może mieć dopisek, np. `zuzlowy-typer-ab12`). Otwórz go — powinna się pokazać strona typera.
   Sprawdzenie: dopisz na końcu adresu `/healthz`. Ma być widać `"ok":true`, `"db":true`
   i `"push":true`.

**Coś nie działa?** Zakładka **Logs** pokazuje, co się stało:

| W logach widzisz | Co zrobić |
|---|---|
| `bad auth` / `authentication failed` | złe hasło w `MONGODB_URI` |
| `Could not connect to any servers` | w Atlasie brak `0.0.0.0/0` w **Network Access** |
| `Brak MONGODB_URI` | nie wpisany adres bazy |

Poprawkę wpisujesz w zakładce **Environment** → **Save Changes** (Render sam uruchomi stronę ponownie).
Gdy wszystko jest dobrze, w logach jest `✅ Połączono z bazą MongoDB.`
i `🔔 Powiadomienia push: klucze z bazy`.

**Masz już na Render starą wersję typera?** Postaw nową jak wyżej, sprawdź, że działa i widzi dane,
a starą usuń: stara usługa → **Settings** → na dole **Delete Web Service**.

## Krok 4. Budzik dla serwera (5 min)

Darmowy serwer zasypia po 15 minutach bez odwiedzin — wtedy nie wysyła przypomnień i nie pobiera
wyników. GitHub będzie go budził co 30 minut (marzec–październik, w ciągu dnia).

1. Render → usługa → zakładka **Environment** → przy `CRON_SECRET` kliknij oko i skopiuj wartość.
2. GitHub → repozytorium → zakładka **Settings** (u góry) → z lewej **Secrets and variables** →
   **Actions** → **New repository secret**:
   - Name: `APP_URL`, Secret: adres z Render, np. `https://zuzlowy-typer.onrender.com`
     → **Add secret**,
   - jeszcze raz **New repository secret**: Name: `CRON_SECRET`, Secret: skopiowana wartość →
     **Add secret**.
3. GitHub → zakładka **Actions** → z lewej **Zadania typera** → **Run workflow** → **Run workflow**.
   Po minucie powinien być zielony ✓ — to znaczy, że serwer się obudził i wykonał zadania.
   Jeśli GitHub pyta o włączenie workflowów, kliknij
   „I understand my workflows, go ahead and enable them”.
   Czerwony ✗? Kliknij go i przeczytaj błąd:
   - „Brak sekretów” — wróć do punktu 2 (nazwy dokładnie `APP_URL` i `CRON_SECRET`),
   - `401` — `CRON_SECRET` różni się od tego w Render,
   - `Could not resolve host` albo `404` — literówka w adresie.

## Krok 5. Pierwsze kroki w typerze (15 min)

1. Otwórz `https://TWÓJ-ADRES.onrender.com/admin`, wpisz hasło admina → **Wjazd na tor**.
2. **Sezon → Sezony → 🆕 Nowy sezon — krok 1**: rok `2027`, nazwa `PGE Ekstraliga 2027`,
   drużyny (po jednej w linii) → **Zapisz i aktywuj**.
3. **📅 Krok 2: terminarz**: poniedziałek 1. kolejki, dni i godziny meczów → **Podgląd** →
   **Zapisz terminarz**. Dokładne daty z ligi poprawisz później w **Mecze → Edytuj**.
4. **Gracze → + Dodaj gracza**: pseudonim → **Dodaj** → **WhatsApp** albo **Kopiuj link**.
   Każdy gracz dostaje swój link — to jego hasło.
5. Wyślij wszystkim adres zasad: `https://TWÓJ-ADRES.onrender.com/zasady`.
6. Gracze otwierają swój link na telefonie, dodają go do ekranu głównego
   (Android: menu ⋮ → „Dodaj do ekranu głównego”, iPhone/Safari: Udostępnij → „Do ekranu
   początkowego”) i w panelu klikają **Włącz powiadomienia**. Na iPhonie powiadomienia działają
   dopiero po otwarciu typera z ikony na ekranie głównym.
7. Powiadomienia dla siebie: **System** (na telefonie: **Więcej → System**) →
   **Powiadamiaj ten telefon o wynikach** → **Wyślij test**.
8. Wyniki meczów wpisujesz w **Mecze** (wynik na karcie meczu → **Zapisz**). Możesz też dodać
   strony z wynikami w **Sezon → Wyniki auto** — wtedy serwer sam podsunie wyniki, a Ty tylko
   klikasz **✓ Zatwierdź** na **Pulpicie**.

---

**Aktualizacje:** każda zmiana w gałęzi `main` (jak w kroku 1) sama przebudowuje stronę na Render
w 3–5 minut. Telefony graczy pobierają nowe pliki same.

**Kopia zapasowa:** raz na jakiś czas **System → 💾 Kopia zapasowa → Pobierz kopię (JSON)**.

**Darmowy plan:** pierwsze wejście po dłuższej przerwie trwa do minuty, bo serwer się budzi.
Płatny plan Render *Starter* (ok. 7 $ miesięcznie) nie zasypia.

**Własne klucze powiadomień** (niepotrzebne, dla zaawansowanych): `npm run vapid`, wynik wpisz
w Render → **Environment** jako `VAPID_PUBLIC_KEY` i `VAPID_PRIVATE_KEY`. Telefony graczy same
przepiszą się na nowe klucze przy następnym wejściu do typera.
