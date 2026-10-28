/* Generuje ikony PNG aplikacji z public/icons/icon.svg (wymaga Playwright + Chromium).
   Uruchamiane ręcznie po zmianie logo: npm run icons. Gotowe PNG są w repozytorium. */
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
    console.error('Brak paczki playwright: npx -y playwright@latest ... albo npm i -D playwright'); process.exit(1);
}

const dir = path.join(__dirname, '..', 'public', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const targets = [
    { file: 'icon-192.png', size: 192, pad: 0 },
    { file: 'icon-512.png', size: 512, pad: 0 },
    { file: 'apple-touch-icon.png', size: 180, pad: 0, square: true },
    { file: 'icon-maskable-512.png', size: 512, pad: 0.12, square: true },
    { file: 'badge-72.png', size: 72, badge: true }
];

(async () => {
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const page = await browser.newPage();
    for (const t of targets) {
        let body;
        if (t.badge) {
            // Monochromatyczna plakietka do paska powiadomień Androida (tylko kanał alfa)
            body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="72" height="72"><path d="M18 14h36L30 48h26v10H16l24-34H18z" fill="#fff"/></svg>`;
        } else {
            const inner = t.size * (1 - 2 * t.pad);
            const bg = t.square ? '#0b1220' : 'transparent';
            body = `<div style="width:${t.size}px;height:${t.size}px;background:${bg};display:grid;place-items:center">
                <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></div>`;
        }
        await page.setViewportSize({ width: t.size, height: t.size });
        await page.setContent(`<html><body style="margin:0;background:transparent">${body}</body></html>`);
        await page.screenshot({ path: path.join(dir, t.file), omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
        console.log('✔', t.file);
    }
    await browser.close();
})();
