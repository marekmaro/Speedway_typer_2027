/* ------------------------------------------------------------------
   Półautomatyczne pobieranie wyników (brak oficjalnego API).

   Zasada: scraper NIGDY nie zapisuje wyniku do meczu. Tworzy "draft",
   który admin ogląda w panelu (z fragmentem tekstu ze źródła) i zatwierdza
   jednym kliknięciem. Dopiero zatwierdzenie przelicza punkty.

   Odporność na zmiany layoutu: nie polegamy na klasach CSS konkretnego portalu.
   Strona jest dzielona na małe bloki tekstu (wiersz tabeli, element listy, kafelek),
   a w każdym bloku szukamy dokładnie dwóch drużyn z terminarza i wyniku "50:40".
   Drużyny rozpoznajemy po charakterystycznych słowach nazwy (miasto, przydomek),
   więc zmiana sponsora w nazwie ("Orlen Oil Motor Lublin" -> "Motor Lublin") nie psuje dopasowania.
------------------------------------------------------------------- */
const cheerio = require('cheerio');
const { Match, ResultDraft, Season } = require('../models/Database');
const { MAX_SCORE, FULL_MATCH_TOTAL, MIN_VALID_TOTAL, SCRAPE_MIN_AGE_MINUTES, SCRAPE_MAX_AGE_DAYS } = require('../config');

const MINUTE = 60 * 1000;

/* ---------------- dopasowanie nazw drużyn ---------------- */

function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/ł/g, 'l')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9:\-–]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Słowa, które nic nie mówią o drużynie. */
const STOP = new Set(['ks', 'kz', 'kms', 'tz', 'zks', 'rks', 'sa', 'team', 'speedway', 'zuzel', 'klub', 'oil', 'grupa', 'the', 'pge']);

/**
 * Dla każdej drużyny sezonu lista aliasów: słowa występujące TYLKO w jej nazwie
 * (np. "lublin", "motor") + ręczne aliasy admina. Słowa wspólne dla dwóch drużyn
 * (np. "stal", "unia") są pomijane, bo byłyby dwuznaczne.
 */
function buildTeamMatcher(teams, extraAliases = {}) {
    const tokensOf = name => normalize(name).split(' ').filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
    const owners = {};
    teams.forEach(team => new Set(tokensOf(team)).forEach(t => { (owners[t] = owners[t] || new Set()).add(team); }));

    const aliases = {};
    teams.forEach(team => {
        const own = tokensOf(team).filter(t => owners[t].size === 1);
        const extra = (extraAliases[team] || []).map(normalize).filter(Boolean);
        aliases[team] = [...new Set([...extra, ...own])];
    });

    /** Pierwsza pozycja drużyny w tekście albo -1. Pojedyncze słowa łapią też odmianę ("Spartę", "Lublinie"). */
    function positionIn(normText, team) {
        let best = -1;
        for (const alias of aliases[team] || []) {
            const stem = !alias.includes(' ') && alias.length >= 5 ? alias.slice(0, -1) : alias;
            const re = new RegExp(`(?:^| )${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${alias.includes(' ') ? '' : '[a-z]{0,3}'}(?= |$)`);
            const m = re.exec(normText);
            if (m && (best === -1 || m.index < best)) best = m.index;
        }
        return best;
    }

    return { aliases, positionIn, teams };
}

/* ---------------- wyciąganie kandydatów z HTML ---------------- */

const SCORE_RE = /(?<![\d:])(\d{1,2})\s*[:\-–]\s*(\d{1,2})(?![\d:])/g;

/** "20:30" to godzina, a nie wynik. Prawdziwy wynik z gospodarzem <= 23 ma gości >= 60. */
function looksLikeTime(a, b, raw) {
    return a <= 23 && b <= 59 && /:/.test(raw);
}

