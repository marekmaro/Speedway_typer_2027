/* Strona "Zasady gry" (/zasady): regulamin z ustawień sezonu (rules.js), przykłady i FAQ.
   Adres można wysłać nowemu graczowi, zanim jeszcze dostanie swój link. */

const esc = T.escapeHtml;
const seasonParam = new URLSearchParams(location.search).get('season');

document.addEventListener('DOMContentLoaded', async () => {
    T.registerSW();
    const token = T.storedToken();
    if (token) {
        const a = document.getElementById('z-panel');
        a.href = `/typuj.html?id=${encodeURIComponent(token)}`;
        a.classList.remove('hidden');
    }
    try {
        const D = await T.getJson('/api/public/data' + (seasonParam ? `?season=${encodeURIComponent(seasonParam)}` : ''));
        render(D.season);
    } catch (e) {
        const box = document.getElementById('z-error');
        box.textContent = `Nie udało się pobrać zasad sezonu: ${e.message}`;
        box.classList.remove('hidden');
    }
});

function render(season) {
    document.getElementById('z-season').textContent = season.label;
    document.title = `Zasady gry — ${season.label}`;

    document.getElementById('z-facts').innerHTML = R.facts(season).map(([icon, value, label]) => `
        <div class="rounded-xl bg-white/5 border border-white/10 px-3 py-2">
            <div class="text-lg" aria-hidden="true">${icon}</div>
            <div class="led text-lg leading-tight">${esc(value)}</div>
            <div class="text-[11px] font-semibold text-white/60 leading-tight">${esc(label)}</div>
        </div>`).join('');

    const lock = T.lockLabel(season.lockMinutes);
    const remind = T.lockLabel(season.reminderMinutes || 120);
    const steps = [
        ['🔗', 'Dostajesz swój link', 'Admin wysyła Ci prywatny link do typowania. To Twoje hasło — nie udostępniaj go nikomu.'],
        ['📲', 'Dodaj go do ekranu głównego', 'Android: menu ⋮ → „Dodaj do ekranu głównego”. iPhone (Safari): Udostępnij → „Do ekranu początkowego”. Ikona otworzy od razu Twój panel.'],
        ['🔔', 'Włącz przypomnienia', `W panelu kliknij „Włącz powiadomienia” — ${remind} przed blokadą dostaniesz przypomnienie, jeśli nie masz typu.`],
        ['🏁', 'Typuj każdy mecz', `Wpisz wynik (np. 46:44) najpóźniej ${lock} przed pierwszym biegiem. Zapisuje się sam, a do blokady możesz go zmieniać.`]
    ];
    document.getElementById('z-start').innerHTML = steps.map(([icon, title, text], i) => `
        <li class="flex gap-3 rounded-2xl border border-line bg-raised/60 p-3">
            <span class="relative shrink-0 w-11 h-11 rounded-xl bg-surface border border-line flex items-center justify-center text-xl" aria-hidden="true">${icon}
                <span class="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-brand text-white text-[11px] font-black flex items-center justify-center">${i + 1}</span></span>
            <span class="min-w-0"><span class="block font-black">${title}</span><span class="text-sm text-muted">${text}</span></span>
        </li>`).join('');

    document.getElementById('z-tiles').innerHTML = R.tiles(season).map(([v, t]) => `
        <div class="score-tile"><div class="led">${v}</div><div class="text-[11px] text-muted leading-tight mt-1">${t}</div></div>`).join('');
    document.getElementById('z-examples').innerHTML = R.examples(season).map(([typ, pts, why]) => `
        <tr class="border-b border-line last:border-0">
            <td class="py-2 font-led font-black tabular-nums">${typ}</td>
            <td class="py-2 text-center"><span class="pts-stamp ${pts > 0 ? 'text-ok' : 'text-faint'}">+${pts}</span></td>
            <td class="py-2 text-muted">${why}</td>
        </tr>`).join('');

    const sections = R.sections(season);
    document.getElementById('z-sections').innerHTML = sections.map(sec => `
        <section id="${sec.id}" class="rule-block scroll-mt-16 ${sec.scoring || sec.id === 'typowanie' ? 'md:col-span-2' : ''}">
            <h3 class="rule-title"><span aria-hidden="true">${sec.icon}</span> ${sec.title}</h3>
            <ul class="rule-list">${sec.items.filter(Boolean).map(i => `<li>${i}</li>`).join('')}</ul>
        </section>`).join('');

    document.getElementById('z-faq').innerHTML = R.faq(season).map(([q, a]) => `
        <details class="group py-1">
            <summary class="flex items-center justify-between gap-3 cursor-pointer list-none py-2.5 font-bold">
                <span>${q}</span><span class="text-muted group-open:rotate-180 transition" aria-hidden="true">▾</span></summary>
            <p class="text-sm text-muted pb-3">${a}</p>
        </details>`).join('');

    const toc = [['jak-zaczac', '🚀 Jak zacząć'], ['przyklad', '🧮 Przykład'], ...sections.map(s => [s.id, `${s.icon} ${s.title.replace(/ \(.*\)$/, '')}`]), ['faq', '❓ Pytania']];
    document.getElementById('z-toc').innerHTML = toc.map(([id, label]) => `<a href="#${id}" class="round-chip !min-h-[36px] !text-xs">${label}</a>`).join('');
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView();
}
