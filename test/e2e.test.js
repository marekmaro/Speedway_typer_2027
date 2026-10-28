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

    await test('ładuje się bez błędów i bez poziomego przewijania (telefon i komputer, wszystkie zakładki i zasady)', async () => {
        const p = await newPage();
        await p.goto(base + '/', { waitUntil: 'networkidle' });
        await p.waitForSelector('#start-top li');
        await noHorizontalScroll(p);
        await p.goto(base + '/#mecze', { waitUntil: 'networkidle' });
        await p.waitForSelector('#matches-container article');
        noErrors(p);
        await close(p);
        const d = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        await d.route(url => !url.href.startsWith(base), r => r.abort());
        const dp = await d.newPage();
        const errs = []; dp.on('pageerror', e => errs.push(e.message));
        for (const url of ['/', '/#mecze', '/#tabela', '/#ranking', '/#puchar', '/#wiecej', '/zasady']) {
            await dp.goto(base + url, { waitUntil: 'networkidle' });
            await noHorizontalScroll(dp);
        }
        assert.deepStrictEqual(errs, []);
        await d.close();
        const m = await newPage();
        for (const url of ['/#tabela', '/#ranking', '/#puchar', '/#wiecej', '/zasady']) {
            await m.goto(base + url, { waitUntil: 'networkidle' });
            await noHorizontalScroll(m);
        }
        noErrors(m);
        await close(m);
    });

    await test('dolna nawigacja przełącza sekcje i zmienia adres (#ranking)', async () => {
        const p = await newPage();
        await p.goto(base + '/', { waitUntil: 'networkidle' });
        assert.ok(await p.locator('#tab-start:not(.hidden)').count() === 1, 'strona startowa domyślnie');
        for (const [tab, sel] of [['ranking', '#ranking-list li'], ['tabela', '#league-table-body tr'], ['puchar', '#cup-container .card'], ['wiecej', '#alltime-list li .font-bold'], ['mecze', '#matches-container article']]) {
            await p.locator(`nav.tabbar a[data-tab="${tab}"]`).click();
            await p.waitForSelector(`#tab-${tab}:not(.hidden)`);
            assert.ok(p.url().endsWith(`#${tab}`));
            assert.ok(await p.locator(sel).count() > 0, `sekcja ${tab} jest pusta`);
        }
        await p.goBack();
        await p.waitForSelector('#tab-wiecej:not(.hidden)');
        noErrors(p);
        await close(p);
    });

    await test('wybór kolejki chipem zmienia listę meczów', async () => {
        const p = await newPage();
        await p.goto(base + '/#mecze', { waitUntil: 'networkidle' });
        const before = await p.locator('#round-title').textContent();
        await p.locator('#round-nav button').first().click();
        assert.notStrictEqual(await p.locator('#round-title').textContent(), before);
        assert.strictEqual(await p.locator('#round-title').textContent(), 'Runda 1');
        assert.ok(await p.locator('#matches-container article').count() === 4);
        await close(p);
    });

    await test('typy na przyszły mecz są ukryte (kłódka), na rozegrany jawne z punktami', async () => {
        const p = await newPage();
        await p.goto(base + '/#mecze', { waitUntil: 'networkidle' });
        const future = db.Match._rows.find(m => m.homeScore === null && !m.predictionsFrozen && new Date(m.matchDate) > Date.now() + MIN * 60 && db.Prediction._rows.some(x => x.matchId === String(m._id)));
        await p.evaluate(r => window.changeRound(r), future.round);
        const html = await p.locator('#matches-container').innerHTML();
        assert.ok(html.includes('🔒'), 'kłódka przy ukrytych typach');
        await p.locator('#round-nav button').first().click();
        const card = p.locator('#matches-container article').first();
        assert.ok(/\+\d/.test(await card.innerText()), 'punkty przy rozegranym meczu');
        await close(p);
    });

    await test('Więcej: H2H, ranking wszech czasów, odnośnik do zasad', async () => {
        const p = await newPage();
        await p.goto(base + '/#wiecej', { waitUntil: 'networkidle' });
        await p.waitForSelector('#alltime-list li .font-bold');
        await p.selectOption('#h2h-a', 'Marek');
        await p.selectOption('#h2h-b', 'Kasia');
        await p.waitForFunction(() => /wspólnych/.test(document.getElementById('h2h-result').textContent));
        assert.ok(await p.locator('#tab-wiecej a[href="/zasady"]').count() === 1);
        noErrors(p);
        await close(p);
    });

    await test('strona startowa: powitanie, bieżąca kolejka, czołówka, ostatnie wyniki, sezon w liczbach', async () => {
        const p = await newPage();
        await p.goto(base + '/', { waitUntil: 'networkidle' });
        assert.ok(/Witaj/i.test(await p.locator('#h-start').textContent()));
        assert.ok(await p.locator('#start-round li').count() >= 1, 'mecze kolejki');
        assert.strictEqual(await p.locator('#start-top li').count(), 5, 'czołówka');
        assert.ok(await p.locator('#start-results li').count() >= 1, 'wyniki');
        assert.strictEqual(await p.locator('#start-stats .kpi').count(), 4);
        assert.ok(await p.locator('#tab-start a[href="/zasady"]').count() >= 1, 'odnośnik do zasad');
        await noHorizontalScroll(p);
        // telefon zna link gracza -> powitanie po imieniu i przycisk do typowania
        await p.evaluate(t => localStorage.setItem('typerToken', t), tokenOf(0));
        await p.reload({ waitUntil: 'networkidle' });
        await p.waitForFunction(n => document.getElementById('h-start').textContent.includes(n), PLAYERS[0]);
        assert.ok(await p.locator(`#start-cta a[href*="${tokenOf(0)}"]`).count() === 1);
        await noHorizontalScroll(p);
        noErrors(p);
        await close(p);
    });

    await test('strona z zasadami: liczby z ustawień sezonu, przykłady, spis treści i pytania', async () => {
        const p = await newPage();
        await p.goto(base + '/zasady', { waitUntil: 'networkidle' });
        await p.waitForSelector('#z-sections .rule-block');
        const text = await p.locator('main').textContent();
        assert.ok(/1 min przed pierwszym biegiem/.test(text), 'blokada z ustawień sezonu');
        assert.ok(await p.locator('#z-examples tr').count() >= 4, 'przykłady punktacji');
        assert.ok(await p.locator('#z-faq details').count() >= 5, 'pytania');
        assert.ok(await p.locator('#z-toc a').count() >= 8, 'spis treści');
        await p.click('#z-toc a[href="#puchar"]');
        await p.waitForFunction(() => location.hash === '#puchar');
        await p.locator('#z-faq summary').first().click();
        assert.ok(await p.locator('#z-faq details[open]').count() === 1);
        await noHorizontalScroll(p);
        assert.strictEqual((await (await fetch(base + '/regulamin')).text()).includes('Zasady gry'), true, 'adres /regulamin też działa');
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

    await runAdminTests();
    await runFinaleTests();

    await browser.close();
    server.close();
    console.log(`\n${passed} testów E2E przeszło${failed ? `, ${failed} NIE przeszło: ${failures.join(' | ')}` : ''}.\n`);
    process.exit(process.exitCode || 0);
})();

