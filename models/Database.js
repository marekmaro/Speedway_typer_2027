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
    lockHours: { type: Number, default: DEFAULT_LOCK_HOURS },
    scoring: {
        exact: { type: Number, default: DEFAULT_SCORING.exact },
        diff: { type: Number, default: DEFAULT_SCORING.diff },
        winner: { type: Number, default: DEFAULT_SCORING.winner },
        motrBonus: { type: Number, default: DEFAULT_SCORING.motrBonus },
        jokerMultiplier: { type: Number, default: DEFAULT_SCORING.jokerMultiplier },
        longTermEach: { type: Number, default: DEFAULT_SCORING.longTermEach }
    },
    teams: { type: [String], default: [] },
    stageNames: { type: Map, of: String, default: {} },
    results: {
        champion: { type: String, default: '' },
        bronze: { type: String, default: '' },
        relegation: { type: String, default: '' }
    }
}, { timestamps: true });

const matchSchema = new mongoose.Schema({
    season: { type: Number, required: true, index: true },
    round: Number,
    homeTeam: String,
    awayTeam: String,
    matchDate: Date,
    homeScore: { type: Number, default: null },
    awayScore: { type: Number, default: null },
    isMatchOfTheRound: { type: Boolean, default: false },
    isPostponed: { type: Boolean, default: false },
    note: { type: String, default: '' }
}, { timestamps: true });
matchSchema.index({ season: 1, round: 1, homeTeam: 1, awayTeam: 1 }, { unique: true });

const predictionSchema = new mongoose.Schema({
    season: { type: Number, required: true, index: true },
    nickname: String,
    matchId: String,
    homePred: Number,
    awayPred: Number,
    usedJoker: { type: Boolean, default: false },
    pointsEarned: { type: Number, default: null },
    source: { type: String, default: 'player' } // 'player' | 'admin'
}, { timestamps: true });
// Ten indeks fizycznie uniemożliwia powstanie duplikatów typów.
predictionSchema.index({ season: 1, nickname: 1, matchId: 1 }, { unique: true });

const playerSchema = new mongoose.Schema({
    fullName: String,
    nickname: { type: String, unique: true },
    token: { type: String, unique: true },
    isActive: { type: Boolean, default: true },
    seasons: { type: [Number], default: [] }
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

module.exports = {
    Season: mongoose.model('Season', seasonSchema),
    Match: mongoose.model('Match', matchSchema),
    Prediction: mongoose.model('Prediction', predictionSchema),
    Player: mongoose.model('Player', playerSchema),
    LongTerm: mongoose.model('LongTerm', longTermSchema),
    CupMatch: mongoose.model('CupMatch', cupMatchSchema)
};
