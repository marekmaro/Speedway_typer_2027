/* ------------------------------------------------------------------
   Generator terminarza na nowy sezon (dwumecze każdy z każdym).
   8 drużyn -> 7 kolejek rundy zasadniczej x2 = 14 kolejek po 4 mecze.
   Wpisujesz nazwy drużyn i datę startu, dostajesz gotowy JSON.
------------------------------------------------------------------- */

const DEFAULT_SLOTS = [
    // typowy weekend Ekstraligi: piątek 18:00 i 20:30, niedziela 16:00 i 19:15
    { dayOffset: 0, time: '18:00' },
    { dayOffset: 0, time: '20:30' },
    { dayOffset: 2, time: '16:00' },
    { dayOffset: 2, time: '19:15' }
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

function applyTime(baseDate, dayOffset, time) {
    const [h, min] = String(time).split(':').map(Number);
    const d = new Date(baseDate.getTime());
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h || 18, min || 0, 0, 0);
    return d;
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
    const base = new Date(`${startDate}T12:00:00`);
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
        const monday = new Date(base.getTime());
        monday.setDate(monday.getDate() + weekCursor * 7 * weekGap);
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

module.exports = { generateSchedule, roundRobin, DEFAULT_SLOTS };