/* ================================================================
   PANEL ADMINA
================================================================ */
const ADMIN_PASS = process.env.ADMIN_PASSWORD;

async function adminPage(opts = {}) {
    const p = await newPage(opts);
    await p.goto(base + '/admin', { waitUntil: 'networkidle' });
    await p.fill('#admin-pass-input', ADMIN_PASS);
    await p.click('#login-modal form button');
    await p.waitForSelector('#view section, #view .card');
    return p;
}
const toastHas = async (p, txt) => {
    await p.waitForFunction(t => { const el = document.getElementById('t-toast'); return el && el.textContent.includes(t); }, txt, { timeout: 8000 });
    await p.waitForFunction(() => !document.body.dataset.busy, null, { timeout: 8000 });
};
const confirmYes = p => p.click('[data-cf="1"]');
const confirmNo = p => p.click('[data-cf="0"]');
async function goView(p, hash) {
    await p.evaluate(h => { location.hash = h; }, hash);
    await p.waitForTimeout(150);
}
/** Data w formacie pola datetime-local, w czasie polskim. */
function warsawInput(date) {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace(' ', 'T');
}
async function mkAdminMatch(round, startsInMin, extra = {}) {
    const m = await db.Match.create({ season: 2027, round, homeTeam: 'Fogo Unia Leszno', awayTeam: 'Gezet Stal Gorzów', matchDate: new Date(Date.now() + startsInMin * MIN), ...extra });
    cache.invalidate();
    return m;
}

