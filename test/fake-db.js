/* Miniaturowa atrapa mongoose na potrzeby testów integracyjnych (tylko dev).
   Pozwala przetestować trasy API bez uruchamiania MongoDB. */

let counter = 0;
const newId = () => `id${++counter}`;

function matches(doc, query) {
    return Object.entries(query || {}).every(([key, cond]) => {
        const val = doc[key];
        if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
            return Object.entries(cond).every(([op, arg]) => {
                switch (op) {
                    case '$ne': return String(val) !== String(arg);
                    case '$in': return (Array.isArray(val) ? val : [val]).some(v => arg.map(String).includes(String(v)));
                    case '$nin': return !(Array.isArray(val) ? val : [val]).some(v => arg.map(String).includes(String(v)));
                    case '$gte': return Number(val) >= Number(arg);
                    case '$gt': return Number(val) > Number(arg);
                    case '$lte': return Number(val) <= Number(arg);
                    case '$size': return Array.isArray(val) && val.length === arg;
                    default: throw new Error(`Nieobsługiwany operator ${op}`);
                }
            });
        }
        if (Array.isArray(val)) return val.map(String).includes(String(cond));
        if (cond === null || cond === undefined) return val === null || val === undefined;
        return String(val) === String(cond);
    });
}

class Query {
    constructor(exec) { this.exec = exec; this._sort = null; }
    sort(spec) { this._sort = spec; return this; }
    select() { return this; }
    lean() { return this; }
    then(resolve, reject) {
        let out = this.exec();
        if (Array.isArray(out) && this._sort) {
            const keys = Object.entries(this._sort);
            out = [...out].sort((a, b) => {
                for (const [k, dir] of keys) {
                    const av = a[k] instanceof Date ? a[k].getTime() : a[k];
                    const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
                    if (av === bv) continue;
                    return (av > bv ? 1 : -1) * (dir === -1 ? -1 : 1);
                }
                return 0;
            });
        }
        return Promise.resolve(out).then(resolve, reject);
    }
    catch(fn) { return this.then(undefined, fn); }
}

function makeModel(name, defaults = {}, unique = null) {
    const rows = [];
    const decorate = doc => {
        Object.defineProperty(doc, 'save', { value: async () => doc, enumerable: false, configurable: true });
        Object.defineProperty(doc, 'toObject', { value: () => ({ ...doc }), enumerable: false, configurable: true });
        return doc;
    };
    const model = {
        modelName: name,
        _rows: rows,
        find: q => new Query(() => rows.filter(r => matches(r, q))),
        findOne: q => new Query(() => rows.find(r => matches(r, q)) || null),
        findById: id => new Query(() => rows.find(r => String(r._id) === String(id)) || null),
        countDocuments: q => new Query(() => rows.filter(r => matches(r, q)).length),
        create: async data => {
            if (unique && rows.some(r => String(r[unique]) === String(data[unique]))) {
                const err = new Error(`E11000 duplicate key ${unique}`); err.code = 11000; throw err;
            }
            const doc = decorate({ _id: newId(), ...defaults, ...data });
            rows.push(doc);
            return doc;
        },
        insertMany: async list => { for (const d of list) await model.create(d); },
        findOneAndUpdate: (q, update, opts = {}) => new Query(() => {
            const set = update.$set || update;
            const onInsert = update.$setOnInsert || {};
            let doc = rows.find(r => matches(r, q));
            if (!doc) {
                if (!opts.upsert) return null;
                doc = decorate({ _id: newId(), ...defaults, ...q, ...onInsert });
                rows.push(doc);
            }
            Object.entries(set).forEach(([k, v]) => { if (!k.startsWith('$')) doc[k] = v; });
            return doc;
        }),
        findByIdAndUpdate: (id, update) => model.findOneAndUpdate({ _id: id }, update),
        updateOne: (q, update, opts = {}) => new Query(() => {
            const set = update.$set || update;
            let doc = rows.find(r => matches(r, q));
            let upserted = 0;
            if (!doc && opts.upsert) {
                doc = decorate({ _id: newId(), ...defaults, ...q, ...(update.$setOnInsert || {}) });
                rows.push(doc);
                upserted = 1;
            }
            if (doc) Object.entries(set).forEach(([k, v]) => { if (!k.startsWith('$')) doc[k] = v; });
            if (doc && update.$pull) Object.entries(update.$pull).forEach(([k, v]) => { doc[k] = (doc[k] || []).filter(x => String(x) !== String(v)); });
            return { upsertedCount: upserted, modifiedCount: doc ? 1 : 0 };
        }),
        updateMany: (q, update) => new Query(() => {
            const set = update.$set || update;
            const pull = update.$pull || null;
            const hits = rows.filter(r => matches(r, q));
            hits.forEach(doc => {
                Object.entries(set).forEach(([k, v]) => { if (!k.startsWith('$')) doc[k] = v; });
                if (pull) Object.entries(pull).forEach(([k, v]) => { doc[k] = (doc[k] || []).filter(x => String(x) !== String(v)); });
            });
            return { modifiedCount: hits.length };
        }),
        deleteOne: q => new Query(() => {
            const i = rows.findIndex(r => matches(r, q));
            if (i >= 0) rows.splice(i, 1);
            return { deletedCount: i >= 0 ? 1 : 0 };
        }),
        deleteMany: q => new Query(() => {
            let n = 0;
            for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], q)) { rows.splice(i, 1); n++; }
            return { deletedCount: n };
        }),
        aggregate: () => new Query(() => []),
        bulkWrite: async ops => {
            for (const op of ops) {
                if (op.updateOne) await model.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: op.updateOne.upsert });
                else if (op.insertOne) await model.create(op.insertOne.document);
                else if (op.deleteOne) await model.deleteOne(op.deleteOne.filter);
            }
            return { ok: 1 };
        }
    };
    return model;
}

module.exports = function fakeModels() {
    return {
        Season: makeModel('Season', { isActive: false, isFinished: false, lockHours: 24, lockMinutes: null, teams: [], results: {}, standingsAdjustments: [], scraperUrls: [] }),
        Match: makeModel('Match', { homeScore: null, awayScore: null, isMatchOfTheRound: false, isPostponed: false, isWalkover: false, voidPredictions: false, predictionsFrozen: false, originalDate: null, note: '' }),
        Prediction: makeModel('Prediction', { usedJoker: false, pointsEarned: null, outcome: null, source: 'player' }),
        Player: makeModel('Player', { isActive: true, seasons: [] }),
        LongTerm: makeModel('LongTerm', { pointsEarned: 0, champion: '', bronze: '', relegation: '' }),
        CupMatch: makeModel('CupMatch', { score1: null, score2: null, autoScore: true }),
        ResultDraft: makeModel('ResultDraft', { status: 'draft', warnings: [], blockers: [], notes: [], scrapedHome: null, scrapedAway: null }),
        PushSubscription: makeModel('PushSubscription', { nickname: null, isAdmin: false, failures: 0 }, 'endpoint'),
        NotificationLog: makeModel('NotificationLog', {}, 'key'),
        JobRun: makeModel('JobRun', {}),
        AppSetting: makeModel('AppSetting', { value: null }, 'key')
    };
};
