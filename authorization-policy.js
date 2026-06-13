const KNOWN_COUNTRIES = [
    "United States",
    "United Kingdom",
    "India",
    "Canada",
    "Australia",
    "Germany",
    "France",
    "Ireland",
    "Netherlands",
    "Singapore",
    "Brazil",
    "Japan",
    "Mexico",
    "Spain",
    "Italy",
    "Switzerland",
    "Sweden",
    "Poland",
    "Israel",
    "United Arab Emirates",
    "Serbia",
    "Netherlands"
];

const LOCATION_HINTS = [
    { pattern: /\b(united states|u\.?s\.?a?\.?|america)\b/i, country: "United States" },
    { pattern: /\b(united kingdom|u\.?k\.?|england|scotland|wales)\b/i, country: "United Kingdom" },
    { pattern: /\b(india|bangalore|bengaluru|gurgaon|gurugram|hyderabad|mumbai|pune|noida|delhi|chennai)\b/i, country: "India" },
    { pattern: /\bin-bengaluru\b/i, country: "India" },
    { pattern: /\bremote\s*[-,]?\s*india\b/i, country: "India" },
    { pattern: /\bhybrid\s*[-–]\s*(bangalore|bengaluru|mumbai|gurgaon|gurugram|hyderabad|pune|delhi|chennai)\b/i, country: "India" },
    { pattern: /\b(india|bangalore|bengaluru|gurgaon|gurugram|hyderabad|mumbai|pune|noida|delhi|chennai),\s*ind(ia)?\b/i, country: "India" },
    { pattern: /\b(canada|toronto|vancouver|montreal)\b/i, country: "Canada" },
    { pattern: /\b(australia|sydney|melbourne)\b/i, country: "Australia" },
    { pattern: /\b(germany|berlin|munich)\b/i, country: "Germany" },
    { pattern: /\b(france|paris)\b/i, country: "France" },
    { pattern: /\b(ireland|dublin)\b/i, country: "Ireland" },
    { pattern: /\b(netherlands|amsterdam)\b/i, country: "Netherlands" },
    { pattern: /\b(singapore)\b/i, country: "Singapore" },
    { pattern: /\b(santa clara|san francisco|bay area|mountain view|san mateo|seattle|austin|boston|chicago|los angeles|new york|california|,\s*ca\b|,\s*ny\b|,\s*wa\b|,\s*tx\b)/i, country: "United States" },
    { pattern: /\b(london|manchester|cambridge,\s*uk)\b/i, country: "United Kingdom" }
];

const COUNTRY_ALIASES = {
    us: "United States",
    usa: "United States",
    "u.s.": "United States",
    "u.s.a.": "United States",
    america: "United States",
    uk: "United Kingdom",
    "u.k.": "United Kingdom",
    england: "United Kingdom",
    bharat: "India"
};

function normalizeCountry(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
        return null;
    }

    const alias = COUNTRY_ALIASES[trimmed.toLowerCase()];
    if (alias) {
        return alias;
    }

    const exact = KNOWN_COUNTRIES.find((country) => country.toLowerCase() === trimmed.toLowerCase());
    return exact || trimmed;
}

function countriesMatch(left, right) {
    const a = normalizeCountry(left);
    const b = normalizeCountry(right);
    return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function extractCountryFromText(text) {
    const source = String(text || "");
    if (!source.trim()) {
        return null;
    }

    for (const country of KNOWN_COUNTRIES) {
        const pattern = new RegExp(`\\b${country.replace(/\s+/g, "\\s+")}\\b`, "i");
        if (pattern.test(source)) {
            return country;
        }
    }

    for (const hint of LOCATION_HINTS) {
        if (hint.pattern.test(source)) {
            return hint.country;
        }
    }

    return null;
}

function getHomeCountry(profile) {
    return normalizeCountry(profile?.citizenship || profile?.country);
}

function resolveTargetCountry(question, context = {}) {
    if (context.targetCountry) {
        return normalizeCountry(context.targetCountry);
    }

    if (context.jobLocation) {
        const fromJob = extractCountryFromText(context.jobLocation);
        if (fromJob) {
            return fromJob;
        }
    }

    return extractCountryFromText(question);
}

function getExplicitCountryAnswer(map, targetCountry) {
    if (!map || !targetCountry) {
        return null;
    }

    const normalizedTarget = normalizeCountry(targetCountry);
    const entry = Object.entries(map).find(([country]) =>
        country !== "default" && countriesMatch(country, normalizedTarget)
    );

    if (!entry) {
        return null;
    }

    const value = entry[1];
    return value === undefined || value === null || value === "" ? null : String(value);
}

function resolveCitizenshipAuthorization(type, profile, targetCountry) {
    const homeCountry = getHomeCountry(profile);
    const resolvedTarget = normalizeCountry(targetCountry);

    if (!homeCountry || !resolvedTarget) {
        return null;
    }

    const isHomeMarket = countriesMatch(homeCountry, resolvedTarget);

    if (type === "authorized") {
        return isHomeMarket ? "Yes" : "No";
    }

    return isHomeMarket ? "No" : "Yes";
}

function isWorkAuthorizationQuestion(question) {
    return /(authorized|authorised).*(work|employment|lawfully)|(work|employment).*(authorized|authorised)|\bwork authorization\b|eligible to work|legally authorized to work|legally authorised to work|right to live and work/i.test(question);
}

function isSponsorshipQuestion(question) {
    return /sponsor|sponsorship|immigration case|immigration support|visa|h-1b|work permit|need sponsorship for employment/i.test(question);
}

function isResidencyQuestion(question) {
    if (/willing to relocat|relocate to|open to relocat/i.test(question)) {
        return false;
    }

    if (/what country|which country|country are you based/i.test(question)) {
        return false;
    }

    return /(currently|do you)\s+(reside|live)\s+(in|within)|based in|located in|currently located/i.test(question);
}

function resolveResidencyAnswer(question, profile, context = {}) {
    if (!isResidencyQuestion(question)) {
        return null;
    }

    const homeCountry = getHomeCountry(profile);
    const targetCountry = resolveTargetCountry(question, context);
    if (!homeCountry || !targetCountry) {
        return null;
    }

    return countriesMatch(homeCountry, targetCountry) ? "Yes" : "No";
}

function resolveAuthorizationAnswer(type, question, profile, context = {}) {
    const normalized = String(question || "");
    const map = type === "authorized"
        ? profile.workAuthorizationByCountry
        : profile.sponsorshipRequiredByCountry;

    const targetCountry = resolveTargetCountry(normalized, context);
    const explicit = getExplicitCountryAnswer(map, targetCountry);
    if (explicit !== null) {
        return explicit;
    }

    const citizenshipAnswer = resolveCitizenshipAuthorization(type, profile, targetCountry);
    if (citizenshipAnswer !== null) {
        return citizenshipAnswer;
    }

    if (map?.default !== undefined && map.default !== null && map.default !== "") {
        return String(map.default);
    }

    return null;
}

module.exports = {
    KNOWN_COUNTRIES,
    countriesMatch,
    extractCountryFromText,
    getHomeCountry,
    isResidencyQuestion,
    isSponsorshipQuestion,
    isWorkAuthorizationQuestion,
    normalizeCountry,
    resolveAuthorizationAnswer,
    resolveResidencyAnswer,
    resolveTargetCountry
};