async function runAdminTests() {
    group('Panel admina');

    await test('logowanie: złe hasło = komunikat, dobre = pulpit z licznikiem spraw', async () => {
        const p = await newPage();
        await p.goto(base + '/admin', { waitUntil: 'networkidle' });
        await p.fill('#admin-pass-input', 'zle-haslo');
        await p.click('#login-modal form button');
        await p.waitForFunction(() => /Złe hasło/.test(document.getElementById('login-error').textContent));
        await p.fill('#admin-pass-input', ADMIN_PASS);
        await p.click('#login-modal form button');
        await p.waitForSelector('#view section');
        // innerText uwzględnia CSS (tytuły sekcji są pisane wersalikami), więc bez rozróżniania wielkości liter
        assert.ok(/Wyniki do zatwierdzenia/i.test(await p.locator('#view').innerText()));
        assert.ok(/Mecze bez wyniku/i.test(await p.locator('#view').innerText()));
        assert.ok(Number(await p.locator('#tab-nav .badge-dot').innerText()) >= 2, 'licznik na ikonie Pulpitu');
        noErrors(p);
        await close(p);
    });

    await test('pulpit: zatwierdzenie wyniku ze scrapera z poprawionymi liczbami przelicza punkty', async () => {
        const draft = db.ResultDraft._rows.find(d => d.status === 'draft');
        const p = await adminPage();
        const box = p.locator(`[data-draft="${draft._id}"]`);
        await box.locator('[data-draft-h]').fill('46');
        await box.locator('[data-draft-a]').fill('44');
        assert.ok(/suma 90/.test(await box.locator('[data-sum]').innerText()));
        await box.locator('[data-act="draft-approve"]').click();
        await toastHas(p, 'Zatwierdzono');
        const m = matchById(draft.matchId);
        assert.deepStrictEqual([m.homeScore, m.awayScore], [46, 44]);
        assert.strictEqual(m.resultSource, 'admin', 'poprawiony przez admina');
        const preds = db.Prediction._rows.filter(x => x.matchId === draft.matchId);
        assert.ok(preds.length && preds.every(x => x.pointsEarned !== null), 'punkty przeliczone');
        assert.strictEqual(await p.locator(`[data-draft="${draft._id}"]`).count(), 0);
        await close(p);
    });

    await test('pulpit: wynik wpisany przy "Mecze bez wyniku" zapisuje się z paska "Zapisz wyniki"', async () => {
        const p = await adminPage();
        const row = p.locator('[data-row]').first();
        const id = await row.getAttribute('data-row');
        await row.locator('[data-res="h"]').fill('50');
        await row.locator('[data-res="a"]').fill('40');
        await p.waitForSelector('#savebar');
        assert.ok(/Niezapisane wyniki: 1/.test(await p.locator('#savebar').innerText()));
        await p.click('[data-act="save-results"]');
        await toastHas(p, 'Zapisano wyniki 1');
        assert.deepStrictEqual([matchById(id).homeScore, matchById(id).awayScore], [50, 40]);
        assert.strictEqual(await p.locator('#savebar').count(), 0);
        await close(p);
    });

    await test('mecze: niemożliwa suma wymaga potwierdzenia ("Anuluj" nie zapisuje), "Cofnij" czyści pasek', async () => {
        const m = await mkAdminMatch(60, -2 * 24 * 60);
        const m2 = await mkAdminMatch(60, -2 * 24 * 60 + 120, { homeTeam: 'Gezet Stal Gorzów', awayTeam: 'Fogo Unia Leszno' });
        const p = await adminPage();
        await goView(p, 'mecze/60');
        const card = p.locator(`[data-card="${m._id}"]`);
        await card.locator('[data-res="h"]').fill('60');
        await card.locator('[data-res="a"]').fill('40');
        assert.ok(/niemożliwe/.test(await card.innerText()), 'podpowiedź o sumie > 90');
        await p.click('[data-act="save-results"]');
        await p.waitForSelector('[data-cf="1"]');
        assert.ok(/Nietypowa suma/.test(await p.locator('.sheet').last().innerText()));
        await confirmNo(p);
        assert.strictEqual(matchById(m._id).homeScore, null);
        await p.click('[data-act="save-results"]');
        await confirmYes(p);
        await toastHas(p, 'Zapisano wyniki');
        assert.strictEqual(matchById(m._id).homeScore, 60);
        const card2 = p.locator(`[data-card="${m2._id}"]`);
        await card2.locator('[data-res="h"]').fill('44');
        await p.waitForSelector('#savebar');
        await p.click('[data-act="discard-results"]');
        assert.strictEqual(await p.locator('#savebar').count(), 0);
        assert.strictEqual(await p.locator(`[data-card="${m2._id}"] [data-res="h"]`).inputValue(), '');
        await close(p);
    });

    await test('mecze: admin wpisuje typ za gracza z listy pod meczem (lista zostaje rozwinięta)', async () => {
        const m = await mkAdminMatch(61, -3 * 24 * 60, { homeScore: 46, awayScore: 44 });
        const p = await adminPage();
        await goView(p, 'mecze/61');
        await p.click(`[data-card="${m._id}"] [data-act="toggle-preds"]`);
        const row = p.locator(`[data-tip="Tomek|${m._id}"]`);
        await row.locator('[data-tip-h]').fill('46');
        await row.locator('[data-tip-a]').fill('44');
        await row.locator('[data-act="save-tip"]').click();
        await toastHas(p, 'zapisany');
        const pr = predOf('Tomek', String(m._id));
        assert.deepStrictEqual([pr.homePred, pr.awayPred, pr.source, pr.pointsEarned], [46, 44, 'admin', 5]);
        assert.strictEqual(await p.locator(`[data-preds="${m._id}"]:not(.hidden)`).count(), 1, 'lista typów dalej rozwinięta');
        await noHorizontalScroll(p);
        await close(p);
    });

    await test('edycja meczu: przełożenie po blokadzie (deszcz) zamraża typy, podpowiedź to zapowiada', async () => {
        const m = await mkAdminMatch(62, 0.5);
        await db.Prediction.create({ season: 2027, nickname: 'Kasia', matchId: String(m._id), homePred: 45, awayPred: 45 });
        const p = await adminPage();
        await goView(p, 'mecze/62');
        await p.click(`[data-card="${m._id}"] [data-act="edit-match"]`);
        await p.waitForSelector('#ed-date');
        assert.ok(await p.locator('#ed-freeze-hint.hidden').count() === 1);
        await p.fill('#ed-date', warsawInput(new Date(Date.now() + 5 * 24 * 3600 * 1000)));
        assert.ok(await p.locator('#ed-freeze-hint:not(.hidden)').count() === 1, 'podpowiedź o zamrożeniu');
        await p.click('[data-act="save-match"]');
        await toastHas(p, 'zamrożone');
        const doc = matchById(m._id);
        assert.strictEqual(doc.predictionsFrozen, true);
        assert.ok(doc.originalDate, 'pierwotny termin zapamiętany');
        await close(p);
    });

    await test('edycja meczu: "termin nieznany" przed blokadą, potem "Ustal termin" z pulpitu', async () => {
        const m = await mkAdminMatch(63, 3 * 24 * 60);
        const p = await adminPage();
        await goView(p, 'mecze/63');
        await p.click(`[data-card="${m._id}"] [data-act="edit-match"]`);
        await p.check('#ed-postponed');
        await p.click('[data-act="save-match"]');
        await toastHas(p, 'przełożony');
        assert.strictEqual(matchById(m._id).isPostponed, true);
        assert.strictEqual(matchById(m._id).predictionsFrozen, false, 'przed blokadą nie zamrażamy');
        await goView(p, 'pulpit');
        await p.click(`[data-act="edit-match"][data-id="${m._id}"][data-focus="date"]`);
        await p.fill('#ed-date', warsawInput(new Date(Date.now() + 10 * 24 * 3600 * 1000)));
        assert.strictEqual(await p.isChecked('#ed-postponed'), false, 'nowa data wyłącza "termin nieznany"');
        await p.click('[data-act="save-match"]');
        await toastHas(p, 'nowy termin');
        assert.strictEqual(matchById(m._id).isPostponed, false);
        await close(p);
    });

    await test('edycja meczu: walkower (typy anulowane) i cofnięcie walkowera', async () => {
        const m = await mkAdminMatch(64, -24 * 60);
        await db.Prediction.create({ season: 2027, nickname: 'Ola', matchId: String(m._id), homePred: 40, awayPred: 0 });
        const p = await adminPage();
        await goView(p, 'mecze/64');
        await p.click(`[data-card="${m._id}"] [data-act="edit-match"]`);
        await p.click('[data-act="walkover"][data-h="40"]');
        await confirmYes(p);
        await toastHas(p, 'walkower');
        let doc = matchById(m._id);
        assert.deepStrictEqual([doc.homeScore, doc.isWalkover, doc.voidPredictions], [40, true, true]);
        assert.strictEqual(predOf('Ola', String(m._id)).pointsEarned, null);
        await p.click('[data-act="walkover-undo"]');
        await confirmYes(p);
        await toastHas(p, 'wyczyszczony');
        doc = matchById(m._id);
        assert.deepStrictEqual([doc.homeScore, doc.isWalkover, doc.voidPredictions], [null, false, false]);
        await close(p);
    });

    await test('edycja meczu: przeniesienie do zajętej kolejki = czytelny błąd; usuwanie wymaga potwierdzenia', async () => {
        await mkAdminMatch(65, 4 * 24 * 60);
        const b = await mkAdminMatch(66, 4 * 24 * 60);
        const p = await adminPage();
        await goView(p, 'mecze/66');
        await p.click(`[data-card="${b._id}"] [data-act="edit-match"]`);
        await p.fill('#ed-round', '65');
        await p.click('[data-act="save-match"]');
        await toastHas(p, 'jest już mecz');
        assert.strictEqual(matchById(b._id).round, 66);
        await p.click('[data-act="delete-match"]');
        await confirmNo(p);
        assert.ok(matchById(b._id), 'po "Anuluj" mecz zostaje');
        await p.click('[data-act="delete-match"]');
        await confirmYes(p);
        await toastHas(p, 'usunięte');
        assert.strictEqual(matchById(b._id), undefined);
        await close(p);
    });

    await test('gracze: wyszukiwanie i dodanie gracza z gotowym linkiem do wysłania', async () => {
        const p = await adminPage();
        await goView(p, 'gracze');
        await p.fill('[data-input="search"]', 'kas');
        assert.strictEqual(await p.locator('[data-act="open-player"]').count(), 1);
        await p.fill('[data-input="search"]', '');
        await p.click('[data-act="add-player"]');
        await p.fill('#np-nick', 'Nowak');
        await p.click('[data-act="add-player-save"]');
        await p.waitForFunction(() => /dodany/.test(document.querySelector('.sheet-body').textContent));
        const pl = db.Player._rows.find(x => x.nickname === 'Nowak');
        assert.ok(pl && pl.seasons.includes(2027));
        assert.ok((await p.locator('.sheet-body input[readonly]').inputValue()).endsWith(pl.token));
        await close(p);
    });

    await test('gracze: nowy link (reset), wstrzymanie konta i zmiana pseudonimu z przeniesieniem typów', async () => {
        const pl = db.Player._rows.find(x => x.nickname === 'Nowak');
        const oldToken = pl.token;
        await db.Prediction.create({ season: 2027, nickname: 'Nowak', matchId: 'm-nowak', homePred: 1, awayPred: 2 });
        const p = await adminPage();
        await goView(p, 'gracze');
        await p.click('[data-act="open-player"][data-nick="Nowak"]');
        await p.click('[data-act="new-token"]');
        await confirmYes(p);
        await toastHas(p, 'Nowy link');
        assert.notStrictEqual(pl.token, oldToken);
        assert.ok((await p.locator('.sheet-body input[readonly]').inputValue()).endsWith(pl.token), 'szuflada pokazuje nowy link');
        await p.click('[data-act="toggle-active"]');
        await toastHas(p, 'wstrzymany');
        assert.strictEqual(pl.isActive, false);
        await p.fill('#pl-nick', 'Nowakowski');
        await p.click('[data-act="rename-player"]');
        await confirmYes(p);
        await toastHas(p, 'Zmieniono pseudonim');
        assert.strictEqual(pl.nickname, 'Nowakowski');
        assert.ok(db.Prediction._rows.find(x => x.matchId === 'm-nowak').nickname === 'Nowakowski');
        assert.strictEqual(await p.locator('#sheet-title').innerText(), 'Nowakowski');
        await p.keyboard.press('Escape');
        assert.strictEqual(await p.locator('.sheet').count(), 0, 'ESC zamyka szufladę');
        await close(p);
    });

    await test('gracze: pseudonim z apostrofem i znakami HTML nie psuje panelu', async () => {
        await db.Player.create({ nickname: `O'Neil <b>`, fullName: '', token: 'feedfeedfeedfeedfeedfeed', seasons: [2027], isActive: true });
        const p = await adminPage();
        await goView(p, 'gracze');
        await p.click(`[data-act="open-player"][data-nick="O'Neil <b>"]`);
        assert.strictEqual(await p.locator('#sheet-title').innerText(), `O'Neil <b>`);
        await p.click('[data-act="toggle-active"]');
        await toastHas(p, 'wstrzymany');
        noErrors(p);
        await close(p);
    });

    await test('sezon: blokada z szybkiego wyboru, punktacja z potwierdzeniem i przeliczeniem', async () => {
        const p = await adminPage();
        await goView(p, 'sezon/ustawienia');
        await p.click('[data-act="lock-preset"][data-v="15"]');
        await p.click('[data-act="save-lock"]');
        await toastHas(p, 'zapisane');
        assert.strictEqual(db.Season._rows.find(x => x.year === 2027).lockMinutes, 15);
        await p.fill('#set-lock', '1');
        await p.click('[data-act="save-lock"]');
        await toastHas(p, 'zapisane');
        const exact = db.Prediction._rows.find(x => x.season === 2027 && x.pointsEarned === 5);
        await p.fill('#set-exact', '6');
        await p.click('[data-act="save-scoring"]');
        await confirmYes(p);
        await toastHas(p, 'przeliczone');
        assert.strictEqual(exact.pointsEarned, 6);
        await p.fill('#set-exact', '5');
        await p.click('[data-act="save-scoring"]');
        await confirmYes(p);
        await toastHas(p, 'przeliczone');
        assert.strictEqual(exact.pointsEarned, 5);
        await close(p);
    });

    await test('sezon: korekta tabeli z panelu widoczna w podglądzie i na stronie', async () => {
        const p = await adminPage();
        await goView(p, 'sezon/tabela');
        await p.click('[data-act="adj-add"]');
        const row = p.locator('#adj-list [data-adj]').last();
        await row.locator('[data-adj-team]').selectOption('Fogo Unia Leszno');
        await row.locator('[data-adj-points]').fill('-2');
        await row.locator('[data-adj-reason]').fill('walkower R5');
        await p.click('[data-act="adj-save"]');
        await toastHas(p, 'zapisane');
        assert.ok(/korekta -2/.test(await p.locator('#view').innerText()));
        const s = db.Season._rows.find(x => x.year === 2027);
        assert.strictEqual(s.standingsAdjustments[0].points, -2);
        s.standingsAdjustments = [];
        cache.invalidate();
        await close(p);
    });

    await test('sezon: źródła wyników - zły adres odrzucony, dobry i alias zapisane', async () => {
        const p = await adminPage();
        await goView(p, 'sezon/auto');
        await p.fill('#auto-urls', 'zly-adres');
        await p.click('[data-act="save-auto"]');
        await toastHas(p, 'https://');
        await p.fill('#auto-urls', 'https://wyniki.example/ekstraliga');
        await p.fill('[data-alias="PRES Grupa Deweloperska Toruń"]', 'Apator, KS Toruń');
        await p.click('[data-act="save-auto"]');
        await toastHas(p, 'zapisane');
        const s = db.Season._rows.find(x => x.year === 2027);
        assert.deepStrictEqual(s.scraperUrls, ['https://wyniki.example/ekstraliga']);
        assert.deepStrictEqual(s.teamAliases['PRES Grupa Deweloperska Toruń'], ['Apator', 'KS Toruń']);
        await close(p);
    });

    await test('sezon: nowy sezon (nieaktywny) - panel przełącza się na niego z ostrzeżeniem', async () => {
        const p = await adminPage();
        await goView(p, 'sezon/sezony');
        await p.click('summary:has-text("Nowy sezon")');
        await p.fill('#ns-year', '2031');
        await p.click('[data-act="new-season"][data-activate="0"]');
        await toastHas(p, 'Sezon 2031 zapisany');
        await p.waitForFunction(() => document.getElementById('season-picker').value === '2031');
        assert.ok(/nie jest aktywny/.test(await p.locator('#season-warning').innerText()));
        const s = db.Season._rows.find(x => x.year === 2031);
        assert.strictEqual(s.lockMinutes, 1);
        assert.strictEqual(s.isActive, false);
        await p.selectOption('#season-picker', '2027');
        await p.waitForFunction(() => document.getElementById('season-warning').classList.contains('hidden'));
        await close(p);
    });

    await test('puchar: rozstawienie par i usunięcie pary', async () => {
        const p = await adminPage();
        await goView(p, 'puchar');
        await p.fill('#cg-stage', 'Półfinał');
        await p.fill('#cg-count', '4');
        await p.click('[data-act="cup-generate"]');
        await toastHas(p, 'Rozstawiono 2');
        const n = db.CupMatch._rows.filter(c => c.stage === 'Półfinał').length;
        assert.strictEqual(n, 2);
        await p.locator('[data-act="cup-delete"]').last().click();
        await confirmYes(p);
        await toastHas(p, 'usunięta');
        assert.strictEqual(db.CupMatch._rows.length, 2, 'ćwierćfinał z demo + jeden półfinał');
        await close(p);
    });

    await test('system: kopia zapasowa pobiera się jako JSON', async () => {
        const p = await adminPage();
        await goView(p, 'system');
        const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-act="backup"]')]);
        assert.ok(/^typer-kopia-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()));
        const file = await download.path();
        const data = JSON.parse(require('fs').readFileSync(file, 'utf8'));
        assert.ok(data.matches.length > 50 && data.players.length >= 6);
        await close(p);
    });

    await test('sesja wygasła: panel wraca do logowania zamiast pokazywać błędy', async () => {
        const p = await newPage();
        await p.goto(base + '/admin', { waitUntil: 'networkidle' });
        await p.evaluate(() => sessionStorage.setItem('adminToken', 'wygasly-token'));
        await p.reload({ waitUntil: 'networkidle' });
        assert.ok(await p.locator('#login-modal:not(.hidden)').count() === 1);
        noErrors(p);
        await close(p);
    });

    await test('nawigacja na telefonie: "Więcej" prowadzi do Pucharu i Systemu', async () => {
        const p = await adminPage();
        await p.click('#tab-nav a[href="#wiecej"]');
        await p.click('#view a[href="#puchar"]');
        await p.waitForFunction(() => document.getElementById('view-title').textContent === 'Puchar Typerów');
        assert.ok(await p.locator('#tab-nav a[href="#wiecej"][aria-current="page"]').count() === 1, '"Więcej" podświetlone');
        await close(p);
    });

    await test('wszystkie widoki admina bez błędów i poziomego przewijania (telefon i komputer)', async () => {
        for (const opts of [{}, { ctx: { viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 } }]) {
            const p = await adminPage(opts);
            for (const v of ['pulpit', 'mecze', 'gracze', 'puchar', 'sezon/ustawienia', 'sezon/tabela', 'sezon/auto', 'sezon/sezony', 'system', 'wiecej']) {
                await goView(p, v);
                await noHorizontalScroll(p);
            }
            await goView(p, 'mecze');
            for (const b of await p.locator('[data-act="toggle-preds"]').all()) await b.click();
            await noHorizontalScroll(p);
            noErrors(p);
            await close(p);
        }
    });
}

