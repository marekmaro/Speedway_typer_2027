/** Tailwind budowany lokalnie (npm run build:css) zamiast CDN - szybciej, offline (PWA) i bez ostrzeżeń w konsoli. */
const v = name => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
    content: ['./public/**/*.html', './public/js/**/*.js'],
    theme: {
        extend: {
            colors: {
                bg: v('bg'),
                surface: v('surface'),
                raised: v('raised'),
                line: v('line'),
                ink: v('ink'),
                muted: v('muted'),
                faint: v('faint'),
                brand: v('brand'),
                'brand-ink': v('brand-ink'),
                gold: v('gold'),
                silver: v('silver'),
                bronze: v('bronze'),
                ok: v('ok'),
                bad: v('bad'),
                warn: v('warn'),
                night: v('night'),
                track: v('track'),
                // kolory pokrowców kasków: gospodarze czerwony i niebieski, goście biały i żółty
                'gate-red': v('gate-red'),
                'gate-blue': v('gate-blue'),
                'gate-white': v('gate-white'),
                'gate-yellow': v('gate-yellow')
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
                led: ['ui-monospace', 'SF Mono', 'Roboto Mono', 'Menlo', 'Consolas', 'monospace']
            },
            boxShadow: {
                card: '0 1px 2px rgb(0 0 0 / .05), 0 4px 16px rgb(0 0 0 / .05)',
                glow: '0 0 0 1px rgb(var(--gold) / .45), 0 6px 24px rgb(var(--gold) / .22)',
                lift: '0 10px 30px rgb(0 0 0 / .18)'
            }
        }
    },
    plugins: []
};
