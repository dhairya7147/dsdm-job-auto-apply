const fs = require("fs");
const path = require("path");
const { normalizeQuestion } = require("./answer-engine");

const LEDGER_FILE = "unanswered-ledger.json";
const PENDING_FILE = "pending-answers.json";

function cleanQuestionLabel(question) {
    return normalizeQuestion(question)
        .replace(/\s+question_\d+$/i, "")
        .replace(/\s+\d{8,}$/, "")
        .replace(/\s+(first_name|last_name|email|phone|country)$/i, "")
        .trim();
}

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function mergePendingAnswers(profile, baseDir = process.cwd()) {
    const pendingPath = path.join(baseDir, PENDING_FILE);
    const pending = readJson(pendingPath, null);

    if (!pending || typeof pending !== "object" || Array.isArray(pending)) {
        return profile;
    }

    profile.customAnswers = {
        ...(profile.customAnswers || {}),
        ...pending
    };

    return profile;
}

function recordUnanswered({ questions = [], jobUrl = null, companyName = null, baseDir = process.cwd(), artifactDir = null }) {
    const cleaned = [...new Set(questions.map(cleanQuestionLabel).filter(Boolean))];
    if (cleaned.length === 0) {
        return { added: 0, ledgerPath: path.join(baseDir, LEDGER_FILE) };
    }

    if (artifactDir) {
        fs.mkdirSync(artifactDir, { recursive: true });
        writeJson(path.join(artifactDir, "unanswered.json"), {
            jobUrl,
            companyName,
            questions: cleaned,
            pendingAnswersFile: PENDING_FILE
        });
    }

    const ledgerPath = path.join(baseDir, LEDGER_FILE);
    const ledger = readJson(ledgerPath, { entries: [] });
    const now = new Date().toISOString();
    let added = 0;

    for (const question of cleaned) {
        const existing = ledger.entries.find((entry) => entry.question === question);

        if (existing) {
            existing.lastSeen = now;
            existing.seenCount += 1;
            if (jobUrl && !existing.jobUrls.includes(jobUrl)) {
                existing.jobUrls.push(jobUrl);
            }
            if (companyName && !existing.companyName) {
                existing.companyName = companyName;
            }
            continue;
        }

        ledger.entries.push({
            question,
            firstSeen: now,
            lastSeen: now,
            seenCount: 1,
            companyName,
            jobUrls: jobUrl ? [jobUrl] : []
        });
        added += 1;
    }

    ledger.entries.sort((left, right) => right.seenCount - left.seenCount || right.lastSeen.localeCompare(left.lastSeen));
    writeJson(ledgerPath, ledger);

    return { added, ledgerPath, unanswered: cleaned };
}

function promotePendingAnswers(profilePath = "profile.json", baseDir = process.cwd()) {
    const resolvedProfilePath = path.resolve(profilePath);
    const pendingPath = path.join(baseDir, PENDING_FILE);
    const pending = readJson(pendingPath, null);

    if (!pending || Object.keys(pending).length === 0) {
        return { promoted: 0, message: "No pending answers to promote" };
    }

    const profile = JSON.parse(fs.readFileSync(resolvedProfilePath, "utf8"));
    profile.customAnswers = {
        ...(profile.customAnswers || {}),
        ...pending
    };

    writeJson(resolvedProfilePath, profile);
    fs.unlinkSync(pendingPath);

    return { promoted: Object.keys(pending).length, profilePath: resolvedProfilePath };
}

module.exports = {
    LEDGER_FILE,
    PENDING_FILE,
    cleanQuestionLabel,
    mergePendingAnswers,
    promotePendingAnswers,
    recordUnanswered
};
