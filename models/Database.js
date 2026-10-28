const mongoose = require('mongoose');
const { DEFAULT_SCORING, DEFAULT_LOCK_HOURS } = require('../config');

/* ------------------------------------------------------------------
   SEZON - nowy byt w wersji 2.
   Dzięki niemu sezon 2026 zostaje w archiwum, a 2027 startuje od zera.
------------------------------------------------------------------- */
const seasonSchema = new mongoose.Schema({
    year: { type: Number, required: true, unique: true },
    label: { type: String, default: '' },
    isActive: { type: Boolean, default: false },
    isFinished: { type: Boolean, default: false },
    // v2: blokada w godzinach. v3: w minutach (lockMinutes ma pierwszeństwo, gdy jest ustawione).
    lockHours: { type: Number, default: DEFAULT_LOCK_HOURS },
    lockMinutes: { type: Number, default: null },
    scoring: {
        exact: { type: Number, default: DEFAULT_SCORING.exact },
        diff: { type: Number, default: DEFAULT_SCORING.diff },
        winner: { type: Number, default: DEFAULT_SCORING.winner },
        motrBonus: { type: Number, default: DEFAULT_SCORING.motrBonus },
        jokerMultiplier: { type: Number, default: DEFAULT_SCORING.jokerMultiplier },
        longTermEach: { type: Number, default: DEFAULT_SCORING.longTermEach },
        diffTolerance: { type: Number, default: DEFAULT_SCORING.diffTolerance }
    },
    teams: { type: [String], default: [] },
    stageNames: { type: Map, of: String, default: {} },
    results: {
        champion: { type: String, default: '' },
        bronze: { type: String, default: '' },
        relegation: { type: String, default: '' }
    },
    // Ręczne korekty tabeli ligi (walkower z ujemnymi punktami, decyzja GKSŻ, bonus przyznany przy zielonym stoliku)
    standingsAdjustments: {
        type: [{ team: String, points: Number, reason: String, _id: false }],
        default: []
    },
    // Scraper: dodatkowe nazwy drużyn używane przez portale (np. "Motor" dla "Orlen Oil Motor Lublin")
    teamAliases: { type: Map, of: [String], default: {} },
    // Scraper: adresy stron z wynikami dla tego sezonu (puste = SCRAPER_URLS z .env)
    scraperUrls: { type: [String], default: [] },
    // Niespodzianka dla Mistrza Typera. Widzi ją tylko zwycięzca (przez swój link) po zamknięciu sezonu.
    winnerSurprise: {
        prize: { type: String, default: '' },        // np. "kask z autografem" - zakryty do zdrapania
        message: { type: String, default: '' },      // osobista wiadomość od organizatora
        revealedBy: { type: [String], default: [] }  // kto już odkrył niespodziankę
    }
}, { timestamps: true });

const matchSchema = new mongoose.Schema({
    season: { type: Number, required: true, index: true },
    round: Number,
    homeTeam: String,
    awayTeam: String,
    matchDate: Date,
    // Pierwotna data - ustawiana przy pierwszym przełożeniu, typy NIE są ruszane
    originalDate: { type: Date, default: null },
    homeScore: { type: Number, default: null },
    awayScore: { type: Number, default: null },
    isMatchOfTheRound: { type: Boolean, default: false },
    isPostponed: { type: Boolean, default: false },
    // Walkower: wynik liczy się do tabeli ligi, ale typy są anulowane (nikt nie przewidzi 40:0)
    isWalkover: { type: Boolean, default: false },
    // Typy anulowane (walkower, mecz odwołany na stałe) - nikt nie dostaje punktów, joker wraca do gracza
    voidPredictions: { type: Boolean, default: false },
    // Mecz przełożony PO blokadzie (np. deszcz w dniu meczu): typy były już jawne,
    // więc zostają zamrożone także po zmianie daty. Admin może je świadomie odmrozić.
    predictionsFrozen: { type: Boolean, default: false },
    resultSource: { type: String, default: null }, // 'admin' | 'scraper'
    resultConfirmedAt: { type: Date, default: null },
    note: { type: String, default: '' }
}, { timestamps: true });
matchSchema.index({ season: 1, round: 1, homeTeam: 1, awayTeam: 1 }, { unique: true });
matchSchema.index({ season: 1, matchDate: 1 });

