const { getAnswer, normalizeQuestion } = require("../../core/answer-engine");
const { fillField, optionMatches } = require("../greenhouse/helper");

function pickSmartRecruitersQuestionLabel(label) {
    return normalizeQuestion(String(label || "")
        .replace(/[✱*]+/g, "")
        .replace(/\s+/g, " ")
        .trim());
}

async function isCaptchaPresent(page) {
    const frameCaptcha = page.frames().some((frame) => /captcha-delivery\.com|captcha/i.test(frame.url()));
    if (frameCaptcha) {
        return true;
    }

    const text = await page.locator("body").innerText().catch(() => "");
    return /verification required|slide right to secure|unusual activity from your device/i.test(text);
}

async function openSmartRecruitersApplication(page, emit) {
    if (/oneclick-ui/i.test(page.url())) {
        return page.url();
    }

    const applyLink = page.locator('a[href*="oneclick-ui"], a.cjs-apply-button, a.job-button, button:has-text("Apply")').first();
    if (await applyLink.count() > 0 && await applyLink.isVisible().catch(() => false)) {
        const href = await applyLink.getAttribute("href");
        if (href) {
            await page.goto(href, { waitUntil: "domcontentloaded", timeout: 45000 });
            emit("application_opened", { method: "apply-link", url: page.url() });
            return page.url();
        }

        await applyLink.click();
        await page.waitForTimeout(2000);
        emit("application_opened", { method: "apply-click", url: page.url() });
        return page.url();
    }

    return page.url();
}

async function waitForSmartRecruitersForm(page, emit, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (await isCaptchaPresent(page)) {
            emit("captcha_detected", { message: "SmartRecruiters bot verification is blocking the application form" });
            return { ready: false, captcha: true };
        }

        const hasForm = await page.locator([
            'input[type="email"]',
            'input[autocomplete="email"]',
            'input[name*="email" i]',
            "spl-input input",
            'input[autocomplete="given-name"]',
            'input[name*="first" i]'
        ].join(",")).first().isVisible().catch(() => false);

        if (hasForm) {
            return { ready: true, captcha: false };
        }

        await page.waitForTimeout(500);
    }

    if (await isCaptchaPresent(page)) {
        emit("captcha_detected", { message: "SmartRecruiters bot verification is blocking the application form" });
        return { ready: false, captcha: true };
    }

    throw new Error("SmartRecruiters application form did not load");
}

async function getSmartRecruitersQuestionLabel(element) {
    const label = await element.evaluate((node) => {
        const parts = [];
        const host = node.getRootNode().host;
        if (host?.getAttribute) {
            parts.push(host.getAttribute("label"), host.getAttribute("aria-label"));
        }

        const id = node.id;
        if (id) {
            const explicit = node.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (explicit) {
                parts.push(explicit.innerText);
            }
        }

        const wrapping = node.closest("label");
        if (wrapping) {
            parts.push(wrapping.innerText);
        }

        const group = node.closest("fieldset, .question, .field, [data-test], spl-input, spl-textarea, spl-select, oc-field, oc-question");
        if (group) {
            const heading = group.querySelector("legend, label, .label, h3, h4, [class*=label]");
            if (heading) {
                parts.push(heading.innerText);
            }
            parts.push(group.getAttribute("label"), group.getAttribute("aria-label"));
        }

        parts.push(node.getAttribute("aria-label"), node.getAttribute("placeholder"), node.name);
        return parts.filter(Boolean).join(" ");
    });

    return pickSmartRecruitersQuestionLabel(label);
}

function resolveSmartRecruitersSystemFieldAnswer(fieldName, label, profile) {
    const normalizedName = String(fieldName || "").toLowerCase();
    const normalizedLabel = String(label || "").toLowerCase();

    if (/first.?name|given/i.test(normalizedName) || /\bfirst name\b/i.test(normalizedLabel)) {
        return profile.firstName || null;
    }
    if (/last.?name|family|surname/i.test(normalizedName) || /\blast name\b/i.test(normalizedLabel)) {
        return profile.lastName || null;
    }
    if (normalizedName === "email" || /\bemail\b/i.test(normalizedLabel)) {
        return profile.email || null;
    }
    if (/phone|tel/i.test(normalizedName) || /\bphone\b/i.test(normalizedLabel)) {
        return profile.phone || null;
    }
    if (/linkedin/i.test(normalizedName) || /linkedin/i.test(normalizedLabel)) {
        return profile.linkedin || null;
    }
    if (/github/i.test(normalizedName) || /github/i.test(normalizedLabel)) {
        return profile.github || null;
    }
    if (/portfolio|website/i.test(normalizedName) || /portfolio|website/i.test(normalizedLabel)) {
        return profile.portfolio || profile.website || null;
    }
    if (/city|location|residence/i.test(normalizedName) || /place of residence|current location/i.test(normalizedLabel)) {
        return profile.city || profile.location || null;
    }

    return null;
}

