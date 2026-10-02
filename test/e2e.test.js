/* ------------------------------------------------------------------
   Testy w prawdziwej przeglądarce (Playwright + Chromium) na danych demo.
   Sprawdzają to, czego nie widać w testach API: klikanie, autozapis, joker,
   blokadę w trakcie, dwa urządzenia, brak sieci, zły zegar telefonu, panel admina.

   Jednorazowo:  npm i --no-save playwright && npx playwright install chromium
   Uruchom:      npm run test:e2e
   (Bez Playwrighta test się pomija - nie blokuje `npm test` ani deployu.)
------------------------------------------------------------------- */
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch (e) {
    console.log('ℹ️  Pomijam testy E2E: brak paczki playwright (npm i --no-save playwright && npx playwright install chromium).');
    process.exit(0);
}
process.env.ADMIN_PASSWORD = 'e2e-haslo';
process.env.ENABLE_SCHEDULER = 'false';

const assert = require('assert');
const { seedDemo, useFakeDb, tokenOf, PLAYERS } = require('../scripts/demo');
const db = useFakeDb();
const app = require('../server');
const cache = require('../services/cache');

const MIN = 60 * 1000;
let passed = 0, failed = 0;
const failures = [];
const only = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY) : null;
async function test(name, fn) {
    if (only && !only.test(name)) return;
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; failures.push(name); console.error(`  ❌ ${name}\n     ${String(e.stack || e).split('\n').slice(0, 4).join('\n     ')}`); process.exitCode = 1; }
}
const group = name => console.log(`\n${name}`);

let base, browser;
const PHONE = devices['Pixel 5'];

async function newPage(opts = {}) {
    const ctx = await browser.newContext({ ...PHONE, serviceWorkers: opts.sw ? 'allow' : 'block', ...(opts.ctx || {}) });
    // logo drużyn z zewnętrznego serwisu - w teście bez sieci zewnętrznej
    await ctx.route(url => !url.href.startsWith(base), r => r.abort());
    if (opts.init) await ctx.addInitScript(opts.init);
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('dialog', d => (opts.onDialog ? opts.onDialog(d) : d.accept()));
    return page;
}
const close = p => p.context().close();
const noErrors = p => assert.deepStrictEqual(p.errors, [], `błędy JS: ${p.errors.join(' | ')}`);
async function noHorizontalScroll(p) {
    const { sw, cw } = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert.ok(sw <= cw + 1, `poziomy scroll: ${sw} > ${cw}`);
}
const matchById = id => db.Match._rows.find(m => String(m._id) === String(id));
const predOf = (nick, id) => db.Prediction._rows.find(p => p.nickname === nick && p.matchId === String(id) && p.season === 2027);

/** Otwiera panel gracza na kolejce danego meczu. */
async function openPlayerOn(page, playerIdx, matchId) {
    await page.goto(`${base}/typuj.html?id=${tokenOf(playerIdx)}`, { waitUntil: 'networkidle' });
    const round = matchById(matchId).round;
    await page.evaluate(r => window.changeRound(r), round);
    await page.waitForSelector(`.match-card[data-id="${matchId}"]`);
    return page.locator(`.match-card[data-id="${matchId}"]`);
}

/** Nowy mecz w osobnej kolejce, bez typów. */
let roundSeq = 40;
async function freshMatch(startsInMin, extra = {}) {
    const m = await db.Match.create({ season: 2027, round: ++roundSeq, homeTeam: 'Orlen Oil Motor Lublin', awayTeam: 'Betard Sparta Wrocław', matchDate: new Date(Date.now() + startsInMin * MIN), ...extra });
    cache.invalidate();
    return String(m._id);
}

