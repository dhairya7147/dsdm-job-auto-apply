const { optionMatches } = require("../greenhouse/helper");

async function getAshbyFieldLabel(field) {
    return field.evaluate((element) => {
        const parts = [];
        const id = element.id;

        if (id) {
            const explicit = element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (explicit) {
                parts.push(explicit.innerText);
            }
        }

        const wrappingLabel = element.closest("label");
        if (wrappingLabel) {
            parts.push(wrappingLabel.innerText);
        }

        let node = element.parentElement;
        for (let depth = 0; depth < 8 && node; depth += 1) {
            const heading = node.querySelector(":scope > label, :scope > h3, :scope > h4, :scope > p, :scope > span");
            if (heading?.innerText?.trim()) {
                parts.push(heading.innerText);
            }
            node = node.parentElement;
        }

        parts.push(
            element.getAttribute("aria-label"),
            element.getAttribute("placeholder"),
            element.name,
            element.id
        );

        return parts.filter(Boolean).join(" ");
    });
}

function pickAshbyQuestionLabel(rawLabel, optionTexts = []) {
    const cleaned = normalizeAshbyQuestionLabel(rawLabel);
    const parts = cleaned
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length === 0) {
        return "";
    }

    const normalizedOptions = new Set(optionTexts.map((text) => text.trim().toLowerCase()));
    const isOptionLike = (part) => normalizedOptions.has(part.toLowerCase());

    const questionLike = parts.find((part) =>
        !isOptionLike(part)
        && (/please confirm|are you|do you|will you|would you|have you|where |how |what |which |why |agree|acknowledge|consent|\?/i.test(part) || part.length >= 48)
    );
    if (questionLike) {
        return questionLike;
    }

    const nonOption = parts.filter((part) => !isOptionLike(part));
    const pool = nonOption.length > 0 ? nonOption : parts;
    return pool.sort((left, right) => right.length - left.length)[0];
}

