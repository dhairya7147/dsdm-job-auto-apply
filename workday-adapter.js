const fs = require("fs");
const path = require("path");
const { getAnswer, normalizeQuestion } = require("./answer-engine");
const {
    ADVANCE_WAIT_MS,
    NETWORK_IDLE_MS,
    PAUSE_LONG,
    PAUSE_MED,
    PAUSE_SHORT,
    POLL_INTERVAL_MS,
    ROW_ADD_WAIT_MS,
    STEP_READY_BUFFER_MS
} = require("./workday-timing");
const { shouldIgnoreQuestion } = require("./question-filters");
const { recordWorkdayAccount, resolveWorkdayAuthPlan, touchWorkdayAccount } = require("./workday-accounts");
const { parseWorkdayJobUrl } = require("./workday-metadata");
const {
    completeWorkdayAuth,
    isWorkdayAccountExistsError,
    readWorkdayAuthError,
    fillWorkdayField,
    ensureWorkdayApplicationQuestions,
    ensureWorkdayMyExperience,
    gapFillPassThroughMyInformation,
    gapFillWorkdayMyExperience,
    unlockWorkdayFieldsFromValidation,
    ensureWorkdayMyInformationRequired,
    ensureWorkdayVoluntaryDisclosures,
    ensureWorkdaySelfIdentify,
    getEducationDateLabelHint,
    getWorkdayFieldSection,
    isWorkdayDropdownValueSet,
    getEducationYearLabelHint,
    getWorkdayFieldLabel,
    getWorkdayFieldValue,
    resolveWorkdayQuestionLabel,
    shouldSkipWorkdayFill,
    workdayFieldKey,
    markWorkdayFieldHandled,
    isWorkdayFieldHandled,
    clickWorkdaySectionAddByLabel
} = require("./workday-helper");

const FIELD_SELECTOR = [
    "input:not([type='hidden'])",
    "textarea",
    "select",
    "[data-automation-id*='formField'] input:not([type='hidden'])",
    "[data-automation-id*='formField'] textarea",
    "[data-automation-id*='formField'] select"
].join(",");

const MAX_STEPS = 12;
const APPLICATION_FIELD_WAIT_MS = 25000;
const DEFAULT_ACCOUNT_GATE_TIMEOUT_MS = 10 * 60 * 1000;
const STEP_MAX_DURATION_MS = 300000;

let stepScreenshotCounter = 0;

function slugifyScreenshotLabel(label) {
    return String(label || "page")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "page";
}

async function captureStepScreenshot(page, emit, applicationContext = {}, label = "page") {
    const artifactDir = applicationContext.artifactDir;
    if (!artifactDir) {
        return null;
    }

    fs.mkdirSync(artifactDir, { recursive: true });
    stepScreenshotCounter += 1;
    const filename = `step-${String(stepScreenshotCounter).padStart(2, "0")}-${slugifyScreenshotLabel(label)}.png`;
    const screenshotPath = path.join(artifactDir, filename);

    try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        emit("step_screenshot", { screenshotPath, label });
        return screenshotPath;
    } catch (error) {
        emit("step_screenshot_failed", { label, message: error.message });
        return null;
    }
}

const APPLICATION_STEP_LABELS = /my information|my experience|voluntary disclosures|self identify|review|autofill with resume/i;

function parseWorkdayStep(bodyText = "") {
    const match = bodyText.match(/current step\s+(\d+)\s+of\s+(\d+)/i);
    if (!match) {
        return { step: null, total: null, label: null };
    }

    const step = Number(match[1]);
    const total = Number(match[2]);
    const labels = [...bodyText.matchAll(/step\s+\d+\s+of\s+\d+\s+([^\n]+)/gi)].map((entry) => entry[1].trim());
    return { step, total, label: labels[step - 1] || null };
}

function normalizeWorkdayStepKey(stepInfo = {}) {
    const label = String(stepInfo.label || "").trim().toLowerCase();
    if (label) {
        return label;
    }

    if (stepInfo.step != null) {
        return `step:${stepInfo.step}`;
    }

    return "unknown";
}

function matchesWorkdayStep(stepKey, stepInfo, pattern) {
    const source = pattern instanceof RegExp ? pattern.source : String(pattern);
    const matcher = new RegExp(source, "i");
    return matcher.test(stepKey || "") || matcher.test(stepInfo?.label || "");
}

function canonicalWorkdayStepKey(stepKey, stepInfo = {}) {
    const candidates = [
        stepKey,
        stepInfo.label,
        normalizeWorkdayStepKey(stepInfo)
    ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);

    const mappings = [
        [/my information/, "my information"],
        [/my experience/, "my experience"],
        [/application questions/, "application questions"],
        [/voluntary disclosures/, "voluntary disclosures"],
        [/self identify/, "self identify"],
        [/^review$/, "review"],
        [/create account|sign in/, "create account/sign in"]
    ];

    for (const [pattern, canonical] of mappings) {
        if (candidates.some((candidate) => pattern.test(candidate))) {
            return canonical;
        }
    }

    return candidates[0] || "unknown";
}

