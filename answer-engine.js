const {
    isSponsorshipQuestion,
    isWorkAuthorizationQuestion,
    resolveAuthorizationAnswer
} = require("./authorization-policy");
const { resolveExperienceBracketAnswer } = require("./experience-policy");

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
    { pattern: /employment agreements.*post-employment restrictions|agreements that may restrict your ability/i, key: "nonCompete" },
    { pattern: /(previously|ever).*(worked|employed)|worked.*(before|previously)/i, key: "previousEmployee" },
    { pattern: /employed by .* in the past|been employed by .* entity/i, key: "previousEmployee" },
    { pattern: /current or former .* employee|alphabet employee|deloitte/i, key: "previousEmployee" },

    // Compliance and consent
    { pattern: /government official|close relative.*government|public official/i, key: "governmentOfficial" },
    { pattern: /interview.*record|ai notetaker|transcribe.*interview|ai to transcribe/i, key: "interviewRecordingConsent" },
    { pattern: /ai policy|ai responsible use|may use ai tools to assist/i, key: "aiPolicyConsent" },
    { pattern: /sanctions and export controls/i, key: "sanctionsCompliance" },

    // Screening
    { pattern: /phd/i, key: "hasPhd" },
    { pattern: /hybrid.*office|in-person.*office|days a week in office|in office.*days|office-centric hybrid|able to meet this requirement/i, key: "hybridOfficeWilling" },
    { pattern: /marketing communications|stay up to date|company and product news/i, key: "marketingOptIn" },
    { pattern: /know anyone who works|family member.*employee|relative.*working/i, key: "knowEmployeeAtCompany" },
    { pattern: /optional practical training/i, key: "optStatus" },
    { pattern: /6 years of data\/analytics engineering/i, key: "sixYearsDataExperience" },
    { pattern: /5 years of full time relevant/i, key: "fiveYearsExperience" },
    { pattern: /10\+ years of total relevant technical/i, key: "tenYearsTechnical" },
    { pattern: /deadlines or timeline considerations/i, key: "timelineConsiderations" },
    { pattern: /interviewed at .* before/i, key: "previousInterview" },
    { pattern: /applied to .* in the last/i, key: "recentApplication" },
    { pattern: /fluent or proficient in arabic/i, key: "speaksArabic" },
    { pattern: /familiarity with artificial intelligence/i, key: "aiFamiliarityRating" },
    { pattern: /preferred coding language/i, key: "preferredCodingLanguage" },
    { pattern: /front end and back end languages/i, key: "codingLanguages" },
    { pattern: /languages you speak fluently/i, key: "languagesSpoken" },
    { pattern: /from where do you intend to work/i, key: "workLocationPreference" },
    { pattern: /cumulative gpa/i, key: "gpa" },
    { pattern: /where are you currently based/i, key: "currentLocation" },
    { pattern: /additional information/i, key: "additionalInformation" },
    { pattern: /core technical stack/i, key: "coreTechnicalStack" },
    { pattern: /english level|proficiency in english|advanced english level/i, key: "englishLevel" },
    { pattern: /earliest you would want to start|earliest start/i, key: "earliestStartDate" },
    { pattern: /name pronunciation/i, key: "namePronunciation" },
    { pattern: /contact your current employer/i, key: "contactCurrentEmployer" },
    { pattern: /reasonable accommodation/i, key: "reasonableAccommodation" },
    { pattern: /military status/i, key: "militaryStatus" },
    { pattern: /current salary|current total salary/i, key: "currentSalary" },
    { pattern: /finra license/i, key: "finraLicenses" },
    { pattern: /in-person 5 days|five days a week|four days a week|office at least two days|office-centric hybrid|commutable distance to austin/i, key: "onsiteRequirementWilling" },
    { pattern: /ready to relocate to mumbai|relocate to mumbai/i, key: "mumbaiRelocation" },
    { pattern: /may we contact your current employer/i, key: "contactCurrentEmployer" },
    { pattern: /salary increment expectation|salary expectation/i, key: "salaryExpectation" },
    { pattern: /gitlab username/i, key: "gitlabUsername" },
    { pattern: /roblox username/i, key: "robloxUsername" },
    { pattern: /fluent french/i, key: "speaksFrench" },
    { pattern: /fluent or proficient in arabic/i, key: "speaksArabic" },
    { pattern: /currently enrolled as a student/i, key: "isStudent" },
    { pattern: /public company experience/i, key: "publicCompanyExperience" },
    { pattern: /experience using airtable/i, key: "airtableExperience" },
    { pattern: /using looker/i, key: "lookerExperience" },
    { pattern: /whatsapp messages from stripe/i, key: "whatsappRecruitingOptIn" },
    { pattern: /business trips every/i, key: "businessTravelWilling" },
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
    { pattern: /current (or )?(more |most )?recent (job )?title|current (job )?title|current role/i, key: "currentTitle" },
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

    // Motivation & essays
    { pattern: /why.*(interested|apply|join)|interest in (this|the) (role|position|company|opportunity)/i, key: "genericMotivation" },
    { pattern: /why do you want to work/i, key: "genericMotivation" },
    { pattern: /why\s+\w+/i, key: "genericMotivation" },
    { pattern: /what excites you/i, key: "excitementAnswer" },
    { pattern: /which .* value resonates|values can be found on our careers page/i, key: "companyValuesAnswer" },
    { pattern: /first-generation professional/i, key: "firstGenerationProfessional" },
    { pattern: /future job opportunities/i, key: "futureOpportunitiesOptIn" },
    { pattern: /receive alerts for similar jobs/i, key: "jobAlertsOptIn" },
    { pattern: /address from which you plan on working/i, key: "workFromAddress" },
    { pattern: /generative ai demonstrating|leverage ai\/agentic tools/i, key: "genAiToolExperience" },
    { pattern: /engineering management experience/i, key: "engineeringManagementExperience" },
    { pattern: /today.?s date of application/i, key: "applicationDate" },
    { pattern: /applicant privacy notice|consent to privacy notice|candidate non-disclosure/i, key: "consentAcknowledgement" },
    { pattern: /scripting language.*rest apis.*graphql/i, key: "scriptingApiProficiency" },
    { pattern: /accessible and inclusive interview/i, key: "reasonableAccommodation" },
    { pattern: /double-check all the information/i, key: "informationAccuracyConfirm" },
    { pattern: /personal preferences/i, key: "personalPreferences" },
    { pattern: /other social accounts/i, key: "linkedin" },
    { pattern: /nickname/i, key: "nickname" },
    { pattern: /ads products/i, key: "adsProductsExperience" },
    { pattern: /conversion modeling or ranking/i, key: "conversionModelingExperience" },
    { pattern: /applied to this role before/i, key: "appliedToRoleBefore" },
    { pattern: /nationality/i, key: "nationality" },
    { pattern: /family status/i, key: "familyStatus" }
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