function normalizeAshbyQuestionLabel(rawLabel) {
    return String(rawLabel || "")
        .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, " ")
        .replace(/-labeled-(checkbox|radio)-\d+/gi, " ")
        .replace(/Type here\.{3}/gi, " ")
        .replace(/Start typing\.{3}/gi, " ")
        .replace(/Search schools\.{3}/gi, " ")
        .replace(/OpenAI may use Artificial Intelligence with this application\. Learn more\./gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getAshbyControlQuestion(elementHandle) {
    return elementHandle.evaluate((element) => {
        let container = element.parentElement;
        for (let depth = 0; depth < 12 && container; depth += 1) {
            const lines = (container.innerText || "")
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
            const question = lines
                .filter((line) => !/^(yes|no|u\.s\.|canada|other|python|rust|c\/c\+\+)$/i.test(line))
                .find((line) =>
                    line.includes("?")
                    || /agree|acknowledge|privacy|consent|arbitration|select the technology|engineering areas|country of residence|currently located|plan on working|most recently worked|still student|education history/i.test(line)
                );
            if (question) {
                return question;
            }
            container = container.parentElement;
        }
        return "";
    });
}

function shouldSelectAshbyCheckbox(question, optionLabel, answer) {
    const normalizedQuestion = normalizeAshbyQuestionLabel(question);
    const normalizedAnswer = String(answer || "").trim();
    const normalizedOption = String(optionLabel || "").trim();

    if (!normalizedAnswer || !normalizedOption) {
        return false;
    }

    if (/^yes$/i.test(normalizedAnswer) && /agree|acknowledge|consent|privacy|arbitration|read and|confirm|gdpr|talent pool|hereby/i.test(normalizedQuestion)) {
        return /agree|acknowledge|consent|read and|confirm|yes|accept|hereby/i.test(normalizedOption);
    }

    if (/^yes$/i.test(normalizedAnswer) && /text message|sms|consent to receiving/i.test(normalizedQuestion)) {
        return /yes.*consent/i.test(normalizedOption);
    }

    if (/country of residence/i.test(normalizedQuestion)) {
        return optionMatches(normalizedOption, normalizedAnswer);
    }

    if (/technology you have the most experience|select the technology/i.test(normalizedQuestion)) {
        return optionMatches(normalizedOption, normalizedAnswer);
    }

    if (/engineering areas are you most interested/i.test(normalizedQuestion)) {
        return normalizedAnswer.split(/[,;]| and /i).some((part) => optionMatches(normalizedOption, part.trim()));
    }

    if (/why are you interested in working at plaid|interest in working at/i.test(normalizedQuestion)) {
        return normalizedAnswer.split(/[,;]/).some((part) => {
            const piece = part.trim();
            return piece && (normalizedOption.toLowerCase() === piece.toLowerCase()
                || normalizedOption.toLowerCase().includes(piece.toLowerCase()));
        });
    }

    if (/preferred work location|where would you like to work/i.test(normalizedQuestion)) {
        return normalizedAnswer.split(/[,;]/).some((part) => optionMatches(normalizedOption, part.trim()));
    }

    if (/how did you hear about this position/i.test(normalizedQuestion)) {
        return optionMatches(normalizedOption, normalizedAnswer);
    }

    return normalizedAnswer.split(/[,;]| and /i).some((part) => optionMatches(normalizedOption, part.trim()));
}

async function getAshbyRadioGroupQuestion(root, groupName) {
    const radios = root.locator(`input[type="radio"][name="${groupName}"]`);
    const optionTexts = [];
    const count = await radios.count();

    for (let index = 0; index < count; index += 1) {
        const radio = radios.nth(index);
        const id = await radio.getAttribute("id");
        if (!id) {
            continue;
        }

        const text = (await root.locator(`label[for="${id}"]`).first().innerText().catch(() => "")).trim();
        if (text) {
            optionTexts.push(text);
        }
    }

    if (count === 0) {
        return { questionLabel: "", optionTexts };
    }

    const rawLabel = await getAshbyFieldLabel(radios.first());
    return {
        questionLabel: pickAshbyQuestionLabel(rawLabel, optionTexts),
        optionTexts
    };
}

function resolveAshbySystemFieldAnswer(systemFieldName, label, profile) {
    if (systemFieldName === "_systemfield_email") {
        return profile.email || null;
    }

    if (systemFieldName === "_systemfield_name") {
        if (/preferred name/i.test(label)) {
            return profile.preferredName || profile.firstName || null;
        }

        if (/full name|legal name/i.test(label)) {
            return profile.fullName || null;
        }

        if (/first name/i.test(label)) {
            return profile.firstName || null;
        }

        if (/last name/i.test(label)) {
            return profile.lastName || null;
        }

        return profile.fullName || profile.preferredName || profile.firstName || null;
    }

    if (systemFieldName === "_systemfield_education_history-degree") {
        return profile.highestDegree || null;
    }

    if (systemFieldName === "_systemfield_education_history-major") {
        return profile.fieldOfStudy || null;
    }

    return null;
}

async function selectAshbyRadioGroup(root, groupName, questionLabel, value) {
    const radios = root.locator(`input[type="radio"][name="${groupName}"]`);
    const count = await radios.count();
    if (count === 0) {
        throw new Error(`No radio group found for ${groupName}`);
    }

    for (let index = 0; index < count; index += 1) {
        const radio = radios.nth(index);
        const id = await radio.getAttribute("id");
        if (!id) {
            continue;
        }

        const label = root.locator(`label[for="${id}"]`).first();
        const text = (await label.innerText().catch(() => "")).trim();
        if (!text) {
            continue;
        }

        if (optionMatches(text, value)) {
            await label.click();
            return text;
        }
    }

    if (/^yes$/i.test(String(value)) && /in[- ]?person|office|hybrid/i.test(questionLabel)) {
        for (let index = 0; index < count; index += 1) {
            const radio = radios.nth(index);
            const id = await radio.getAttribute("id");
            const label = root.locator(`label[for="${id}"]`).first();
            const text = (await label.innerText().catch(() => "")).trim();
            if (/able to be in[- ]?person|i am able|yes/i.test(text) && !/not able|unable/i.test(text)) {
                await label.click();
                return text;
            }
        }
    }

    throw new Error(`No radio option matching "${value}" for "${questionLabel}"`);
}

async function fillAshbyEducationHistory(root, profile, emit) {
    let filled = 0;
    const unanswered = [];

    const degreeField = root.locator("#_systemfield_education_history-degree").first();
    if (await degreeField.count() > 0 && await degreeField.isVisible().catch(() => false)) {
        const value = profile.highestDegree || "Bachelor's Degree";
        await degreeField.fill(value);
        filled += 1;
        emit("field_filled", { field: "Education Degree", value });
    }

    const majorField = root.locator("#_systemfield_education_history-major").first();
    if (await majorField.count() > 0 && await majorField.isVisible().catch(() => false)) {
        const value = profile.fieldOfStudy || "Computer Science and Engineering";
        await majorField.fill(value);
        filled += 1;
        emit("field_filled", { field: "Education Major", value });
    }

    const schoolField = root.locator("input[placeholder*='Search schools' i]").first();
    if (await schoolField.count() > 0 && await schoolField.isVisible().catch(() => false)) {
        const { selectOption } = require("../greenhouse/helper");
        const school = profile.university || "Motilal Nehru National Institute of Technology";
        const schoolQueries = ["MNNIT", "Motilal Nehru", "Allahabad", school];
        let schoolFilled = false;
        for (const query of schoolQueries) {
            try {
                await schoolField.click();
                await schoolField.fill(query);
                await root.waitForTimeout(700);
                const option = root.getByRole("option").filter({ hasText: /MNNIT|Motilal|Allahabad|Nehru/i }).first();
                if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await option.click();
                    schoolFilled = true;
                    filled += 1;
                    emit("field_filled", { field: "School", value: school, method: "type_select" });
                    break;
                }
            } catch {
                // try next query
            }
        }
        if (!schoolFilled) {
            unanswered.push("School Education History");
        }
    }

    const startDate = root.locator("#_systemfield_education_history-startDate");
    if (await startDate.count() > 0) {
        const { selectOption } = require("../greenhouse/helper");
        const monthSelect = startDate.locator("select").nth(0);
        const yearSelect = startDate.locator("select").nth(1);
        if (await monthSelect.count() > 0) {
            await selectOption(monthSelect, profile.educationStartMonth || "December", root);
            filled += 1;
        }
        if (await yearSelect.count() > 0) {
            await selectOption(yearSelect, profile.educationStartYear || profile.graduationYear || "2020", root);
            filled += 1;
        }
        emit("field_filled", { field: "Education Start Date" });
    }

    const endDate = root.locator("#_systemfield_education_history-endDate");
    if (await endDate.count() > 0) {
        const { selectOption } = require("../greenhouse/helper");
        const monthSelect = endDate.locator("select").nth(0);
        const yearSelect = endDate.locator("select").nth(1);
        if (await monthSelect.count() > 0) {
            await selectOption(monthSelect, profile.educationEndMonth || "May", root);
            filled += 1;
        }
        if (await yearSelect.count() > 0) {
            await selectOption(yearSelect, profile.educationEndYear || profile.graduationYear || "2024", root);
            filled += 1;
        }
        emit("field_filled", { field: "Education End Date" });
    }

    return { filled, unanswered };
}