/* ================================================================
   NOWE FUNKCJE: wygrana kolejka, typy sezonowe, osiągnięcia, Mistrz Typera
================================================================ */
async function runFinaleTests() {
    group('Mistrz Typera i nowy wygląd');
    const nickToken = nick => tokenOf(PLAYERS.indexOf(nick));
    const api = async url => (await fetch(base + url)).json();

    await test('baner "wygrałeś kolejkę" dla zwycięzcy ostatniej rozliczonej kolejki; zamknięcie zapamiętane', async () => {
        cache.invalidate();
        const rw = (await api('/api/public/data')).roundWinners.filter(r => r.complete).pop();
        const winner = rw.winners[0];
        const p = await newPage();
        await p.goto(`${base}/typuj.html?id=${nickToken(winner)}`, { waitUntil: 'networkidle' });
        await p.waitForSelector('#round-win:not(.hidden)');
        assert.ok((await p.locator('#round-win').textContent()).includes(`${rw.points} pkt`));
        await p.click('#round-win-x');
        await p.reload({ waitUntil: 'networkidle' });
        assert.strictEqual(await p.locator('#round-win:not(.hidden)').count(), 0, 'po zamknięciu baner nie wraca');
        const loser = PLAYERS.find(n => !rw.winners.includes(n));
        await p.goto(`${base}/typuj.html?id=${nickToken(loser)}`, { waitUntil: 'networkidle' });
        assert.strictEqual(await p.locator('#round-win:not(.hidden)').count(), 0, 'baner tylko dla zwycięzcy');
        noErrors(p);
        await close(p);
    });

    await test('typy sezonowe: drużyna wybrana w jednym polu jest niedostępna w pozostałych', async () => {
        await db.Season.create({ year: 2031, label: 'Test 2031', isActive: false, lockMinutes: 1, teams: ['Orlen Oil Motor Lublin', 'Betard Sparta Wrocław', 'Fogo Unia Leszno', 'Gezet Stal Gorzów'], stageNames: {}, scoring: {} });
        await db.Match.create({ season: 2031, round: 1, homeTeam: 'Orlen Oil Motor Lublin', awayTeam: 'Betard Sparta Wrocław', matchDate: new Date(Date.now() + 30 * 24 * 60 * MIN) });
        cache.invalidate();
        const p = await newPage();
        try {
            await p.goto(`${base}/typuj.html?id=${tokenOf(0)}`, { waitUntil: 'networkidle' });
            await p.evaluate(() => window.changeSeason(2031));
            await p.waitForFunction(() => !document.getElementById('lt-champion').disabled);
            await p.selectOption('#lt-champion', 'Orlen Oil Motor Lublin');
            const disabled = await p.$eval('#lt-bronze', s => [...s.options].filter(o => o.disabled).map(o => o.value));
            assert.deepStrictEqual(disabled, ['Orlen Oil Motor Lublin']);
            await p.selectOption('#lt-bronze', 'Fogo Unia Leszno');
            const rel = await p.$eval('#lt-relegation', s => [...s.options].filter(o => o.disabled).map(o => o.value).sort());
            assert.deepStrictEqual(rel, ['Fogo Unia Leszno', 'Orlen Oil Motor Lublin']);
            await p.waitForFunction(() => /Zapisane/.test(document.getElementById('save-state').textContent), null, { timeout: 6000 });
            const lt = db.LongTerm._rows.find(l => l.season === 2031 && l.nickname === PLAYERS[0]);
            assert.deepStrictEqual([lt.champion, lt.bronze], ['Orlen Oil Motor Lublin', 'Fogo Unia Leszno']);
            noErrors(p);
        } finally {
            await close(p);
            db.Season._rows.splice(db.Season._rows.findIndex(x => x.year === 2031), 1);
            for (const m of db.Match._rows.filter(x => x.season === 2031)) db.Match._rows.splice(db.Match._rows.indexOf(m), 1);
            cache.invalidate();
        }
    });

    await test('profil: osiągnięcia (zdobyte i do zdobycia) i kask gracza', async () => {
        const p = await newPage();
        await p.goto(`${base}/gracz.html?nick=${PLAYERS[2]}`, { waitUntil: 'networkidle' });
        await p.waitForSelector('#g-achievements .ach');
        assert.strictEqual(await p.locator('#g-achievements .ach').count(), 8);
        assert.ok(await p.locator('#g-achievements .ach:not(.locked)').count() >= 1, 'coś już zdobyte');
        assert.ok(await p.locator('#g-achievements .ach.locked').count() >= 1, 'coś jeszcze do zdobycia');
        assert.strictEqual(await p.locator('#g-helmet .helmet').count(), 1);
        await noHorizontalScroll(p);
        noErrors(p);
        await close(p);
    });

    await test('admin: niespodzianka dla mistrza zapisuje się i panel mówi, kto byłby mistrzem', async () => {
        const p = await adminPage();
        await goView(p, 'sezon/sezony');
        assert.ok(/Sezon trwa/.test(await p.locator('#view').textContent()));
        await p.evaluate(() => document.querySelectorAll('#view details').forEach(d => { d.open = true; }));
        await p.fill('#fin-prize', 'Kask z autografem');
        await p.fill('#fin-msg', 'Odbiór przy grillu');
        await p.click('[data-act="save-surprise"]');
        await toastHas(p, 'zapisane');
        const s = db.Season._rows.find(x => x.year === 2027);
        assert.deepStrictEqual([s.winnerSurprise.prize, s.winnerSurprise.message], ['Kask z autografem', 'Odbiór przy grillu']);
        noErrors(p);
        await close(p);
    });

    await test('koniec sezonu: baner i podium na stronie, zdrapka + dyplom u mistrza, nagroda tajna dla innych', async () => {
        const season = db.Season._rows.find(x => x.year === 2027);
        const keep = { isFinished: season.isFinished, winnerSurprise: season.winnerSurprise };
        season.isFinished = true;
        season.winnerSurprise = { prize: 'Kask z autografem', message: 'Odbiór przy grillu', revealedBy: [] };
        cache.invalidate();
        const p = await newPage({ ctx: { acceptDownloads: true } });
        try {
            const fin = (await api('/api/public/data')).finale;
            const champ = fin.champions[0];
            await p.goto(`${base}/#ranking`, { waitUntil: 'networkidle' });
            await p.waitForSelector('#finale-banner:not(.hidden)');
            assert.ok((await p.locator('#finale-banner').textContent()).includes(champ));
            assert.ok(await p.locator('#podium .podium-step').count() >= 2, 'podium');
            assert.ok(!(await p.content()).includes('Kask z autografem'), 'nagroda niewidoczna na stronie głównej');

            await p.goto(`${base}/typuj.html?id=${nickToken(champ)}`, { waitUntil: 'networkidle' });
            await p.waitForSelector('#surprise #sv-canvas');           // zdrapka otwiera się sama przy pierwszym wejściu
            await p.click('#reveal-now');
            await p.waitForFunction(() => !document.getElementById('sv-canvas'));
            assert.ok((await p.locator('#surprise').textContent()).includes('Kask z autografem'));
            assert.ok(await p.locator('#sv-msg:not(.invisible)').count() === 1, 'wiadomość organizatora po odkryciu');
            await p.waitForFunction(() => /Twoja niespodzianka/.test(document.getElementById('champ-box').textContent));
            assert.deepStrictEqual(season.winnerSurprise.revealedBy, [champ], 'serwer zapisał odkrycie');
            const [file] = await Promise.all([p.waitForEvent('download'), p.click('#sv-diploma')]);
            assert.ok(/^dyplom-.+-2027\.png$/.test(file.suggestedFilename()), file.suggestedFilename());
            noErrors(p);

            const other = PLAYERS.find(n => !fin.champions.includes(n));
            await p.goto(`${base}/typuj.html?id=${nickToken(other)}`, { waitUntil: 'networkidle' });
            assert.strictEqual(await p.locator('#surprise').count(), 0);
            assert.ok(!(await p.content()).includes('Kask z autografem'), 'inny gracz nie widzi nagrody');
            noErrors(p);
        } finally {
            await close(p);
            Object.assign(season, keep);
            cache.invalidate();
        }
    });
}
