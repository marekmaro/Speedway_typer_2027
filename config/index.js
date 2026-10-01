// Centralne miejsce na stałe całej aplikacji.
// Zmieniasz tu -> zmienia się wszędzie (serwer + frontend przez /api/public/config).

const DEFAULT_SCORING = {
    exact: 5,          // dokładny wynik
    diff: 3,           // dobry zwycięzca + dokładna różnica
    winner: 2,         // dobry zwycięzca
    motrBonus: 1,      // Złoty Kask (mecz kolejki) - dodatkowy punkt przy 5 lub 3 pkt
    jokerMultiplier: 2,// Joker mnoży cały dorobek z meczu
    longTermEach: 10   // za każdy trafiony typ długoterminowy
};

const num = (v, def) => (v === undefined || v === '' || isNaN(Number(v)) ? def : Number(v));

module.exports = {
    // Ile minut przed pierwszym biegiem zamykamy typowanie (nowe sezony).
    // Stare sezony z polem lockHours działają dalej, dopóki admin nie ustawi minut.
    DEFAULT_LOCK_MINUTES: 1,

    // Wartość z wersji 2 - używana tylko dla sezonów, które nie mają lockMinutes
    DEFAULT_LOCK_HOURS: 24,

    // Maksymalna liczba punktów meczowych jaką można wpisać (żużel: 15 biegów)
    MAX_SCORE: 75,

    // Suma punktów obu drużyn w pełnym meczu: 15 biegów x (3+2+1+0) = 90.
    // Mniej = upadki, wykluczenia, defekty albo mecz przerwany.
    FULL_MATCH_TOTAL: 90,
    // Mecz jest zaliczony po 8 biegach (8 x 6 = 48 pkt) - poniżej tego wynik nie jest wiarygodny.
    MIN_VALID_TOTAL: 48,

    // Domyślna punktacja nowego sezonu
    DEFAULT_SCORING,

    // Domyślne nazwy rund fazy finałowej (można nadpisać per sezon w panelu)
    DEFAULT_STAGE_NAMES: {
        15: 'Mecze o 5-6 miejsce',
        16: 'Mecze o 5-6 miejsce (rewanże)',
        17: 'Półfinały',
        18: 'Półfinały (rewanże)',
        19: 'Finał / mecz o 3. miejsce',
        20: 'Finał / o 3. miejsce (rewanże)'
    },

    // Sezon, którym stemplowane są stare dane przy pierwszym uruchomieniu v2
    LEGACY_SEASON: Number(process.env.LEGACY_SEASON || 2026),

    // Ważność sesji admina (ms)
    ADMIN_SESSION_TTL: 8 * 60 * 60 * 1000,

    // ---- zadania w tle ----
    // Przypomnienie push: ile minut przed blokadą typów
    REMINDER_MINUTES: num(process.env.REMINDER_MINUTES, 120),
    // Scraper bierze pod uwagę mecze, które zaczęły się co najmniej tyle minut temu
    // (żeby nie złapać wyniku "na żywo" w trakcie meczu)
    SCRAPE_MIN_AGE_MINUTES: num(process.env.SCRAPE_MIN_AGE_MINUTES, 150),
    // ... i nie starsze niż tyle dni (stare zaległości admin wpisuje ręcznie)
    SCRAPE_MAX_AGE_DAYS: num(process.env.SCRAPE_MAX_AGE_DAYS, 14)
};