(async () => {
    await seedDemo(db);
    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

    /* ============================================================ */
    group('Strona główna');

    await test('ładuje się bez błędów i bez poziomego przewijania (telefon i komputer)', async () => {
        const p = await newPage();
        await p.goto(base + '/', { waitUntil: 'networkidle' });
        await p.waitForSelector('#matches-container article');
        await noHorizontalScroll(p);
        noErrors(p);
        await close(p);
        const d = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        await d.route(url => !url.href.startsWith(base), r => r.abort());
        const dp = await d.newPage();
        const errs = []; dp.on('pageerror', e => errs.push(e.message));
        await dp.goto(base + '/', { waitUntil: 'networkidle' });
        await noHorizontalScroll(dp);
        assert.deepStrictEqual(errs, []);
        await d.close();
    });

    await test('dolna nawigacja przełącza sekcje i zmienia adres (#ranking)', async () => {
        const p = await newPage();
        await p.goto(base + '/', { waitUntil: 'networkidle' });
        for (const [tab, sel] of [['ranking', '#ranking-list li'], ['tabela', '#league-table-body tr'], ['puchar', '#cup-container .card'], ['wiecej', '#rules-content h4']]) {
            await p.locator(`nav.tabbar a[data-tab="${tab}"]`).click();
            await p.waitForSelector(`#tab-${tab}:not(.hidden)`);
            assert.ok(p.url().endsWith(`#${tab}`));
            assert.ok(await p.locator(sel).count() > 0, `sekcja ${tab} jest pusta`);
        }
        await p.goBack();
        await p.waitForSelector('#tab-puchar:not(.hidden)');
        noErrors(p);
        await close(p);
    });

    await test('wybór kolejki chipem zmienia listę meczów', async () => {
        const p = await newPage();
        await p.goto(base + '/', { waitUntil: 'networkidle' });
        const before = await p.locator('#round-title').textContent();
        await p.locator('#round-nav button').first().click();
        assert.notStrictEqual(await p.locator('#round-title').textContent(), before);
        assert.strictEqual(await p.locator('#round-title').textContent(), 'Runda 1');
        assert.ok(await p.locator('#matches-container article').count() === 4);
        await close(p);
    });

    await test('typy na przyszły mecz są ukryte (kłódka), na rozegrany jawne z punktami', async () => {
        const p = await newPage();
        await p.goto(base + '/', { waitUntil: 'networkidle' });
        const future = db.Match._rows.find(m => m.homeScore === null && !m.predictionsFrozen && new Date(m.matchDate) > Date.now() + MIN * 60 && db.Prediction._rows.some(x => x.matchId === String(m._id)));
        await p.evaluate(r => window.changeRound(r), future.round);
        const html = await p.locator('#matches-container').innerHTML();
        assert.ok(html.includes('🔒'), 'kłódka przy ukrytych typach');
        await p.locator('#round-nav button').first().click();
        const card = p.locator('#matches-container article').first();
        assert.ok(/\+\d/.test(await card.innerText()), 'punkty przy rozegranym meczu');
        await close(p);
    });

    await test('Więcej: H2H, ranking wszech czasów, regulamin z blokadą "1 min"', async () => {
        const p = await newPage();
        await p.goto(base + '/#wiecej', { waitUntil: 'networkidle' });
        await p.waitForSelector('#alltime-list li .font-bold');
        await p.selectOption('#h2h-a', 'Marek');
        await p.selectOption('#h2h-b', 'Kasia');
        await p.waitForFunction(() => /wspólnych/.test(document.getElementById('h2h-result').textContent));
        assert.ok(/1 min przed pierwszym biegiem/.test(await p.locator('#rules-content').innerText()));
        noErrors(p);
        await close(p);
    });

    await test('klik w gracza w rankingu otwiera profil z wykresami i podpowiedzią', async () => {
        const p = await newPage();
        await p.goto(base + '/#ranking', { waitUntil: 'networkidle' });
        await p.locator('#ranking-list a').first().click();
        await p.waitForURL(/gracz\.html/);
        await p.waitForSelector('#chart-points svg');
        assert.ok(await p.locator('#chart-position svg circle').count() > 0);
        await p.locator('#chart-points svg rect').nth(1).hover();
        await p.waitForSelector('#chart-points .chart-tip:not(.hidden)');
        assert.ok(/pkt/.test(await p.locator('#chart-points .chart-tip').innerText()));
        assert.ok(await p.locator('#g-history li').count() > 3);
        await noHorizontalScroll(p);
        noErrors(p);
        await close(p);
    });

    await test('profil nieistniejącego gracza pokazuje komunikat zamiast pustej strony', async () => {
        const p = await newPage();
        await p.goto(base + '/gracz.html?nick=Nikt', { waitUntil: 'networkidle' });
        assert.ok(/Nie ma takiego gracza/.test(await p.locator('#g-error').innerText()));
        await close(p);
    });

    /* ============================================================ */
    group('Panel gracza: typowanie');

    await test('zły link = czytelny komunikat; brak linku = komunikat', async () => {
        const p = await newPage();
        await p.goto(base + '/typuj.html?id=zlylink', { waitUntil: 'networkidle' });
        assert.ok(/Link nieprawidłowy/.test(await p.locator('main').innerText()));
        await p.goto(base + '/typuj.html', { waitUntil: 'networkidle' });
        assert.ok(/Brak klucza/.test(await p.locator('main').innerText()));
        await close(p);
    });

    await test('regresja: wpisana liczba NIE znika po pauzie (autozapis innych meczów)', async () => {
        const id = await freshMatch(60 * 24 * 3);
        const p = await newPage();
        const card = await openPlayerOn(p, 0, id);
        await card.locator('.home-pred').click();
        await p.keyboard.type('4');
        await p.waitForTimeout(2600);
        assert.strictEqual(await card.locator('.home-pred').inputValue(), '4');
        assert.ok(/Wpisz oba wyniki/.test(await card.locator('.sum-hint').innerText()));
        assert.strictEqual(predOf('Marek', id), undefined, 'niepełny typ się nie zapisał');
        await close(p);
    });

    await test('pełny typ: autoprzeskok do pola gości, autozapis, stan "Zapisane"', async () => {
        const id = await freshMatch(60 * 24 * 3);
        const p = await newPage();
        const card = await openPlayerOn(p, 1, id);
        await card.locator('.home-pred').click();
        await p.keyboard.type('46');
        assert.ok(await p.evaluate(() => document.activeElement.classList.contains('away-pred')), 'kursor w polu gości');
        await p.keyboard.type('44');
        await p.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 5000 });
        const pr = predOf('Kasia', id);
        assert.deepStrictEqual([pr.homePred, pr.awayPred], [46, 44]);
        assert.ok(/Suma 90/.test(await card.locator('.sum-hint').innerText()));
        noErrors(p);
        await close(p);
    });

    await test('wyczyszczenie obu pól usuwa typ', async () => {
        const id = await freshMatch(60 * 24 * 3);
        await db.Prediction.create({ season: 2027, nickname: 'Tomek', matchId: id, homePred: 50, awayPred: 40 });
        const p = await newPage();
        const card = await openPlayerOn(p, 2, id);
        await card.locator('.home-pred').fill(''); await card.locator('.home-pred').dispatchEvent('input');
        await card.locator('.away-pred').fill(''); await card.locator('.away-pred').dispatchEvent('input');
        assert.ok(/zostanie usunięty/.test(await card.locator('.sum-hint').innerText()));
        await p.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 5000 });
        assert.strictEqual(predOf('Tomek', id), undefined);
        await close(p);
    });

    await test('joker: na mecz bez typu blokowany komunikatem; z typem zapisany; przeniesienie zostawia jeden', async () => {
        const a = await freshMatch(60 * 24 * 4), b = await freshMatch(60 * 24 * 4);
        // ten gracz nie może mieć zużytego jokera
        db.Prediction._rows.filter(x => x.nickname === 'Ola').forEach(x => { x.usedJoker = false; });
        const p = await newPage();
        let card = await openPlayerOn(p, 3, a);
        await card.locator('.joker-checkbox').click(); // aplikacja sama go odznaczy
        assert.strictEqual(await card.locator('.joker-checkbox').isChecked(), false, 'odznaczony, bo brak typu');
        assert.ok(/Najpierw wpisz typ/.test(await p.locator('#t-toast').innerText()));
        await card.locator('.home-pred').click(); await p.keyboard.type('5040');
        await card.locator('.joker-checkbox').check();
        await p.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 5000 });
        assert.strictEqual(predOf('Ola', a).usedJoker, true);
        card = await openPlayerOn(p, 3, b);
        await card.locator('.home-pred').click(); await p.keyboard.type('4743');
        await card.locator('.joker-checkbox').check();
        await p.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 5000 });
        await p.waitForTimeout(300);
        assert.strictEqual(predOf('Ola', b).usedJoker, true);
        assert.strictEqual(predOf('Ola', a).usedJoker, false);
        await close(p);
    });

    await test('zmiana wyniku na meczu z jokerem nie zdejmuje jokera', async () => {
        const id = await freshMatch(60 * 24 * 4);
        db.Prediction._rows.filter(x => x.nickname === 'Piotrek').forEach(x => { x.usedJoker = false; });
        await db.Prediction.create({ season: 2027, nickname: 'Piotrek', matchId: id, homePred: 46, awayPred: 44, usedJoker: true });
        const p = await newPage();
        const card = await openPlayerOn(p, 4, id);
        await card.locator('.away-pred').click(); await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await p.keyboard.type('42');
        await card.locator('.home-pred').click(); await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await p.keyboard.type('48');
        await p.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 5000 });
        const pr = predOf('Piotrek', id);
        assert.deepStrictEqual([pr.homePred, pr.awayPred, pr.usedJoker], [48, 42, true]);
        await close(p);
    });

    await test('blokada w trakcie: pola zamykają się same, spóźniony zapis jest odrzucony z komunikatem', async () => {
        const id = await freshMatch(1.25); // start za 75 s -> blokada (1 min) za 15 s
        const p = await newPage();
        const card = await openPlayerOn(p, 5, id);
        assert.strictEqual(await card.locator('.home-pred').isDisabled(), false);
        await card.locator('.home-pred').click(); await p.keyboard.type('4545');
        await p.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 5000 });
        await p.waitForFunction(id => {
            const el = document.querySelector(`.match-card[data-id="${id}"] .home-pred`);
            return el && el.disabled;
        }, id, { timeout: 25000 });
        assert.ok(/Typy zamknięte|Trwa/.test(await p.locator(`.match-card[data-id="${id}"] .lock-label`).innerText()));
        // drugie, nieodświeżone urządzenie próbuje zapisać po blokadzie
        const r = await p.evaluate(async ({ id, tok }) => (await fetch('/api/public/submit-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok, predictions: [{ matchId: id, homePred: 30, awayPred: 60 }] }) })).json(), { id, tok: tokenOf(5) });
        assert.strictEqual(r.saved, 0);
        assert.deepStrictEqual([predOf('Zbyszek', id).homePred, predOf('Zbyszek', id).awayPred], [45, 45]);
        await close(p);
    });

    await test('dwa urządzenia: stary ekran nie nadpisuje typu zmienionego na drugim telefonie', async () => {
        const x = await freshMatch(60 * 24 * 5), y = await freshMatch(60 * 24 * 5);
        await db.Prediction.create({ season: 2027, nickname: 'Marek', matchId: x, homePred: 40, awayPred: 50 });
        await db.Prediction.create({ season: 2027, nickname: 'Marek', matchId: y, homePred: 40, awayPred: 50 });
        cache.invalidate();
        const oldPhone = await newPage();
        await openPlayerOn(oldPhone, 0, x);               // ekran otwarty "wczoraj"
        const newPhone = await newPage();
        const cardY = await openPlayerOn(newPhone, 0, y);
        await cardY.locator('.home-pred').click(); await newPhone.keyboard.press('Backspace'); await newPhone.keyboard.press('Backspace'); await newPhone.keyboard.type('55');
        await newPhone.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 5000 });
        assert.strictEqual(predOf('Marek', y).homePred, 55);
        // stary telefon zmienia tylko X (ma w pamięci stare Y = 40:50)
        const roundX = matchById(x).round;
        await oldPhone.evaluate(r => window.changeRound(r), roundX);
        const cardX = oldPhone.locator(`.match-card[data-id="${x}"]`);
        await cardX.locator('.home-pred').click(); await oldPhone.keyboard.press('Backspace'); await oldPhone.keyboard.press('Backspace'); await oldPhone.keyboard.type('48');
        await oldPhone.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 5000 });
        assert.strictEqual(predOf('Marek', x).homePred, 48);
        assert.strictEqual(predOf('Marek', y).homePred, 55, 'typ z drugiego telefonu przetrwał');
        await close(oldPhone); await close(newPhone);
    });

    await test('brak sieci: typ czeka i zapisuje się po powrocie połączenia', async () => {
        const id = await freshMatch(60 * 24 * 5);
        const p = await newPage();
        const card = await openPlayerOn(p, 1, id);
        await p.context().setOffline(true);
        await card.locator('.home-pred').click(); await p.keyboard.type('4248');
        await p.waitForFunction(() => /Brak sieci/.test(document.getElementById('save-state').textContent), null, { timeout: 6000 });
        assert.strictEqual(predOf('Kasia', id), undefined);
        await p.context().setOffline(false);
        await p.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 15000 });
        assert.strictEqual(predOf('Kasia', id).homePred, 42);
        await close(p);
    });

    await test('źle ustawiony zegar telefonu (+5 min): odliczanie i blokada według serwera', async () => {
        const id = await freshMatch(4); // blokada za 3 min
        const p = await newPage({ init: () => { const real = Date.now.bind(Date); Date.now = () => real() + 5 * 60 * 1000; } });
        const card = await openPlayerOn(p, 2, id);
        assert.strictEqual(await card.locator('.home-pred').isDisabled(), false, 'pole otwarte mimo zegara "po blokadzie"');
        const label = await card.locator('.lock-label').innerText();
        assert.ok(/Otwarte · 00:0[23]:\d\d/.test(label), `odliczanie według serwera (~3 min), jest: ${label}`);
        await close(p);
    });

    await test('wstrzymany gracz widzi panel tylko do odczytu', async () => {
        const pl = db.Player._rows.find(x => x.nickname === 'Piotrek');
        pl.isActive = false;
        const p = await newPage();
        await p.goto(`${base}/typuj.html?id=${tokenOf(4)}`, { waitUntil: 'networkidle' });
        assert.ok(/wstrzymane/.test(await p.locator('#blocked-box').innerText()));
        assert.strictEqual(await p.locator('.score-input:not([disabled])').count(), 0);
        pl.isActive = true;
        await close(p);
    });

    await test('mecz przełożony po blokadzie: typy zamrożone i opisane', async () => {
        const frozen = db.Match._rows.find(m => m.predictionsFrozen);
        const p = await newPage();
        const card = await openPlayerOn(p, 0, String(frozen._id));
        assert.strictEqual(await card.locator('.home-pred').isDisabled(), true);
        assert.ok(/zamrożone/.test(await card.innerText()));
        await close(p);
    });

    await test('mecz przełożony bez terminu (przed blokadą): typ dalej można zmieniać', async () => {
        const id = await freshMatch(-30, { isPostponed: true }); // stara data minęła, nowej brak
        const p = await newPage();
        const card = await openPlayerOn(p, 3, id);
        assert.ok(/czeka na termin/.test(await card.locator('.lock-label').innerText()));
        await card.locator('.home-pred').click(); await p.keyboard.type('4644');
        await p.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 5000 });
        assert.strictEqual(predOf('Ola', id).homePred, 46);
        await close(p);
    });

    /* ============================================================ */
    group('PWA');

    await test('service worker: strona działa offline z ostatnich danych', async () => {
        const p = await newPage({ sw: true });
        await p.goto(`${base}/typuj.html?id=${tokenOf(0)}`, { waitUntil: 'networkidle' });
        await p.evaluate(() => navigator.serviceWorker.ready);
        await p.reload({ waitUntil: 'networkidle' }); // teraz pod kontrolą SW (dane trafiają do cache)
        await p.context().setOffline(true);
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => document.getElementById('p-nick').textContent === 'Marek', null, { timeout: 8000 });
        await p.context().setOffline(false);
        await close(p);
    });

    await test('manifest gracza otwiera jego panel, ikony są dostępne', async () => {
        const p = await newPage();
        await p.goto(`${base}/typuj.html?id=${tokenOf(0)}`, { waitUntil: 'networkidle' });
        const href = await p.locator('link[rel=manifest]').getAttribute('href');
        const man = await (await fetch(base + href)).json();
        assert.ok(man.start_url.includes(tokenOf(0)));
        for (const icon of man.icons) assert.strictEqual((await fetch(base + icon.src)).status, 200, icon.src);
        await close(p);
    });

    // ---- testy panelu admina są dopisywane niżej (sekcja "Panel admina") ----
    if (typeof adminTests === 'function') await adminTests();

    await browser.close();
    server.close();
    console.log(`\n${passed} testów E2E przeszło${failed ? `, ${failed} NIE przeszło: ${failures.join(' | ')}` : ''}.\n`);
    process.exit(process.exitCode || 0);
})();

/* placeholder - zastępowany przez sekcję admina */
let adminTests;