async function fillSmartRecruitersRadioGroups(root, profile, emit, context = {}) {
    const groups = await root.locator("input[type='radio']").evaluateAll((elements) => {
        const names = new Set();
        for (const element of elements) {
            if (element.name && element.offsetParent !== null) {
                names.add(element.name);
            }
        }
        return [...names];
    });

    let filled = 0;
    const unanswered = [];

    for (const groupName of groups) {
        const sample = root.locator(`input[type="radio"][name="${groupName}"]`).first();
        const questionLabel = await getSmartRecruitersQuestionLabel(sample);
        const answer = getAnswer(questionLabel, profile, context);
        if (!answer) {
            if (questionLabel && !unanswered.includes(questionLabel)) {
                unanswered.push(questionLabel);
            }
            continue;
        }

        try {
            const radios = root.locator(`input[type="radio"][name="${groupName}"]`);
            const count = await radios.count();
            let selected = null;

            for (let index = 0; index < count; index += 1) {
                const radio = radios.nth(index);
                const label = radio.locator("xpath=ancestor::label[1]");
                const text = await label.innerText().catch(async () => radio.getAttribute("value") || "");
                if (optionMatches(text, answer)) {
                    await label.click().catch(async () => radio.check({ force: true }));
                    selected = text.trim();
                    break;
                }
            }

            if (!selected) {
                throw new Error(`No radio option matching "${answer}"`);
            }

            filled += 1;
            emit("field_filled", { field: questionLabel, value: selected, type: "radio" });
        } catch (error) {
            emit("field_failed", { field: questionLabel, message: error.message, type: "radio" });
            if (questionLabel && !unanswered.includes(questionLabel)) {
                unanswered.push(questionLabel);
            }
        }
    }

    return { filled, unanswered };
}

async function fillSmartRecruitersCheckboxGroups(root, profile, emit, context = {}) {
    const groups = await root.locator("input[type='checkbox']").evaluateAll((elements) => {
        const grouped = new Map();
        for (const element of elements) {
            if (!element.name || element.offsetParent === null) {
                continue;
            }

            const entry = grouped.get(element.name) || { count: 0, question: "" };
            entry.count += 1;
            const group = element.closest("fieldset, .question, [data-test], spl-checkbox, label");
            entry.question = group?.innerText?.trim() || entry.question;
            grouped.set(element.name, entry);
        }
        return [...grouped.entries()].map(([name, meta]) => ({ name, count: meta.count, question: meta.question }));
    });

    let filled = 0;
    const unanswered = [];

    for (const group of groups) {
        const questionLabel = pickSmartRecruitersQuestionLabel(group.question) || group.name;
        const answer = getAnswer(questionLabel, profile, context);
        if (!answer) {
            if (group.count > 0 && !unanswered.includes(questionLabel)) {
                unanswered.push(questionLabel);
            }
            continue;
        }

        try {
            const checkboxes = root.locator(`input[type="checkbox"][name="${group.name}"]`);
            const count = await checkboxes.count();
            let matched = false;

            for (let index = 0; index < count; index += 1) {
                const checkbox = checkboxes.nth(index);
                const label = checkbox.locator("xpath=ancestor::label[1]");
                const text = await label.innerText().catch(async () => checkbox.getAttribute("value") || "");
                if (optionMatches(text, answer)) {
                    await label.click().catch(async () => checkbox.check({ force: true }));
                    matched = true;
                    filled += 1;
                    emit("field_filled", { field: questionLabel, value: text.trim(), type: "checkbox" });
                    break;
                }
            }

            if (!matched && count === 1) {
                const checkbox = checkboxes.first();
                await checkbox.setChecked(optionMatches(await checkbox.getAttribute("value") || questionLabel, answer));
                filled += 1;
                emit("field_filled", { field: questionLabel, value: answer, type: "checkbox" });
            } else if (!matched) {
                throw new Error(`No checkbox option matching "${answer}"`);
            }
        } catch (error) {
            emit("field_failed", { field: questionLabel, message: error.message, type: "checkbox" });
            if (!unanswered.includes(questionLabel)) {
                unanswered.push(questionLabel);
            }
        }
    }

    return { filled, unanswered };
}

