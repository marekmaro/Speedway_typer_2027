/* ------------------------------------------------------------------
   Silnik symulacji: losowanie z ziarnem, siła drużyn i mecz żużlowy bieg po biegu.
   Mecz = 15 biegów, w każdym 2 zawodników gospodarzy i 2 gości, punktacja 3-2-1-0.
   Upadek / defekt / wykluczenie = 0 pkt, więc suma meczu bywa mniejsza niż 90.
   Siły drużyn są umowne (to symulacja, nie prognoza).
------------------------------------------------------------------- */

/** Generator liczb losowych z ziarnem (mulberry32) - ten sam seed = ten sam sezon. */
function rngOf(seed) {
    let s = seed >>> 0;
    const next = () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
        pick: arr => arr[Math.floor(next() * arr.length)],
        chance: p => next() < p,
        normal: (mu = 0, sd = 1) => mu + sd * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
        shuffle: arr => {
            const a = [...arr];
            for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
            return a;
        }
    };
}

// Umowna siła drużyn (średnia "prędkość" zawodnika). Kolejność nazw jak w terminarzu demo.
const STRENGTH = {
    'Orlen Oil Motor Lublin': 1.00,
    'Betard Sparta Wrocław': 0.93,
    'PRES Grupa Deweloperska Toruń': 0.89,
    'Krono-Plast Włókniarz Częstochowa': 0.75,
    'Gezet Stal Gorzów': 0.73,
    'Fogo Unia Leszno': 0.71,
    'Bayersystem GKM Grudziądz': 0.67,
    'Stelmet Falubaz Zielona Góra': 0.65
};
const TEAMS = Object.keys(STRENGTH);
// Skalibrowane tak, by przypominać ligę: gospodarz wygrywa ~64% meczów, typowa różnica ~10 pkt,
// faworyt u siebie z najsłabszym ok. 57:33, a na wyjeździe ok. 51:39.
const HOME_BONUS = 0.12;   // znajomość własnego toru
const RIDER_SD = 0.60;     // forma dnia, start spod taśmy, ścieżka
const DNF = 0.02;          // upadek / defekt / wykluczenie w biegu

/**
 * Mecz bieg po biegu. maxHeats < 15 = mecz przerwany (np. deszcz).
 * Zwraca { home, away, heats: [[h, a], ...] }.
 */
function simulateMatch(home, away, rng, { maxHeats = 15 } = {}) {
    const sh = STRENGTH[home] + HOME_BONUS, sa = STRENGTH[away];
    let h = 0, a = 0;
    const heats = [];
    for (let i = 0; i < maxHeats; i++) {
        const riders = [
            { side: 'h', perf: rng.normal(sh, RIDER_SD) }, { side: 'h', perf: rng.normal(sh, RIDER_SD) },
            { side: 'a', perf: rng.normal(sa, RIDER_SD) }, { side: 'a', perf: rng.normal(sa, RIDER_SD) }
        ];
        const finishers = riders.filter(() => !rng.chance(DNF)).sort((x, y) => y.perf - x.perf);
        let hh = 0, aa = 0;
        finishers.forEach((r, idx) => { const pts = 3 - idx; if (r.side === 'h') hh += pts; else aa += pts; });
        heats.push([hh, aa]);
        h += hh; a += aa;
    }
    return { home: h, away: a, heats };
}

/** Średni wynik gospodarzy dla każdej pary - "wiedza eksperta" (liczona symulacją, nie wzorem). */
function expectedTable(samples = 300, seed = 99) {
    const rng = rngOf(seed);
    const out = {};
    for (const h of TEAMS) for (const a of TEAMS) {
        if (h === a) continue;
        let sum = 0;
        for (let i = 0; i < samples; i++) { const r = simulateMatch(h, a, rng); sum += r.home * 90 / (r.home + r.away); }
        out[`${h}|${a}`] = sum / samples;
    }
    return out;
}

/** Wynik "po żużlowemu": liczba całkowita gospodarzy 30-60, goście dopełniają do 90. */
function toScore(homeMean) {
    const h = Math.max(30, Math.min(60, Math.round(homeMean)));
    return [h, 90 - h];
}

module.exports = { rngOf, STRENGTH, TEAMS, HOME_BONUS, simulateMatch, expectedTable, toScore };