async function fillAshbyComboboxes(root, profile, emit, context = {}) {
    const { getAnswer } = require("../../core/answer-engine");
    const { selectOption } = require("../greenhouse/helper");
    const combos = root.locator("input[role='combobox'], [role='combobox']");
    const count = await combos.count();
    const handled = new Set();
    let filled = 0;
    const unanswered = [];

    for (let index = 0; index < count; index += 1) {
        const field = combos.nth(index);
        if (!await field.isVisible().catch(() => false)) {
            continue;
        }

        const placeholder = (await field.getAttribute("placeholder") || "").toLowerCase();
        const rawLabel = await getAshbyFieldLabel(field);
        const label = pickAshbyQuestionLabel(rawLabel);
        const dedupeKey = `${placeholder}:${label}`;
        if (handled.has(dedupeKey)) {
            continue;
        }
        handled.add(dedupeKey);

        if (/^location$/i.test(label) && !/currently located|plan on working|payroll/i.test(label)) {
            continue;
        }

        let answer = getAnswer(label, profile, context);
        if (!answer && /currently located|where are you/i.test(label)) {
            answer = profile.currentLocation || `${profile.city}, ${profile.country}`;
        }
        if (!answer && /plan on working from|payroll tax/i.test(label)) {
            answer = profile.workFromAddress || profile.currentLocation || `${profile.city}, ${profile.country}`;
        }
        if (!answer && /search schools/i.test(placeholder)) {
            answer = profile.university;
        }

        if (!answer) {
            if (label) {
                unanswered.push(label);
            }
            continue;
        }

        try {
            await selectOption(field, answer, root, profile.country || "India");
            filled += 1;
            emit("field_filled", { field: label || placeholder, value: answer, type: "combobox" });
        } catch (error) {
            try {
                await field.click();
                await field.fill(String(answer).split(",")[0].trim());
                await root.waitForTimeout(500);
                const option = root.getByRole("option").filter({ hasText: new RegExp(escapeAshbyValue(answer), "i") }).first();
                if (await option.isVisible().catch(() => false)) {
                    await option.click();
                    filled += 1;
                    emit("field_filled", { field: label || placeholder, value: answer, type: "combobox", method: "type_select" });
                } else {
                    await field.press("Enter");
                    filled += 1;
                    emit("field_filled", { field: label || placeholder, value: answer, type: "combobox", method: "enter" });
                }
            } catch (innerError) {
                emit("field_failed", { field: label || placeholder, message: innerError.message, type: "combobox" });
                if (label) {
                    unanswered.push(label);
                }
            }
        }
    }

    return { filled, unanswered };
}

