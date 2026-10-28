#!/usr/bin/env node
/* ------------------------------------------------------------------
   Symulacja ligi: cały sezon PGE Ekstraligi przeprowadzony w aplikacji (prawdziwe API
   na atrapie bazy, zegar symulacji) + Monte Carlo zasad typera.

     npm run symulacja                      -> raport SYMULACJA.md
     npm run symulacja -- --seed 7          -> inny przebieg sezonu
     npm run symulacja -- --mc 5000         -> więcej sezonów w Monte Carlo (domyślnie 2000)
     npm run symulacja -- --serve           -> po symulacji serwer zostaje na :3000,
                                               można obejrzeć zakończony sezon w przeglądarce
     npm run symulacja -- --quiet           -> bez dziennika zdarzeń

   Kod wyjścia 1 = któryś niezmiennik nie przeszedł (lista w raporcie).
------------------------------------------------------------------- */
const clock = require('./sim/clock').install();
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const seed = Number(opt('seed', 2027));
const mcRuns = Number(opt('mc', 2000));
const quiet = !!opt('quiet', false);
const serve = !!opt('serve', false);
const reportPath = path.resolve(__dirname, '..', opt('report', 'SYMULACJA.md'));

(async () => {
    const started = clock.RealDate.now();
    const { runSeason } = require('./sim/season');
    const season = await runSeason({ seed, clock, log: quiet ? () => {} : s => console.log(s) });
    const seasonMs = clock.RealDate.now() - started;

    const { runMonteCarlo } = require('./sim/montecarlo');
    const t2 = clock.RealDate.now();
    const mc = mcRuns > 0 ? runMonteCarlo({ runs: mcRuns, seed }) : null;
    const mcMs = clock.RealDate.now() - t2;

    const { buildReport } = require('./sim/report');
    fs.writeFileSync(reportPath, buildReport({ season, mc, seed, seasonMs, mcMs }), 'utf8');

    const fails = Object.values(season.inv).reduce((s, x) => s + x.fails, 0);
    const checks = Object.values(season.inv).reduce((s, x) => s + x.checks, 0);
    console.log(`\n${fails ? '❌' : '✅'} Sezon: ${season.events} zdarzeń, ${checks} sprawdzeń niezmienników, błędów: ${fails} (${(seasonMs / 1000).toFixed(1)} s)`);
    if (fails) season.problems.slice(0, 25).forEach(p => console.log(`   - ${p}`));
    if (mc) console.log(`📊 Monte Carlo: ${mc.runs} sezonów w ${(mcMs / 1000).toFixed(1)} s`);
    console.log(`📄 Raport: ${path.relative(process.cwd(), reportPath)}`);

    if (serve) {
        clock.run();
        season.server.close();
        const app = require('../server');
        const port = Number(process.env.PORT || 3000);
        app.listen(port, () => {
            console.log(`\n🏁 Sezon po symulacji: http://localhost:${port}   (admin: hasło "${process.env.ADMIN_PASSWORD}")`);
            season.links.forEach(l => console.log(`   ${l.nick.padEnd(13)} http://localhost:${port}/typuj.html?id=${l.token}${l.champion ? '   🏆 mistrz — czeka niespodzianka' : ''}`));
        });
        return;
    }
    season.server.close();
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
