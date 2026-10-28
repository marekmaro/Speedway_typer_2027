/* ------------------------------------------------------------------
   Zegar symulacji. Podmienia globalne Date, więc serwer (blokady, przypomnienia, scraper,
   pamięć podręczna) widzi czas symulacji. Musi być zainstalowany PRZED require('server').
   Czas płynie tylko do przodu - tak jak w prawdziwym sezonie.
------------------------------------------------------------------- */
const RealDate = Date;
let now = RealDate.now();
let frozen = true;
let anchor = null; // tryb "na żywo": po symulacji czas płynie normalnie od chwili końca sezonu

class SimDate extends RealDate {
    constructor(...args) {
        if (args.length === 0) super(SimDate.now());
        else super(...args);
    }
    static now() {
        return frozen ? now : anchor.sim + (RealDate.now() - anchor.real);
    }
}

const clock = {
    install() { global.Date = SimDate; return clock; },
    get now() { return SimDate.now(); },
    set(t) {
        if (t < now) throw new Error(`Zegar symulacji nie może się cofać (${new RealDate(t).toISOString()} < ${new RealDate(now).toISOString()})`);
        now = t;
    },
    /** Po symulacji: zegar rusza w normalnym tempie (np. do oglądania sezonu w przeglądarce). */
    run() { anchor = { sim: now, real: RealDate.now() }; frozen = false; },
    RealDate
};

module.exports = clock;
