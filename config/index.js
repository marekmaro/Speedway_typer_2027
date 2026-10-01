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

module.exports = {
    // Ile godzin przed pierwszym wyścigiem zamykamy typowanie
    DEFAULT_LOCK_HOURS: 24,

    // Maksymalna liczba punktów meczowych jaką można wpisać (żużel: 15 biegów)
    MAX_SCORE: 75,

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
    ADMIN_SESSION_TTL: 8 * 60 * 60 * 1000
};
