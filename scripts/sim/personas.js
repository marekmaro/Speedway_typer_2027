/* ------------------------------------------------------------------
   Typerzy w symulacji: każdy ma inny styl typowania, inną strategię Jokera
   i inne nawyki (spóźnianie się, zapominanie, poprawianie typów).
   predictFor() jest czystą funkcją - korzysta z niej zarówno sezon przez API, jak i Monte Carlo.
------------------------------------------------------------------- */
const { toScore } = require('./engine');

const LUBLIN = 'Orlen Oil Motor Lublin';

const PERSONAS = [
    { nick: 'Ekspert', kind: 'ekspert', desc: 'zna siłę drużyn (z niewielkim błędem), Joker na najpewniejszy mecz' },
    { nick: 'KibicMotoru', kind: 'kibic', desc: 'Motor zawsze wygrywa 54:36, reszta „na gospodarza”' },
    { nick: 'Remisiarz', kind: 'remis', desc: 'przy wyrównanych parach typuje remis 45:45' },
    { nick: 'Pan4644', kind: 'klasyk', desc: 'zawsze 46:44 dla gospodarzy' },
    { nick: 'Gospodarz', kind: 'gospodarz', desc: 'zawsze 50:40 dla gospodarzy' },
    { nick: 'Losowy', kind: 'losowy', desc: 'losowy wynik z sumą 90' },
    { nick: 'Statystyk', kind: 'statystyk', desc: 'liczy z tabeli ligi (punkty i małe punkty na mecz)' },
    { nick: 'Spóźnialski', kind: 'spoznialski', desc: 'dobry typer, ale typuje w ostatniej chwili — co trzeci typ po blokadzie' },
    { nick: 'Zapominalski', kind: 'zapominalski', desc: 'pomija co trzeci mecz, raz podał typ SMS-em, wstrzymany na 2 kolejki' },
    { nick: 'Podglądacz', kind: 'podgladacz', desc: 'chce zerknąć na cudze typy przed blokadą (nie widzi nic) i typuje 46:44' },
    { nick: 'Jokerowiec', kind: 'jokerowiec', desc: 'przekłada Jokera między meczami, próbuje przenieść zablokowanego' },
    { nick: 'Poprawiacz', kind: 'poprawiacz', desc: 'poprawia typy kilka razy, czasem czyści i wpisuje od nowa' },
    { nick: 'Nowy', kind: 'nowy', desc: 'dołącza po 5. kolejce, typy sezonowe już zamknięte', joinRound: 6 }
];

/** Typ [gospodarze, goście] albo null (pomija mecz). ctx: { E, table }. */
function predictFor(kind, m, ctx, rng) {
    const e = ctx.E[`${m.homeTeam}|${m.awayTeam}`];
    switch (kind) {
        case 'ekspert': return toScore(e + rng.normal(0, 1.5));
        case 'kibic':
            if (m.homeTeam === LUBLIN) return [54, 36];
            if (m.awayTeam === LUBLIN) return [36, 54];
            return [48, 42];
        case 'remis': return Math.abs(e - 45) < 3 ? [45, 45] : toScore(Math.round((e + rng.normal(0, 2)) / 2) * 2);
        case 'klasyk': return [46, 44];
        case 'gospodarz': return [50, 40];
        case 'losowy': { const h = rng.int(34, 56); return [h, 90 - h]; }
        case 'statystyk': {
            const row = n => (ctx.table || []).find(x => x.name === n);
            const H = row(m.homeTeam), A = row(m.awayTeam);
            if (!H || !A || H.matches < 2 || A.matches < 2) return [48, 42];
            const ppm = x => x.points / x.matches, dpm = x => x.diff / x.matches;
            const margin = 6 + 2.5 * (ppm(H) - ppm(A)) + (dpm(H) - dpm(A)) / 2.5;
            return toScore(45 + margin / 2);
        }
        case 'spoznialski': return toScore(e + rng.normal(0, 2.5));
        case 'zapominalski': return e >= 45 ? [47, 43] : [43, 47];
        case 'podgladacz': return [46, 44]; // nie widzi cudzych typów przed blokadą, więc "jak wszyscy"
        case 'jokerowiec': return toScore(e + rng.normal(0, 3));
        case 'poprawiacz': return toScore(e + rng.normal(0, 2));
        case 'nowy': return toScore(e + rng.normal(0, 4));
        default: throw new Error(`Nieznany typer ${kind}`);
    }
}