async function fillSmartRecruitersKnownFields(root, profile, emit, context = {}) {
    const fields = root.locator([
        "textarea",
        "spl-textarea textarea",
        "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='file']):not([type='radio']):not([type='checkbox'])",
        "spl-input input",
        "select",
        "spl-select select"
    ].join(","));
    const count = await fields.count();
    const handledKeys = new Set();
    const unanswered = [];
    let filled = 0;

    for (let index = 0; index < count; index += 1) {
        const field = fields.nth(index);
        if (!await field.isVisible().catch(() => false) || !await field.isEnabled().catch(() => false)) {
            continue;
        }

        const name = await field.getAttribute("name") || "";
        const label = await getSmartRecruitersQuestionLabel(field);
        const dedupeKey = `${name}::${label}`;
        if (handledKeys.has(dedupeKey)) {
            continue;
        }
        handledKeys.add(dedupeKey);

        const systemAnswer = resolveSmartRecruitersSystemFieldAnswer(name, label, profile);
        const answer = systemAnswer || getAnswer(label, profile, context);
        if (!answer) {
            if (label && !unanswered.includes(label)) {
                unanswered.push(label);
            }
            continue;
        }

        try {
            await fillField(field, answer, root);
            filled += 1;
            emit("field_filled", { field: label || name, value: answer });
        } catch (error) {
            emit("field_failed", { field: label || name, message: error.message });
            if (label && !unanswered.includes(label)) {
                unanswered.push(label);
            }
        }
    }

    return { filled, unanswered };
}

async function fillSmartRecruitersConsent(root, profile, emit) {
    const consents = root.locator('input[type="checkbox"]');
    const count = await consents.count();
    let filled = 0;

    for (let index = 0; index < count; index += 1) {
        const checkbox = consents.nth(index);
        if (!await checkbox.isVisible().catch(() => false)) {
            continue;
        }

        const label = await getSmartRecruitersQuestionLabel(checkbox);
        if (!/privacy|consent|agree|declare|read/i.test(label)) {
            continue;
        }

        const answer = getAnswer(label, profile) || profile.consentToPrivacyNotice || profile.gdprArticle13Consent || "Yes";
        if (optionMatches("Yes", answer) || optionMatches("I agree", answer)) {
            await checkbox.check({ force: true }).catch(async () => {
                const labelNode = checkbox.locator("xpath=ancestor::label[1]");
                await labelNode.click();
            });
            filled += 1;
            emit("field_filled", { field: label, value: "checked", type: "consent" });
        }
    }

    return { filled };
}

async function findManualReviewFields(root) {
    const invalidFields = root.locator("input:invalid, select:invalid, textarea:invalid");
    const count = await invalidFields.count();
    const labels = [];

    for (let index = 0; index < count; index += 1) {
        const field = invalidFields.nth(index);
        const type = (await field.getAttribute("type") || "").toLowerCase();
        if (type === "file" || type === "radio" || type === "hidden" || type === "checkbox") {
            continue;
        }

        if (!await field.isVisible().catch(() => false)) {
            continue;
        }

        const label = pickSmartRecruitersQuestionLabel(await getSmartRecruitersQuestionLabel(field));
        if (label && !labels.includes(label)) {
            labels.push(label);
        }
    }

    return labels;
}

module.exports = {
    fillSmartRecruitersCheckboxGroups,
    fillSmartRecruitersConsent,
    fillSmartRecruitersKnownFields,
    fillSmartRecruitersRadioGroups,
    findManualReviewFields,
    getSmartRecruitersQuestionLabel,
    isCaptchaPresent,
    openSmartRecruitersApplication,
    pickSmartRecruitersQuestionLabel,
    resolveSmartRecruitersSystemFieldAnswer,
    waitForSmartRecruitersForm
};