function escapeAshbyValue(value) {
    return String(value || "").split(",")[0].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fillAshbyYesNoButtons(root, profile, emit, context = {}) {
    const { getAnswer } = require("../../core/answer-engine");
    const groups = await root.evaluate(() => {
        const questions = [];
        const seen = new Set();

        for (const button of document.querySelectorAll("button")) {
            const label = button.innerText.trim();
            if (!/^(yes|no)$/i.test(label)) {
                continue;
            }

            let container = button.parentElement;
            let question = "";
            for (let depth = 0; depth < 12 && container; depth += 1) {
                const lines = (container.innerText || "")
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean);
                const candidate = lines
                    .filter((line) => line.length >= 20)
                    .find((line) => line.includes("?"));
                if (candidate) {
                    question = candidate;
                    break;
                }
                container = container.parentElement;
            }

            if (!question || seen.has(question)) {
                continue;
            }
            seen.add(question);
            questions.push(question);
        }

        return questions;
    });

    let filled = 0;
    const unanswered = [];

    for (const question of groups) {
        const label = pickAshbyQuestionLabel(question);
        const answer = getAnswer(label, profile, context);
        if (!answer) {
            unanswered.push(label);
            continue;
        }

        const clicked = await root.evaluate(({ questionText, answerText }) => {
            for (const button of document.querySelectorAll("button")) {
                const label = button.innerText.trim();
                if (!/^(yes|no)$/i.test(label)) {
                    continue;
                }

                let container = button.parentElement;
                for (let depth = 0; depth < 12 && container; depth += 1) {
                    if (!(container.innerText || "").includes(questionText)) {
                        container = container.parentElement;
                        continue;
                    }

                    const buttons = [...container.querySelectorAll("button")]
                        .filter((entry) => /^(yes|no)$/i.test(entry.innerText.trim()));
                    const target = buttons.find((entry) => {
                        const text = entry.innerText.trim().toLowerCase();
                        const requested = String(answerText).trim().toLowerCase();
                        return requested === "yes" ? text === "yes" : requested === "no" ? text === "no" : text === requested;
                    });
                    if (target) {
                        target.click();
                        return true;
                    }
                    break;
                }
            }
            return false;
        }, { questionText: question, answerText: answer });

        if (clicked) {
            filled += 1;
            emit("field_filled", { field: label, value: answer, type: "yes_no_button" });
        } else {
            unanswered.push(label);
        }
    }

    return { filled, unanswered };
}

