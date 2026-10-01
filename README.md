# Żużlowy Typer 2.0

Typer żużlowej Ekstraligi dla znajomych: terminarz, wyniki, ranking typerów, Joker, Złoty Kask,
typy długoterminowe i Puchar Typerów (H2H). Wersja 2.0 obsługuje **wiele sezonów** — bieżący sezon
gra się normalnie, a nowy przygotowujesz obok i włączasz jednym przyciskiem.

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

## Instalacja

```bash
npm install
cp .env.example .env     # i uzupełnij dane
npm start                # produkcyjnie
npm run dev              # z auto-restartem (nodemon)
npm test                 # 61 testów, nie wymaga bazy
```

Plik `.env`:

```
MONGODB_URI=mongodb+srv://user:haslo@klaster.mongodb.net/zuzel-typer
ADMIN_PASSWORD=dlugie-haslo-admina
PORT=3000
LEGACY_SEASON=2026
```

Serwer nie wystartuje bez `MONGODB_URI` (zamiast cicho działać z pustą bazą, jak wcześniej).
Kontrola stanu: `GET /healthz`.

## Migracja z wersji 1

Nic nie musisz robić ręcznie. Przy pierwszym uruchomieniu serwer:

- dopisuje `season: 2026` (wartość z `LEGACY_SEASON`) do wszystkich starych meczów, typów,
  zakładów długoterminowych i par pucharowych,
- tworzy sezon 2026 i ustawia go jako aktywny,
- odczytuje listę drużyn z terminarza,
- przypisuje graczy do sezonu 2026,
- ostrzega w konsoli, jeśli w bazie są **zdublowane mecze** (zdarzało się przy wgrywaniu play-off).
  Duplikaty usuń w panelu → *Terminarz* → wybierz mecz → „Usuń mecz", albo hurtem
  *System* → „Usuń kolejki od numeru".

Kolejność wdrożenia, którą polecam: kopia zapasowa starej bazy → zmiana hasła Atlas →
wdrożenie 2.0 → sprawdzenie konsoli → regeneracja linków graczy.

## Struktura

```
server.js                 start serwera, statyczne pliki, obsługa błędów
config/index.js           stałe: punktacja, blokada, nazwy rund finałowych
models/Database.js        schematy Mongo + indeksy unikalne
services/scoring.js       punkty, tabela, ranking, maskowanie typów (czyste funkcje)
services/schedule.js      generator terminarza (karuzela Bergera)
services/seasons.js       sezony, migracja, przeliczanie punktów
middleware/auth.js        logowanie admina, sesje, limity żądań
routes/publicRoutes.js    API strony i panelu gracza
routes/adminRoutes.js     API panelu administratora
public/                   frontend (index, typuj, admin + wspólny js/shared.js)
test/                     61 testów: jednostkowe + integracyjne na atrapie bazy
```

## Co zostało naprawione

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

## Jak przygotować nowy sezon

Bieżący sezon **zostaje nietknięty** — po przełączeniu trafia do archiwum i jest dostępny
z listy sezonów na stronie głównej oraz w panelu gracza.

1. **Panel → 7. System → „Pobierz kopię (JSON)"** — zawsze przed większą operacją.
2. **Panel → 6. Sezony → Nowy sezon (krok 1):** rok, nazwa, ile godzin przed meczem blokada
   (domyślnie 24), lista drużyn (jedna na linię — przycisk „Wklej drużyny z bieżącego sezonu"
   pomaga, potem podmieniasz spadkowicza na beniaminka). Zaznacz „przepisz graczy", jeśli
   grają ci sami ludzie. Zapisz jako **nieaktywny** — nikt jeszcze nic nie widzi.
