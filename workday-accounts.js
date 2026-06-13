const fs = require("fs");
const path = require("path");
const { formatCompanyName } = require("./answer-engine");

const LEDGER_FILE = "workday-accounts.json";
const DEFAULT_WORKDAY_PASSWORD = "Dsdm260423!!";

function readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeCompanyKey(companyName) {
    const formatted = formatCompanyName(companyName) || String(companyName || "").trim();
    return formatted.toLowerCase();
}

function ledgerPath(baseDir = process.cwd()) {
    return path.join(baseDir, LEDGER_FILE);
}

function hasWorkdayAccount(companyName, baseDir = process.cwd()) {
    const key = normalizeCompanyKey(companyName);
    if (!key) {
        return false;
    }

    const ledger = readJson(ledgerPath(baseDir), { accounts: [] });
    return ledger.accounts.some((entry) => entry.companyKey === key);
}

function resolveWorkdayAuthPlan(applicationContext = {}, profile = {}) {
    const baseDir = applicationContext.baseDir || process.cwd();
    const companyName = applicationContext.companyName || null;
    const explicitMode = applicationContext.workdayAuthMode || profile.workdayAuthMode;

    if (explicitMode && explicitMode !== "auto") {
        return {
            companyName,
            hasAccount: hasWorkdayAccount(companyName, baseDir),
            modes: [explicitMode]
        };
    }

    const hasAccount = hasWorkdayAccount(companyName, baseDir);
    return {
        companyName,
        hasAccount,
        modes: hasAccount ? ["sign_in", "create_account"] : ["create_account", "sign_in"]
    };
}

function recordWorkdayAccount({
    companyName,
    jobUrl = null,
    email = null,
    baseDir = process.cwd(),
    source = "create_account"
}) {
    const companyKey = normalizeCompanyKey(companyName);
    if (!companyKey) {
        return null;
    }

    const filePath = ledgerPath(baseDir);
    const ledger = readJson(filePath, { accounts: [] });
    const now = new Date().toISOString();
    const displayName = formatCompanyName(companyName) || String(companyName).trim();
    const existing = ledger.accounts.find((entry) => entry.companyKey === companyKey);

    if (existing) {
        existing.lastUsedAt = now;
        existing.email = email || existing.email;
        if (jobUrl && !existing.jobUrls.includes(jobUrl)) {
            existing.jobUrls.push(jobUrl);
        }
        if (source && !existing.sources.includes(source)) {
            existing.sources.push(source);
        }
        writeJson(filePath, ledger);
        return existing;
    }

    const entry = {
        companyKey,
        companyName: displayName,
        email,
        firstCreatedAt: now,
        lastUsedAt: now,
        jobUrls: jobUrl ? [jobUrl] : [],
        sources: [source]
    };
    ledger.accounts.push(entry);
    ledger.accounts.sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
    writeJson(filePath, ledger);
    return entry;
}

function touchWorkdayAccount(companyName, baseDir = process.cwd(), jobUrl = null) {
    return recordWorkdayAccount({
        companyName,
        jobUrl,
        baseDir,
        source: "sign_in"
    });
}

module.exports = {
    DEFAULT_WORKDAY_PASSWORD,
    LEDGER_FILE,
    hasWorkdayAccount,
    ledgerPath,
    normalizeCompanyKey,
    recordWorkdayAccount,
    resolveWorkdayAuthPlan,
    touchWorkdayAccount
};
