const path = require("path");
const { extractCountryFromText } = require("../../core/authorization-policy");
const { formatCompanyName } = require("../../core/answer-engine");
const {
    fillSmartRecruitersCheckboxGroups,
    fillSmartRecruitersConsent,
    fillSmartRecruitersKnownFields,
    fillSmartRecruitersRadioGroups,
    findManualReviewFields,
    isCaptchaPresent,
    openSmartRecruitersApplication,
    waitForSmartRecruitersForm
} = require("./helper");
const { parseSmartRecruitersJobUrl } = require("./metadata");

async function dismissCookieBanner(page, emit) {
    const acceptButton = page.getByRole("button", { name: /accept all|agree and proceed|i agree|got it|allow all|accept cookies/i }).first();
    if (await acceptButton.isVisible().catch(() => false)) {
        await acceptButton.click().catch(() => {});
        await page.waitForTimeout(400);
        emit("cookie_banner_dismissed", {});
    }
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

    const { companySlug } = parseSmartRecruitersJobUrl(page.url());
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
    const resumeInput = root.locator('input[type="file"][name*="resume" i], input[type="file"]').first();
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

async function prepareSmartRecruitersApplication(page, profile, emit, applicationContext = {}) {
    await dismissCookieBanner(page, emit);
    await openSmartRecruitersApplication(page, emit);

    const formState = await waitForSmartRecruitersForm(page, emit);
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

    if (formState.captcha || await isCaptchaPresent(page)) {
        return {
            provider: "smartrecruiters",
            companyName,
            targetCountry,
            filled: 0,
            unanswered: [],
            resumeUploaded: false,
            manualReviewRequired: ["Complete SmartRecruiters bot verification"],
            blockers: ["captcha_verification_required"]
        };
    }

    const radioResult = await fillSmartRecruitersRadioGroups(page, profile, emit, fillContext);
    const checkboxResult = await fillSmartRecruitersCheckboxGroups(page, profile, emit, fillContext);
    const fieldResult = await fillSmartRecruitersKnownFields(page, profile, emit, fillContext);
    const consentFilled = await fillSmartRecruitersConsent(page, profile, emit);
    const resumeUploaded = await uploadResume(page, profile, emit);
    const manualReviewRequired = await findManualReviewFields(page);

    const unanswered = [...new Set([
        ...radioResult.unanswered,
        ...checkboxResult.unanswered,
        ...fieldResult.unanswered
    ])];

    return {
        provider: "smartrecruiters",
        companyName,
        targetCountry,
        filled: radioResult.filled + checkboxResult.filled + fieldResult.filled + consentFilled,
        unanswered,
        resumeUploaded,
        manualReviewRequired,
        blockers: []
    };
}

module.exports = {
    detectCompanyName,
    detectTargetCountry,
    findManualReviewFields,
    prepareSmartRecruitersApplication
};
