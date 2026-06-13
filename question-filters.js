const { isSponsorshipQuestion, isWorkAuthorizationQuestion } = require("./authorization-policy");

const IGNORE_PATTERNS = [
    /^web-ui\d*$/i,
    /^upload pdf/i,
    /resume_format|cover_format|edit-resume-format|edit-cover-format/i,
    /^stackexchange\b/i,
    /edit-question-\d+/i,
    /question_\d+\[\]/i,
    /select all that apply\.?\s*question_\d+/i,
    /^yes yes question_/i,
    /^i acknowledge i acknowledge/i,
    /verification code/i,
    /security.code/i,
    /confirm you.?re a human/i,
    /voluntary self-identification/i,
    /equal employment opportunity/i,
    /government reporting purposes/i,
    /^school school--/i,
    /^degree degree--/i,
    /^discipline discipline--/i,
    /^country phone$/i,
    /^location \(city\) candidate-location$/i,
    /^search box$/i,
    /^keyword search input$/i,
    /^page error$/i,
    /^password$/i,
    /^verify password$/i,
    /^beecatcher$/i,
    /^date section (month|day|year) input$/i,
    /^error:/i,
    /^select one$/i,
    /^overall select one required$/i,
    /^from$/i,
    /^phone extension$/i,
    /^other$/i,
    /^utility menu button$/i,
    /^skip to main content$/i,
    /^yes$/i,
    /^resume resume/i,
    /_systemfield_resume$/i
];

function shouldIgnoreQuestion(question) {
    const cleaned = String(question || "").trim();
    if (!cleaned) {
        return true;
    }

    return IGNORE_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function isAutoHandledQuestion(question, profile, context = {}) {
    if (isWorkAuthorizationQuestion(question) || isSponsorshipQuestion(question)) {
        return true;
    }

    if (shouldIgnoreQuestion(question)) {
        return true;
    }

    if (/^upload\b/i.test(question) && /pdf|resume|cover/i.test(question)) {
        return true;
    }

    return false;
}

module.exports = {
    IGNORE_PATTERNS,
    isAutoHandledQuestion,
    shouldIgnoreQuestion
};