const predictionSchema = new mongoose.Schema({
    season: { type: Number, required: true, index: true },
    nickname: String,
    matchId: String,
    homePred: Number,
    awayPred: Number,
    usedJoker: { type: Boolean, default: false },
    pointsEarned: { type: Number, default: null },
    // 'exact' | 'diff' | 'winner' | 'miss' | null - liczone przy rozliczeniu, żeby statystyki
    // (także ranking wszech czasów) nie musiały za każdym razem łączyć typów z meczami
    outcome: { type: String, default: null },
    source: { type: String, default: 'player' } // 'player' | 'admin'
}, { timestamps: true });
// Ten indeks fizycznie uniemożliwia powstanie duplikatów typów.
predictionSchema.index({ season: 1, nickname: 1, matchId: 1 }, { unique: true });
// Przeliczanie jednego meczu
predictionSchema.index({ matchId: 1 });

const playerSchema = new mongoose.Schema({
    fullName: String,
    nickname: { type: String, unique: true },
    token: { type: String, unique: true },
    isActive: { type: Boolean, default: true },
    seasons: { type: [Number], default: [] },
    lastSeenAt: { type: Date, default: null }
}, { timestamps: true });

const longTermSchema = new mongoose.Schema({
    season: { type: Number, required: true, index: true },
    nickname: String,
    champion: { type: String, default: '' },
    bronze: { type: String, default: '' },
    relegation: { type: String, default: '' },
    pointsEarned: { type: Number, default: 0 }
}, { timestamps: true });
longTermSchema.index({ season: 1, nickname: 1 }, { unique: true });

const cupMatchSchema = new mongoose.Schema({
    season: { type: Number, required: true, index: true },
    stage: String,
    roundNumber: Number,
    player1: String,
    player2: String,
    score1: { type: Number, default: null },
    score2: { type: Number, default: null },
    autoScore: { type: Boolean, default: true } // licz punkty automatycznie z rundy
}, { timestamps: true });

/* ------------------------------------------------------------------
   v3: WYNIKI ZE SCRAPERA czekające na zatwierdzenie admina.
   Nic nie trafia do meczu, dopóki admin nie kliknie "Zatwierdź".
------------------------------------------------------------------- */
const resultDraftSchema = new mongoose.Schema({
    season: { type: Number, required: true, index: true },
    matchId: { type: String, required: true },
    homeScore: Number,
    awayScore: Number,
    source: String,          // nazwa parsera / hosta
    sourceUrl: String,
    snippet: String,         // fragment tekstu, z którego odczytano wynik (do weryfikacji wzrokiem)
    warnings: { type: [String], default: [] },
    blockers: { type: [String], default: [] }, // poważne problemy - zatwierdzenie wymaga korekty
    notes: { type: [String], default: [] },    // informacje bez zastrzeżeń (np. "zgodne w 2 źródłach")
    // odczyt ze źródła, gdy admin zatwierdził poprawione liczby - żeby błędny odczyt nie wracał przy kolejnym pobraniu
    scrapedHome: { type: Number, default: null },
    scrapedAway: { type: Number, default: null },
    status: { type: String, default: 'draft' }, // 'draft' | 'approved' | 'rejected'
    decidedAt: { type: Date, default: null }
}, { timestamps: true });
resultDraftSchema.index({ matchId: 1, status: 1 });

/* v3: subskrypcje Web Push (telefon gracza albo admina). */
const pushSubscriptionSchema = new mongoose.Schema({
    endpoint: { type: String, required: true, unique: true },
    keys: { p256dh: String, auth: String },
    nickname: { type: String, default: null, index: true },
    isAdmin: { type: Boolean, default: false },
    userAgent: { type: String, default: '' },
    failures: { type: Number, default: 0 }
}, { timestamps: true });

/* v3: dziennik wysłanych powiadomień - gwarantuje, że przypomnienie nie przyjdzie dwa razy. */
const notificationLogSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    sentAt: { type: Date, default: Date.now }
});

/* v3: dziennik zadań w tle (scraper, przypomnienia) - widoczny w panelu admina. */
const jobRunSchema = new mongoose.Schema({
    job: String,
    ok: Boolean,
    summary: String,
    details: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });
jobRunSchema.index({ createdAt: -1 });

module.exports = {
    Season: mongoose.model('Season', seasonSchema),
    Match: mongoose.model('Match', matchSchema),
    Prediction: mongoose.model('Prediction', predictionSchema),
    Player: mongoose.model('Player', playerSchema),
    LongTerm: mongoose.model('LongTerm', longTermSchema),
    CupMatch: mongoose.model('CupMatch', cupMatchSchema),
    ResultDraft: mongoose.model('ResultDraft', resultDraftSchema),
    PushSubscription: mongoose.model('PushSubscription', pushSubscriptionSchema),
    NotificationLog: mongoose.model('NotificationLog', notificationLogSchema),
    JobRun: mongoose.model('JobRun', jobRunSchema)
};