/** Pewność typu eksperta = jak daleko od remisu jest średni wynik. */
const confidence = (m, ctx) => Math.abs(ctx.E[`${m.homeTeam}|${m.awayTeam}`] - 45);

/**
 * Na który mecz kolejki typer stawia Jokera (albo null). Wywoływane tylko, gdy Joker jest wolny.
 * Strategie "z przygodami" (Jokerowiec, KibicMotoru, Poprawiacz) obsługuje scenariusz sezonu.
 */
function jokerPick(kind, round, open, ctx, rng, nick) {
    if (!open.length) return null;
    const byConf = [...open].sort((a, b) => confidence(b, ctx) - confidence(a, ctx));
    switch (kind) {
        case 'ekspert': return round >= 7 && confidence(byConf[0], ctx) >= 9 ? byConf[0] : null;
        case 'kibic': return round >= 3 ? (open.find(m => m.homeTeam === LUBLIN || m.awayTeam === LUBLIN) || null) : null;
        case 'klasyk': return round >= 5 ? open[0] : null;
        case 'gospodarz': return round >= 10 ? open[0] : null;
        case 'losowy': return round >= ctx.luckyRound(nick) ? rng.pick(open) : null;
        case 'statystyk': return round >= 12 ? byConf[0] : null;
        case 'spoznialski': return round >= 9 ? open[0] : null;
        case 'podgladacz': return round >= 4 ? open[open.length - 1] : null;
        case 'jokerowiec': return round >= 5 ? open[0] : null;
        case 'poprawiacz': return round >= 6 ? byConf[0] : null;
        case 'nowy': return round >= 8 ? byConf[0] : null;
        default: return null; // Remisiarz i Zapominalski nie używają Jokera
    }
}

/** Typy sezonowe (mistrz, brąz, spadek) albo null. Losowi wybierają trzy różne drużyny. */
function longTermPick(kind, teams, rng) {
    const T = n => teams.find(t => t.includes(n));
    const random = () => { const [a, b, c] = rng.shuffle(teams); return { champion: a, bronze: b, relegation: c }; };
    switch (kind) {
        case 'ekspert': return { champion: T('Lublin'), bronze: T('Toruń'), relegation: T('Zielona Góra') };
        case 'kibic': return { champion: T('Lublin'), bronze: T('Wrocław'), relegation: T('Grudziądz') };
        case 'remis': return { champion: T('Wrocław'), bronze: T('Lublin'), relegation: T('Zielona Góra') };
        case 'gospodarz': return { champion: T('Toruń'), bronze: T('Wrocław'), relegation: T('Leszno') };
        case 'statystyk': return { champion: T('Lublin'), bronze: T('Wrocław'), relegation: T('Zielona Góra') };
        case 'podgladacz': return { champion: T('Lublin'), bronze: T('Toruń'), relegation: T('Grudziądz') };
        case 'jokerowiec': return { champion: T('Wrocław'), bronze: T('Toruń'), relegation: T('Zielona Góra') };
        case 'poprawiacz': return { champion: T('Lublin'), bronze: T('Toruń'), relegation: T('Zielona Góra') };
        case 'spoznialski': return { champion: T('Lublin'), bronze: T('Wrocław'), relegation: T('Grudziądz') };
        case 'klasyk': case 'losowy': return random();
        default: return null; // Zapominalski i Nowy nie mają typów sezonowych
    }
}

module.exports = { PERSONAS, predictFor, jokerPick, longTermPick, LUBLIN };
