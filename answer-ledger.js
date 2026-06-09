const fs = require("fs");
const path = require("path");
const { formatCompanyName, normalizeQuestion } = require("./answer-engine");
const { isSponsorshipQuestion, isWorkAuthorizationQuestion } = require("./authorization-policy");

const LEDGER_FILE = "unanswered-ledger.json";
const PENDING_FILE = "pending-answers.json";

function cleanQuestionLabel(question) {
    return normalizeQuestion(question)
        .replace(/\s+question_\d+$/i, "")
        .replace(/\s+\d{8,}$/, "")
        .replace(/\s+(first_name|last_name|email|phone|country)$/i, "")
        .replace(/\s+(school--\d+|degree--\d+|discipline--\d+|candidate-location)$/i, "")
        .replace(/\s+(company-name-\d+|title-\d+|end-date-month-\d+|end-date-year-\d+)$/i, "")
        .replace(/^(School|Degree|Discipline)\s+\1$/i, "$1")
        .replace(/^(GitHub|Portfolio|Website|Other)\s+\1$/i, "$1")
        .replace(/(.{80,})\s+\1$/i, "$1")
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

    profile.customAnswers = profile.customAnswers || {};

    for (const [question, answer] of Object.entries(pending)) {
        if (answer === undefined || answer === null || String(answer).trim() === "") {
            continue;
        }

        profile.customAnswers[question] = answer;
    }

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

const EMPLOYER_QUESTION = /current company|current employer|most recent company|most recent employer|who is your current|which company do you work|at which company are you currently|please provide the name of your current|work experience:\s*current/i;

const PROFILE_FIELD_RULES = [
    { pattern: /^(github|github profile|github\/portfolio)/i, field: "github" },
    { pattern: /^(website\/portfolio\/github|website or github|personal website\s*\/\s*blog)/i, field: "portfolio" },
    { pattern: /^home address line 1$/i, field: "streetAddress" },
    { pattern: /^home address zip code$|^zip code$|^zip \/ postal code$/i, field: "postalCode" },
    { pattern: /^cumulative gpa$/i, field: "gpa" },
    { pattern: /preferred name|name you'd prefer|name pronunciation/i, field: "preferredName" },
    { pattern: /current (or )?(more |most )?recent (job )?title|current or previous job title|current or most recent title/i, field: "currentTitle" },
    { pattern: /^please select all the languages you speak fluently/i, field: "languagesSpoken" },
    { pattern: /^from where do you intend to work/i, field: "workLocationPreference" },
    { pattern: /^as part of the interview process.*preferred coding language/i, field: "preferredCodingLanguage" },
    { pattern: /^which front end and back end languages/i, field: "codingLanguages" },
    { pattern: /^in our pursuit of ai-driven advancements/i, field: "aiFamiliarityRating" }
];

function normalizePromotedAnswer(answer) {
    const trimmed = String(answer || "").trim();
    if (!trimmed) {
        return "";
    }

    return trimmed === "Ye" ? "Yes" : trimmed;
}

function matchProfileField(question) {
    return PROFILE_FIELD_RULES.find(({ pattern }) => pattern.test(question)) || null;
}

function promotePendingAnswers(profilePath = "profile.json", baseDir = process.cwd()) {
    const resolvedProfilePath = path.resolve(profilePath);
    const pendingPath = path.join(baseDir, PENDING_FILE);
    const pending = readJson(pendingPath, null);

    if (!pending || Object.keys(pending).length === 0) {
        return { promoted: 0, message: "No pending answers to promote" };
    }

    const profile = JSON.parse(fs.readFileSync(resolvedProfilePath, "utf8"));
    profile.customAnswers = profile.customAnswers || {};
    profile.companyMotivations = profile.companyMotivations || {};

    const remaining = {};
    let promoted = 0;
    let skippedAuthorization = 0;
    let keptEmpty = 0;

    const addressLine2 = normalizePromotedAnswer(pending["Home Address Line 2"]);

    for (const [question, rawAnswer] of Object.entries(pending)) {
        const answer = normalizePromotedAnswer(rawAnswer);
        const cleaned = cleanQuestionLabel(question);

        if (!answer) {
            remaining[question] = "";
            keptEmpty += 1;
            continue;
        }

        if (isWorkAuthorizationQuestion(cleaned) || isSponsorshipQuestion(cleaned)) {
            skippedAuthorization += 1;
            continue;
        }

        const whyMatch = cleaned.match(/^why\s+(.+?)\??$/i);
        if (whyMatch) {
            const company = formatCompanyName(whyMatch[1].trim()) || whyMatch[1].trim();
            profile.companyMotivations[company] = answer;
            promoted += 1;
            continue;
        }

        if (EMPLOYER_QUESTION.test(cleaned)) {
            profile.currentEmployer = answer;
            promoted += 1;
            continue;
        }

        const profileField = matchProfileField(cleaned);
        if (profileField) {
            profile[profileField.field] = answer;
            promoted += 1;
            continue;
        }

        if (/^block's purpose is economic empowerment/i.test(cleaned)) {
            profile.companyMotivations.Block = answer;
            promoted += 1;
            continue;
        }

        profile.customAnswers[cleaned] = answer;
        promoted += 1;
    }

    if (profile.streetAddress && addressLine2) {
        profile.streetAddress = `${profile.streetAddress}, ${addressLine2}`;
    }

    writeJson(resolvedProfilePath, profile);
    writeJson(pendingPath, remaining);

    return {
        promoted,
        keptEmpty,
        skippedAuthorization,
        remainingCount: Object.keys(remaining).length,
        profilePath: resolvedProfilePath,
        pendingPath
    };
}

module.exports = {
    LEDGER_FILE,
    PENDING_FILE,
    cleanQuestionLabel,
    mergePendingAnswers,
    promotePendingAnswers,
    recordUnanswered
};