function getApplicationDate() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
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

    if (isWorkAuthorizationQuestion(normalized)) {
        return resolveAuthorizationAnswer("authorized", normalized, profile, context);
    }

    if (isSponsorshipQuestion(normalized)) {
        return resolveAuthorizationAnswer("sponsorship", normalized, profile, context);
    }

    const experienceAnswer = resolveExperienceBracketAnswer(normalized, profile);
    if (experienceAnswer) {
        return experienceAnswer;
    }

    const rule = QUESTION_RULES.find(({ pattern }) => pattern.test(normalized));

    if (!rule) {
        return null;
    }

    if (rule.key === "genericMotivation") {
        return resolveMotivationAnswer(profile, context);
    }

    if (rule.key === "minimumAgeConfirmed") {
        return profile.minimumAgeConfirmed ? "Yes" : "No";
    }

    if (rule.key === "applicationDate") {
        return getApplicationDate();
    }

    if (rule.key === "consentAcknowledgement") {
        return profile.consentAcknowledgement || "Yes";
    }

    const answer = getValue(profile, rule.key);
    return answer === undefined || answer === null || answer === "" ? null : String(answer);
}

module.exports = {
    formatCompanyName,
    getAnswer,
    getCountryAnswer,
    normalizeQuestion,
    resolveMotivationAnswer,
    resolveAuthorizationAnswer,
    isWorkAuthorizationQuestion,
    isSponsorshipQuestion
};