async function fillAshbyCheckboxGroups(root, profile, emit, context = {}) {
    const { getAnswer } = require("../../core/answer-engine");
    const groups = await root.evaluate(() => {
        const map = new Map();

        for (const checkbox of document.querySelectorAll("input[type='checkbox']")) {
            if (checkbox.id === "_systemfield_education_history-isCurrent") {
                continue;
            }

            let question = "";
            let container = checkbox.parentElement;
            for (let depth = 0; depth < 12 && container; depth += 1) {
                const lines = (container.innerText || "")
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean);
                const candidate = lines.find((line) =>
                    line.includes("?")
                    || /agree|acknowledge|privacy|consent|arbitration|select the technology|engineering areas|country of residence|interest in working|preferred work location|how did you hear/i.test(line)
                );
                if (candidate) {
                    question = candidate;
                    break;
                }
                container = container.parentElement;
            }

            const optionLabel = checkbox.id
                ? document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`)?.innerText?.trim()
                : "";
            const groupKey = question || optionLabel || checkbox.name || checkbox.id;
            if (!map.has(groupKey)) {
                map.set(groupKey, { question, options: [] });
            }
            map.get(groupKey).options.push({
                id: checkbox.id,
                label: optionLabel || checkbox.name,
                checked: checkbox.checked
            });
        }

        return [...map.values()];
    });

    let filled = 0;
    const unanswered = [];

    for (const group of groups) {
        const label = pickAshbyQuestionLabel(group.question || group.options[0]?.label || "");
        let answer = getAnswer(label, profile, context);

        if (!answer && /privacy notice|candidate privacy/i.test(label)) {
            answer = "Yes";
        }
        if (!answer && /arbitration agreement/i.test(label)) {
            answer = "Yes";
        }

        if (!answer) {
            if (label) {
                unanswered.push(label);
            }
            continue;
        }

        for (const option of group.options) {
            if (!option.id || option.checked) {
                continue;
            }

            if (!shouldSelectAshbyCheckbox(label, option.label, answer)) {
                continue;
            }

            const checkbox = root.locator(`#${option.id.replace(/:/g, "\\:")}`);
            const optionLabel = root.locator(`label[for="${option.id.replace(/:/g, "\\:")}"]`).first();
            if (await optionLabel.count() > 0) {
                await optionLabel.click();
            } else {
                await checkbox.click({ force: true });
            }
            filled += 1;
            emit("field_filled", { field: label, value: option.label, type: "checkbox" });
        }
    }

    return { filled, unanswered };
}

async function fillAshbyLocationCombobox(root, profile, emit) {
    let field = root.locator("input[role='combobox']").first();
    const labeled = root.locator("label", { hasText: /^location$/i }).first();
    if (await labeled.count() > 0) {
        const forId = await labeled.getAttribute("for");
        if (forId) {
            const byFor = root.locator(`#${forId.replace(/:/g, "\\:")}`);
            if (await byFor.count() > 0) {
                field = byFor;
            }
        }
    }
    if (await field.count() === 0 || !await field.isVisible().catch(() => false)) {
        return false;
    }

    const city = profile.city || profile.currentLocation || "Gurgaon";
    const { selectOption } = require("../greenhouse/helper");

    try {
        await selectOption(field, city, root, profile.country || "India");
        emit("field_filled", { field: "location" });
        return true;
    } catch (error) {
        try {
            await field.click();
            await field.fill(city);
            await root.waitForTimeout(400);
            const option = root.getByRole("option").filter({ hasText: new RegExp(city, "i") }).first();
            if (await option.isVisible().catch(() => false)) {
                await option.click();
            } else {
                await field.press("Enter");
            }
            emit("field_filled", { field: "location", method: "type_enter" });
            return true;
        } catch (innerError) {
            emit("field_failed", { field: "location", message: innerError.message });
            return false;
        }
    }
}

module.exports = {
    fillAshbyCheckboxGroups,
    fillAshbyComboboxes,
    fillAshbyEducationHistory,
    fillAshbyLocationCombobox,
    fillAshbyYesNoButtons,
    getAshbyFieldLabel,
    getAshbyRadioGroupQuestion,
    normalizeAshbyQuestionLabel,
    pickAshbyQuestionLabel,
    resolveAshbySystemFieldAnswer,
    selectAshbyRadioGroup,
    shouldSelectAshbyCheckbox
};