/** Małe bloki tekstu: wiersze tabel, elementy list, kafelki. */
function textBlocks(html) {
    const $ = cheerio.load(html);
    $('script, style, noscript, svg, iframe, head').remove();
    // cheerio skleja tekst sąsiednich komórek ("Lublin52 : 38Sparta") - rozdzielamy elementy spacją
    $('body *').each((_, el) => { $(el).append(' '); });
    $('br').replaceWith(' ');
    const blocks = [];
    const seen = new Set();
    $('tr, li, article, section, div, p, a, td').each((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (text.length < 7 || text.length > 320 || seen.has(text)) return;
        seen.add(text);
        blocks.push(text);
    });
    return blocks;
}

/**
 * Kandydaci na wyniki: [{ home, away, homeScore, awayScore, snippet, ambiguous }]
 * home/away to nazwy drużyn Z NASZEGO terminarza (po dopasowaniu).
 */
function extractCandidates(html, matcher) {
    const out = [];
    for (const block of textBlocks(html)) {
        const norm = normalize(block);
        const found = matcher.teams
            .map(team => ({ team, pos: matcher.positionIn(norm, team) }))
            .filter(x => x.pos >= 0)
            .sort((a, b) => a.pos - b.pos);
        if (found.length !== 2) continue; // 0-1 drużyn = nie wynik, 3+ = blok z kilkoma meczami

        const scores = [];
        let m;
        SCORE_RE.lastIndex = 0;
        while ((m = SCORE_RE.exec(norm))) {
            const a = Number(m[1]), b = Number(m[2]);
            if (looksLikeTime(a, b, m[0])) continue;
            if (a + b < MIN_VALID_TOTAL - 8) continue; // stan po kilku biegach, punkty bonusowe itp.
            scores.push({ a, b, index: m.index });
        }
        if (!scores.length) continue;

        // Preferujemy wynik stojący pomiędzy nazwami drużyn ("Motor 50:40 Sparta")
        const between = scores.filter(s => s.index > found[0].pos && s.index < found[1].pos);
        const pickFrom = between.length ? between : scores;
        const distinct = [...new Set(pickFrom.map(s => `${s.a}:${s.b}`))];
        out.push({
            home: found[0].team,
            away: found[1].team,
            homeScore: pickFrom[0].a,
            awayScore: pickFrom[0].b,
            ambiguous: distinct.length > 1 ? distinct : null,
            snippet: block.slice(0, 240)
        });
    }
    return out;
}

/* ---------------- weryfikacja sensowności ---------------- */

/**
 * blockers - wynik prawie na pewno błędny (zatwierdzenie wymaga ręcznej korekty),
 * warnings - nietypowy, ale możliwy (admin patrzy uważniej).
 */
function sanityCheck(homeScore, awayScore) {
    const blockers = [], warnings = [];
    const total = homeScore + awayScore;
    if (homeScore > MAX_SCORE || awayScore > MAX_SCORE) blockers.push(`Wynik powyżej ${MAX_SCORE} pkt.`);
    if (total > FULL_MATCH_TOTAL) blockers.push(`Suma ${total} > ${FULL_MATCH_TOTAL} (15 biegów x 6 pkt) — niemożliwe.`);
    if (total < MIN_VALID_TOTAL) blockers.push(`Suma ${total} < ${MIN_VALID_TOTAL} — mniej niż 8 biegów, mecz nie powinien być zaliczony. Może to stan w trakcie meczu?`);
    else if (total < 84) warnings.push(`Suma ${total} pkt (pełny mecz to zwykle 84–90). Mecz skrócony, upadki lub wykluczenia? Sprawdź.`);
    if (homeScore === awayScore) warnings.push('Remis — zdarza się rzadko, upewnij się.');
    [[homeScore, 'Gospodarze'], [awayScore, 'Goście']].forEach(([v, who]) => {
        if (v < 30 || v > 60) warnings.push(`${who}: ${v} pkt — nietypowo (zwykle 30–60).`);
    });
    return { blockers, warnings };
}

/* ---------------- pobieranie ---------------- */

