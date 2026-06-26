const path = require("path");
const { extractCountryFromText } = require("../../core/authorization-policy");
const { formatCompanyName } = require("../../core/answer-engine");
const {
    fillLeverCheckboxGroups,
    fillLeverKnownFields,
    fillLeverLocation,
    fillLeverRadioGroups,
    findManualReviewFields
} = require("./helper");
const { parseLeverJobUrl } = require("./metadata");

async function dismissCookieBanner(page, emit) {
    const acceptButton = page.getByRole("button", { name: /accept all|agree and proceed|i agree|got it|allow all|accept cookies/i }).first();
    if (await acceptButton.isVisible().catch(() => false)) {
        await acceptButton.click().catch(() => {});
        await page.waitForTimeout(400);
        emit("cookie_banner_dismissed", {});
    }
}

async function waitForLeverForm(page) {
    await page.locator("input[name='email'], #resume-upload-input, input[name='resume']").first()
        .waitFor({ state: "visible", timeout: 20000 });
}

async function detectCompanyName(page, applicationContext = {}) {
    if (applicationContext.companyName) {
        return applicationContext.companyName;
    }

    const title = await page.title().catch(() => "");
    const titleMatch = title.match(/^(.+?)\s+-\s+/);
    if (titleMatch) {
        return titleMatch[1].trim();
    }

    const { companySlug } = parseLeverJobUrl(page.url());
    return companySlug ? formatCompanyName(companySlug) : null;
}

async function detectTargetCountry(page, applicationContext = {}) {
    const text = await page.locator("body").innerText().catch(() => "");
    return applicationContext.targetCountry || extractCountryFromText(text);
}

async function uploadResume(root, profile, emit) {
    if (!profile.resume) {
        return false;
    }

    const resumePath = path.resolve(profile.resume);
    const resumeInput = root.locator("#resume-upload-input, input[name='resume']").first();
    if (await resumeInput.count() === 0) {
        emit("resume_skipped", { message: "No resume file input found" });
        return false;
    }

    await resumeInput.setInputFiles(resumePath);
    await root.waitForTimeout(1500);

    const uploadedName = await root.locator("text=/\\.pdf$/i").first().isVisible().catch(() => false);
    emit("resume_uploaded", { uploadedNameVisible: uploadedName });
    return true;
}

async function prepareLeverApplication(page, profile, emit, applicationContext = {}) {
    await dismissCookieBanner(page, emit);
    await waitForLeverForm(page);

    const companyName = await detectCompanyName(page, applicationContext);
    const targetCountry = await detectTargetCountry(page, applicationContext);
    const fillContext = {
        targetCountry,
        companyName,
        jobLocation: applicationContext.jobLocation || null,
        jobUrl: applicationContext.jobUrl || page.url()
    };

    emit("target_country_detected", { targetCountry, source: applicationContext.targetCountry ? "job_metadata" : "page_text" });
    emit("company_detected", { companyName });

    await fillLeverLocation(page, profile, emit);
    const radioResult = await fillLeverRadioGroups(page, profile, emit, fillContext);
    const checkboxResult = await fillLeverCheckboxGroups(page, profile, emit, fillContext);
    const fieldResult = await fillLeverKnownFields(page, profile, emit, fillContext);
    const resumeUploaded = await uploadResume(page, profile, emit);
    const manualReviewRequired = await findManualReviewFields(page);

    const unanswered = [...new Set([
        ...radioResult.unanswered,
        ...checkboxResult.unanswered,
        ...fieldResult.unanswered
    ])];

    return {
        provider: "lever",
        companyName,
        targetCountry,
        filled: radioResult.filled + checkboxResult.filled + fieldResult.filled,
        unanswered,
        resumeUploaded,
        manualReviewRequired
    };
}

module.exports = {
    detectCompanyName,
    detectTargetCountry,
    findManualReviewFields,
    prepareLeverApplication
};
