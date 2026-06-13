function getExperienceYears(profile) {
    const explicit = Number(profile.experienceYears);
    if (!Number.isNaN(explicit) && explicit > 0) {
        return explicit;
    }

    const parsed = Number(profile.yearsOfExperience);
    return Number.isNaN(parsed) || parsed <= 0 ? 2 : parsed;
}

function resolveExperienceBracketAnswer(question, profile) {
    const years = getExperienceYears(profile);
    const normalized = String(question || "").replace(/\s+/g, " ").trim();

    if (!/years? of|years?\b|year experience|years? experience|years? in/i.test(normalized)) {
        return null;
    }

    const range = normalized.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\+?\s*years?/i);
    if (range) {
        const low = Number(range[1]);
        const high = Number(range[2]);
        return years >= low && years <= high ? "Yes" : "No";
    }

    const patterns = [
        /(?:at least|minimum of|min\.?|have)\s*(\d+)\+?\s*years?/i,
        /(\d+)\+\s*years?/i,
        /(\d+)\s*or more years?/i,
        /(\d+)\s*years? of (?:full[- ]time |relevant |professional |data\/analytics )?experience/i
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (!match) {
            continue;
        }

        const threshold = Number(match[1]);
        return years >= threshold ? "Yes" : "No";
    }

    return null;
}

module.exports = {
    getExperienceYears,
    resolveExperienceBracketAnswer
};