async function fetchHtml(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ZuzlowyTyper/3.0; prywatna gra znajomych)',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'pl-PL,pl;q=0.9'
        },
        signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

function sourceUrls(season) {
    const fromSeason = (season.scraperUrls || []).filter(Boolean);
    if (fromSeason.length) return fromSeason;
    return String(process.env.SCRAPER_URLS || '').split(/[\s,]+/).filter(Boolean);
}

function aliasesOf(season) {
    const a = season.teamAliases;
    if (!a) return {};
    if (a instanceof Map || typeof a.entries === 'function') {
        try { return Object.fromEntries(a); } catch (e) { return {}; }
    }
    return { ...a };
}

/**
 * Główne zadanie. Zwraca podsumowanie do dziennika i powiadomienia admina.
 * opts.fetchHtml - podmiana pobierania (testy), opts.now - czas (testy).
 */
async function runScrape(opts = {}) {
    const fetcher = opts.fetchHtml || fetchHtml;
    const now = opts.now || Date.now();
    const season = opts.season || await Season.findOne({ isActive: true });
    if (!season) return { ok: true, summary: 'Brak aktywnego sezonu.', created: 0 };

    const urls = opts.urls || sourceUrls(season);
    if (!urls.length) return { ok: true, summary: 'Brak skonfigurowanych źródeł (SCRAPER_URLS albo ustawienia sezonu).', created: 0 };

    // Mecze, które mogły się już skończyć: start co najmniej 2,5 h temu, nie starsze niż 2 tygodnie.
    const matches = await Match.find({ season: season.year }).lean();
    const candidatesFor = matches.filter(m => {
        const t = new Date(m.matchDate).getTime();
        return !m.isPostponed && !m.voidPredictions
            && t <= now - SCRAPE_MIN_AGE_MINUTES * MINUTE
            && t >= now - SCRAPE_MAX_AGE_DAYS * 24 * 60 * MINUTE;
    });
    if (!candidatesFor.length) return { ok: true, summary: 'Brak meczów czekających na wynik.', created: 0 };

    const teams = season.teams && season.teams.length ? season.teams : [...new Set(matches.flatMap(m => [m.homeTeam, m.awayTeam]))];
    const matcher = buildTeamMatcher(teams, aliasesOf(season));

    // Zbieramy wyniki ze wszystkich źródeł: matchId -> [{ score, source, url, snippet, ambiguous }]
    const found = {};
    const sourceErrors = [];
    for (const url of urls) {
        let html;
        try { html = await fetcher(url); }
        catch (e) { sourceErrors.push(`${url}: ${e.message}`); continue; }
        const cands = extractCandidates(html, matcher);
        if (!cands.length) sourceErrors.push(`${url}: nie znaleziono żadnego wyniku (zmienił się układ strony?)`);
        for (const c of cands) {
            // Kolejność drużyn jest istotna: w dwumeczu ta sama para gra dwa razy z zamianą gospodarza.
            const match = candidatesFor
                .filter(m => m.homeTeam === c.home && m.awayTeam === c.away)
                .sort((a, b) => Math.abs(new Date(a.matchDate) - now) - Math.abs(new Date(b.matchDate) - now))[0];
            if (!match) continue;
            const id = String(match._id);
            (found[id] = found[id] || []).push({ ...c, url, source: hostOf(url) });
        }
    }

    let created = 0, updated = 0, unchanged = 0;
    const createdList = [];
    const seasonDecided = Object.keys(found).length
        ? await ResultDraft.find({ season: season.year, status: { $in: ['approved', 'rejected'] } }).lean() : [];
    for (const [matchId, all] of Object.entries(found)) {
        const match = candidatesFor.find(m => String(m._id) === matchId);
        const confirmed = match.homeScore !== null && match.homeScore !== undefined;
        const same = (c, h, a) => c.homeScore === h && c.awayScore === a;
        // Wiersz z wynikiem innego meczu tych samych drużyn (np. z rundy zasadniczej, gdy teraz grają w play-off)
        // to stary mecz, nie nowy - strony z wynikami często pokazują cały sezon. "Znany" = zatwierdzony wynik
        // tamtego meczu albo odczyt, który admin już przy nim rozpatrzył (np. literówka portalu).
        const knownFor = m => [[m.homeScore, m.awayScore], ...seasonDecided.filter(d => d.matchId === String(m._id))
            .flatMap(d => [[d.homeScore, d.awayScore], [d.scrapedHome, d.scrapedAway]])];
        const list = all.filter(c => !matches.some(m => String(m._id) !== matchId && m.homeTeam === match.homeTeam
            && m.awayTeam === match.awayTeam && knownFor(m).some(([h, a]) => same(c, h, a))));
        // Odczyty już rozpatrzone przez admina (zatwierdzone, poprawione albo odrzucone) nie wracają
        const decided = seasonDecided.filter(d => d.matchId === matchId);
        const isDecided = c => decided.some(d => same(c, d.homeScore, d.awayScore) || same(c, d.scrapedHome, d.scrapedAway));
        const fresh = list.filter(c => !(confirmed && same(c, match.homeScore, match.awayScore)) && !isDecided(c));
        if (!fresh.length) { unchanged++; continue; }

        const first = fresh[0];
        const { blockers, warnings } = sanityCheck(first.homeScore, first.awayScore);
        const notes = [];
        const variants = [...new Set(list.map(c => `${c.homeScore}:${c.awayScore}`))];
        if (variants.length > 1) warnings.push(`Źródła podają różne wyniki: ${variants.join(' / ')}.`);
        list.forEach(c => { if (c.ambiguous) warnings.push(`W bloku tekstu jest kilka wyników (${c.ambiguous.join(', ')}) — wybrano pierwszy.`); });
        const sources = [...new Set(list.map(c => c.source))];
        if (sources.length > 1 && variants.length === 1) notes.push(`Zgodne w ${sources.length} źródłach.`);
        if (confirmed) warnings.unshift(`Uwaga: różni się od zatwierdzonego wyniku ${match.homeScore}:${match.awayScore} (korekta po weryfikacji?).`);

        const existing = await ResultDraft.findOne({ matchId, status: 'draft' });
        const data = {
            season: season.year, matchId,
            homeScore: first.homeScore, awayScore: first.awayScore,
            source: sources.join(', '), sourceUrl: first.url, snippet: first.snippet,
            warnings, blockers, notes
        };
        if (existing) {
            if (existing.homeScore === first.homeScore && existing.awayScore === first.awayScore) { unchanged++; continue; }
            data.warnings = [`Wynik zmienił się od poprzedniego pobrania (było ${existing.homeScore}:${existing.awayScore}).`, ...warnings];
            await ResultDraft.updateOne({ _id: existing._id }, { $set: data });
            updated++;
        } else {
            await ResultDraft.create({ ...data, status: 'draft' });
            created++;
        }
        createdList.push(`${match.homeTeam} – ${match.awayTeam} ${first.homeScore}:${first.awayScore}`);
    }

    const missing = candidatesFor.filter(m => (m.homeScore === null || m.homeScore === undefined) && !found[String(m._id)]);
    const summary = `Źródła: ${urls.length}, nowe drafty: ${created}, zaktualizowane: ${updated}, bez zmian: ${unchanged}`
        + (missing.length ? `, bez wyniku w źródłach: ${missing.length}` : '')
        + (sourceErrors.length ? `, problemy: ${sourceErrors.length}` : '');
    return {
        ok: sourceErrors.length < urls.length,
        summary, created, updated, unchanged, createdList, sourceErrors,
        missing: missing.map(m => `${m.homeTeam} – ${m.awayTeam}`)
    };
}

function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
}

module.exports = { normalize, buildTeamMatcher, extractCandidates, sanityCheck, runScrape, textBlocks, looksLikeTime };
