const QUESTION_RULES = [
    // General patterns - most specific first
    { pattern: /consent to privacy notice/i, key: "consentToPrivacyNotice" },
    { pattern: /acknowledge.*(privacy|data protection)|receipt.*(privacy|data protection)/i, key: "autoAcknowledgePrivacyReceipt" },

    { pattern: /at least (18|eighteen)|minimum age/i, key: "minimumAgeConfirmed" },
    { pattern: /pronouns?/i, key: "pronouns" },

    // Demographics
    { pattern: /hispanic|latino|latina|latinx/i, key: "demographics.hispanicOrLatino" },
    { pattern: /race or ethnicity/i, key: "demographics.raceEthnicityDetail" },
    { pattern: /race|ethnicity|ethnic background/i, key: "demographics.raceEthnicity" },
    { pattern: /veteran|military service/i, key: "demographics.veteranStatus" },
    { pattern: /disability|disabled/i, key: "demographics.disabilityStatus" },
    { pattern: /lgbtq|sexual orientation/i, key: "demographics.lgbtq" },
    { pattern: /transgender|trans identity/i, key: "demographics.transgender" },
    { pattern: /gender identity/i, key: "demographics.genderIdentity" },
    { pattern: /\bgender\b/i, key: "gender" },

    // Company-specific
    { pattern: /employed by\s+(airbnb|airseva|airbnb global capability center)/i, key: "previousAirbnbEmployee" },
    { pattern: /worked.*(airbnb|airseva|airbnb global capability center)/i, key: "previousAirbnbEmployee" },
    { pattern: /(blood relative|immediate.*relative|family member|parent|sibling|spouse|offspring).*working.*airbnb/i, key: "relativeAtAirbnb" },
    { pattern: /candidate privacy policy|i agree.*candidate privacy policy/i, key: "consentToPrivacyNotice" },
    { pattern: /please provide the name of your current \(or most recent\) company|name of your current \(or most recent\) company|current \(or most recent\) company/i, key: "currentEmployer" },
    { pattern: /please select up to \d+ ethnicit|select up to \d+ ethnicit|ethnicities/i, key: "ethnicities" },
    { pattern: /gdpr_demographic_data_consent_given|consent to .*demographic data|demographic data survey/i, key: "demographicConsent" },

    // General work history
    { pattern: /non[- ]?compete/i, key: "nonCompete" },
    { pattern: /(previously|ever).*(worked|employed)|worked.*(before|previously)/i, key: "previousEmployee" },

    // Source & links
    { pattern: /hear about|how did you find|source/i, key: "source" },
    { pattern: /linkedin/i, key: "linkedin" },
    { pattern: /github/i, key: "github" },
    { pattern: /portfolio|personal website|website url/i, key: "portfolio" },

    // Name fields
    { pattern: /preferred name|name you go by/i, key: "preferredName" },
    { pattern: /full name|legal name/i, key: "fullName" },
    { pattern: /middle name/i, key: "middleName" },
    { pattern: /first name|given name/i, key: "firstName" },
    { pattern: /last name|family name|surname/i, key: "lastName" },

    // Contact
    { pattern: /\bemail\b/i, key: "email" },
    { pattern: /\bphone|mobile/i, key: "phone" },

    // Address
    { pattern: /street address|address line 1|mailing address/i, key: "streetAddress" },
    { pattern: /state|province|region/i, key: "state" },
    { pattern: /postal|zip code/i, key: "postalCode" },
    { pattern: /\bcountry\b/i, key: "country" },
    { pattern: /\bcity\b|location/i, key: "city" },

    // Work experience
    { pattern: /current (company|employer)|where do you currently work/i, key: "currentEmployer" },
    { pattern: /current (job )?title|current role/i, key: "currentTitle" },
    { pattern: /years? of (professional |relevant )?experience|how many years/i, key: "yearsOfExperience" },

    // Education
    { pattern: /highest (level of )?education|highest degree|degree type/i, key: "highestDegree" },
    { pattern: /university|college|school name/i, key: "university" },
    { pattern: /field of study|major|discipline/i, key: "fieldOfStudy" },
    { pattern: /graduation year|year graduated/i, key: "graduationYear" },

    // Location screening
    { pattern: /currently located in (the )?(us|united states)/i, key: "currentlyInUS" },
    { pattern: /bay area/i, key: "bayAreaRelocation" },

    // Availability
    { pattern: /willing.*relocat|open to relocat/i, key: "willingToRelocate" },
    { pattern: /notice period|available to start|start date/i, key: "noticePeriod" },

    // Compensation
    { pattern: /salary expectation|expected salary|desired salary|compensation expectation/i, key: "desiredSalary.display" },

    // Short/alternate forms
    { pattern: /\bdegree\b/i, key: "highestDegree" },
    { pattern: /\bschool\b/i, key: "university" },
    { pattern: /\bwebsite\b/i, key: "portfolio" },

    // Technical skills - order matters (more specific patterns first)
    { pattern: /dsa\b|data structure.*algorithm|algorithm.*data structure/i, key: "technicalSkills.dsa" },
    { pattern: /selenium/i, key: "technicalSkills.selenium" },
    { pattern: /\bjava\b(?!script)/i, key: "technicalSkills.java" },
    { pattern: /\bpython\b/i, key: "technicalSkills.python" },
    { pattern: /\bjavascript\b|\bjs\b/i, key: "technicalSkills.javascript" },
    { pattern: /typescript/i, key: "technicalSkills.typescript" },
    { pattern: /\breact\b/i, key: "technicalSkills.react" },
    { pattern: /node\.?js|nodejs/i, key: "technicalSkills.nodeJs" },
    { pattern: /test.*automat|automat.*test/i, key: "technicalSkills.testAutomation" },
    { pattern: /api.*test|test.*api/i, key: "technicalSkills.apiTesting" },
    { pattern: /database.*test|test.*database/i, key: "technicalSkills.databaseTesting" },

    // Motivation
    { pattern: /why.*(interested|apply)|interest in (this|the) (role|position)/i, key: "genericMotivation" }
    ,{ pattern: /why do you want to work/i, key: "genericMotivation" }
];

