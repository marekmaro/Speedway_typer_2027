/* ------------------------------------------------------------------
   Generator terminarza na nowy sezon (dwumecze każdy z każdym).
   8 drużyn -> 7 kolejek rundy zasadniczej x2 = 14 kolejek po 4 mecze.
   Wpisujesz nazwy drużyn i datę startu, dostajesz gotowy JSON.
------------------------------------------------------------------- */

const DEFAULT_SLOTS = [
    // typowy weekend Ekstraligi (dni liczone od poniedziałku kolejki): piątek 18:00 i 20:30, niedziela 16:00 i 19:15
    { dayOffset: 4, time: '18:00' },
    { dayOffset: 4, time: '20:30' },
    { dayOffset: 6, time: '16:00' },
    { dayOffset: 6, time: '19:15' }
];

/** Algorytm karuzeli (Berger) - pary na kolejkę. */
function roundRobin(teams) {
    const list = [...teams];
    if (list.length % 2 !== 0) list.push(null); // pauza
    const n = list.length;
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
        const pairs = [];
        for (let i = 0; i < n / 2; i++) {
            const a = list[i], b = list[n - 1 - i];
            if (a && b) pairs.push(i % 2 === 0 ? [a, b] : [b, a]);
        }
        rounds.push(pairs);
        list.splice(1, 0, list.pop()); // rotacja
    }
    return rounds;
}

const TZ = 'Europe/Warsaw';

/** Przesunięcie strefy (w minutach) w danej chwili, np. +120 latem, +60 zimą. */
function tzOffsetMinutes(ts, timeZone = TZ) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(ts));
    const get = t => Number(parts.find(p => p.type === t).value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return Math.round((asUtc - ts) / 60000);
}

/**
 * Data i godzina "jak w Polsce" -> Date, niezależnie od strefy czasowej serwera
 * (Render domyślnie działa w UTC). Uwzględnia zmianę czasu letni/zimowy.
 */
function warsawDate(y, m, d, hh, mm) {
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    let ts = guess - tzOffsetMinutes(guess) * 60000;
    const again = guess - tzOffsetMinutes(ts) * 60000; // korekta w okolicy zmiany czasu
    if (again !== ts) ts = again;
    return new Date(ts);
}

function applyTime(baseDate, dayOffset, time) {
    const [h, min] = String(time).split(':').map(Number);
    // baseDate to północ UTC danego dnia (z "YYYY-MM-DD"); dzień liczymy w UTC, godzinę w czasie polskim
    const day = new Date(baseDate.getTime() + dayOffset * 86400000);
    return warsawDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(),
        Number.isFinite(h) ? h : 18, Number.isFinite(min) ? min : 0);
}

/**
 * @param {Object} opts
 * @param {string[]} opts.teams        - lista drużyn (min. 4, parzysta)
 * @param {string} opts.startDate      - data pierwszej kolejki (YYYY-MM-DD)
 * @param {number} [opts.weekGap=1]    - co ile tygodni kolejka
 * @param {Array}  [opts.slots]        - rozkład godzin w kolejce
 * @param {boolean}[opts.doubleRound=true]
 * @param {number[]}[opts.skipWeeks]   - numery kolejek, po których wstawić tydzień przerwy
 * @returns {Array} lista meczów gotowa do zapisu
 */
function generateSchedule({ teams, startDate, weekGap = 1, slots, doubleRound = true, skipWeeks = [] }) {
    const clean = (teams || []).map(t => String(t).trim()).filter(Boolean);
    if (clean.length < 4) throw new Error('Podaj co najmniej 4 drużyny.');
    if (clean.length % 2 !== 0) throw new Error('Liczba drużyn musi być parzysta.');
    if (new Set(clean).size !== clean.length) throw new Error('Nazwy drużyn muszą być unikalne.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || ''))) throw new Error('Niepoprawna data startu (użyj formatu YYYY-MM-DD).');
    const base = new Date(`${startDate}T00:00:00Z`);
    if (isNaN(base.getTime())) throw new Error('Niepoprawna data startu (użyj formatu YYYY-MM-DD).');

    const timeSlots = (slots && slots.length) ? slots : DEFAULT_SLOTS;
    const firstLeg = roundRobin(clean);
    const allRounds = doubleRound
        ? [...firstLeg, ...firstLeg.map(pairs => pairs.map(([h, a]) => [a, h]))]
        : firstLeg;

    const out = [];
    let weekCursor = 0;
    allRounds.forEach((pairs, idx) => {
        const round = idx + 1;
        const monday = new Date(base.getTime() + weekCursor * 7 * weekGap * 86400000);
        pairs.forEach(([home, away], i) => {
            const slot = timeSlots[i % timeSlots.length];
            out.push({
                round,
                homeTeam: home,
                awayTeam: away,
                matchDate: applyTime(monday, slot.dayOffset, slot.time).toISOString(),
                isMatchOfTheRound: i === 0 // pierwszy mecz kolejki jako Złoty Kask (do zmiany w panelu)
            });
        });
        weekCursor += 1;
        if (skipWeeks.includes(round)) weekCursor += 1; // tydzień rezerwowy
    });
    return out.sort((a, b) => a.round - b.round || new Date(a.matchDate) - new Date(b.matchDate));
}

module.exports = { generateSchedule, roundRobin, DEFAULT_SLOTS, warsawDate, tzOffsetMinutes };