async function inferWorkdayStepKey(page, stepInfo = {}) {
    const label = String(stepInfo.label || "").trim().toLowerCase();
    if (label) {
        return label;
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (stepInfo.step != null) {
        const labels = [...bodyText.matchAll(/step\s+\d+\s+of\s+\d+\s+([^\n]+)/gi)]
            .map((entry) => entry[1].trim().toLowerCase());
        const fromStepIndex = labels[stepInfo.step - 1];
        if (fromStepIndex) {
            return fromStepIndex;
        }
    }

    if (/my experience/i.test(bodyText)) {
        const hasWorkFields = await page.locator(
            '[data-automation-id="jobTitle"], [data-automation-id="positionTitle"], input[aria-label*="Job Title" i]'
        ).first().isVisible().catch(() => false);
        if (hasWorkFields) {
            return "my experience";
        }
    }

    if (/my information/i.test(bodyText)) {
        const hasInfoFields = await page.locator(
            '[data-automation-id="firstName"], [data-automation-id="legalNameSection_firstName"], [data-automation-id="nameSection_firstName"]'
        ).first().isVisible().catch(() => false);
        if (hasInfoFields) {
            return "my information";
        }
    }

    if (/application questions/i.test(bodyText)) {
        return "application questions";
    }
    if (/voluntary disclosures/i.test(bodyText)) {
        return "voluntary disclosures";
    }
    if (/self identify/i.test(bodyText)) {
        return "self identify";
    }

    return label || "unknown";
}

function isAccountGateStepLabel(label) {
    return /create account\/sign in/i.test(label || "");
}

function isApplicationStepLabel(label) {
    return APPLICATION_STEP_LABELS.test(label || "");
}

async function detectCurrentStep(page) {
    const text = await page.locator("body").innerText();
    return parseWorkdayStep(text);
}

async function openApplication(page, jobUrl, emit) {
    const parsed = parseWorkdayJobUrl(jobUrl);
    const applyUrl = parsed?.applyUrl || jobUrl.replace(/\/apply(\/.*)?$/, "/apply");
    const jobPostingUrl = applyUrl.replace(/\/apply$/, "");

    await page.goto(jobPostingUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    emit("workday_job_posting_opened", { jobPostingUrl });

    const applyButton = page.locator('[data-automation-id="jobPostingApplyButton"]').first();
    if (await applyButton.isVisible().catch(() => false)) {
        await applyButton.click();
        await page.waitForTimeout(PAUSE_MED);
        emit("workday_entry_selected", { method: "apply_button" });
    } else {
        await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(PAUSE_SHORT);
        emit("workday_entry_selected", { method: "apply_url" });
    }

    const applyManually = page.locator('[data-automation-id="applyManually"]');
    await applyManually.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    if (await applyManually.isVisible().catch(() => false)) {
        await applyManually.click();
        await page.waitForTimeout(PAUSE_MED);
        emit("workday_entry_selected", { method: "apply_manually" });
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(PAUSE_SHORT);
    await page.locator(
        '[data-automation-id="email"], [data-automation-id="verifyPassword"], [data-automation-id="firstName"], button:has-text("Sign in with email")'
    ).first().waitFor({ state: "attached", timeout: 60000 }).catch(() => {});
    emit("workday_apply_opened", { url: page.url() });
}

async function isWorkdayErrorPage(page) {
    const text = await page.locator("body").innerText().catch(() => "");
    return /something went wrong/i.test(text) && /refresh the page/i.test(text);
}

async function recoverWorkdayErrorPage(page, emit) {
    if (!await isWorkdayErrorPage(page)) {
        return false;
    }

    const url = page.url();
    emit("workday_error_page_detected", { url });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(PAUSE_MED);
    emit("workday_error_page_reloaded", { url: page.url() });
    return !await isWorkdayErrorPage(page);
}

async function waitForVoluntaryDisclosuresReady(page, emit, timeoutMs = 30000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const ready = await page.locator("[data-automation-id*='formField']")
            .filter({ hasText: /what is your gender/i })
            .locator('button[aria-haspopup="listbox"], [role="combobox"]')
            .first()
            .isVisible()
            .catch(() => false);
        if (ready) {
            await page.waitForTimeout(STEP_READY_BUFFER_MS);
            emit("workday_voluntary_disclosures_ready", { elapsedMs: Date.now() - startedAt });
            return true;
        }
        await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    emit("workday_voluntary_disclosures_timeout", { timeoutMs });
    return false;
}

async function waitForApplicationQuestionsReady(page, emit, timeoutMs = 30000) {
    const startedAt = Date.now();
    const readyPatterns = [
        /provide verification of your ident/i,
        /legally eligible to work in the job/i,
        /require sponsorship or assistance/i,
        /reach out to me via sms/i
    ];

    while (Date.now() - startedAt < timeoutMs) {
        const bodyText = await page.locator("body").innerText().catch(() => "");
        if (readyPatterns.some((pattern) => pattern.test(bodyText))) {
            await page.waitForTimeout(STEP_READY_BUFFER_MS);
            emit("workday_application_questions_ready", { elapsedMs: Date.now() - startedAt });
            return true;
        }
        await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    emit("workday_application_questions_timeout", { timeoutMs });
    return false;
}

async function waitForApplicationStepReady(page, emit, timeoutMs = APPLICATION_FIELD_WAIT_MS) {
    const readySelectors = [
        '[data-automation-id="firstName"]',
        '[data-automation-id="legalNameSection_firstName"]',
        '[data-automation-id="nameSection_firstName"]',
        'input[data-automation-id*="firstName"]',
        '[data-automation-id="addressSection_addressLine1"]',
        '[data-automation-id="phoneNumber"]',
        '[data-automation-id="phone-device-type"]',
        '[data-automation-id="jobTitle"]',
        '[data-automation-id="positionTitle"]',
        'input[aria-label*="Job Title" i]',
        '[data-automation-id*="school"]',
        '[data-automation-id="school"]',
        'input[type="file"]'
    ];

    const startedAt = Date.now();
    emit("workday_waiting_for_application_fields", {});

    while (Date.now() - startedAt < timeoutMs) {
        if (await isWorkdayErrorPage(page)) {
            await recoverWorkdayErrorPage(page, emit);
        }

        for (const selector of readySelectors) {
            if (await page.locator(selector).first().isVisible().catch(() => false)) {
                await page.waitForTimeout(STEP_READY_BUFFER_MS);
                emit("workday_application_fields_ready", {
                    selector,
                    elapsedMs: Date.now() - startedAt
                });
                return true;
            }
        }

        const fieldCount = await page.locator(FIELD_SELECTOR).count();
        const bodyText = await page.locator("body").innerText();
        const onExperienceStep = /my experience/i.test(bodyText);
        const experienceReady = onExperienceStep && (
            await page.locator('[data-automation-id="jobTitle"], [data-automation-id="positionTitle"], input[aria-label*="Job Title" i], [data-automation-id*="school"], input[type="file"]').first().isVisible().catch(() => false)
        );
        const minFieldCount = onExperienceStep ? 8 : 12;
        const stillLoading = !experienceReady && fieldCount < minFieldCount
            && /my information|my experience|create account\/sign in/i.test(bodyText);
        if (experienceReady || (!stillLoading && fieldCount >= minFieldCount)) {
            await page.waitForTimeout(STEP_READY_BUFFER_MS);
            emit("workday_application_fields_ready", {
                selector: "field_count",
                fieldCount,
                elapsedMs: Date.now() - startedAt
            });
            return true;
        }

        await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    emit("workday_application_fields_timeout", { timeoutMs });
    return false;
}

async function hasApplicationFormFields(page) {
    const selectors = [
        '[data-automation-id="firstName"]',
        '[data-automation-id="nameSection_firstName"]',
        '[data-automation-id="legalNameSection_firstName"]',
        'input[data-automation-id*="firstName"]',
        '[data-automation-id="resume-upload-input"]',
        '[data-automation-id="skillsSection"]',
        '[data-automation-id="experienceSection"]',
        '[data-automation-id="educationSection"]',
        'input[aria-label*="Type to Add Skills" i]',
        'input[type="file"]'
    ];

    for (const selector of selectors) {
        if (await page.locator(selector).first().isVisible().catch(() => false)) {
            return true;
        }
    }

    return false;
}

async function hasReachedApplicationFlow(page, stepInfo) {
    if (isAccountGateStepLabel(stepInfo.label) || await isOnSignInLandingPage(page)) {
        return false;
    }

    if (isApplicationStepLabel(stepInfo.label)) {
        return true;
    }

    return hasApplicationFormFields(page);
}

async function isOnSignInLandingPage(page) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const emailVisible = await page.locator('[data-automation-id="email"]').isVisible().catch(() => false);
    const signInSubmitVisible = await page.locator('[data-automation-id="signInSubmitButton"]').isVisible().catch(() => false);
    return emailVisible
        && signInSubmitVisible
        && /\bsign in\b/i.test(bodyText)
        && /create account/i.test(bodyText);
}

async function isOnAccountGate(page, stepInfo) {
    if (isApplicationStepLabel(stepInfo.label) || await hasApplicationFormFields(page)) {
        return false;
    }

    if (isAccountGateStepLabel(stepInfo.label)) {
        return true;
    }

    const emailSignIn = page.getByRole("button", { name: /sign in with email/i });
    if (await emailSignIn.isVisible().catch(() => false)) {
        return true;
    }

    const emailVisible = await page.locator('[data-automation-id="email"]').isVisible().catch(() => false);
    const passwordVisible = await page.locator('[data-automation-id="password"], [data-automation-id="verifyPassword"]')
        .first()
        .isVisible()
        .catch(() => false);
    const signInSubmitVisible = await page.locator('[data-automation-id="signInSubmitButton"]').isVisible().catch(() => false);
    const createAccountSubmitVisible = await page.locator('[data-automation-id="createAccountSubmitButton"]').isVisible().catch(() => false);

    if (emailVisible && (passwordVisible || signInSubmitVisible || createAccountSubmitVisible)) {
        return true;
    }

    return false;
}

async function tryAutoAccountAuth(page, profile, emit, applicationContext = {}) {
    const password = applicationContext.workdayPassword || profile?.workdayPassword;
    if (!password) {
        return false;
    }

    const authPlan = resolveWorkdayAuthPlan(applicationContext, profile);
    emit("workday_auth_plan", authPlan);

    let submitted = false;
    let redirectedToLogin = false;
    let succeededMode = null;
    for (const mode of [...new Set(authPlan.modes)]) {
        const authResult = await completeWorkdayAuth(page, profile, emit, { ...applicationContext, workdayAuthMode: mode });
        if (authResult === "redirect") {
            redirectedToLogin = true;
            submitted = true;
            succeededMode = mode;
            break;
        }
        if (authResult) {
            submitted = true;
            succeededMode = mode;
            break;
        }

        const authError = await readWorkdayAuthError(page);
        if (mode === "create_account" && isWorkdayAccountExistsError(authError) && applicationContext.companyName) {
            recordWorkdayAccount({
                companyName: applicationContext.companyName,
                jobUrl: applicationContext.jobUrl,
                email: profile.email,
                baseDir: applicationContext.baseDir,
                source: "auth_error_existing_account"
            });
            emit("workday_account_already_exists", {
                companyName: applicationContext.companyName,
                message: authError
            });
        }

        emit("workday_auth_retry", { nextMode: mode === "create_account" ? "sign_in" : "create_account" });
    }

    if (redirectedToLogin) {
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(PAUSE_LONG);
        const signInResult = await completeWorkdayAuth(page, profile, emit, {
            ...applicationContext,
            workdayAuthMode: "sign_in"
        });
        if (!signInResult) {
            return false;
        }
        succeededMode = "sign_in";
    } else if (!submitted) {
        return false;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        await page.waitForTimeout(PAUSE_MED);
        const stepInfo = await detectCurrentStep(page);

        if (await isOnSignInLandingPage(page) && succeededMode === "create_account") {
            emit("workday_create_account_redirected_to_sign_in", {});
            const signInResult = await completeWorkdayAuth(page, profile, emit, {
                ...applicationContext,
                workdayAuthMode: "sign_in"
            });
            if (signInResult) {
                succeededMode = "sign_in";
                if (applicationContext.companyName) {
                    recordWorkdayAccount({
                        companyName: applicationContext.companyName,
                        jobUrl: applicationContext.jobUrl,
                        email: profile.email,
                        baseDir: applicationContext.baseDir,
                        source: "auth_error_existing_account"
                    });
                }
            }
            continue;
        }

        if (await hasReachedApplicationFlow(page, stepInfo)) {
            await waitForApplicationStepReady(page, emit, 15000);
            emit("workday_account_gate_passed", { ...stepInfo, method: "auto_auth", authMode: succeededMode });
            if (applicationContext.companyName) {
                if (succeededMode === "create_account") {
                    recordWorkdayAccount({
                        companyName: applicationContext.companyName,
                        jobUrl: applicationContext.jobUrl,
                        email: profile.email,
                        baseDir: applicationContext.baseDir,
                        source: "create_account"
                    });
                    emit("workday_account_recorded", { companyName: applicationContext.companyName });
                } else if (succeededMode === "sign_in") {
                    touchWorkdayAccount(
                        applicationContext.companyName,
                        applicationContext.baseDir,
                        applicationContext.jobUrl
                    );
                }
            }
            return true;
        }
    }

    emit("workday_auth_submitted_but_still_on_gate", {});
    return false;
}

async function waitPastAccountGate(page, emit, timeoutMs) {
    const startedAt = Date.now();
    emit("workday_awaiting_account_creation", {
        message: "Complete sign-in or account creation in the browser; filling will continue automatically"
    });

    while (Date.now() - startedAt < timeoutMs) {
        await page.waitForTimeout(PAUSE_MED);

        const stepInfo = await detectCurrentStep(page);
        const onGate = await isOnAccountGate(page, stepInfo);
        if (!onGate) {
            await waitForApplicationStepReady(page, emit, 15000);
            emit("workday_account_gate_passed", stepInfo);
            return true;
        }

        emit("workday_account_gate_waiting", {
            elapsedMs: Date.now() - startedAt,
            step: stepInfo.step,
            label: stepInfo.label
        });
    }

    emit("workday_account_gate_timeout", { timeoutMs });
    return false;
}

async function activateAccountEntry(page, emit) {
    const emailField = page.locator('[data-automation-id="email"]');
    if (await emailField.isVisible().catch(() => false)) {
        emit("workday_account_form_visible", {});
        return true;
    }

    const emailSignIn = page.getByRole("button", { name: /sign in with email/i });
    if (await emailSignIn.isVisible().catch(() => false)) {
        await emailSignIn.click();
        await page.waitForTimeout(PAUSE_MED);
        emit("workday_sign_in_with_email_opened", {});
    }

    if (await emailField.isVisible().catch(() => false)) {
        emit("workday_account_form_visible", {});
        return true;
    }

    const createAccountEntry = page.locator('[data-automation-id="createAccountLink"]');
    if (await createAccountEntry.isVisible().catch(() => false)) {
        await createAccountEntry.click();
        await page.waitForTimeout(PAUSE_MED);
        emit("workday_account_form_opened", {});
        return true;
    }

    return false;
}

async function uploadResumeIfPresent(page, profile, emit, sessionFlags = {}) {
    if (!profile.resume) {
        return false;
    }

    if (sessionFlags.resumeUploaded) {
        emit("resume_upload_skipped", { reason: "session_locked" });
        return true;
    }

    try {
        const uploaded = await uploadResumeFile(page, profile, emit, sessionFlags);
        if (uploaded) {
            sessionFlags.resumeUploaded = true;
        }
        return uploaded;
    } catch (error) {
        emit("resume_upload_failed", { message: error.message });
        return false;
    }
}

function getWorkdayResumeSection(page) {
    return page.locator([
        '[data-automation-id="resumeSection"]',
        '[data-automation-id="formField-resume"]',
        '[data-automation-id*="formField"][data-automation-id*="resume"]'
    ].join(", "))
        .or(page.locator("section, div").filter({ hasText: /Resume\/CV/i }))
        .first();
}

async function scrollWorkdayResumeSectionIntoView(page) {
    await page.evaluate(() => {
        const headings = [...document.querySelectorAll("h1,h2,h3,h4,legend,label,div,span")]
            .filter((element) => /Resume\/CV/i.test((element.textContent || "").trim()) && element.offsetParent !== null);
        const target = headings[headings.length - 1];
        target?.scrollIntoView({ block: "center" });
    }).catch(() => {});
    await page.waitForTimeout(PAUSE_SHORT);
}

async function resolveWorkdayResumeFileInput(page) {
    await scrollWorkdayResumeSectionIntoView(page);

    const resumeSection = page.locator('[data-automation-id="resumeSection"]').first();
    if (await resumeSection.count() > 0) {
        const scopedInput = resumeSection.locator(
            '[data-automation-id="resume-upload-input"], input[type="file"]'
        ).first();
        if (await scopedInput.count() > 0) {
            return scopedInput;
        }
    }

    const resumeHeading = page.getByText(/^Resume\/CV$/i).last();
    if (await resumeHeading.count() > 0) {
        const resumeBlock = resumeHeading.locator(
            'xpath=ancestor::*[.//input[@type="file"]][1]'
        );
        const resumeInput = resumeBlock.locator('input[type="file"]').first();
        if (await resumeInput.count() > 0) {
            return resumeInput;
        }
    }

    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    for (let index = count - 1; index >= 0; index -= 1) {
        const input = fileInputs.nth(index);
        const context = await input.evaluate((element) => {
            let node = element.parentElement;
            while (node) {
                const text = (node.textContent || "").replace(/\s+/g, " ").trim();
                if (/certificationssection|certifications\b/i.test(node.getAttribute("data-automation-id") || "")
                    || /^certifications\b/i.test(text.slice(0, 40))
                    || /\battachments\b/i.test(text.slice(0, 60))) {
                    return "attachments";
                }
                if (/resumesection/i.test(node.getAttribute("data-automation-id") || "")
                    || /Resume\/CV/i.test(text)) {
                    return "resume";
                }
                node = node.parentElement;
            }
            return "unknown";
        }).catch(() => "unknown");

        if (context === "resume") {
            return input;
        }
    }

    return null;
}

async function uploadResumeFile(page, profile, emit, sessionFlags = {}) {
    const resumePath = path.isAbsolute(profile.resume)
        ? profile.resume
        : path.resolve(__dirname, profile.resume);
    const resumeName = path.basename(resumePath);

    const resumeSection = page.locator('[data-automation-id="resumeSection"]').first();
    if (await resumeSection.count() > 0) {
        const existingUploads = await resumeSection.locator(
            '[data-automation-id="file-upload-filename"], [data-automation-id*="file-upload"]'
        ).filter({ hasText: new RegExp(resumeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).count();
        if (existingUploads > 0) {
            sessionFlags.resumeUploaded = true;
            emit("resume_upload_skipped", { reason: "already_uploaded", count: existingUploads });
            return true;
        }
    }

    let fileInput = await resolveWorkdayResumeFileInput(page);

    if (!fileInput || await fileInput.count() === 0) {
        await clickWorkdaySectionAddByLabel(page, "Resume", emit).catch(() => false);
        await page.waitForTimeout(PAUSE_SHORT);
        fileInput = await resolveWorkdayResumeFileInput(page);
    }

    if (!fileInput || await fileInput.count() === 0) {
        emit("resume_upload_missing", { message: "No resume file input found in resumeSection" });
        return false;
    }

    await fileInput.setInputFiles(resumePath, { timeout: 10000 });
    await page.waitForTimeout(PAUSE_MED);

    const confirmationScope = await resumeSection.count() > 0
        ? resumeSection
        : page.getByText(/^Resume\/CV$/i).last().locator('xpath=ancestor::*[.//*[contains(@data-automation-id,"file-upload") or contains(@class,"file")]][1]');
    const confirmed = await confirmationScope.locator(
        `[data-automation-id="file-upload-filename"], [data-automation-id*="file-upload"], [data-automation-id*="resume"]`
    ).filter({ hasText: new RegExp(resumeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })
        .first()
        .waitFor({ state: "visible", timeout: 15000 })
        .then(() => true)
        .catch(() => false);

    if (!confirmed) {
        emit("resume_upload_wrong_section", { path: resumePath, message: "Resume filename not visible in Resume/CV section" });
        return false;
    }

    emit("resume_uploaded", { provider: "workday", path: resumePath, section: "resumeSection" });
    return true;
}

async function fillWorkdayUnlabeledDropdowns(page, profile, emit, context, sessionFlags = {}) {
    const dropdowns = page.locator('button[aria-haspopup="listbox"], [role="combobox"]');
    const count = await dropdowns.count();
    const handled = new Set();
    let filled = 0;

    for (let index = 0; index < count; index += 1) {
        const field = dropdowns.nth(index);
        if (!await field.isVisible().catch(() => false) || !await field.isEnabled().catch(() => false)) {
            continue;
        }

        const automationId = await field.getAttribute("data-automation-id") || `dropdown-${index}`;
        const sectionHint = await field.evaluate((element) => {
            const container = element.closest("[data-automation-id*='formField'], section, fieldset");
            return container?.innerText?.slice(0, 800) || "";
        }).catch(() => "");

        const rawLabel = await getWorkdayFieldLabel(field);
        const label = resolveWorkdayQuestionLabel(rawLabel, sectionHint);
        if (!label || shouldIgnoreQuestion(label) || handled.has(label)) {
            continue;
        }

        const fieldKey = workdayFieldKey(automationId, label);
        if (isWorkdayFieldHandled(sessionFlags, fieldKey)) {
            handled.add(label);
            continue;
        }

        const answer = getAnswer(label, profile, context);
        if (answer && (await shouldSkipWorkdayFill(field, answer, label)
            || await isWorkdayDropdownValueSet(field, answer))) {
            emit("field_skipped", { field: label, reason: "already_set" });
            markWorkdayFieldHandled(sessionFlags, fieldKey);
            handled.add(label);
            continue;
        }

        const current = (await field.innerText().catch(() => "")).trim();
        if (!answer && current && !/^(please )?select one|required|search$/i.test(current)) {
            markWorkdayFieldHandled(sessionFlags, fieldKey);
            handled.add(label);
            continue;
        }

        if (!answer) {
            emit("workday_dropdown_unanswered", {
                field: label,
                rawLabel,
                sectionHint: sectionHint.slice(0, 160)
            });
            continue;
        }

        try {
            const didFill = await fillWorkdayField(field, answer, page, {
                hint: label,
                force: true,
                sessionFlags,
                fieldKey
            });
            if (didFill) {
                filled += 1;
                emit("field_filled", { field: label, method: "unlabeled_dropdown" });
            } else {
                markWorkdayFieldHandled(sessionFlags, fieldKey);
            }
            handled.add(label);
        } catch (error) {
            emit("field_failed", { field: label, message: error.message });
        }
    }

    return filled;
}

async function fillVisibleFields(page, profile, emit, context, sessionFlags = {}, stepLabel = "") {
    let filled = 0;

    const fields = page.locator(FIELD_SELECTOR);
    const count = await fields.count();
    const handled = new Set();
    const unanswered = [];
    let educationYearOnlyIndex = 0;

    for (let index = 0; index < count; index += 1) {
        const field = fields.nth(index);
        if (!await field.isVisible().catch(() => false) || !await field.isEnabled().catch(() => false)) {
            continue;
        }

        const automationId = await field.getAttribute("data-automation-id") || `field-${index}`;
        const fieldType = (await field.getAttribute("type") || "").toLowerCase();

        if (["password", "verifyPassword", "beecatcher"].includes(automationId)) {
            continue;
        }

        if (/dateSignedOn|selfIdentifiedDisability/i.test(automationId)) {
            continue;
        }

        if (/self identify/i.test(stepLabel)) {
            if (fieldType === "radio" || fieldType === "checkbox" || /dateSection/i.test(automationId)) {
                continue;
            }
        }

        const rawLabel = await getWorkdayFieldLabel(field);
        const sectionHint = await field.evaluate((element) => {
            const container = element.closest("[data-automation-id*='formField'], section, fieldset");
            return container?.innerText?.slice(0, 800) || "";
        }).catch(() => "");

        if (/my experience/i.test(stepLabel) && /legally authorized|sponsorship|visa status/i.test(`${rawLabel} ${sectionHint}`)) {
            continue;
        }

        let label = resolveWorkdayQuestionLabel(rawLabel, sectionHint);

        if (/self-identification of gender/i.test(sectionHint)) {
            label = "Self-Identification of Gender";
        } else if (/please select one/i.test(label) && /gender/i.test(sectionHint)) {
            label = "Self-Identification of Gender";
        }

        if (!label || shouldIgnoreQuestion(label)) {
            continue;
        }

        const handledKey = fieldType === "radio" ? `radio:${label}` : automationId;
        const fieldKey = workdayFieldKey(automationId, label);

        if (fieldType === "radio") {
            if (sessionFlags.myInformationRequiredFilled
                && /worked for Visa|worked for NVIDIA|worked for .* in any capacity/i.test(`${label} ${sectionHint}`)) {
                markWorkdayFieldHandled(sessionFlags, fieldKey);
                handled.add(handledKey);
                emit("field_skipped", { field: label, automationId, reason: "handled_by_structured_fill" });
                continue;
            }

            if (/^(yes|no)\b|i do not want to answer|i am not a protected veteran|i identify as one or more|have a disability|do not have a disability/i.test(label)) {
                continue;
            }
        }

        if (profile.automateDemographics !== false
            && /protected veteran|veteran status|disability status|self-identification of disability|what is your ethnicity|what is your gender|identify as one of the following protected veterans/i.test(`${label} ${sectionHint}`)) {
            continue;
        }
        if (handled.has(handledKey) || isWorkdayFieldHandled(sessionFlags, fieldKey)) {
            continue;
        }

        if (/my experience/i.test(stepLabel)) {
            const section = await getWorkdayFieldSection(field);
            if (section === "work"
                || /^(job title|company|location|role description|description)$/i.test(label)
                || /^i currently work here$/i.test(label)) {
                handled.add(handledKey);
                continue;
            }
        }

        if (/date section year|year input|date section month|month input|from \(yyyy\)|to \(actual/i.test(label)) {
            const section = await getWorkdayFieldSection(field);
            if (section === "work") {
                handled.add(handledKey);
                continue;
            }

            const dateHint = await getEducationDateLabelHint(field) || await getEducationYearLabelHint(field);
            if (dateHint) {
                label = dateHint;
            } else if (/year|\(yyyy\)/i.test(label)) {
                label = educationYearOnlyIndex === 0 ? "Education Start Year" : "Education End Year";
                educationYearOnlyIndex += 1;
            }
        }

        if (/how did you hear|hear about us/i.test(label)) {
            markWorkdayFieldHandled(sessionFlags, fieldKey);
            handled.add(handledKey);
            emit("field_skipped", { field: label, automationId, reason: "handled_by_structured_fill" });
            continue;
        }

        if (/i have a preferred name/i.test(label) && !profile.preferredNameDifferent) {
            markWorkdayFieldHandled(sessionFlags, fieldKey);
            handled.add(handledKey);
            emit("field_skipped", { field: label, automationId, reason: "preferred_name_unchanged" });
            continue;
        }

        if (/^url$/i.test(label) || (/^websites?\b/i.test(label) && /url/i.test(label))) {
            const currentUrl = await getWorkdayFieldValue(field).catch(() => "");
            if (currentUrl || sessionFlags.websiteFilled) {
                emit("field_skipped", { field: label, automationId, reason: "url_already_set" });
                handled.add(handledKey);
                continue;
            }
        }

        const answer = getAnswer(label, profile, context);
        handled.add(handledKey);

        if (!answer) {
            if (/phone extension/i.test(label)) {
                continue;
            }
            if (!unanswered.includes(label)) {
                unanswered.push(label);
            }
            continue;
        }

        if (await shouldSkipWorkdayFill(field, answer, label)
            || (/^country\b/i.test(label) && await isWorkdayDropdownValueSet(field, answer))) {
            emit("field_skipped", { field: label, automationId, reason: "already_set" });
            markWorkdayFieldHandled(sessionFlags, fieldKey);
            continue;
        }

        try {
            const didFill = await fillWorkdayField(field, answer, page, {
                hint: label,
                sessionFlags,
                fieldKey
            });
            if (didFill) {
                filled += 1;
                emit("field_filled", { field: label, automationId });
            } else {
                emit("field_skipped", { field: label, automationId, reason: "already_set" });
                markWorkdayFieldHandled(sessionFlags, fieldKey);
            }
        } catch (error) {
            if (/\bstate\b/i.test(label)) {
                const currentState = await getWorkdayFieldValue(field).catch(() => "");
                if (currentState && !/^(mm|yyyy|select|search)$/i.test(currentState)) {
                    emit("field_skipped", {
                        field: label,
                        automationId,
                        reason: "state_left_unchanged",
                        value: currentState
                    });
                    continue;
                }
            }

            emit("field_failed", { field: label, automationId, message: error.message });
            if (!unanswered.includes(label)) {
                unanswered.push(label);
            }
        }
    }

    return { filled, unanswered };
}

async function findManualReviewFields(page) {
    const invalidFields = page.locator("input:invalid, select:invalid, textarea:invalid");
    const count = await invalidFields.count();
    const labels = [];

    for (let index = 0; index < count; index += 1) {
        const field = invalidFields.nth(index);
        if (!await field.isVisible().catch(() => false)) {
            continue;
        }

        const label = normalizeQuestion(await getWorkdayFieldLabel(field));
        if (label && !labels.includes(label)) {
            labels.push(label);
        }
    }

    return labels;
}

async function collectWorkdayValidationBlockers(page) {
    return page.evaluate(() => {
        const blockers = [];
        const seen = new Set();
        const add = (text) => {
            const cleaned = String(text || "").replace(/\s+/g, " ").trim();
            if (!cleaned || cleaned.length > 240 || seen.has(cleaned)) {
                return;
            }
            if (/^required$/i.test(cleaned) || /^current step/i.test(cleaned) || /successfully uploaded/i.test(cleaned)) {
                return;
            }
            seen.add(cleaned);
            blockers.push(cleaned);
        };

        document.querySelectorAll(
            '[data-automation-id*="errorMessage"], [data-automation-id*="formFieldError"], [role="alert"], [aria-live="assertive"], [data-automation-id*="errorBanner"], [data-automation-id*="errorsFound"]'
        ).forEach((element) => add(element.innerText));

        const bodyText = document.body?.innerText || "";
        if (/errors found/i.test(bodyText)) {
            bodyText.split("\n").forEach((line) => {
                if (/^error\s*-/i.test(line.trim()) || /is required and must have a value/i.test(line)) {
                    add(line);
                }
            });
        }

        document.querySelectorAll('[data-automation-id*="formField"]').forEach((section) => {
            const text = section.innerText || "";
            if (/is required|please enter|invalid|must be|cannot be blank/i.test(text)) {
                const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
                for (const line of lines) {
                    if (/is required|please enter|invalid|must be|cannot be blank/i.test(line)) {
                        add(line);
                    }
                }
            }
        });

        return blockers.slice(0, 8);
    }).catch(() => []);
}

function normalizeOnlyStep(onlyStep = "") {
    return String(onlyStep || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function shouldFillStep(applicationContext, canonicalKey, stepInfo) {
    const onlyStep = normalizeOnlyStep(applicationContext.onlyStep);
    if (!onlyStep) {
        return true;
    }
    if (onlyStep === "my-experience") {
        return matchesWorkdayStep(canonicalKey, stepInfo, /my information|my experience/);
    }
    return matchesWorkdayStep(canonicalKey, stepInfo, new RegExp(onlyStep.replace(/-/g, " "), "i"));
}

function extractUnansweredFromValidationErrors(validationErrors = []) {
    const questions = [];
    for (const error of validationErrors) {
        const requiredMatch = String(error).match(/The field (.+?) is required/i);
        if (requiredMatch?.[1]) {
            questions.push(requiredMatch[1].trim());
            continue;
        }

        const errorMatch = String(error).match(/^Error[-\s]*(.+)$/i);
        if (errorMatch?.[1] && !/must have a value/i.test(errorMatch[1])) {
            questions.push(errorMatch[1].trim());
        }
    }

    return questions;
}

function stepMaxRetries(canonicalKey, applicationContext) {
    if (matchesWorkdayStep(canonicalKey, {}, /my experience|my information/)) {
        return 3;
    }
    if (applicationContext.onlyStep) {
        return 2;
    }
    return 5;
}

async function fillWorkdayStep(page, profile, emit, context, applicationContext, canonicalKey, stepInfo, session, gapMode) {
    if (!shouldFillStep(applicationContext, canonicalKey, stepInfo)) {
        emit("workday_step_skip", { step: canonicalKey, reason: "only_step_debug" });
        return { filled: 0, unanswered: [] };
    }

    if (matchesWorkdayStep(canonicalKey, stepInfo, /my information/)) {
        if (gapMode) {
            return { filled: await gapFillPassThroughMyInformation(page, profile, emit, session), unanswered: [] };
        }
        let filled = await ensureWorkdayMyInformationRequired(page, profile, emit, session);
        const result = await fillVisibleFields(page, profile, emit, context, session, canonicalKey);
        filled += await fillWorkdayUnlabeledDropdowns(page, profile, emit, context, session);
        filled += result.filled;
        return { filled, unanswered: result.unanswered };
    }

    if (matchesWorkdayStep(canonicalKey, stepInfo, /my experience/)) {
        if (gapMode) {
            const validationErrors = await collectWorkdayValidationBlockers(page);
            return {
                filled: await gapFillWorkdayMyExperience(page, profile, emit, session, validationErrors),
                unanswered: []
            };
        }
        await waitForApplicationStepReady(page, emit, 30000);
        return { filled: await ensureWorkdayMyExperience(page, profile, emit, session), unanswered: [] };
    }

    if (matchesWorkdayStep(canonicalKey, stepInfo, /application questions/)) {
        await waitForApplicationQuestionsReady(page, emit);
        let filled = await ensureWorkdayApplicationQuestions(page, profile, emit, context);
        const result = await fillVisibleFields(page, profile, emit, context, session, canonicalKey);
        filled += result.filled;
        return { filled, unanswered: result.unanswered };
    }
    if (matchesWorkdayStep(canonicalKey, stepInfo, /voluntary disclosures/)) {
        await waitForVoluntaryDisclosuresReady(page, emit);
        return { filled: await ensureWorkdayVoluntaryDisclosures(page, profile, emit), unanswered: [] };
    }
    if (matchesWorkdayStep(canonicalKey, stepInfo, /self identify/)) {
        return { filled: await ensureWorkdaySelfIdentify(page, profile, emit), unanswered: [] };
    }

    const result = await fillVisibleFields(page, profile, emit, context, session, canonicalKey);
    return result;
}

function detectBlockers(stepInfo) {
    const blockers = [];

    if (isAccountGateStepLabel(stepInfo.label)) {
        blockers.push({
            type: "account_creation_required",
            message: "Workday requires account creation or sign-in before application fields are available"
        });
    }

    if (stepInfo.label && /autofill with resume/i.test(stepInfo.label)) {
        blockers.push({
            type: "resume_autofill_step",
            message: "Workday is on the resume autofill step"
        });
    }

    return blockers;
}

async function detectWorkdayPageBlockers(page, stepInfo) {
    const blockers = detectBlockers(stepInfo);
    const bodyText = String(await page.locator("body").innerText().catch(() => "")).trim();

    if (/you(?:'|')ve already applied for this job/i.test(bodyText)) {
        blockers.push({
            type: "already_applied",
            message: "You have already applied for this job; open the in-progress application from Candidate Home or use a different posting"
        });
    }

    return blockers;
}

async function dismissWorkdayCookieBanner(page) {
    const accept = page.getByRole("button", { name: /accept cookies/i }).first();
    if (await accept.count() > 0 && await accept.isVisible().catch(() => false)) {
        await accept.click({ force: true }).catch(() => {});
        await page.waitForTimeout(PAUSE_SHORT);
    }
}

async function tryAdvance(page, emit, previousStep = null) {
    await dismissWorkdayCookieBanner(page);
    const stepBefore = previousStep || await detectCurrentStep(page);
    if (/^review$/i.test(stepBefore.label || "")) {
        emit("workday_review_reached", { message: "Application prepared at Review; not submitting" });
        return false;
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(PAUSE_SHORT);

    const candidateLocators = [
        page.locator('[data-automation-id="bottom-navigation-next-button"]'),
        page.locator('[data-automation-id="pageFooterNextButton"]'),
        page.getByRole("button", { name: /save and continue/i }),
        page.getByRole("button", { name: /^next$/i })
    ];

    let target = null;
    for (const locator of candidateLocators) {
        const count = await locator.count();
        for (let index = 0; index < count; index += 1) {
            const button = locator.nth(index);
            if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
                target = button;
                break;
            }
        }
        if (target) {
            break;
        }
    }

    if (!target) {
        emit("workday_advance_disabled", {});
        return false;
    }

    await target.scrollIntoViewIfNeeded().catch(() => {});
    await target.click({ force: true });
    await page.waitForTimeout(ADVANCE_WAIT_MS);

    let stepAfter = await detectCurrentStep(page);
    const stepBeforeKey = `${stepBefore.step}:${(stepBefore.label || "").toLowerCase()}`;
    for (let attempt = 0; attempt < 24; attempt += 1) {
        const stepAfterKey = `${stepAfter.step}:${(stepAfter.label || "").toLowerCase()}`;
        if (stepAfterKey !== stepBeforeKey && stepAfter.step != null) {
            break;
        }
        await page.waitForTimeout(500);
        await page.waitForLoadState("domcontentloaded", { timeout: 2000 }).catch(() => {});
        stepAfter = await detectCurrentStep(page);
    }

    const sameStep = stepBefore.step === stepAfter.step
        && (stepBefore.label || "").toLowerCase() === (stepAfter.label || "").toLowerCase();

    if (sameStep) {
        const validationErrors = await collectWorkdayValidationBlockers(page);
        const invalidLabels = await findManualReviewFields(page);
        emit("workday_advance_no_progress", {
            step: stepAfter,
            validationErrors,
            invalidLabels,
            buttonEnabled: await target.isEnabled().catch(() => null)
        });
        return false;
    }

    emit("workday_step_advanced", { from: stepBefore, to: stepAfter });
    return true;
}

async function prepareWorkdayApplication(page, profile, emit, applicationContext = {}) {
    stepScreenshotCounter = 0;
    const jobUrl = applicationContext.jobUrl || page.url();
    const companyName = applicationContext.companyName
        || applicationContext.board
        || parseWorkdayJobUrl(jobUrl)?.tenant
        || null;
    const context = {
        targetCountry: applicationContext.targetCountry || null,
        jobLocation: applicationContext.jobLocation || null,
        companyName,
        jobUrl
    };

    const initialStep = await detectCurrentStep(page);
    if (!isApplicationStepLabel(initialStep.label) && !await hasApplicationFormFields(page)) {
        await openApplication(page, jobUrl, emit);
        await captureStepScreenshot(page, emit, applicationContext, "job-posting-apply");
    } else {
        emit("workday_apply_already_open", { step: initialStep });
        await captureStepScreenshot(page, emit, applicationContext, initialStep.label || "apply-already-open");
    }

    let totalFilled = 0;
    const unanswered = [];
    const blockers = [];
    let resumeUploaded = false;
    let passedAccountGate = false;
    const session = {
        filledFields: new Set(),
        certificationsHandled: false,
        workHistoryInitialized: false,
        myInformationRequiredFilled: false,
        resumeUploaded: false,
        doneSteps: new Set(),
        retries: {}
    };

    for (let attempt = 0; attempt < MAX_STEPS; attempt += 1) {
        if (await isWorkdayErrorPage(page)) {
            await recoverWorkdayErrorPage(page, emit);
        }

        const stepInfo = await detectCurrentStep(page);
        const stepKey = await inferWorkdayStepKey(page, stepInfo);
        const canonicalKey = canonicalWorkdayStepKey(stepKey, stepInfo);
        const stepSignature = `${stepInfo.step}:${stepInfo.label}`;
        emit("workday_step_detected", { ...stepInfo, stepKey, canonicalKey });
        await captureStepScreenshot(page, emit, applicationContext, stepInfo.label || `step-${stepInfo.step}`);

        if (matchesWorkdayStep(canonicalKey, stepInfo, /^review$/)) {
            emit("workday_review_reached", { message: "Application prepared at Review; not submitting" });
            await captureStepScreenshot(page, emit, applicationContext, "review");
            break;
        }

        const stepBlockers = await detectWorkdayPageBlockers(page, stepInfo);
        blockers.push(...stepBlockers);
        if (stepBlockers.some((blocker) => blocker.type === "already_applied")) {
            emit("workday_already_applied", { jobUrl });
            break;
        }

        const onAccountGate = await isOnAccountGate(page, stepInfo);
        if (onAccountGate && !passedAccountGate) {
            await activateAccountEntry(page, emit);
            await captureStepScreenshot(page, emit, applicationContext, "account-gate");

            let passed = await tryAutoAccountAuth(page, profile, emit, applicationContext);
            await captureStepScreenshot(page, emit, applicationContext, "account-gate-after-auth");

            if (!passed) {
                const accountGateTimeoutMs = applicationContext.accountGateTimeoutMs
                    ?? (applicationContext.headless ? 0 : DEFAULT_ACCOUNT_GATE_TIMEOUT_MS);

                if (accountGateTimeoutMs > 0) {
                    passed = await waitPastAccountGate(page, emit, accountGateTimeoutMs);
                }
            }

            if (!passed) {
                break;
            }

            passedAccountGate = true;
            await captureStepScreenshot(page, emit, applicationContext, "account-gate-passed");
            continue;
        }

        if (isApplicationStepLabel(stepInfo.label) || passedAccountGate) {
            await waitForApplicationStepReady(page, emit);
        }

        const retries = session.retries[canonicalKey] || 0;
        const gapMode = session.doneSteps.has(canonicalKey) && retries > 0;

        if (!session.doneSteps.has(canonicalKey) || gapMode) {
            try {
                const result = await fillWorkdayStep(
                    page, profile, emit, context, applicationContext, canonicalKey, stepInfo, session, gapMode
                );
                totalFilled += result.filled;
                for (const question of result.unanswered || []) {
                    if (!unanswered.includes(question)) {
                        unanswered.push(question);
                    }
                }
                if (!gapMode) {
                    session.doneSteps.add(canonicalKey);
                    emit("workday_step_filled", { step: canonicalKey, filled: result.filled, gapMode: false });
                } else {
                    emit("workday_step_gap_fill", { step: canonicalKey, filled: result.filled });
                }
            } catch (error) {
                emit("workday_step_fill_failed", { step: canonicalKey, message: error.message });
            }
        } else {
            emit("workday_step_fill_skipped", { step: canonicalKey, reason: "already_filled" });
        }

        if (matchesWorkdayStep(canonicalKey, stepInfo, /my experience/)) {
            resumeUploaded = resumeUploaded || await uploadResumeIfPresent(page, profile, emit, session);
            await captureStepScreenshot(page, emit, applicationContext, "my-experience-filled");
        }

        await page.waitForTimeout(PAUSE_SHORT);
        const advanced = await tryAdvance(page, emit, stepInfo);
        if (!advanced) {
            session.retries[canonicalKey] = retries + 1;
            await unlockWorkdayFieldsFromValidation(page, session, emit);
            const validationErrors = await collectWorkdayValidationBlockers(page);
            emit("workday_advance_failed", { step: canonicalKey, retries: session.retries[canonicalKey], validationErrors });
            for (const question of extractUnansweredFromValidationErrors(validationErrors)) {
                if (!unanswered.includes(question)) {
                    unanswered.push(question);
                }
            }

            if (session.retries[canonicalKey] >= stepMaxRetries(canonicalKey, applicationContext)) {
                emit("workday_step_blocked", { step: canonicalKey, retries: session.retries[canonicalKey] });
                break;
            }
            continue;
        }

        session.retries[canonicalKey] = 0;
    }

    const manualReviewRequired = await findManualReviewFields(page);
    const uniqueBlockers = [...new Map(blockers.map((item) => [item.type, item])).values()]
        .filter((blocker) => blocker.type !== "account_creation_required" || !passedAccountGate);

    return {
        provider: "workday",
        companyName,
        targetCountry: context.targetCountry,
        filled: totalFilled,
        unanswered,
        resumeUploaded,
        manualReviewRequired,
        blockers: uniqueBlockers
    };
}

module.exports = {
    detectCurrentStep,
    hasApplicationFormFields,
    inferWorkdayStepKey,
    isAccountGateStepLabel,
    isApplicationStepLabel,
    isOnAccountGate,
    matchesWorkdayStep,
    openApplication,
    parseWorkdayStep,
    prepareWorkdayApplication
};