3. **Nowy sezon (krok 2):** wpisz poniedziałek pierwszej kolejki, ustaw godziny meczów
   (domyślnie piątek 18:00 i 20:30, niedziela 16:00 i 19:15), podaj numery kolejek, po których
   ma być wolny tydzień, i kliknij **Podgląd**. Generator ułoży dwumecze każdy z każdym
   (8 drużyn = 14 kolejek po 4 mecze, każda para raz u siebie i raz na wyjeździe).
   Gdy wygląda dobrze — **Zapisz terminarz**.
   Alternatywa: wklej oficjalny terminarz jako JSON w polu importu.
4. **Zakładka 2. Terminarz:** popraw pojedyncze daty i zaznacz mecze kolejki (Złoty Kask).
5. Gdy stary sezon się skończy: **6. Sezony → Zamknięcie sezonu** — wskaż mistrza, brąz
   i spadkowicza, rozlicz typy długoterminowe, zaznacz „oznacz jako zakończony".
6. **„Ustaw aktywny"** przy nowym sezonie. Strona główna przełącza się na nowy sezon,
   gracze wchodzą tymi samymi linkami.

Faza play-off: kolejki, które mają własną nazwę w ustawieniach sezonu (domyślnie 15–20),
nie wchodzą do tabeli ligowej, ale normalnie się typuje i punktuje.

## Zasady gry (konfigurowalne per sezon)

- **5 pkt** — dokładny wynik
- **3 pkt** — dobry zwycięzca i dokładna różnica punktowa
- **2 pkt** — dobry zwycięzca
- **0 pkt** — pudło
- **Złoty Kask** — w wyróżnionym meczu kolejki trafienie na 5 lub 3 pkt daje **+1 pkt**
- **Joker** — raz w sezonie mnoży dorobek z jednego meczu **x2** (maksimum z meczu: 12 pkt)
- **Typy długoterminowe** — mistrz / brąz / spadek, po **+10 pkt**, typowane przed
  pierwszym meczem sezonu
- **Puchar Typerów** — pary rozstawiane wg rankingu (1 vs ostatni), wygrywa ten, kto zdobędzie
  więcej punktów w wyznaczonej kolejce

Regulamin na stronie generuje się z tych ustawień, więc po zmianie punktacji nie trzeba
poprawiać tekstu.

## Codzienna obsługa

- **Po każdej kolejce:** panel → *1. Wyniki* → wybierz kolejkę → wpisz cztery wyniki →
  „Zapisz wyniki kolejki". Punkty przeliczają się same.
- **Mecz odwołany:** *2. Terminarz* → zaznacz „odwołany", po ustaleniu nowej daty wpisz ją —
  blokada policzy się od nowa, typy zostają.
- **Ktoś podał typ SMS-em:** *4. Typy graczy* → wybierz gracza i kolejkę → wpisz i zapisz
  (omija blokadę czasową).
- **Puchar:** *5. Puchar* → „Rozstaw pary", a po kolejce „Przelicz wyniki H2H".
- **Nowy uczestnik w trakcie sezonu:** *3. Gracze* → dodaj → „Kopiuj link" lub „WhatsApp".

## Uwagi techniczne

- Logo drużyn są linkowane z zewnętrznego serwisu (zostały z wersji 1). Gdy przestaną się
  ładować, w miejscu obrazka pojawi się plakietka z inicjałami — strona nie rozjedzie się.
  Docelowo lepiej wrzucić pliki do `public/logos/` i podmienić mapę `LOGOS` w `public/js/shared.js`.
- Tailwind wczytywany jest z CDN (`cdn.tailwindcss.com`) — wygodne, ale wymaga internetu
  u gracza i wypisuje ostrzeżenie w konsoli. Na produkcji można to zamienić na zbudowany plik CSS.
- Limity żądań są trzymane w pamięci procesu — przy jednym serwerze (Render, Railway, VPS)
  działają dobrze; przy kilku instancjach każda ma własny licznik.
- Sesje admina też są w pamięci: restart serwera wylogowuje panel. To celowe i bezpieczne.
- `test/fake-db.js` to miniaturowa atrapa Mongo używana wyłącznie w testach — nie trafia
  na produkcję i nie jest importowana przez aplikację.
