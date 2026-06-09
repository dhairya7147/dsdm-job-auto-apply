const fs = require("fs");
const path = require("path");
const { cleanQuestionLabel, PENDING_FILE, LEDGER_FILE } = require("./answer-ledger");
const { getAnswer } = require("./answer-engine");
const { loadProfile } = require("./profile-loader");

const PROFILE_PATH = process.env.JOB_AUTO_APPLY_PROFILE || "profile.json";

const IGNORE_PATTERNS = [
    /verification code/i,
    /security.code/i,
    /confirm you.?re a human/i,
    /voluntary self-identification/i,
    /equal employment opportunity/i,
    /government reporting purposes/i,
    /^&lt;/i,
    /<h3>/i,
    /^school school--/i,
    /^degree degree--/i,
    /^discipline discipline--/i,
    /^country phone$/i,
    /^location \(city\) candidate-location$/i
];

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function shouldSync(question, profile) {
    const cleaned = cleanQuestionLabel(question);
    if (!cleaned || IGNORE_PATTERNS.some((pattern) => pattern.test(cleaned))) {
        return false;
    }

    if (getAnswer(cleaned, profile)) {
        return false;
    }

    if (profile.customAnswers && cleaned in profile.customAnswers && profile.customAnswers[cleaned]) {
        return false;
    }

    return true;
}

function syncPendingAnswers(baseDir = process.cwd()) {
    const ledgerPath = path.join(baseDir, LEDGER_FILE);
    const pendingPath = path.join(baseDir, PENDING_FILE);
    const profile = loadProfile(path.join(baseDir, PROFILE_PATH));

    const ledger = readJson(ledgerPath, { entries: [] });
    const pending = readJson(pendingPath, {});

    let added = 0;
    const candidates = [];

    for (const entry of ledger.entries || []) {
        if (!shouldSync(entry.question, profile)) {
            continue;
        }

        const cleaned = cleanQuestionLabel(entry.question);
        if (pending[cleaned] !== undefined && pending[cleaned] !== "") {
            continue;
        }

        if (pending[cleaned] === undefined) {
            pending[cleaned] = "";
            added += 1;
        }

        candidates.push({
            question: cleaned,
            seenCount: entry.seenCount,
            companyName: entry.companyName,
            sampleUrl: entry.jobUrls?.[0] || null
        });
    }

    candidates.sort((left, right) => right.seenCount - left.seenCount);
    fs.writeFileSync(pendingPath, `${JSON.stringify(pending, null, 2)}\n`);

    return {
        pendingPath,
        ledgerPath,
        added,
        totalPending: Object.keys(pending).length,
        unansweredStillEmpty: Object.entries(pending).filter(([, value]) => value === "").length,
        topCandidates: candidates.slice(0, 30)
    };
}

if (require.main === module) {
    const result = syncPendingAnswers(process.cwd());
    process.stdout.write(`${JSON.stringify({ event: "pending_synced", ...result }, null, 2)}\n`);
}

module.exports = { syncPendingAnswers };
