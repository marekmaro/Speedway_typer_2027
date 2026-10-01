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
                ok: v('ok'),
                bad: v('bad'),
                warn: v('warn'),
                night: v('night')
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']
            },
            boxShadow: {
                card: '0 1px 2px rgb(0 0 0 / .05), 0 4px 16px rgb(0 0 0 / .05)'
            }
        }
    },
    plugins: []
};