function getValue(profile, key) {
    return key.split(".").reduce((value, part) => value?.[part], profile);
}

function getCountryAnswer(valuesByCountry, targetCountry) {
    if (!valuesByCountry || !targetCountry) {
        return null;
    }

    const exactKey = Object.keys(valuesByCountry).find(
        (country) => country.toLowerCase() === targetCountry.toLowerCase()
    );

    return exactKey ? valuesByCountry[exactKey] : valuesByCountry.default ?? null;
}

function normalizeQuestion(question) {
    return String(question || "")
        .replace(/\s+/g, " ")
        .replace(/\*/g, "")
        .trim();
}

function formatCompanyName(slug) {
    if (!slug) {
        return null;
    }

    return String(slug)
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
}

function resolveMotivationAnswer(profile, context = {}) {
    const companyName = context.companyName || null;
    const byCompany = profile.companyMotivations || {};
    const companyAnswer = companyName ? byCompany[companyName] : null;

    if (companyAnswer) {
        return String(companyAnswer);
    }

    const fallback = profile.genericMotivation;
    if (!fallback) {
        return null;
    }

    return String(fallback).replace(/\{company\}/gi, companyName || "this company");
}

function getAnswer(question, profile, context = {}) {
    const normalized = normalizeQuestion(question);

    // Prefer explicit per-question overrides provided in the profile.customAnswers
    // Match keys case-insensitively after normalizing whitespace and punctuation.
    if (profile && profile.customAnswers) {
        const normalizedKeys = Object.keys(profile.customAnswers).map((k) => ({
            key: k,
            normalizedKey: normalizeQuestion(k).toLowerCase()
        }));

        // Match custom answers when the question contains the custom-answer key text
        const matchEntry = normalizedKeys.find(({ normalizedKey }) => normalized.toLowerCase().includes(normalizedKey) || normalizedKey.includes(normalized.toLowerCase()));
        if (matchEntry) {
            const v = profile.customAnswers[matchEntry.key];
            return v === undefined || v === null || v === "" ? null : String(v);
        }
    }

    if (/\bcountry\b/i.test(normalized) && /\bphone\b/i.test(normalized)) {
        return profile.country === undefined || profile.country === null || profile.country === "" ? null : String(profile.country);
    }

    if (/(authorized|authorised).*(work|employment)|(work|employment).*(authorized|authorised)/i.test(normalized)) {
        return getCountryAnswer(profile.workAuthorizationByCountry, context.targetCountry);
    }

    if (/sponsor|sponsorship/i.test(normalized)) {
        return getCountryAnswer(profile.sponsorshipRequiredByCountry, context.targetCountry);
    }

    const rule = QUESTION_RULES.find(({ pattern }) => pattern.test(normalized));

    if (!rule) {
        return null;
    }

    if (rule.key === "genericMotivation") {
        return resolveMotivationAnswer(profile, context);
    }

    const answer = getValue(profile, rule.key);
    return answer === undefined || answer === null || answer === "" ? null : String(answer);
}

module.exports = {
    formatCompanyName,
    getAnswer,
    getCountryAnswer,
    normalizeQuestion,
    resolveMotivationAnswer
};
