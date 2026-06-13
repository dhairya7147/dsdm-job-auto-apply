const { escapeRegExp, fillField, optionMatches, selectOption } = require("./greenhouse-helper");
const {
    PAUSE_SHORT,
    PAUSE_MED,
    PAUSE_LONG,
    PAUSE_TINY,
    ROW_ADD_WAIT_MS
} = require("./workday-timing");

const AUTOMATION_LABELS = {
    firstName: "First Name",
    lastName: "Last Name",
    middleName: "Middle Name",
    email: "Email",
    phone: "Phone",
    phoneNumber: "Phone",
    address: "Street Address",
    addressLine1: "Home Address Line 1",
    city: "City",
    postal: "Postal Code",
    zip: "Zip Code",
    country: "Country",
    region: "State",
    state: "State",
    linkedin: "LinkedIn",
    website: "Website",
    source: "How did you hear about this job?",
    createAccountCheckbox: "I agree to the terms and privacy policy",
    phoneDeviceType: "Phone Device Type",
    phoneExtension: "Phone Extension",
    countryPhoneCode: "Country Phone Code"
};

function labelFromAutomationId(automationId = "") {
    if (!automationId) {
        return null;
    }

    if (AUTOMATION_LABELS[automationId]) {
        return AUTOMATION_LABELS[automationId];
    }

    const suffixMatch = automationId.match(/(?:^|_)(firstName|lastName|middleName|email|phoneNumber|phone|addressLine1|address|city|postal|zip|country|region|state|linkedin|website)$/i);
    if (suffixMatch) {
        const suffix = suffixMatch[1];
        const mapped = AUTOMATION_LABELS[suffix.charAt(0).toLowerCase() + suffix.slice(1)]
            || AUTOMATION_LABELS[suffix.toLowerCase()];
        if (mapped) {
            return mapped;
        }
    }

    const normalized = automationId
        .replace(/Section_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim();

    return normalized || null;
}

async function getEducationYearLabelHint(field) {
    return field.evaluate((element) => {
        let current = element;

        for (let depth = 0; depth < 10 && current; depth += 1) {
            const text = current.textContent || "";
            if (/\bFrom\b/i.test(text) && /\bTo\b/i.test(text)) {
                const fromNode = [...current.querySelectorAll("*")].find((node) => {
                    const label = node.getAttribute?.("data-automation-id") || "";
                    return /formFieldLabel|legend|label/i.test(label)
                        || (node.tagName === "LABEL")
                        || (node.childNodes.length === 1 && node.textContent?.trim() === "From");
                });

                const markers = [...current.querySelectorAll("[data-automation-id='formFieldLabel'], label, legend, p, span, div")]
                    .map((node) => ({
                        node,
                        text: (node.textContent || "").trim()
                    }))
                    .filter((entry) => /^(From|To)$/i.test(entry.text));

                if (markers.length >= 2) {
                    const ordered = markers.sort((left, right) =>
                        left.node.compareDocumentPosition(right.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
                    );
                    const fromMarker = ordered.find((entry) => /^From$/i.test(entry.text));
                    const toMarker = ordered.find((entry) => /^To$/i.test(entry.text));

                    if (fromMarker && toMarker) {
                        const position = element.compareDocumentPosition(fromMarker.node) & Node.DOCUMENT_POSITION_FOLLOWING
                            ? "after-from"
                            : "before-from";
                        const afterFrom = fromMarker.node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING;
                        const beforeTo = element.compareDocumentPosition(toMarker.node) & Node.DOCUMENT_POSITION_FOLLOWING;

                        if (afterFrom && beforeTo) {
                            return "Education Start Year";
                        }

                        if (toMarker.node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) {
                            return "Education End Year";
                        }
                    }
                }
            }

            current = current.parentElement;
        }

        const aria = element.getAttribute("aria-label") || "";
        if (/from/i.test(aria)) {
            return "Education Start Year";
        }
        if (/to/i.test(aria)) {
            return "Education End Year";
        }

        return null;
    });
}

const MONTH_NUMBER_TO_NAME = {
    1: "january",
    2: "february",
    3: "march",
    4: "april",
    5: "may",
    6: "june",
    7: "july",
    8: "august",
    9: "september",
    10: "october",
    11: "november",
    12: "december"
};

function normalizeMonthToken(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) {
        return "";
    }

    if (/^\d{1,2}$/.test(raw)) {
        return MONTH_NUMBER_TO_NAME[Number(raw)] || raw;
    }

    return raw.slice(0, 3);
}

function normalizeYearToken(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length === 2) {
        return `20${digits}`;
    }

    return digits.slice(0, 4);
}

function workdayStrictTextMatch(expected, actual) {
    const requested = String(expected || "").trim().toLowerCase();
    const current = String(actual || "").trim().toLowerCase();
    return requested.length > 0 && requested === current;
}

function workdayFieldKey(automationId, label = "", index = null) {
    const id = String(automationId || "").trim();
    const suffix = index == null ? "" : `:${index}`;
    if (id && !/^field-\d+$/i.test(id)) {
        return `id:${id}${suffix}`;
    }

    const normalizedLabel = String(label || "").trim().toLowerCase();
    return normalizedLabel ? `lbl:${normalizedLabel}${suffix}` : `id:${id || "unknown"}${suffix}`;
}

function markWorkdayFieldHandled(sessionFlags, key) {
    if (sessionFlags?.filledFields && key) {
        sessionFlags.filledFields.add(key);
    }
}

function isWorkdayFieldHandled(sessionFlags, key) {
    return Boolean(sessionFlags?.filledFields?.has(key));
}

function workdayValuesMatch(expected, actual, hint = "") {
    const requested = String(expected || "").trim();
    const current = String(actual || "").trim();

    if (!requested) {
        return Boolean(current);
    }

    if (!current || /^(mm|yyyy|dd|select|search|mm\/yyyy)$/i.test(current)) {
        return false;
    }

    if (/job title|company/i.test(hint)) {
        return workdayStrictTextMatch(requested, current);
    }

    const req = requested.toLowerCase();
    const cur = current.toLowerCase();

    if (req === cur || cur.includes(req) || req.includes(cur)) {
        return true;
    }

    if (/month/i.test(hint)) {
        return normalizeMonthToken(req) === normalizeMonthToken(cur);
    }

    if (/year/i.test(hint)) {
        return normalizeYearToken(req) === normalizeYearToken(cur);
    }

    if (/phone/i.test(hint)) {
        const reqDigits = requested.replace(/\D/g, "").replace(/^91/, "");
        const curDigits = current.replace(/\D/g, "").replace(/^91/, "").replace(/^0/, "");
        return reqDigits.length >= 10 && curDigits === reqDigits;
    }

    if (/^(yes|no|true|false)$/i.test(req)) {
        const expectedYes = /^(yes|true|1)$/i.test(req);
        const actualYes = /^(yes|true|checked|1)$/i.test(cur);
        return expectedYes === actualYes;
    }

    return false;
}

async function getWorkdayFieldValue(field) {
    const meta = await field.evaluate((element) => ({
        tagName: element.tagName.toLowerCase(),
        type: (element.getAttribute("type") || "").toLowerCase(),
        role: (element.getAttribute("role") || "").toLowerCase(),
        isContentEditable: element.isContentEditable
    })).catch(() => ({ tagName: "", type: "", role: "", isContentEditable: false }));

    if (meta.type === "radio") {
        const checked = await field.isChecked().catch(() => false);
        if (!checked) {
            return "";
        }

        const id = await field.getAttribute("id");
        const label = id
            ? field.page().locator(`label[for="${id}"]`).first()
            : field.locator("xpath=following-sibling::label[1]");
        return await label.innerText().catch(() => "checked");
    }

    if (meta.type === "checkbox") {
        return (await field.isChecked().catch(() => false)) ? "yes" : "";
    }

    if (meta.role === "spinbutton") {
        return await field.evaluate((element) => (
            element.value
            || element.getAttribute("aria-valuenow")
            || element.getAttribute("aria-valuetext")
            || ""
        )).catch(() => "");
    }

    if (meta.tagName === "input" || meta.tagName === "textarea" || meta.isContentEditable) {
        return await field.inputValue().catch(async () => (
            await field.getAttribute("value")
            || await field.getAttribute("aria-valuenow")
            || ""
        ));
    }

    if (meta.tagName === "button" || meta.role === "combobox") {
        return await field.innerText().catch(() => "");
    }

    return await field.innerText().catch(() => "");
}

async function shouldSkipWorkdayFill(field, expectedValue, hint = "") {
    const currentValue = await getWorkdayFieldValue(field);
    if (/work (start|end)|date/i.test(hint) && /^\d{1,2}\/\d{4}$/.test(String(expectedValue))) {
        return workDateFormattedMatches(expectedValue, currentValue);
    }

    if (!workdayValuesMatch(expectedValue, currentValue, hint)) {
        return false;
    }

    return true;
}

async function getWorkdayFieldSection(field) {
    return field.evaluate((element) => {
        const automationId = element.getAttribute("data-automation-id") || "";
        if (/startDate|endDate|jobTitle|company|currentlyWorkHere|roleDescription|description/i.test(automationId)) {
            return "work";
        }

        if (/dateSection|education|school|degree|fieldOfStudy|gpa/i.test(automationId)) {
            return "education";
        }

        let current = element;
        for (let depth = 0; depth < 12 && current; depth += 1) {
            const heading = [...current.querySelectorAll("h1,h2,h3,h4,legend,[data-automation-id='formFieldLabel']")]
                .map((node) => (node.textContent || "").trim())
                .find((text) => /^(Work Experience|Education)$/i.test(text));

            if (heading) {
                return /^Work Experience$/i.test(heading) ? "work" : "education";
            }

            current = current.parentElement;
        }

        return "other";
    });
}

async function getEducationDateLabelHint(field) {
    const automationId = await field.getAttribute("data-automation-id") || "";
    const isMonth = /month/i.test(automationId);
    const isYear = /year/i.test(automationId);

    if (!isMonth && !isYear) {
        return null;
    }

    const segment = await field.evaluate((element) => {
        let current = element;

        for (let depth = 0; depth < 10 && current; depth += 1) {
            const markers = [...current.querySelectorAll("[data-automation-id='formFieldLabel'], label, legend, p, span, div")]
                .map((node) => ({
                    node,
                    text: (node.textContent || "").trim()
                }))
                .filter((entry) => /^(From|To)$/i.test(entry.text));

            if (markers.length >= 2) {
                const ordered = markers.sort((left, right) =>
                    left.node.compareDocumentPosition(right.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
                );
                const fromMarker = ordered.find((entry) => /^From$/i.test(entry.text));
                const toMarker = ordered.find((entry) => /^To$/i.test(entry.text));

                if (fromMarker && toMarker) {
                    const afterFrom = fromMarker.node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING;
                    const beforeTo = element.compareDocumentPosition(toMarker.node) & Node.DOCUMENT_POSITION_FOLLOWING;

                    if (afterFrom && beforeTo) {
                        return "start";
                    }

                    if (toMarker.node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) {
                        return "end";
                    }
                }
            }

            current = current.parentElement;
        }

        const aria = element.getAttribute("aria-label") || "";
        if (/from/i.test(aria)) {
            return "start";
        }
        if (/to/i.test(aria)) {
            return "end";
        }

        return null;
    });

    if (!segment) {
        return null;
    }

    if (isMonth) {
        return segment === "start" ? "Education Start Month" : "Education End Month";
    }

    return segment === "start" ? "Education Start Year" : "Education End Year";
}

const MONTH_ABBREV_TO_NUMBER = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
};

function formatWorkdayMonthYear(month, year) {
    if (!month || !year) {
        return null;
    }

    const normalized = normalizeMonthToken(month).slice(0, 3);
    const monthNumber = MONTH_ABBREV_TO_NUMBER[normalized] || String(month).replace(/\D/g, "").padStart(2, "0");
    const yearNumber = normalizeYearToken(year);
    return `${monthNumber}/${yearNumber}`;
}

function parseWorkdayMonthYear(value) {
    const text = String(value || "").trim();
    const slashMatch = text.match(/(\d{1,2})\s*[/-]\s*(\d{2,4})/);
    if (slashMatch) {
        return {
            month: slashMatch[1].padStart(2, "0"),
            year: normalizeYearToken(slashMatch[2])
        };
    }

    return null;
}

function workDateFormattedMatches(expectedFormatted, actual) {
    const expected = parseWorkdayMonthYear(expectedFormatted);
    const current = parseWorkdayMonthYear(actual);
    if (!expected || !current) {
        return false;
    }

    return expected.month === current.month && expected.year === current.year;
}

const WORK_EXPERIENCE_TITLE_INPUT = [
    '[data-automation-id="formField-jobTitle"] input:not([type="hidden"])',
    'input[data-automation-id="jobTitle"]:not([type="hidden"])',
    '[data-automation-id="jobTitle"] input:not([type="hidden"])',
    '[data-automation-id*="jobTitle"] input:not([type="hidden"])',
    'input[id*="jobTitle"]:not([type="hidden"])',
    'input[name*="jobTitle"]:not([type="hidden"])',
    'input[aria-label*="Job Title" i]:not([type="hidden"])'
].join(", ");

const WORK_EXPERIENCE_COMPANY_INPUT = [
    '[data-automation-id="formField-company"] input:not([type="hidden"])',
    'input[data-automation-id="company"]:not([type="hidden"])',
    '[data-automation-id="company"] input:not([type="hidden"])',
    'input[id*="company"]:not([type="hidden"])',
    'input[name*="company"]:not([type="hidden"])',
    'input[aria-label*="Company" i]:not([type="hidden"])'
].join(", ");

const WORK_EXPERIENCE_LOCATION_INPUT = [
    '[data-automation-id="formField-location"] input:not([type="hidden"])',
    'input[data-automation-id="location"]:not([type="hidden"])',
    '[data-automation-id="location"] input:not([type="hidden"])',
    'input[id*="location"]:not([type="hidden"])',
    'input[name*="location"]:not([type="hidden"])',
    'input[aria-label*="Location" i]:not([type="hidden"])'
].join(", ");

function getWorkExperienceSection(page) {
    const exact = page.locator('[data-automation-id="workExperienceSection"]').first();
    return exact;
}

function getWorkExperienceBlock(page) {
    return page.locator('[data-automation-id="workExperienceSection"]').first()
        .or(page.locator("section, div, fieldset").filter({ hasText: /Work Experience 1\b/i }).first());
}

async function resolveWorkdayNamedSection(page, automationId, sectionLabel) {
    const byAutomationId = page.locator(`[data-automation-id="${automationId}"]`).first();
    if (await byAutomationId.count() > 0) {
        return byAutomationId;
    }

    const labelPattern = new RegExp(`^${sectionLabel}\\b`, "i");
    const candidates = page.locator("section, div, fieldset").filter({ hasText: labelPattern });
    const count = await candidates.count();
    let best = null;
    let bestArea = Infinity;

    for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        const text = String(await candidate.innerText().catch(() => "")).trim();
        if (/Work Experience/i.test(text)) {
            continue;
        }

        const box = await candidate.boundingBox().catch(() => null);
        const area = box ? box.width * box.height : Infinity;
        if (area < bestArea) {
            bestArea = area;
            best = candidate;
        }
    }

    if (best) {
        return best;
    }

    return page.locator("section, div, fieldset").filter({ hasText: labelPattern }).last();
}

function getWorkExperienceTitleFields(page) {
    return page.locator(WORK_EXPERIENCE_TITLE_INPUT);
}

function getWorkExperienceCompanyFields(page) {
    return page.locator(WORK_EXPERIENCE_COMPANY_INPUT);
}

function getWorkExperienceLocationFields(page) {
    return page.locator(WORK_EXPERIENCE_LOCATION_INPUT);
}

async function countWorkExperienceRows(page) {
    const section = page.locator('[data-automation-id="workExperienceSection"]').first();
    if (await section.count() > 0) {
        return await section.locator(WORK_EXPERIENCE_TITLE_INPUT).count();
    }

    return await getWorkExperienceTitleFields(page).count();
}

function getWorkExperienceRow(page, index) {
    const titleField = getWorkExperienceTitleFields(page).nth(index);
    return titleField.locator(
        'xpath=ancestor::*[.//input[contains(@aria-label,"Company") or contains(@data-automation-id,"company")] and .//input[contains(@aria-label,"Location") or contains(@data-automation-id,"location")]][1]'
    );
}

async function resolveWorkExperienceWorkId(page, index) {
    const block = getWorkExperienceBlock(page);
    if (await block.count() === 0) {
        return null;
    }

    return block.evaluate((root, rowIndex) => {
        const startMonths = [...root.querySelectorAll('[id*="startDate-dateSectionMonth-input"]')];
        const dateEl = startMonths[rowIndex];
        if (!dateEl?.id) {
            return null;
        }

        const match = dateEl.id.match(/workExperience-(\d+)/);
        return match ? match[1] : null;
    }, index).catch(() => null);
}

async function resolveWorkExperienceRow(page, index) {
    const heading = page.getByText(new RegExp(`Work Experience ${index + 1}\\b`, "i")).first();
    if (await heading.count() > 0) {
        const rowFromHeading = heading.locator(
            'xpath=ancestor::*[.//input[contains(@aria-label,"Job Title") or contains(@aria-label,"Company")]][1]'
        );
        if (await rowFromHeading.count() > 0) {
            return rowFromHeading;
        }
    }

    const workId = await resolveWorkExperienceWorkId(page, index);
    if (workId) {
        const scoped = page.locator(`[id*="workExperience-${workId}"]`).first().locator(
            `xpath=ancestor::*[.//*[@id[contains(., "workExperience-${workId}")]]][1]`
        );
        if (await scoped.count() > 0) {
            return scoped;
        }
    }

    return getWorkExperienceRow(page, index);
}

async function resolveWorkExperienceDatePair(page, index, kind) {
    const datePrefix = kind === "start" ? "startDate" : "endDate";
    const workId = await resolveWorkExperienceWorkId(page, index);
    const row = await resolveWorkExperienceRow(page, index);

    if (workId) {
        const monthInput = page.locator(`[id="workExperience-${workId}--${datePrefix}-dateSectionMonth-input"]`);
        const yearInput = page.locator(`[id="workExperience-${workId}--${datePrefix}-dateSectionYear-input"]`);
        if (await monthInput.count() > 0) {
            return { monthInput, yearInput, workId };
        }
    }

    const label = kind === "start" ? /^From\b/i : /^To\b/i;
    const labeledGroup = row.locator("div, fieldset").filter({ has: row.getByText(label) }).first();
    let monthInput = labeledGroup.getByRole("spinbutton").nth(0);
    let yearInput = labeledGroup.getByRole("spinbutton").nth(1);

    if (await monthInput.count() === 0) {
        monthInput = row.locator('[data-automation-id="dateSectionMonth-input"]').nth(kind === "start" ? 0 : 1);
        yearInput = row.locator('[data-automation-id="dateSectionYear-input"]').nth(kind === "start" ? 0 : 1);
    }

    if (await monthInput.count() === 0) {
        const spinbuttons = row.getByRole("spinbutton");
        const spinOffset = kind === "start" ? 0 : 2;
        monthInput = spinbuttons.nth(spinOffset);
        yearInput = spinbuttons.nth(spinOffset + 1);
    }

    if (await monthInput.count() === 0) {
        const allMonthInputs = page.locator('[data-automation-id="dateSectionMonth-input"]');
        const allYearInputs = page.locator('[data-automation-id="dateSectionYear-input"]');
        const offset = index * 2 + (kind === "start" ? 0 : 1);
        if (await allMonthInputs.count() > offset) {
            monthInput = allMonthInputs.nth(offset);
            yearInput = allYearInputs.nth(offset);
        }
    }

    return { monthInput, yearInput, workId };
}

async function verifyWorkExperienceRowDates(page, index, kind, month, year) {
    const formatted = formatWorkdayMonthYear(month, year);
    if (!formatted) {
        return true;
    }

    const { monthInput, yearInput } = await resolveWorkExperienceDatePair(page, index, kind);
    if (await monthInput.count() === 0) {
        return false;
    }

    const startMonth = String(await getWorkdayFieldValue(monthInput).catch(() => "")).trim();
    const startYear = await yearInput.count() > 0
        ? String(await getWorkdayFieldValue(yearInput).catch(() => "")).trim()
        : "";
    const composite = startYear ? `${startMonth}/${startYear}` : startMonth;
    return workDateFormattedMatches(formatted, composite);
}

async function fillWorkExperienceRowDates(page, index, kind, month, year, emit) {
    const formatted = formatWorkdayMonthYear(month, year);
    if (!formatted) {
        return false;
    }

    if (await verifyWorkExperienceRowDates(page, index, kind, month, year)) {
        emit?.("workday_date_skipped", { experienceIndex: index, dateKind: kind, value: formatted, reason: "already_set" });
        return true;
    }

    if (await fillWorkdayDateSpinbuttonsDirect(page, index, kind, month, year, emit)) {
        return verifyWorkExperienceRowDates(page, index, kind, month, year);
    }

    return false;
}

async function resolveWorkdayTextInput(field) {
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
    const type = (await field.getAttribute("type") || "").toLowerCase();

    if ((tagName === "input" && type !== "hidden") || tagName === "textarea") {
        return field;
    }

    const inner = field.locator('input:not([type="hidden"]):not([tabindex="-1"]), textarea').first();
    if (await inner.count() > 0) {
        return inner;
    }

    const container = field.locator('xpath=ancestor::*[contains(@data-automation-id,"formField")][1]');
    const containerInput = container.locator('input:not([type="hidden"]):not([tabindex="-1"]), textarea').first();
    if (await containerInput.count() > 0) {
        return containerInput;
    }

    return resolveWorkdayFormField(field);
}

function stateSelectionLooksValid(value = "", expected = "Haryana") {
    const normalized = String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized || /^(please )?select one|required|search$/i.test(normalized)) {
        return false;
    }

    const expectedLower = String(expected || "").trim().toLowerCase();
    return normalized.includes(expectedLower) || expectedLower.includes(normalized);
}

async function readWorkdayStateValue(field) {
    return String(await getWorkdayFieldValue(field).catch(() => "")).trim();
}

async function selectWorkdayStateFromVisibleList(page, field, state) {
    const queries = [...new Set([state, "Haryana", "Haryana, India"].filter(Boolean))];
    const listboxes = page.locator('[role="listbox"]');
    const listboxCount = await listboxes.count();

    for (let listIndex = listboxCount - 1; listIndex >= 0; listIndex -= 1) {
        const listbox = listboxes.nth(listIndex);
        if (!await listbox.isVisible().catch(() => false)) {
            continue;
        }

        const options = listbox.locator(
            '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"], [data-automation-id="promptLeafNode"]'
        );
        const optionCount = await options.count();

        for (const query of queries) {
            for (let index = 0; index < optionCount; index += 1) {
                const option = options.nth(index);
                if (!await option.isVisible().catch(() => false)) {
                    continue;
                }

                const text = String(await option.innerText().catch(() => "")).trim();
                if (!text || !optionMatches(text, query)) {
                    continue;
                }

                await option.click({ force: true });
                await page.waitForTimeout(PAUSE_SHORT);
                const after = await readWorkdayStateValue(field);
                if (stateSelectionLooksValid(after, state)) {
                    return after;
                }
            }
        }
    }

    return "";
}

async function selectWorkdayStateField(page, field, state, emit) {
    const queries = [...new Set([state, "Haryana", "Haryana, India"].filter(Boolean))];
    await scrollWorkdayFieldIntoView(field);
    await closeWorkdayPopups(page);

    const current = await readWorkdayStateValue(field);
    if (stateSelectionLooksValid(current, state)) {
        return current;
    }

    await field.click({ force: true }).catch(() => {});
    await page.waitForTimeout(PAUSE_MED);

    let selected = await selectWorkdayStateFromVisibleList(page, field, state);
    if (selected) {
        if (emit) {
            emit("field_filled", { field: "State", value: selected, method: "listbox_click" });
        }
        return selected;
    }

    const editable = await resolveWorkdayFormField(field);
    for (const query of queries) {
        await editable.click({ force: true }).catch(() => {});
        await editable.fill("").catch(() => {});
        await page.waitForTimeout(PAUSE_TINY);
        await editable.fill(query).catch(() => {});
        await page.waitForTimeout(PAUSE_MED);

        selected = await selectWorkdayStateFromVisibleList(page, field, state);
        if (selected) {
            if (emit) {
                emit("field_filled", { field: "State", value: selected, method: "typed_listbox_click" });
            }
            return selected;
        }

        await page.keyboard.press("ArrowDown").catch(() => {});
        await page.waitForTimeout(PAUSE_SHORT);
        await page.keyboard.press("Enter").catch(() => {});
        await page.waitForTimeout(PAUSE_MED);

        const afterEnter = await readWorkdayStateValue(field);
        if (stateSelectionLooksValid(afterEnter, state)) {
            if (emit) {
                emit("field_filled", { field: "State", value: afterEnter, method: "type_enter" });
            }
            return afterEnter;
        }
    }

    for (const query of queries) {
        try {
            const listboxValue = await selectWorkdayListboxOption(page, field, query);
            const after = await readWorkdayStateValue(field);
            if (stateSelectionLooksValid(after, state)) {
                if (emit) {
                    emit("field_filled", { field: "State", value: after || listboxValue, method: "listbox" });
                }
                return after || listboxValue;
            }
        } catch {
            // try next query
        }
    }

    throw new Error(`No Workday state option matching "${state}"`);
}

async function findWorkdayStateField(page) {
    const scopedCandidates = [
        page.getByRole("combobox", { name: /^State\b/i }).first(),
        page.locator('[data-automation-id="formField-addressRegion"] button, [data-automation-id*="addressRegion"] [role="combobox"]').first(),
        page.locator('[data-automation-id*="formField"]').filter({ hasText: /^State\b/i })
            .locator('button[aria-haspopup="listbox"], [role="combobox"]')
            .first(),
        page.locator('button[aria-haspopup="listbox"], [role="combobox"]')
            .filter({ hasText: /^Select One$/i })
            .nth(1)
    ];

    for (const candidate of scopedCandidates) {
        if (await candidate.count() > 0 && await candidate.isVisible().catch(() => false)) {
            return candidate;
        }
    }

    return null;
}

async function ensureVisaPriorEmploymentRadio(page, profile, emit) {
    const priorAnswer = profile.previousEmployee || "No";
    const section = page.locator("[data-automation-id*='formField'], section, fieldset")
        .filter({ hasText: /ever worked for Visa Inc/i })
        .first();

    if (await section.count() === 0) {
        return 0;
    }

    await section.scrollIntoViewIfNeeded().catch(() => {});
    const wantsNo = /^no\b/i.test(priorAnswer);
    const target = wantsNo
        ? section.getByRole("radio", { name: /^no\b/i }).first()
        : section.getByRole("radio", { name: /^yes\b/i }).first();

    if (await target.count() === 0) {
        emit("field_missing", { field: "Visa prior employment", reason: "radio_not_found" });
        return 0;
    }

    if (await target.isChecked().catch(() => false)) {
        emit("field_skipped", { field: "Visa prior employment", reason: "already_set", value: priorAnswer });
        return 0;
    }

    await target.click({ force: true });
    await page.waitForTimeout(PAUSE_SHORT);
    if (await target.isChecked().catch(() => false)) {
        emit("field_filled", { field: "Visa prior employment", value: priorAnswer, method: "radio_gap_fill" });
        return 1;
    }

    emit("field_failed", { field: "Visa prior employment", message: "Radio click did not stick" });
    return 0;
}

async function gapFillPassThroughMyInformation(page, profile, emit, sessionFlags = {}) {
    let filled = 0;

    filled += await ensureVisaPriorEmploymentRadio(page, profile, emit);

    const state = profile.state;
    if (state) {
        for (const key of [...sessionFlags.filledFields]) {
            if (/\bstate\b/i.test(key)) {
                sessionFlags.filledFields.delete(key);
            }
        }

        const stateField = await findWorkdayStateField(page);
        if (!stateField) {
            emit("field_missing", { field: "State", reason: "state_dropdown_not_found" });
        } else {
            const current = await readWorkdayStateValue(stateField);
            if (stateSelectionLooksValid(current, state)) {
                emit("field_skipped", { field: "State", reason: "already_set", value: current });
            } else {
                try {
                    await selectWorkdayStateField(page, stateField, state, emit);
                    filled += 1;
                } catch (error) {
                    emit("field_failed", { field: "State", message: error.message });
                }
            }
        }
    }

    return filled;
}

async function selectWorkdayListboxOption(page, dropdown, answer) {
    await scrollWorkdayFieldIntoView(dropdown);
    await closeWorkdayPopups(page);
    await dropdown.click({ force: true });
    await page.waitForTimeout(PAUSE_SHORT);

    const optionLocators = [
        page.locator('[data-automation-id="menuItem"]'),
        page.locator('[data-automation-id="promptOption"]'),
        page.getByRole("option")
    ];

    for (const locator of optionLocators) {
        const count = await locator.count();
        for (let index = 0; index < count; index += 1) {
            const option = locator.nth(index);
            if (!await option.isVisible().catch(() => false)) {
                continue;
            }

            const text = (await option.innerText().catch(() => "")).trim();
            if (!text || /select one/i.test(text)) {
                continue;
            }

            if (optionMatches(text, answer)) {
                await option.click({ force: true });
                await page.waitForTimeout(PAUSE_SHORT);
                await closeWorkdayPopups(page);
                return text;
            }
        }
    }

    throw new Error(`No Workday dropdown option matching "${answer}"`);
}

async function findWorkExperienceAddAnotherButton(page) {
    const workSection = page.locator("div, section, fieldset").filter({ hasText: /Work Experience 1\b/i }).first();
    const inSection = workSection.getByRole("button", { name: /add another/i }).first();
    if (await inSection.count() > 0 && await inSection.isVisible().catch(() => false)) {
        return inSection;
    }

    const buttons = page.getByRole("button", { name: /add another/i });
    const count = await buttons.count();
    for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        const nearWork = await button.evaluate((element) => {
            let node = element.parentElement;
            for (let depth = 0; depth < 12 && node; depth += 1) {
                if (/Work Experience/i.test(node.textContent || "")) {
                    return true;
                }
                node = node.parentElement;
            }
            return false;
        }).catch(() => false);
        if (nearWork && await button.isVisible().catch(() => false)) {
            return button;
        }
    }

    return buttons.first();
}

async function clickWorkExperienceAddButton(page, experienceBlock, emit, index) {
    const addAnother = await findWorkExperienceAddAnotherButton(page);
    const addButton = experienceBlock.getByRole("button", { name: /^add$/i }).first();
    const target = await addAnother.count() > 0 && await addAnother.isVisible().catch(() => false)
        ? addAnother
        : addButton;

    if (await target.count() > 0 && await target.isVisible().catch(() => false)) {
        await experienceBlock.scrollIntoViewIfNeeded().catch(() => {});
        await target.click();
        emit("workday_work_experience_row_added", { index, method: "section_button" });
        return true;
    }

    if (await clickWorkdaySectionAddByLabel(page, "Work Experience", emit)) {
        emit("workday_work_experience_row_added", { index, method: "section_label" });
        return true;
    }

    return false;
}

async function ensureWorkExperienceRowCount(page, desiredCount, emit) {
    const experienceBlock = getWorkExperienceBlock(page);
    let count = await getWorkExperienceTitleFields(page).count();
    let attempts = 0;

    if (count === 0) {
        await clickWorkExperienceAddButton(page, experienceBlock, emit, 0);
        await page.waitForTimeout(ROW_ADD_WAIT_MS);
        count = await getWorkExperienceTitleFields(page).count();
    }

    while (count < desiredCount && attempts < 6) {
        attempts += 1;
        await clickWorkExperienceAddButton(page, experienceBlock, emit, count);
        await page.waitForTimeout(ROW_ADD_WAIT_MS);
        const nextCount = await getWorkExperienceTitleFields(page).count();
        if (nextCount <= count) {
            emit("workday_work_experience_row_stalled", { count, desiredCount, attempts });
            break;
        }

        count = nextCount;
    }

    emit("workday_experience_fields_found", { titleCount: count });
    await trimWorkExperienceRows(page, desiredCount, emit);
}

async function ensureWorkExperienceRowAvailable(page, index, emit) {
    const experienceBlock = getWorkExperienceBlock(page);
    let count = await getWorkExperienceTitleFields(page).count();

    if (count === 0) {
        await clickWorkExperienceAddButton(page, experienceBlock, emit, 0);
        await page.waitForTimeout(ROW_ADD_WAIT_MS);
        count = await getWorkExperienceTitleFields(page).count();
    }

    let attempts = 0;
    while (count <= index && attempts < 6) {
        attempts += 1;
        const addAnother = await findWorkExperienceAddAnotherButton(page);
        const addButton = experienceBlock.getByRole("button", { name: /^add$/i }).last();
        const target = await addAnother.count() > 0 && await addAnother.isVisible().catch(() => false)
            ? addAnother
            : addButton;

        if (await target.count() === 0 || !await target.isVisible().catch(() => false)) {
            emit("workday_work_experience_add_missing", { index, count, attempts });
            break;
        }

        await experienceBlock.scrollIntoViewIfNeeded().catch(() => {});
        await target.scrollIntoViewIfNeeded().catch(() => {});
        await target.click({ force: true });
        emit("workday_work_experience_add_another_clicked", { index, countBefore: count });
        await page.waitForTimeout(ROW_ADD_WAIT_MS);

        await getWorkExperienceTitleFields(page).nth(index).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
        const nextCount = await getWorkExperienceTitleFields(page).count();
        if (nextCount <= count) {
            emit("workday_work_experience_row_stalled", { index, count, nextCount, attempts });
            break;
        }

        count = nextCount;
    }

    emit("workday_experience_row_ready", { index, titleCount: count });
    return count > index;
}

function monthToNumber(month) {
    const normalized = normalizeMonthToken(month).slice(0, 3);
    return MONTH_ABBREV_TO_NUMBER[normalized] || String(month).replace(/\D/g, "").padStart(2, "0");
}

async function spinbuttonValueMatches(input, expected) {
    const actual = String(await getWorkdayFieldValue(input).catch(() => "")).trim();
    const nextValue = String(expected).trim();
    return actual === nextValue
        || actual.replace(/^0+/, "") === nextValue.replace(/^0+/, "")
        || (nextValue.length === 2 && actual.padStart(2, "0") === nextValue);
}

async function fillSpinbuttonValue(input, value, page) {
    if (await input.count() === 0) {
        return false;
    }

    await scrollWorkdayFieldIntoView(input);
    const nextValue = String(value);
    await closeWorkdayPopups(page);

    if (await spinbuttonValueMatches(input, nextValue)) {
        return true;
    }

    const setNativeValue = async () => {
        await input.evaluate((element, val) => {
            element.scrollIntoView({ block: "center", inline: "nearest" });
            element.focus();
            const proto = window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (setter) {
                setter.call(element, val);
            } else {
                element.value = val;
            }
            element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: val }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            element.dispatchEvent(new Event("blur", { bubbles: true }));
        }, nextValue).catch(() => {});
        await page.waitForTimeout(PAUSE_TINY);
        return spinbuttonValueMatches(input, nextValue);
    };

    try {
        await input.fill(nextValue, { timeout: 4000, force: true });
        await page.waitForTimeout(PAUSE_TINY);
        if (await spinbuttonValueMatches(input, nextValue)) {
            return true;
        }
    } catch {
        // Fall back to focus + keyboard for Workday spinbuttons.
    }

    if (await setNativeValue()) {
        return true;
    }

    await input.click({ force: true, timeout: 4000 }).catch(() => {});
    const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
    await page.keyboard.press(selectAll).catch(() => {});
    await page.keyboard.type(nextValue, { delay: 30 });
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(PAUSE_TINY);
    if (await spinbuttonValueMatches(input, nextValue)) {
        return true;
    }

    await page.keyboard.press("Tab").catch(() => {});
    await page.waitForTimeout(PAUSE_SHORT);
    return spinbuttonValueMatches(input, nextValue);
}

function workExperienceDateSpinbuttonSelectors(datePrefix) {
    return {
        month: [
            `[id*="--${datePrefix}-dateSectionMonth-input"]`,
            `[id*="${datePrefix}"][data-automation-id="dateSectionMonth-input"]`,
            `[data-automation-id*="${datePrefix}"] [data-automation-id="dateSectionMonth-input"]`
        ].join(", "),
        year: [
            `[id*="--${datePrefix}-dateSectionYear-input"]`,
            `[id*="${datePrefix}"][data-automation-id="dateSectionYear-input"]`,
            `[data-automation-id*="${datePrefix}"] [data-automation-id="dateSectionYear-input"]`
        ].join(", ")
    };
}

async function listWorkExperienceIds(page) {
    const inputs = page.locator('[id*="workExperience-"][id*="--startDate-dateSectionMonth-input"]');
    const count = await inputs.count();
    const ids = [];

    for (let index = 0; index < count; index += 1) {
        const id = await inputs.nth(index).getAttribute("id");
        const match = String(id || "").match(/workExperience-(\d+)/);
        if (match && !ids.includes(match[1])) {
            ids.push(match[1]);
        }
    }

    return ids;
}

async function resolveWorkExperienceDateSpinbuttons(page, experienceIndex, kind) {
    const datePrefix = kind === "start" ? "startDate" : "endDate";
    const selectors = workExperienceDateSpinbuttonSelectors(datePrefix);
    const workIds = await listWorkExperienceIds(page);
    const workId = workIds[experienceIndex] || null;

    if (workId) {
        const monthInput = page.locator(`[id="workExperience-${workId}--${datePrefix}-dateSectionMonth-input"]`);
        const yearInput = page.locator(`[id="workExperience-${workId}--${datePrefix}-dateSectionYear-input"]`);
        if (await monthInput.count() > 0) {
            return { monthInput, yearInput, workId };
        }
    }

    const row = getWorkExperienceRow(page, experienceIndex);
    if (await row.count() > 0) {
        const monthInput = row.locator(selectors.month).first();
        const yearInput = row.locator(selectors.year).first();
        if (await monthInput.count() > 0) {
            const rowWorkId = await monthInput.evaluate((element) => {
                const match = String(element.id || "").match(/workExperience-(\d+)/);
                return match ? match[1] : null;
            }).catch(() => null);
            return { monthInput, yearInput, workId: rowWorkId };
        }
    }

    const experienceBlock = getWorkExperienceBlock(page);
    const monthInputs = experienceBlock.locator('[data-automation-id="dateSectionMonth-input"]');
    const yearInputs = experienceBlock.locator('[data-automation-id="dateSectionYear-input"]');
    const offset = experienceIndex * 2 + (kind === "start" ? 0 : 1);
    return {
        monthInput: monthInputs.nth(offset),
        yearInput: yearInputs.nth(offset),
        workId
    };
}

async function fillWorkdayDateSpinbuttonsDirect(page, experienceIndex, dateKind, month, year, emit = null) {
    const formatted = formatWorkdayMonthYear(month, year);
    if (!formatted) {
        return false;
    }

    const { monthInput, yearInput, workId } = await resolveWorkExperienceDatePair(page, experienceIndex, dateKind);
    if (await monthInput.count() === 0) {
        emit?.("workday_date_spinbuttons_missing", { experienceIndex, dateKind, workId });
        return false;
    }

    const monthValue = await getWorkdayFieldValue(monthInput).catch(() => "");
    const yearValue = await yearInput.count() > 0
        ? await getWorkdayFieldValue(yearInput).catch(() => "")
        : "";
    const composite = yearValue ? `${monthValue}/${yearValue}` : monthValue;
    if (workDateFormattedMatches(formatted, composite)) {
        emit?.("workday_date_skipped", { experienceIndex, dateKind, value: composite, reason: "already_set" });
        return true;
    }

    const monthNum = String(monthToNumber(month)).padStart(2, "0");
    const yearNum = normalizeYearToken(year);
    emit?.("workday_date_spinbutton_fill", { experienceIndex, dateKind, month: monthNum, year: yearNum, workId });

    const monthOk = await fillSpinbuttonValue(monthInput, monthNum, page);
    const yearOk = await yearInput.count() > 0
        ? await fillSpinbuttonValue(yearInput, yearNum, page)
        : true;

    const afterMonth = String(await getWorkdayFieldValue(monthInput).catch(() => "")).trim();
    const afterYear = await yearInput.count() > 0
        ? String(await getWorkdayFieldValue(yearInput).catch(() => "")).trim()
        : "";
    const ok = monthOk && yearOk && Boolean(afterMonth && afterYear)
        && workDateFormattedMatches(formatted, `${afterMonth}/${afterYear}`);
    if (ok) {
        emit?.("workday_date_fill_success", {
            experienceIndex,
            dateKind,
            value: `${afterMonth}/${afterYear}`,
            method: "direct_spinbutton"
        });
    } else {
        emit?.("workday_date_fill_failed", {
            experienceIndex,
            dateKind,
            expected: formatted,
            actual: `${afterMonth}/${afterYear}`,
            method: "direct_spinbutton"
        });
    }
    return ok;
}

async function resolveWorkdayFormField(field) {
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
    const role = (await field.getAttribute("role") || "").toLowerCase();
    const type = (await field.getAttribute("type") || "").toLowerCase();

    if (tagName === "input" || tagName === "textarea" || tagName === "select"
        || role === "combobox" || role === "textbox" || type === "checkbox" || type === "radio") {
        return field;
    }

    const inner = field.locator(
        "input:not([type='hidden']):not([tabindex='-1']), textarea, select, button[aria-haspopup], [role='combobox'], [contenteditable='true']"
    ).first();

    if (await inner.count() > 0) {
        return inner;
    }

    return field;
}

async function scrollWorkdayFieldIntoView(field) {
    await field.evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "nearest" });
    }).catch(() => {});
    await field.scrollIntoViewIfNeeded().catch(() => {});
}

function resolveWorkdayQuestionLabel(rawLabel, sectionHint = "") {
    const { normalizeQuestion } = require("./answer-engine");
    let label = normalizeQuestion(rawLabel);
    const isGeneric = !label
        || label.length < 8
        || /^(please )?select one(\s+required)?$/i.test(label)
        || /^search$/i.test(label)
        || /^mm$|^yyyy$/i.test(label);

    if (!isGeneric) {
        return label;
    }

    const lines = String(sectionHint)
        .split("\n")
        .map((line) => line.replace(/\*/g, "").trim())
        .filter((line) => line
            && !/^(please )?select one/i.test(line)
            && !/^required$/i.test(line)
            && !/^mm\/yyyy$/i.test(line));

    const question = lines.find((line) => line.includes("?"))
        || lines.find((line) => line.length >= 12)
        || lines[0];

    if (question && question.length > label.length) {
        return normalizeQuestion(question);
    }

    return label;
}

async function getWorkdayFieldLabel(field) {
    const automationId = await field.getAttribute("data-automation-id");
    const ariaLabel = await field.getAttribute("aria-label");
    const labelledBy = await field.getAttribute("aria-labelledby");
    const type = (await field.getAttribute("type") || "").toLowerCase();

    if (type === "radio") {
        const radioGroupLabel = await field.evaluate((element) => {
            const container = element.closest("[data-automation-id*='formField'], fieldset, [role='radiogroup']");
            const labelNode = container?.querySelector("[data-automation-id='formFieldLabel'], legend");
            return labelNode?.textContent?.trim() || null;
        });

        if (radioGroupLabel) {
            return radioGroupLabel.replace(/\*+$/, "").trim();
        }
    }

    if (automationId && labelFromAutomationId(automationId)) {
        return labelFromAutomationId(automationId);
    }

    if (ariaLabel) {
        return ariaLabel.replace(/\*+$/, "").trim();
    }

    if (labelledBy) {
        const labelText = await field.page().locator(`#${labelledBy.split(" ")[0]}`).innerText().catch(() => "");
        if (labelText) {
            return labelText.replace(/\*+$/, "").trim();
        }
    }

    const id = await field.getAttribute("id");
    if (id) {
        const label = field.page().locator(`label[for="${id}"]`).first();
        if (await label.count() > 0) {
            return (await label.innerText()).replace(/\*+$/, "").trim();
        }
    }

    const containerLabel = await field.evaluate((element) => {
        const container = element.closest("[data-automation-id*='formField']");
        const labelNode = container?.querySelector("[data-automation-id='formFieldLabel'], label, legend");
        return labelNode?.textContent?.trim() || null;
    });

    if (containerLabel) {
        return containerLabel.replace(/\*+$/, "").trim();
    }

    const radioGroupLabel = await field.evaluate((element) => {
        const type = (element.getAttribute("type") || "").toLowerCase();
        if (type !== "radio") {
            return null;
        }

        const container = element.closest("[data-automation-id*='formField'], fieldset, [role='radiogroup']");
        const labelNode = container?.querySelector("[data-automation-id='formFieldLabel'], legend");
        return labelNode?.textContent?.trim() || null;
    });

    if (radioGroupLabel) {
        return radioGroupLabel.replace(/\*+$/, "").trim();
    }

    return labelFromAutomationId(automationId);
}

async function submitWorkdayAuthForm(page) {
    const clickFilter = page.locator('[data-automation-id="click_filter"][aria-label="Submit"]').first();
    if (await clickFilter.isVisible().catch(() => false)) {
        await clickFilter.click();
        return "click_filter";
    }

    const signInSubmit = page.locator('[data-automation-id="signInSubmitButton"]');
    if (await signInSubmit.count() > 0) {
        await signInSubmit.click({ force: true });
        return "sign_in_submit";
    }

    const createSubmit = page.locator('[data-automation-id="createAccountSubmitButton"]');
    if (await createSubmit.count() > 0) {
        await createSubmit.click({ force: true });
        return "create_account_submit";
    }

    return null;
}

function isWorkdayAccountExistsError(message) {
    return /email address is already in use|already registered/i.test(String(message || ""));
}

async function readWorkdayAuthError(page) {
    const text = await page.locator("body").innerText().catch(() => "");
    const patterns = [
        /Error:\s*[^\n]+(?:\n\t\s+-\s+[^\n]+)*/i,
        /You may have entered the wrong email address or password[^\n]*/i,
        /account might be locked[^\n]*/i,
        /email address is already in use[^\n]*/i,
        /already registered[^\n]*/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return match[0].trim();
        }
    }

    return null;
}

async function ensureEmailAuthEntry(page, emit) {
    await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(PAUSE_SHORT);

    const emailField = page.locator('[data-automation-id="email"]');
    if (await emailField.isVisible().catch(() => false)) {
        return true;
    }

    const emailSignIn = page.getByRole("button", { name: /sign in with email/i });
    await emailSignIn.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
    if (await emailSignIn.isVisible().catch(() => false)) {
        await emailSignIn.click();
        await page.waitForTimeout(PAUSE_MED);
        emit("workday_sign_in_with_email_opened", {});
    }

    await emailField.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
    return await emailField.isVisible().catch(() => false);
}

async function isSignInOnlyForm(page) {
    const emailVisible = await page.locator('[data-automation-id="email"]').isVisible().catch(() => false);
    const verifyPassword = await page.locator('[data-automation-id="verifyPassword"]').isVisible().catch(() => false);
    const signInSubmit = await page.locator('[data-automation-id="signInSubmitButton"]').isVisible().catch(() => false);
    return emailVisible && !verifyPassword && signInSubmit;
}

async function ensureCreateAccountForm(page, emit) {
    const verifyPassword = page.locator('[data-automation-id="verifyPassword"]');
    if (await verifyPassword.isVisible().catch(() => false)) {
        return true;
    }

    if (await isSignInOnlyForm(page)) {
        emit("workday_on_sign_in_form_switching_to_create", {});
    }

    const createAccountEntry = page.locator('[data-automation-id="createAccountLink"]');
    await createAccountEntry.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    if (await createAccountEntry.isVisible().catch(() => false)) {
        await createAccountEntry.click();
        await page.waitForTimeout(PAUSE_MED);
        emit("workday_create_account_form_opened", { method: "createAccountLink" });
        return await verifyPassword.isVisible().catch(() => false);
    }

    const createAccountButton = page.locator('button[data-automation-id="createAccountSubmitButton"] ~ button, [data-automation-id="signInLink"]')
        .filter({ hasText: /^Create Account$/ });
    if (await createAccountButton.count() > 0) {
        await createAccountButton.first().click();
        await page.waitForTimeout(PAUSE_MED);
        emit("workday_create_account_form_opened", { method: "create_account_button" });
        return await verifyPassword.isVisible().catch(() => false);
    }

    const createAccountText = page.getByText("Create Account", { exact: true });
    const count = await createAccountText.count();
    for (let index = 0; index < count; index += 1) {
        const candidate = createAccountText.nth(index);
        const automationId = await candidate.getAttribute("data-automation-id");
        if (automationId === "createAccountSubmitButton") {
            continue;
        }
        if (await candidate.isVisible().catch(() => false)) {
            await candidate.click();
            await page.waitForTimeout(PAUSE_MED);
            emit("workday_create_account_form_opened", { method: "create_account_text" });
            return await verifyPassword.isVisible().catch(() => false);
        }
    }

    return false;
}

async function ensureSignInForm(page, emit) {
    const signInLink = page.locator('[data-automation-id="signInLink"]');
    const verifyPassword = page.locator('[data-automation-id="verifyPassword"]');
    const emailField = page.locator('[data-automation-id="email"]');

    if (await emailField.isVisible().catch(() => false) && !await verifyPassword.isVisible().catch(() => false)) {
        return true;
    }

    if (await signInLink.isVisible().catch(() => false)) {
        await signInLink.click();
        await page.waitForTimeout(PAUSE_MED);
        emit("workday_sign_in_form_opened", {});
    }

    if (!await emailField.isVisible().catch(() => false)) {
        await ensureEmailAuthEntry(page, emit);
        if (await signInLink.isVisible().catch(() => false)) {
            await signInLink.click();
            await page.waitForTimeout(PAUSE_MED);
            emit("workday_sign_in_form_opened", { method: "retry" });
        }
    }

    return await emailField.isVisible().catch(() => false)
        && !await verifyPassword.isVisible().catch(() => false);
}

async function isWorkdayLoginRedirect(page) {
    return /\/login\b/i.test(page.url());
}

async function completeWorkdayAuth(page, profile, emit, options = {}) {
    const password = options.workdayPassword || profile.workdayPassword;
    const mode = options.workdayAuthMode || profile.workdayAuthMode || "sign_in";
    if (!password || !profile.email) {
        return false;
    }

    if (mode === "sign_in") {
        if (!await ensureEmailAuthEntry(page, emit)) {
            emit("workday_email_auth_entry_missing", {});
            return false;
        }
        if (!await ensureSignInForm(page, emit)) {
            emit("workday_sign_in_form_missing", {});
            return false;
        }
    } else {
        if (!await ensureEmailAuthEntry(page, emit)) {
            emit("workday_email_auth_entry_missing", {});
            return false;
        }
        const onCreateForm = await ensureCreateAccountForm(page, emit);
        if (!onCreateForm) {
            emit("workday_create_account_form_missing", {});
            return false;
        }
    }

    const emailField = page.locator('[data-automation-id="email"]');
    if (!await emailField.isVisible().catch(() => false)) {
        emit("workday_auth_form_missing", { mode });
        return false;
    }

    const verifyPassword = page.locator('[data-automation-id="verifyPassword"]');

    await emailField.fill(profile.email);
    emit("workday_auth_email_filled", {});

    const passwordField = page.locator('[data-automation-id="password"]');
    if (await passwordField.isVisible().catch(() => false)) {
        await passwordField.fill(password);
        emit("workday_auth_password_filled", {});
    }

    if (await verifyPassword.isVisible().catch(() => false)) {
        await verifyPassword.fill(password);
        const terms = page.locator('[data-automation-id="createAccountCheckbox"]');
        if (await terms.isVisible().catch(() => false)) {
            await terms.check();
        }
        emit("workday_create_account_form_ready", {});
    }

    const submitMethod = await submitWorkdayAuthForm(page);
    if (!submitMethod) {
        emit("workday_auth_submit_missing", {});
        return false;
    }

    emit("workday_auth_submitted", { method: submitMethod });
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(PAUSE_MED);

    const authError = await readWorkdayAuthError(page);
    if (authError) {
        emit("workday_auth_error", { message: authError });
        return false;
    }

    if (await isWorkdayLoginRedirect(page)) {
        emit("workday_login_redirect_detected", { url: page.url() });
        return "redirect";
    }

    return true;
}

async function fillStructuredWorkdayField(page, field, value, label, emit, extra = {}) {
    if (!value || await field.count() === 0 || !await field.isVisible().catch(() => false)) {
        return 0;
    }

    const sessionFlags = extra.sessionFlags || {};
    const automationId = await field.getAttribute("data-automation-id").catch(() => "");
    const fieldKey = workdayFieldKey(automationId, label, extra.index);
    if (isWorkdayFieldHandled(sessionFlags, fieldKey)) {
        emit("field_skipped", { field: label, reason: "session_locked", ...extra });
        return 0;
    }

    if (await shouldSkipWorkdayFill(field, value, label)) {
        markWorkdayFieldHandled(sessionFlags, fieldKey);
        emit("field_skipped", { field: label, reason: "already_set", ...extra });
        return 0;
    }

    const didFill = await fillWorkdayField(field, value, page, {
        hint: label,
        force: true,
        sessionFlags,
        fieldKey
    });
    if (didFill) {
        emit("field_filled", { field: label, ...extra });
        return 1;
    }

    const current = String(await getWorkdayFieldValue(field).catch(() => "")).trim();
    if (current && workdayValuesMatch(value, current, label)) {
        markWorkdayFieldHandled(sessionFlags, fieldKey);
        emit("field_skipped", { field: label, reason: "already_set", ...extra });
    }
    return 0;
}

async function sectionHasPopulatedValue(root, selectors = []) {
    const scope = typeof root.locator === "function" ? root : root;
    for (const selector of selectors) {
        const fields = scope.locator(selector);
        const count = await fields.count();

        for (let index = 0; index < count; index += 1) {
            const field = fields.nth(index);
            if (!await field.isVisible().catch(() => false)) {
                continue;
            }

            const value = String(await getWorkdayFieldValue(field).catch(() => "")).trim();
            if (value && !/^(mm|yyyy|dd|select|search)$/i.test(value)) {
                return true;
            }
        }
    }

    return false;
}

async function clickWorkdaySectionAddByLabel(page, label, emit) {
    const automationIds = {
        "Work Experience": "workExperienceSection",
        Education: "educationSection",
        Resume: "resumeSection",
        Skills: "skillsSection"
    };

    const automationId = automationIds[label];
    if (automationId) {
        const scopedAdd = page.locator(`[data-automation-id="${automationId}"]`)
            .getByRole("button", { name: /^add$/i })
            .first();
        if (await scopedAdd.count() > 0 && await scopedAdd.isVisible().catch(() => false)) {
            await scopedAdd.scrollIntoViewIfNeeded().catch(() => {});
            await scopedAdd.click();
            await page.waitForTimeout(ROW_ADD_WAIT_MS);
            emit("workday_section_row_added", { section: label, method: "automation_id" });
            return true;
        }
    }

    const clicked = await page.evaluate((sectionLabel) => {
        const headings = [...document.querySelectorAll("h1,h2,h3,h4,legend,label,div,span,button")]
            .filter((element) => element.offsetParent !== null
                && new RegExp(`^${sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(element.textContent.trim()));

        for (const heading of headings) {
            let node = heading;
            for (let depth = 0; depth < 10; depth += 1) {
                node = node.parentElement;
                if (!node) {
                    break;
                }

                const addButton = [...node.querySelectorAll("button")]
                    .find((button) => /^add$/i.test(button.textContent.trim()) && button.offsetParent !== null);

                if (addButton) {
                    addButton.click();
                    return true;
                }
            }
        }

        return false;
    }, label).catch(() => false);

    if (clicked) {
        await page.waitForTimeout(ROW_ADD_WAIT_MS);
        emit("workday_section_row_added", { section: label, method: "dom_walk" });
        return true;
    }

    return false;
}

async function clickWorkdaySectionAdd(section, page, emit, label) {
    if (await clickWorkdaySectionAddByLabel(page, label, emit)) {
        return true;
    }

    const addButton = section.getByRole("button", { name: /^add$/i }).first();
    if (await addButton.count() === 0 || !await addButton.isVisible().catch(() => false)) {
        return false;
    }

    await section.scrollIntoViewIfNeeded().catch(() => {});
    await addButton.click();
    await page.waitForTimeout(ROW_ADD_WAIT_MS);
    emit("workday_section_row_added", { section: label, method: "locator" });
    return true;
}

async function ensureWorkdaySectionRow(page, section, emit, label, populatedSelectors = []) {
    if (populatedSelectors.length > 0 && await sectionHasPopulatedValue(section, populatedSelectors)) {
        return;
    }

    await clickWorkdaySectionAdd(section, page, emit, label);
}

function sortWorkHistoryChronologically(history = []) {
    return [...history].sort((left, right) => {
        const leftYear = Number(normalizeYearToken(left.startYear)) || 0;
        const rightYear = Number(normalizeYearToken(right.startYear)) || 0;
        if (leftYear !== rightYear) {
            return leftYear - rightYear;
        }

        const leftMonth = Number(MONTH_ABBREV_TO_NUMBER[normalizeMonthToken(left.startMonth).slice(0, 3)] || 0);
        const rightMonth = Number(MONTH_ABBREV_TO_NUMBER[normalizeMonthToken(right.startMonth).slice(0, 3)] || 0);
        return leftMonth - rightMonth;
    });
}

async function trimWorkExperienceRows(page, desiredCount, emit) {
    const experienceBlock = getWorkExperienceBlock(page);
    let count = await getWorkExperienceTitleFields(page).count();

    while (count > desiredCount) {
        const deleteButton = experienceBlock.getByRole("button", { name: /^delete$/i }).last();
        if (await deleteButton.count() === 0 || !await deleteButton.isVisible().catch(() => false)) {
            break;
        }

        await deleteButton.scrollIntoViewIfNeeded().catch(() => {});
        await deleteButton.click({ force: true });
        await page.waitForTimeout(ROW_ADD_WAIT_MS);
        count -= 1;
        emit("workday_work_experience_row_removed", { remaining: count });
    }
}

async function deleteWorkExperienceRowAt(page, index, emit) {
    const row = await resolveWorkExperienceRow(page, index);
    const deleteButton = row.getByRole("button", { name: /^delete$/i }).first();
    if (await deleteButton.count() === 0 || !await deleteButton.isVisible().catch(() => false)) {
        return false;
    }

    await deleteButton.scrollIntoViewIfNeeded().catch(() => {});
    await deleteButton.click({ force: true });
    await page.waitForTimeout(ROW_ADD_WAIT_MS);
    emit("workday_work_experience_row_deleted", { index });
    return true;
}

async function readWorkExperienceRowSnapshot(page, index) {
    const titleField = getWorkExperienceTitleFields(page).nth(index);
    const companyField = getWorkExperienceCompanyFields(page).nth(index);
    const title = await titleField.count() > 0
        ? String(await getWorkdayFieldValue(await resolveWorkdayTextInput(titleField)).catch(() => "")).trim()
        : "";
    const company = await companyField.count() > 0
        ? String(await getWorkdayFieldValue(await resolveWorkdayTextInput(companyField)).catch(() => "")).trim()
        : "";
    const startPair = await resolveWorkExperienceDatePair(page, index, "start");
    const endPair = await resolveWorkExperienceDatePair(page, index, "end");
    const startMonth = await startPair.monthInput.count() > 0
        ? String(await getWorkdayFieldValue(startPair.monthInput).catch(() => "")).trim()
        : "";
    const startYear = await startPair.yearInput.count() > 0
        ? String(await getWorkdayFieldValue(startPair.yearInput).catch(() => "")).trim()
        : "";
    const endMonth = await endPair.monthInput.count() > 0
        ? String(await getWorkdayFieldValue(endPair.monthInput).catch(() => "")).trim()
        : "";
    const endYear = await endPair.yearInput.count() > 0
        ? String(await getWorkdayFieldValue(endPair.yearInput).catch(() => "")).trim()
        : "";

    return {
        index,
        title,
        company,
        start: startYear ? `${startMonth}/${startYear}` : startMonth,
        end: endYear ? `${endMonth}/${endYear}` : endMonth,
        workId: startPair.workId || null
    };
}

function fieldOfStudySearchQueries(profile = {}) {
    const queries = [];
    const preferred = String(profile.fieldOfStudySearch || "").trim();
    const full = String(profile.fieldOfStudy || "").trim();

    if (preferred) {
        queries.push(preferred);
    }
    if (/computer science/i.test(full)) {
        queries.push("Computer Science");
    }
    if (/engineering/i.test(full)) {
        queries.push("Computer Science and Engineering");
    }
    if (full) {
        queries.push(full);
    }

    return [...new Set(queries.filter(Boolean))];
}

function schoolSearchQueries(profile = {}) {
    const queries = [];
    const university = String(profile.university || "").trim();
    if (/motilal|mnnit|nehru|allahabad/i.test(university)) {
        queries.push("motilal nehru national");
        queries.push("Motilal Nehru National Institute of Technology");
        queries.push("MNNIT");
    }
    if (university) {
        queries.push(university);
    }
    return [...new Set(queries.filter(Boolean))];
}

function schoolSelectionLooksValid(value = "") {
    return /motilal|mnnit|nehru|allahabad|national institute/i.test(String(value));
}

async function selectWorkdaySchoolField(page, field, emit, educationSection) {
    const query = "motilal nehru national";
    await scrollWorkdayFieldIntoView(field);
    await closeWorkdayPopups(page);
    await field.click({ force: true }).catch(() => {});
    await field.fill("");
    await page.waitForTimeout(PAUSE_TINY);
    await field.fill(query);
    await page.waitForTimeout(PAUSE_MED);
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(PAUSE_LONG);
    await page.keyboard.press("Tab").catch(() => {});
    await page.waitForTimeout(PAUSE_SHORT);

    let value = await readWorkdayMultiSelectValue(field);
    if (schoolSelectionLooksValid(value)) {
        emit("field_filled", { field: "School or University", value, method: "type_enter" });
        return true;
    }

    const searchRoot = educationSection && await educationSection.count().catch(() => 0) > 0
        ? educationSection
        : page;
    const option = searchRoot.locator(
        '[data-automation-id="promptLeafNode"], [data-automation-id="menuItem"], [role="option"]'
    ).filter({ hasText: /motilal|mnnit|nehru/i }).first();
    if (await option.count() > 0 && await option.isVisible().catch(() => false)) {
        await option.click({ force: true });
        await page.waitForTimeout(PAUSE_SHORT);
        await page.keyboard.press("Tab").catch(() => {});
        value = await readWorkdayMultiSelectValue(field);
        if (schoolSelectionLooksValid(value)) {
            emit("field_filled", { field: "School or University", value, method: "prompt_click" });
            return true;
        }
    }

    emit("field_failed", { field: "School or University", reason: "school_not_selected", value });
    return false;
}

async function selectWorkdaySearchMultiSelect(page, field, searchText, emit, label = "MultiSelect", scope = null) {
    const query = String(searchText || "").trim();
    if (!query || await field.count() === 0) {
        return false;
    }

    await scrollWorkdayFieldIntoView(field);
    await closeWorkdayPopups(page);
    await field.click().catch(() => {});
    await field.fill(query);
    await page.waitForTimeout(PAUSE_MED);
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(PAUSE_MED);

    if (label === "School or University") {
        const afterEnter = await readWorkdayMultiSelectValue(field);
        if (schoolSelectionLooksValid(afterEnter)) {
            emit("field_filled", { field: label, value: afterEnter, method: "type_enter" });
            return true;
        }
    }

    await waitForWorkdayPromptReady(page);

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const resultSelectors = [
        '[data-automation-id="promptLeafNode"]',
        '[data-automation-id="menuItem"]',
        '[data-automation-id="promptOption"]',
        '[data-automation-id="multiSelectItem"]',
        '[role="option"]'
    ];
    const searchRoot = scope && await scope.count().catch(() => 0) > 0 ? scope : page;

    for (const selector of resultSelectors) {
        const items = searchRoot.locator(selector);
        const count = await items.count();

        for (let index = 0; index < count; index += 1) {
            const item = items.nth(index);
            if (!await item.isVisible().catch(() => false)) {
                continue;
            }

            const text = String(await item.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
            if (!text || /linkedin/i.test(text)) {
                continue;
            }

            const exactMatch = new RegExp(`^${escaped}\\b`, "i").test(text);
            const startsWith = text.toLowerCase().startsWith(query.toLowerCase());
            if (!exactMatch && !startsWith) {
                continue;
            }

            const checkbox = item.locator('input[type="checkbox"]').first();
            if (await checkbox.count() > 0) {
                if (!await checkbox.isChecked().catch(() => false)) {
                    await checkbox.check({ force: true });
                }
            } else {
                await item.click({ force: true });
            }

            await page.waitForTimeout(PAUSE_SHORT);
            await closeWorkdayPopups(page);
            emit("field_filled", { field: label, value: query, method: "search_select" });
            return true;
        }
    }

    try {
        await clickWorkdayPromptLeaf(page, query);
        emit("field_filled", { field: label, value: query, method: "prompt_leaf" });
        return true;
    } catch {
        await page.keyboard.press("Enter").catch(() => {});
        await page.waitForTimeout(PAUSE_TINY);
        return false;
    }
}

async function fillWorkdayEducationDates(educationSection, profile, page, emit) {
    let filled = 0;
    const pairs = [
        {
            label: "Education Start",
            month: profile.educationStartMonth,
            year: profile.educationStartYear,
            index: 0
        },
        {
            label: "Education End",
            month: profile.educationEndMonth,
            year: profile.educationEndYear,
            index: 1
        }
    ];

    const monthInputs = educationSection.locator('[data-automation-id="dateSectionMonth-input"]');
    const yearInputs = educationSection.locator('[data-automation-id="dateSectionYear-input"]');
    const monthCount = await monthInputs.count();
    const yearCount = await yearInputs.count();

    if (monthCount === 0 && yearCount === 0) {
        emit("field_missing", { field: "Education Dates", reason: "education_date_inputs_not_found" });
        return 0;
    }

    for (const pair of pairs) {
        if (!pair.year || pair.index >= yearCount) {
            continue;
        }

        if (!pair.month || pair.index >= monthCount) {
            const yearField = yearInputs.nth(pair.index);
            const yearValue = String(pair.year);
            if (await shouldSkipWorkdayFill(yearField, yearValue, pair.label)) {
                emit("field_skipped", { field: pair.label, reason: "already_set", index: pair.index });
                continue;
            }
            if (await fillSpinbuttonValue(yearField, yearValue, page)) {
                filled += 1;
                emit("field_filled", { field: pair.label, index: pair.index, value: yearValue, method: "year_only" });
            }
            continue;
        }

        const monthField = monthInputs.nth(pair.index);
        const yearField = yearInputs.nth(pair.index);
        const monthValue = String(monthToNumber(pair.month)).padStart(2, "0");
        const yearValue = String(pair.year);

        if (await shouldSkipWorkdayFill(monthField, monthValue, pair.label)
            && await shouldSkipWorkdayFill(yearField, yearValue, pair.label)) {
            emit("field_skipped", { field: pair.label, reason: "already_set", index: pair.index });
            continue;
        }

        await fillSpinbuttonValue(monthField, monthValue, page);
        await monthField.press("Tab").catch(() => page.keyboard.press("Tab"));
        await page.waitForTimeout(PAUSE_TINY);
        if (await yearField.count() > 0) {
            await fillSpinbuttonValue(yearField, yearValue, page);
            await yearField.press("Tab").catch(() => page.keyboard.press("Tab"));
        }

        const afterMonth = String(await getWorkdayFieldValue(monthField).catch(() => "")).trim();
        const afterYear = await yearField.count() > 0
            ? String(await getWorkdayFieldValue(yearField).catch(() => "")).trim()
            : "";
        if (afterMonth && afterYear) {
            filled += 1;
            emit("field_filled", { field: pair.label, index: pair.index, value: `${afterMonth}/${afterYear}` });
        } else {
            emit("field_failed", {
                field: pair.label,
                index: pair.index,
                message: `education date incomplete: ${afterMonth}/${afterYear}`
            });
        }
    }

    return filled;
}

async function fillWorkdayEducation(page, profile, emit, sessionFlags = {}) {
    let filled = 0;
    let educationSection = page.locator('[data-automation-id="educationSection"]').first();
    if (await educationSection.count() === 0) {
        educationSection = page.locator("section, div").filter({ hasText: /^Education\b/i }).first();
    }
    await ensureWorkdaySectionRow(page, educationSection, emit, "Education", [
        '[data-automation-id="formField-schoolName"] input',
        '[data-automation-id*="schoolName"] input',
        'input[aria-label*="School" i]',
        'input[aria-label*="University" i]'
    ]);

    const educationFields = [
        {
            locator: educationSection.locator(
                '[data-automation-id="formField-schoolName"] input, [data-automation-id*="schoolName"] input, input[aria-label*="School" i], input[aria-label*="University" i]'
            ).first(),
            value: profile.university,
            label: "School or University",
            multiSelect: true,
            schoolField: true
        },
        {
            locator: educationSection.locator(
                '[data-automation-id="formField-degree"] button, [data-automation-id*="degree"] button, [data-automation-id*="degree"] [role="combobox"], button[aria-label*="Degree" i]'
            ).first(),
            value: profile.highestDegree || "Bachelor's Degree",
            label: "Degree"
        },
        {
            locator: educationSection.locator(
                '[data-automation-id="formField-fieldOfStudy"] input, [data-automation-id*="fieldOfStudy"] input, input[aria-label*="Field of Study" i]'
            ).first(),
            value: profile.fieldOfStudy,
            label: "Field of Study",
            multiSelect: true
        },
        {
            locator: educationSection.locator(
                '[data-automation-id="formField-gradeAverage"] input, [data-automation-id*="gpa"] input, input[aria-label*="GPA" i], input[aria-label*="Overall Result" i]'
            ).first(),
            value: profile.gpa,
            label: "Overall Result (GPA)"
        }
    ];

    for (const entry of educationFields) {
        if (!entry.value || await entry.locator.count() === 0) {
            continue;
        }

        try {
            const field = await resolveWorkdayFormField(entry.locator);
            if (entry.multiSelect) {
                const current = await readWorkdayMultiSelectValue(field);
                const fieldLooksValid = entry.schoolField
                    ? schoolSelectionLooksValid(current)
                    : entry.label === "Field of Study"
                        ? /computer science/i.test(current)
                        : Boolean(current && !/0 items selected/i.test(current));

                if (!current || /0 items selected/i.test(current) || !fieldLooksValid) {
                    if (entry.schoolField) {
                        if (await selectWorkdaySchoolField(page, field, emit, educationSection)) {
                            filled += 1;
                        }
                        continue;
                    }

                    const queries = entry.label === "Field of Study"
                        ? fieldOfStudySearchQueries(profile)
                        : [entry.value];
                    let selected = false;
                    for (const query of queries) {
                        selected = await selectWorkdaySearchMultiSelect(
                            page,
                            field,
                            query,
                            emit,
                            entry.label,
                            educationSection
                        );
                        if (selected) {
                            break;
                        }
                    }
                    if (selected) {
                        filled += 1;
                        emit("field_filled", { field: entry.label, method: "multi_select" });
                    }
                } else {
                    emit("field_skipped", { field: entry.label, reason: "already_set" });
                    emit("field_filled", { field: entry.label, method: "already_set" });
                }
                continue;
            }

            filled += await fillStructuredWorkdayField(page, field, entry.value, entry.label, emit, { sessionFlags });
        } catch (error) {
            emit("field_failed", { field: entry.label, message: error.message });
        }
    }

    filled += await fillWorkdayEducationDates(educationSection, profile, page, emit);

    if (profile.university) {
        const schoolKey = workdayFieldKey("schoolName", "School or University");
        const schoolLocators = [
            page.getByRole("combobox", { name: /school or university/i }),
            page.locator('[data-automation-id="formField-schoolName"] input').first(),
            educationSection.locator('[data-automation-id*="schoolName"] input').first(),
            educationSection.getByRole("textbox").first()
        ];

        for (const locator of schoolLocators) {
            if (await locator.count() === 0) {
                continue;
            }
            try {
                const schoolField = await resolveWorkdayFormField(locator);
                const schoolValue = await readWorkdayMultiSelectValue(schoolField);
                if (schoolSelectionLooksValid(schoolValue)) {
                    markWorkdayFieldHandled(sessionFlags, schoolKey);
                    emit("field_skipped", { field: "School or University", reason: "already_set" });
                    break;
                }
                if (await selectWorkdaySchoolField(page, schoolField, emit, educationSection)) {
                    filled += 1;
                    markWorkdayFieldHandled(sessionFlags, schoolKey);
                }
                break;
            } catch (error) {
                emit("field_failed", { field: "School or University", message: error.message });
            }
        }
    }

    return filled;
}

function mapWorkdayLanguageProficiency(value = "") {
    const normalized = String(value).trim().toLowerCase();
    if (/native|bilingual/i.test(normalized)) {
        return "Native or bilingual proficiency";
    }
    if (/fluent|full professional/i.test(normalized)) {
        return "Full professional proficiency";
    }
    if (/professional/i.test(normalized)) {
        return "Professional working proficiency";
    }
    if (/intermediate|limited/i.test(normalized)) {
        return "Limited working proficiency";
    }
    return "Full professional proficiency";
}

async function resolveWorkdayCertificationsSection(page) {
    return resolveWorkdayNamedSection(page, "certificationsSection", "Certifications");
}

async function scrollToWorkdayCertifications(page) {
    for (let pass = 0; pass < 3; pass += 1) {
        await page.evaluate((fraction) => {
            window.scrollTo(0, document.body.scrollHeight * fraction);
        }, (pass + 1) / 3).catch(() => {});
        await page.waitForTimeout(PAUSE_TINY);
    }

    const certSection = await resolveWorkdayCertificationsSection(page);
    if (await certSection.count() > 0) {
        await certSection.scrollIntoViewIfNeeded().catch(() => {});
    } else {
        await page.evaluate(() => {
            const node = [...document.querySelectorAll("h3,h4,h5,legend,label,button,div,span")]
                .find((element) => element.offsetParent !== null && /^Certifications\b/i.test(element.textContent.trim()));
            node?.scrollIntoView({ block: "center" });
        }).catch(() => {});
    }
    await page.waitForTimeout(PAUSE_SHORT);
}

async function isWorkdayCertificationSectionPresent(page) {
    await scrollToWorkdayCertifications(page);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/Certifications 1\b/i.test(bodyText) || /Certification\s*\*/i.test(bodyText)) {
        return true;
    }

    if (await page.getByText(/^Certifications 1\b/i).count() > 0) {
        return true;
    }

    const certField = page.getByLabel(/^Certification\b/i).first();
    return await certField.count() > 0;
}

async function confirmWorkdayDeleteDialog(page) {
    const confirmButton = page.getByRole("button", { name: /^(ok|yes|delete|confirm)$/i }).first();
    if (await confirmButton.count() > 0 && await confirmButton.isVisible().catch(() => false)) {
        await confirmButton.click({ force: true }).catch(() => {});
        await page.waitForTimeout(PAUSE_SHORT);
    }
}

async function isDeleteAlignedWithWorkExperienceHeading(page, button) {
    return button.evaluate((element) => {
        const buttonTop = element.getBoundingClientRect().top;
        const headings = [...document.querySelectorAll("h3,h4,h5,legend,label,div,span,button")]
            .filter((node) => {
                const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
                return node.offsetParent !== null && text.length <= 30 && /^Work Experience \d+\b/i.test(text);
            });

        return headings.some((heading) => (
            Math.abs(heading.getBoundingClientRect().top - buttonTop) < 50
        ));
    }).catch(() => false);
}

async function clickWorkdayNamedRowDelete(page, rowHeadingPattern, fieldLabelPattern, emit, contextLabel) {
    if (await page.getByText(fieldLabelPattern).count() === 0) {
        emit("workday_named_row_not_found", { section: contextLabel, reason: "field_label_missing" });
        return false;
    }

    const heading = page.getByText(rowHeadingPattern).first();
    if (await heading.count() === 0 || !await heading.isVisible().catch(() => false)) {
        emit("workday_named_row_not_found", { section: contextLabel, reason: "row_heading_missing" });
        return false;
    }

    await heading.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(PAUSE_TINY);

    const headingBox = await heading.boundingBox().catch(() => null);
    if (!headingBox) {
        emit("workday_named_row_delete_missing", { section: contextLabel, reason: "heading_box_missing" });
        return false;
    }

    const deleteButtons = page.getByRole("button", { name: /^delete$/i });
    const deleteCount = await deleteButtons.count();
    let bestButton = null;
    let bestScore = Infinity;

    for (let index = 0; index < deleteCount; index += 1) {
        const button = deleteButtons.nth(index);
        if (!await button.isVisible().catch(() => false)) {
            continue;
        }

        const insideWorkExp = await button.evaluate((element) => (
            !!element.closest('[data-automation-id="workExperienceSection"]')
        )).catch(() => false);
        if (insideWorkExp || await isDeleteAlignedWithWorkExperienceHeading(page, button)) {
            continue;
        }

        const inFileUpload = await button.evaluate((element) => (
            !!element.closest('[data-automation-id*="file-upload"]')
        )).catch(() => false);
        if (inFileUpload) {
            continue;
        }

        const box = await button.boundingBox().catch(() => null);
        if (!box) {
            continue;
        }

        const verticalDistance = Math.abs(box.y - headingBox.y);
        if (verticalDistance > 50) {
            continue;
        }

        if (box.x + box.width < headingBox.x + 20) {
            continue;
        }

        const score = (verticalDistance * 100) + Math.abs(box.x - (headingBox.x + headingBox.width));
        if (score < bestScore) {
            bestScore = score;
            bestButton = button;
        }
    }

    if (!bestButton) {
        emit("workday_named_row_delete_missing", { section: contextLabel, reason: "aligned_delete_not_found" });
        return false;
    }

    await bestButton.scrollIntoViewIfNeeded().catch(() => {});
    await bestButton.click({ force: true });
    await page.waitForTimeout(PAUSE_MED);
    await confirmWorkdayDeleteDialog(page);
    emit("workday_section_row_deleted", { section: contextLabel, method: "heading_right_delete" });
    return true;
}

async function clickWorkdayRowDeleteInSection(page, sectionLocator, headingPattern, emit, contextLabel) {
    const patternSource = headingPattern instanceof RegExp ? headingPattern.source : String(headingPattern);
    await sectionLocator.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(PAUSE_TINY);

    const sectionHandle = await sectionLocator.elementHandle().catch(() => null);
    if (!sectionHandle) {
        return false;
    }

    const clicked = await sectionHandle.evaluate((root, patternText) => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const pattern = new RegExp(patternText, "i");
        const isDeleteButton = (button) => {
            if (!button.offsetParent || button.closest('[data-automation-id*="file-upload"]')) {
                return false;
            }
            const label = normalize(button.textContent || button.getAttribute("aria-label") || "");
            return /^delete$/i.test(label);
        };

        const headings = [...root.querySelectorAll("h3,h4,h5,legend,label,div,span,button")]
            .filter((element) => {
                const text = normalize(element.textContent);
                return element.offsetParent !== null && text.length <= 40 && pattern.test(text);
            });

        for (const heading of headings) {
            const headingTop = heading.getBoundingClientRect().top;
            const rowDeletes = [...root.querySelectorAll("button")]
                .filter(isDeleteButton)
                .filter((button) => Math.abs(button.getBoundingClientRect().top - headingTop) < 60)
                .sort((left, right) => right.getBoundingClientRect().left - left.getBoundingClientRect().left);

            if (rowDeletes.length > 0) {
                rowDeletes[0].click();
                return true;
            }
        }

        return false;
    }, patternSource).catch(() => false);

    await sectionHandle.dispose().catch(() => {});

    if (clicked) {
        await page.waitForTimeout(PAUSE_MED);
        await confirmWorkdayDeleteDialog(page);
        emit("workday_section_row_deleted", { section: contextLabel, method: "row_header_delete" });
        return true;
    }

    const heading = sectionLocator.getByText(headingPattern).first();
    if (await heading.count() > 0) {
        const headingBox = await heading.boundingBox().catch(() => null);
        const deleteButtons = sectionLocator.getByRole("button", { name: /^delete$/i });
        const deleteCount = await deleteButtons.count();
        let bestDelete = null;
        let bestScore = Infinity;

        for (let index = 0; index < deleteCount; index += 1) {
            const deleteButton = deleteButtons.nth(index);
            if (!await deleteButton.isVisible().catch(() => false)) {
                continue;
            }

            const deleteBox = await deleteButton.boundingBox().catch(() => null);
            if (!headingBox || !deleteBox) {
                continue;
            }

            const verticalDistance = Math.abs(deleteBox.y - headingBox.y);
            if (verticalDistance > 60) {
                continue;
            }

            const score = verticalDistance * 10 - deleteBox.x;
            if (score < bestScore) {
                bestScore = score;
                bestDelete = deleteButton;
            }
        }

        if (bestDelete) {
            await bestDelete.scrollIntoViewIfNeeded().catch(() => {});
            await bestDelete.click({ force: true });
            await page.waitForTimeout(PAUSE_MED);
            await confirmWorkdayDeleteDialog(page);
            emit("workday_section_row_deleted", { section: contextLabel, method: "row_header_aligned_delete" });
            return true;
        }
    }

    return false;
}

function clearWorkdaySessionFieldKeys(sessionFlags, pattern) {
    for (const key of [...sessionFlags.filledFields]) {
        if (pattern.test(key)) {
            sessionFlags.filledFields.delete(key);
        }
    }
}

async function isWorkdayLanguageRowSelected(page, langSection) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (!/Languages 1\b/i.test(bodyText)) {
        return false;
    }

    const dropdowns = langSection.locator('button[aria-haspopup="listbox"], [role="combobox"]');
    const count = await dropdowns.count();
    for (let index = 0; index < count; index += 1) {
        const text = String(await dropdowns.nth(index).innerText().catch(() => "")).trim();
        if (text && !/^(please )?select one|required|search$/i.test(text)) {
            return true;
        }
    }

    if (/I am fluent in this language/i.test(bodyText)) {
        const fluentCheckbox = langSection.locator('input[type="checkbox"]').first();
        if (await fluentCheckbox.count() > 0 && await fluentCheckbox.isChecked().catch(() => false)) {
            return true;
        }
    }

    return false;
}

async function clearWorkdayLanguageRowIfSelected(page, langSection, emit, sessionFlags = {}) {
    if (!await isWorkdayLanguageRowSelected(page, langSection)) {
        return false;
    }

    await langSection.scrollIntoViewIfNeeded().catch(() => {});
    const deleted = await clickWorkdayNamedRowDelete(page, /^Languages 1\b/i, /^Language\s*\*?$/i, emit, "Languages");
    if (deleted) {
        clearWorkdaySessionFieldKeys(sessionFlags, /language|overall/i);
    }
    return deleted;
}

async function removeWorkdayLanguageRowIfPresent(page, emit, sessionFlags = {}) {
    const bodyText = String(await page.locator("body").innerText().catch(() => "")).trim();
    if (!/Languages 1\b/i.test(bodyText)) {
        return 0;
    }

    const strictSection = page.locator('[data-automation-id="languagesSection"]').first();
    const langSection = await strictSection.count() > 0
        ? strictSection
        : await resolveWorkdayNamedSection(page, "languagesSection", "Languages");
    if (await langSection.count() === 0) {
        emit("field_skipped", { field: "Languages", reason: "section_not_found" });
        return 0;
    }

    await langSection.scrollIntoViewIfNeeded().catch(() => {});
    const deleted = await clickWorkdayNamedRowDelete(page, /^Languages 1\b/i, /^Language\s*\*?$/i, emit, "Languages");
    if (deleted) {
        clearWorkdaySessionFieldKeys(sessionFlags, /language|overall/i);
        emit("workday_language_row_removed", {});
        return 1;
    }

    emit("workday_language_delete_failed", {});
    return 0;
}

async function removeWorkdayWebsitesRowIfPresent(page, emit, sessionFlags = {}) {
    const bodyText = String(await page.locator("body").innerText().catch(() => "")).trim();
    if (!/Websites 1\b/i.test(bodyText)) {
        return 0;
    }

    const websitesSection = await resolveWorkdayNamedSection(page, "websitesSection", "Websites");
    if (await websitesSection.count() === 0) {
        return 0;
    }

    await websitesSection.scrollIntoViewIfNeeded().catch(() => {});
    const deleted = await clickWorkdayNamedRowDelete(page, /^Websites 1\b/i, /^URL\s*\*?$/i, emit, "Websites");
    if (deleted) {
        clearWorkdaySessionFieldKeys(sessionFlags, /url|website/i);
        emit("workday_websites_row_removed", {});
        return 1;
    }

    return 0;
}

async function removeCertificationAttachments(page, certSection, emit) {
    const attachmentDeletes = certSection.locator(
        'button[aria-label*="Delete attachment" i], button[aria-label*="Remove attachment" i], [data-automation-id*="file-upload"] button'
    );
    let removed = 0;
    for (let index = await attachmentDeletes.count() - 1; index >= 0; index -= 1) {
        const button = attachmentDeletes.nth(index);
        if (await button.isVisible().catch(() => false)) {
            await button.scrollIntoViewIfNeeded().catch(() => {});
            await button.click({ force: true }).catch(() => {});
            await page.waitForTimeout(PAUSE_MED);
            removed += 1;
            emit("workday_certification_attachment_removed", { index });
        }
    }
    return removed;
}

async function clickWorkdayCertificationDelete(page, certSection, emit) {
    const heading = page.getByText(/^Certifications 1\b/i).last();
    if (await heading.count() === 0) {
        emit("workday_certification_delete_missing", { reason: "certification_heading_missing" });
        return false;
    }

    await heading.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(PAUSE_TINY);

    const headingHandle = await heading.elementHandle().catch(() => null);
    if (!headingHandle) {
        return false;
    }

    const clicked = await headingHandle.evaluate((element) => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const isDeleteButton = (button) => (
            /^delete$/i.test(normalize(button.textContent || button.getAttribute("aria-label") || ""))
            && !button.closest('[data-automation-id*="file-upload"]')
        );
        const headingTop = element.getBoundingClientRect().top;

        const collectScopedDeletes = (container) => {
            if (!container) {
                return [];
            }

            return [
                ...[...container.children].filter((child) => child.tagName === "BUTTON" && isDeleteButton(child)),
                ...[...container.querySelectorAll(":scope > * > button, :scope > button")].filter(isDeleteButton)
            ];
        };

        let node = element;
        for (let depth = 0; depth < 6; depth += 1) {
            const deletes = collectScopedDeletes(node.parentElement)
                .filter((button) => Math.abs(button.getBoundingClientRect().top - headingTop) < 40)
                .sort((left, right) => right.getBoundingClientRect().left - left.getBoundingClientRect().left);

            if (deletes.length > 0) {
                deletes[0].click();
                return true;
            }

            node = node.parentElement;
            if (!node) {
                break;
            }
        }

        return false;
    }).catch(() => false);

    await headingHandle.dispose().catch(() => {});

    if (!clicked) {
        emit("workday_certification_delete_missing", { reason: "certification_heading_row_delete_not_found" });
        return false;
    }

    await page.waitForTimeout(PAUSE_MED);
    await confirmWorkdayDeleteDialog(page);
    emit("workday_certification_removed", { method: "certification_heading_row_delete" });
    return true;
}

async function handleWorkdayCertifications(page, profile, emit, sessionFlags = {}) {
    if (Array.isArray(profile.certifications) && profile.certifications.length > 0) {
        return 0;
    }

    await scrollToWorkdayCertifications(page);
    const certSection = await resolveWorkdayCertificationsSection(page);
    const certSectionText = String(await certSection.innerText().catch(() => "")).trim();
    if (/Work Experience/i.test(certSectionText)) {
        emit("workday_certification_section_rejected", { reason: "section_includes_work_experience" });
        return 0;
    }
    await certSection.scrollIntoViewIfNeeded().catch(() => {});
    for (const toggle of await certSection.locator('button[aria-expanded="false"]').all()) {
        if (await toggle.isVisible().catch(() => false)) {
            await toggle.click({ force: true }).catch(() => {});
            await page.waitForTimeout(PAUSE_SHORT);
        }
    }

    if (!await isWorkdayCertificationSectionPresent(page)) {
        sessionFlags.certificationsHandled = true;
        emit("field_skipped", { field: "Certifications", reason: "section_absent" });
        return 0;
    }

    clearWorkdaySessionFieldKeys(sessionFlags, /certification/i);
    sessionFlags.certificationsHandled = false;

    await removeCertificationAttachments(page, certSection, emit);
    const deleted = await clickWorkdayCertificationDelete(page, certSection, emit);
    await page.waitForTimeout(PAUSE_MED);

    let stillPresent = await isWorkdayCertificationSectionPresent(page);
    if (stillPresent && deleted) {
        await clickWorkdayCertificationDelete(page, certSection, emit);
        await page.waitForTimeout(PAUSE_MED);
        stillPresent = await isWorkdayCertificationSectionPresent(page);
    }

    sessionFlags.certificationsHandled = true;
    if (stillPresent) {
        sessionFlags.certificationsHandled = false;
        emit("workday_certification_delete_failed", { deleted, message: "Certifications 1 still visible after delete" });
        return 0;
    }

    return deleted ? 1 : 0;
}

async function fillWorkdayLanguages(page, profile, emit, sessionFlags = {}) {
    await page.evaluate(() => {
        const node = [...document.querySelectorAll("h3,h4,h5,legend,label,button,div,span")]
            .find((element) => element.offsetParent !== null && /^Languages\b/i.test(element.textContent.trim()));
        node?.scrollIntoView({ block: "center" });
    }).catch(() => {});
    await page.waitForTimeout(PAUSE_TINY);

    let langSection = page.locator('[data-automation-id="languagesSection"]').first();
    if (await langSection.count() === 0) {
        langSection = page.locator("section, div").filter({ hasText: /^Languages\b/i }).first();
    }
    if (await langSection.count() === 0) {
        const bodyText = await page.locator("body").innerText().catch(() => "");
        if (!/Languages 1\b/i.test(bodyText)) {
            emit("field_missing", { field: "Languages", reason: "languages_section_not_found" });
            return 0;
        }
        langSection = page.locator("section, div").filter({ hasText: /Languages 1/i }).first();
    }

    await langSection.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(PAUSE_TINY);
    const collapsed = langSection.locator('button[aria-expanded="false"]').first();
    if (await collapsed.count() > 0 && await collapsed.isVisible().catch(() => false)) {
        await collapsed.click({ force: true }).catch(() => {});
        await page.waitForTimeout(PAUSE_SHORT);
    }

    if (await clearWorkdayLanguageRowIfSelected(page, langSection, emit, sessionFlags)) {
        await page.waitForTimeout(PAUSE_SHORT);
        if (await langSection.count() === 0 || !await langSection.isVisible().catch(() => false)) {
            langSection = page.locator('[data-automation-id="languagesSection"]').first();
            if (await langSection.count() === 0) {
                langSection = page.locator("section, div").filter({ hasText: /^Languages\b/i }).first();
            }
        }
        await ensureWorkdaySectionRow(page, langSection, emit, "Languages");
        await page.waitForTimeout(PAUSE_SHORT);
    }

    const langEntry = (profile.languages || [])[0] || {};
    const language = langEntry.name || profile.preferredLanguage || "English";
    const proficiency = mapWorkdayLanguageProficiency(langEntry.proficiency || profile.englishLevel || "Fluent");
    let filled = 0;

    const targets = [
        {
            locator: langSection.locator('[data-automation-id*="formField"]').filter({ hasText: /^Language\b/i }).locator('button[aria-haspopup="listbox"], [role="combobox"]').first(),
            fallback: langSection.locator('button[aria-haspopup="listbox"], [role="combobox"]').nth(0),
            value: language,
            label: "Language"
        },
        {
            locator: langSection.locator('[data-automation-id*="formField"]').filter({ hasText: /^Overall\b/i }).locator('button[aria-haspopup="listbox"], [role="combobox"]').first(),
            fallback: langSection.locator('button[aria-haspopup="listbox"], [role="combobox"]').nth(1),
            value: proficiency,
            label: "Overall"
        }
    ];

    for (const target of targets) {
        let field = target.locator;
        if (await field.count() === 0) {
            field = target.fallback;
        }
        if (await field.count() === 0) {
            emit("field_missing", { field: target.label, reason: "language_dropdown_not_found" });
            continue;
        }
        const fieldKey = workdayFieldKey(`language-${target.label}`, target.label);
        const current = (await field.innerText().catch(() => "")).trim();
        if (current && !/^(please )?select one|required|search$/i.test(current)) {
            await clearWorkdayLanguageRowIfSelected(page, langSection, emit, sessionFlags);
            await ensureWorkdaySectionRow(page, langSection, emit, "Languages");
            await page.waitForTimeout(PAUSE_SHORT);
            field = target.locator;
            if (await field.count() === 0) {
                field = target.fallback;
            }
            if (await field.count() === 0) {
                emit("field_missing", { field: target.label, reason: "language_dropdown_not_found_after_delete" });
                continue;
            }
        }

        sessionFlags.filledFields.delete(fieldKey);

        try {
            await fillWorkdayField(field, target.value, page, {
                hint: target.label,
                force: true,
                sessionFlags,
                fieldKey
            });
            filled += 1;
            emit("field_filled", { field: target.label, value: target.value, method: "language_dropdown" });
        } catch (error) {
            emit("field_failed", { field: target.label, message: error.message });
        }
    }

    return filled;
}

async function fillWorkdayWebsites(page, profile, emit, sessionFlags = {}) {
    const url = profile.portfolio || profile.github || profile.linkedin;
    if (!url) {
        return 0;
    }

    await scrollWorkdaySectionIntoView(page, "^Websites\\b");
    let websitesSection = page.locator('[data-automation-id="websitesSection"]').first();
    if (await websitesSection.count() === 0) {
        websitesSection = page.locator("section, div").filter({ hasText: /^Websites\b/i }).first();
    }
    await websitesSection.scrollIntoViewIfNeeded().catch(() => {});
    await ensureWorkdaySectionRow(page, websitesSection, emit, "Websites");

    const urlLocators = [
        websitesSection.getByLabel(/^URL$/i).first(),
        websitesSection.getByRole("textbox", { name: /^URL$/i }).first(),
        websitesSection.locator('[data-automation-id="url"] input, input[aria-label*="URL" i]').first(),
        page.getByLabel(/^URL$/i).first()
    ];

    for (const locator of urlLocators) {
        if (await locator.count() === 0 || !await locator.isVisible().catch(() => false)) {
            continue;
        }

        const field = await resolveWorkdayFormField(locator);
        const current = await getWorkdayFieldValue(field);
        if (current && workdayValuesMatch(url, current, "URL")) {
            emit("field_skipped", { field: "URL", reason: "already_set" });
            return 0;
        }

        await fillWorkdayField(field, url, page, { hint: "URL", force: true, sessionFlags });
        emit("field_filled", { field: "URL", value: url });
        return 1;
    }

    emit("field_missing", { field: "URL", reason: "url_input_not_found" });
    return 0;
}

async function fillWorkExperienceTextField(page, field, value, label, emit, extra = {}) {
    if (!value || await field.count() === 0) {
        return 0;
    }

    const sessionFlags = extra.sessionFlags || {};
    const fieldKey = workdayFieldKey(extra.automationId, label, extra.index);
    if (isWorkdayFieldHandled(sessionFlags, fieldKey)) {
        emit("field_skipped", { field: label, reason: "session_locked", ...extra });
        return 0;
    }

    try {
        const editable = await resolveWorkdayTextInput(field);
        await editable.scrollIntoViewIfNeeded().catch(() => {});
        const current = String(await getWorkdayFieldValue(editable).catch(() => "")).trim();
        if (current && workdayStrictTextMatch(value, current)) {
            markWorkdayFieldHandled(sessionFlags, fieldKey);
            emit("field_skipped", { field: label, reason: "already_set", ...extra });
            return 0;
        }

        const didFill = await fillWorkdayField(editable, value, page, {
            hint: label,
            force: true,
            sessionFlags,
            fieldKey
        });
        if (didFill) {
            emit("field_filled", { field: label, ...extra });
            return 1;
        }

        const after = String(await getWorkdayFieldValue(editable).catch(() => "")).trim();
        if (after && workdayStrictTextMatch(value, after)) {
            markWorkdayFieldHandled(sessionFlags, fieldKey);
            emit("field_skipped", { field: label, reason: "already_set", ...extra });
        }
        return 0;
    } catch (error) {
        emit("field_failed", { field: label, message: error.message, ...extra });
        return 0;
    }
}

async function fillWorkdayWorkHistory(page, profile, emit, sessionFlags = {}) {
    const history = sortWorkHistoryChronologically(profile.workHistory || []);
    if (!history.length) {
        return 0;
    }

    if (sessionFlags.workHistoryInitialized) {
        const existingRows = await getWorkExperienceTitleFields(page).count();
        if (existingRows >= history.length && await isWorkHistoryComplete(page, profile)) {
            emit("workday_work_history_skipped", { reason: "already_initialized", existingRows });
            return 0;
        }
        sessionFlags.workHistoryInitialized = false;
    }

    if (await isWorkHistoryComplete(page, profile)) {
        sessionFlags.workHistoryInitialized = true;
        const existingRows = await getWorkExperienceTitleFields(page).count();
        emit("workday_work_history_skipped", { reason: "already_complete", existingRows });
        return 0;
    }

    let filled = 0;
    const experienceBlock = getWorkExperienceBlock(page);
    await experienceBlock.scrollIntoViewIfNeeded().catch(() => {});
    await openCollapsedMyExperienceSections(page, emit);

    let titleCount = await getWorkExperienceTitleFields(page).count();
    if (titleCount === 0) {
        const collapsedWorkExp = page.locator('[aria-expanded="false"]').filter({ hasText: /Work Experience/i }).first();
        if (await collapsedWorkExp.count() > 0 && await collapsedWorkExp.isVisible().catch(() => false)) {
            await collapsedWorkExp.click({ force: true }).catch(() => {});
            await page.waitForTimeout(PAUSE_MED);
        }
    }

    await getWorkExperienceTitleFields(page).first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});

    let existingRows = await getWorkExperienceTitleFields(page).count();
    emit("workday_experience_fields_found", { titleCount: existingRows });

    if (!(await isWorkHistoryComplete(page, profile)) && existingRows > history.length) {
        await trimWorkExperienceRows(page, history.length, emit);
        existingRows = await getWorkExperienceTitleFields(page).count();
    }

    if (existingRows === 0) {
        await ensureWorkExperienceRowAvailable(page, 0, emit);
    }

    await ensureWorkExperienceRowCount(page, history.length, emit);

    for (let index = 0; index < history.length; index += 1) {
        const job = history[index];

        await ensureWorkExperienceRowAvailable(page, index, emit);
        const rowCount = await getWorkExperienceTitleFields(page).count();
        if (rowCount <= index) {
            emit("workday_work_experience_row_missing", { index, rowCount, expected: history.length });
            continue;
        }

        const row = await resolveWorkExperienceRow(page, index);

        let titleField = row.locator(WORK_EXPERIENCE_TITLE_INPUT).first();
        if (await titleField.count() === 0) {
            titleField = getWorkExperienceTitleFields(page).nth(index);
        }
        let companyField = row.locator(WORK_EXPERIENCE_COMPANY_INPUT).first();
        if (await companyField.count() === 0) {
            companyField = getWorkExperienceCompanyFields(page).nth(index);
        }

        await row.scrollIntoViewIfNeeded().catch(() => {});
        await titleField.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(PAUSE_SHORT);

        if (job.title) {
            filled += await fillWorkExperienceTextField(
                page,
                titleField,
                job.title,
                "Job Title",
                emit,
                { automationId: "jobTitle", index, sessionFlags }
            );
        }

        if (job.company) {
            filled += await fillWorkExperienceTextField(
                page,
                companyField,
                job.company,
                "Company",
                emit,
                { automationId: "company", index, sessionFlags }
            );
        }

        let locationField = row.locator(WORK_EXPERIENCE_LOCATION_INPUT).first();
        if (await locationField.count() === 0) {
            locationField = getWorkExperienceLocationFields(page).nth(index);
        }
        const locationValue = job.location || profile.city;
        if (locationValue) {
            if (await locationField.count() === 0) {
                emit("field_missing", { field: "Location", index, reason: "row_scoped_locator_empty" });
            } else {
                filled += await fillWorkExperienceTextField(
                    page,
                    locationField,
                    locationValue,
                    "Location",
                    emit,
                    { automationId: "location", index, sessionFlags }
                );
            }
        }

        if (job.description) {
            filled += await fillWorkdayRoleDescriptionForRow(page, row, index, job.description, emit, sessionFlags);
        }

        let currentControl = row.locator(
            '[data-automation-id="currentlyWorkHere"], [data-automation-id="currentJob"]'
        ).first();
        if (await currentControl.count() === 0) {
            currentControl = page.locator(
                '[data-automation-id="currentlyWorkHere"], [data-automation-id="currentJob"]'
            ).nth(index);
        }
        if (await currentControl.count() === 0) {
            currentControl = row.getByRole("checkbox", { name: /currently work here/i }).first();
        }
        if (await currentControl.count() === 0) {
            currentControl = page.getByRole("checkbox", { name: /currently work here/i }).nth(index);
        }

        const readCurrentChecked = async (control) => {
            const input = control.locator('input[type="checkbox"]').first();
            if (await input.count() > 0) {
                return input.isChecked().catch(() => false);
            }
            return control.evaluate((element) => (
                element.getAttribute("aria-checked") === "true"
                || element.querySelector('input[type="checkbox"]')?.checked === true
            )).catch(() => false);
        };

        if (await currentControl.count() > 0) {
            const alreadyChecked = await readCurrentChecked(currentControl);
            if (job.current && !alreadyChecked) {
                const input = currentControl.locator('input[type="checkbox"]').first();
                if (await input.count() > 0) {
                    await input.check({ force: true }).catch(async () => {
                        await currentControl.click({ force: true });
                    });
                } else {
                    await currentControl.click({ force: true });
                }
                filled += 1;
                emit("field_filled", { field: "I currently work here", automationId: "currentlyWorkHere", index });
            } else if (!job.current && alreadyChecked) {
                const input = currentControl.locator('input[type="checkbox"]').first();
                if (await input.count() > 0) {
                    await input.uncheck({ force: true }).catch(() => currentControl.click({ force: true }));
                } else {
                    await currentControl.click({ force: true });
                }
                filled += 1;
                emit("field_filled", { field: "I currently work here", automationId: "currentlyWorkHere", index, value: "No" });
            } else if (job.current && alreadyChecked) {
                emit("field_filled", { field: "I currently work here", automationId: "currentlyWorkHere", index, method: "already_set" });
            } else {
                emit("field_skipped", { field: "I currently work here", automationId: "currentlyWorkHere", index, reason: "already_set" });
            }
        } else {
            const label = row.getByText(/I currently work here/i).first();
            if (await label.count() > 0) {
                if (job.current) {
                    await label.click({ force: true });
                    filled += 1;
                    emit("field_filled", { field: "I currently work here", automationId: "currentlyWorkHere", index, method: "label_click" });
                }
            } else {
                emit("field_missing", { field: "I currently work here", index, reason: "checkbox_not_found" });
            }
        }

        await page.waitForTimeout(PAUSE_SHORT);

        const compositeDateFields = [
            {
                month: job.startMonth,
                year: job.startYear,
                label: "Work Start",
                kind: "start"
            },
            {
                month: job.current ? null : job.endMonth,
                year: job.current ? null : job.endYear,
                label: "Work End",
                kind: "end"
            }
        ];

        for (const dateEntry of compositeDateFields) {
            if (!dateEntry.month && !dateEntry.year) {
                continue;
            }

            try {
                const didFill = await fillWorkExperienceRowDates(
                    page,
                    index,
                    dateEntry.kind,
                    dateEntry.month,
                    dateEntry.year,
                    emit
                );
                if (didFill) {
                    filled += 1;
                    emit("field_filled", {
                        field: `${dateEntry.label} Date`,
                        automationId: "workDateSpinbutton",
                        index,
                        value: formatWorkdayMonthYear(dateEntry.month, dateEntry.year)
                    });
                }
            } catch (error) {
                emit("field_failed", {
                    field: `${dateEntry.label} Date`,
                    automationId: "workDateSpinbutton",
                    index,
                    message: error.message
                });
            }
        }

        const snapshot = await readWorkExperienceRowSnapshot(page, index);
        emit("workday_work_experience_row_snapshot", { expected: job, actual: snapshot });
    }

    const finalSnapshots = [];
    for (let index = 0; index < history.length; index += 1) {
        finalSnapshots.push(await readWorkExperienceRowSnapshot(page, index));
    }
    emit("workday_work_history_final", { rows: finalSnapshots, expectedCount: history.length });

    sessionFlags.workHistoryInitialized = await isWorkHistoryComplete(page, profile);
    return filled;
}

async function resolveWorkdaySkillsBox(page, skillsField) {
    const formField = page.locator(
        '[data-automation-id="formField-skills"], [data-automation-id*="formField"][data-automation-id*="skill"]'
    ).first();
    if (await formField.count() > 0 && await formField.isVisible().catch(() => false)) {
        return formField;
    }

    const multiSelect = skillsField.locator(
        'xpath=ancestor::*[@data-automation-id="multiSelectContainer" or contains(@data-automation-id,"multiSelect")][1]'
    ).first();
    if (await multiSelect.count() > 0) {
        return multiSelect;
    }

    const section = page.locator('[data-automation-id="skillsSection"]').first();
    if (await section.count() > 0 && await section.isVisible().catch(() => false)) {
        return section;
    }

    return skillsField;
}

async function readWorkdaySkillsSelectedCount(skillsBox) {
    const text = await skillsBox.innerText().catch(() => "");
    const match = text.match(/(\d+)\s+items?\s+selected/i);
    if (match) {
        return Number(match[1]);
    }

    const chips = skillsBox.locator(
        '[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"] [data-automation-id], [data-automation-id="chip"], [data-automation-id*="selectedItem"]'
    );
    const chipCount = await chips.count().catch(() => 0);
    if (chipCount > 0) {
        return chipCount;
    }

    const tagCount = await skillsBox.locator('[role="button"], button, span').filter({
        hasText: /^(Java|Python|Spring|Docker|Git|MongoDB|MySQL|C\+\+|Flutter|Jenkins|Postman)/i
    }).count().catch(() => 0);
    if (tagCount > 0) {
        return tagCount;
    }

    return /0 items selected/i.test(text) ? 0 : null;
}

async function addWorkdaySkillByEnter(page, skillsField, skillsBox, skill, emit) {
    const query = String(skill || "").trim();
    if (!query) {
        return false;
    }

    await scrollWorkdayFieldIntoView(skillsField);
    await closeWorkdayPopups(page);

    const beforeCount = await readWorkdaySkillsSelectedCount(skillsBox);
    await skillsField.click({ force: true });
    await skillsField.fill("");
    await skillsField.pressSequentially(query, { delay: 35 });
    await page.waitForTimeout(PAUSE_SHORT);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(PAUSE_MED);
    await skillsField.click({ force: true });
    await page.waitForTimeout(PAUSE_SHORT);

    let afterCount = await readWorkdaySkillsSelectedCount(skillsBox);
    let boxText = await skillsBox.innerText().catch(() => "");
    let added = (afterCount ?? 0) > (beforeCount ?? 0)
        || boxText.toLowerCase().includes(query.toLowerCase());

    if (!added) {
        const option = page.locator('[data-automation-id="promptLeafNode"], [role="option"]')
            .filter({ hasText: new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })
            .first();
        if (await option.isVisible().catch(() => false)) {
            await option.click({ force: true });
            await page.waitForTimeout(PAUSE_SHORT);
            await skillsField.click({ force: true });
            afterCount = await readWorkdaySkillsSelectedCount(skillsBox);
            boxText = await skillsBox.innerText().catch(() => "");
            added = (afterCount ?? 0) > (beforeCount ?? 0)
                || boxText.toLowerCase().includes(query.toLowerCase());
        }
    }

    if (added) {
        emit("field_filled", { field: "Skills", value: query, method: "type_enter_click_box" });
        return true;
    }

    emit("field_failed", {
        field: "Skills",
        value: query,
        method: "type_enter_click_box",
        message: "skill not visible after enter and box click",
        beforeCount,
        afterCount
    });
    return false;
}

async function scrollWorkdaySectionIntoView(page, labelPattern) {
    await page.evaluate((patternSource) => {
        const pattern = new RegExp(patternSource, "i");
        const node = [...document.querySelectorAll("h3,h4,h5,legend,label,button,div,span")]
            .find((element) => element.offsetParent !== null && pattern.test(element.textContent.trim()));
        node?.scrollIntoView({ block: "center" });
    }, labelPattern).catch(() => {});
    await page.waitForTimeout(PAUSE_SHORT);
}

async function fillWorkdaySkills(page, profile, emit, sessionFlags = {}) {
    const skillsText = profile.coreTechnicalStack || profile.skills;
    if (!skillsText) {
        return 0;
    }

    const skills = String(skillsText)
        .split(/[,;]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 5);

    await scrollWorkdaySectionIntoView(page, "^Skills\\b|Type to Add Skills");
    let skillsSection = page.locator('[data-automation-id="skillsSection"]').first();
    if (await skillsSection.count() === 0) {
        skillsSection = page.locator("section, div").filter({ hasText: /^Skills\b/i }).first();
    }
    await skillsSection.scrollIntoViewIfNeeded().catch(() => {});
    const collapsed = skillsSection.locator('button[aria-expanded="false"]').first();
    if (await collapsed.count() > 0 && await collapsed.isVisible().catch(() => false)) {
        await collapsed.click({ force: true }).catch(() => {});
        await page.waitForTimeout(PAUSE_SHORT);
    }

    let skillsField = skillsSection.locator([
        'input[aria-label*="Type to Add Skills" i]',
        'input[aria-label*="Add Skills" i]',
        '[data-automation-id*="skills"] input:not([type="hidden"])',
        '[data-automation-id*="skill"] input:not([type="hidden"])'
    ].join(", ")).first();

    if (await skillsField.count() === 0 || !await skillsField.isVisible().catch(() => false)) {
        skillsField = page.locator(
            'input[aria-label*="Type to Add Skills" i], input[aria-label*="Add Skills" i]'
        ).first();
    }

    const skillsBox = await resolveWorkdaySkillsBox(page, skillsField);
    const existingCount = await readWorkdaySkillsSelectedCount(skillsBox);
    if (existingCount !== null && existingCount > 0) {
        emit("field_skipped", { field: "Skills", reason: "already_set", count: existingCount });
        return 0;
    }

    if (await skillsField.count() === 0) {
        emit("field_missing", { field: "Skills", reason: "skills_input_not_found" });
        return 0;
    }

    await skillsField.scrollIntoViewIfNeeded().catch(() => {});
    await skillsField.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    if (!await skillsField.isVisible().catch(() => false)) {
        emit("field_missing", { field: "Skills", reason: "skills_input_not_found" });
        return 0;
    }

    let added = 0;

    for (const skill of skills) {
        if (added >= 3) {
            break;
        }

        const skillAdded = await addWorkdaySkillByEnter(page, skillsField, skillsBox, skill, emit);
        if (skillAdded) {
            added += 1;
        }
    }

    if (added > 0) {
        emit("field_filled", { field: "Skills", count: added, method: "type_enter_click_box" });
    }

    await closeWorkdayPopups(page);
    return added;
}

async function closeWorkdayPopups(page) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(PAUSE_TINY);
    }
}

async function unlockWorkdayFieldsFromValidation(page, sessionFlags, emit) {
    const errors = await page.locator("body").innerText().catch(() => "");
    if (/certification/i.test(errors)) {
        sessionFlags.certificationsHandled = false;
    }
    if (/work experience|job title|company|role description|invalid date/i.test(errors) && !/certification/i.test(errors)) {
        sessionFlags.workHistoryInitialized = false;
    }
    if (/language|overall|skills|url|school|education/i.test(errors)) {
        for (const key of [...sessionFlags.filledFields]) {
            if (/language|overall|skills|url|school|degree|education/i.test(key)) {
                sessionFlags.filledFields.delete(key);
            }
        }
    }
    emit("workday_validation_unlock", { errors: errors.slice(0, 200) });
}

async function gapFillWorkdayMyExperience(page, profile, emit, sessionFlags = {}, validationErrors = []) {
    const errors = validationErrors.join("\n");
    if (!errors.trim()) {
        return 0;
    }

    emit("workday_my_experience_gap_fill", { errors: validationErrors.slice(0, 5) });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(PAUSE_SHORT);
    await openCollapsedMyExperienceSections(page, emit);
    let filled = 0;

    if (/certification/i.test(errors)) {
        filled += await handleWorkdayCertifications(page, profile, emit, sessionFlags);
    }
    if (/school or university|field of study|degree|education/i.test(errors)) {
        filled += await fillWorkdayEducation(page, profile, emit, sessionFlags);
    }
    if (/\blanguage\b|\boverall\b/i.test(errors)) {
        filled += await removeWorkdayLanguageRowIfPresent(page, emit, sessionFlags);
    }
    if (/\burl\b/i.test(errors)) {
        filled += await removeWorkdayWebsitesRowIfPresent(page, emit, sessionFlags);
    }
    if (/role description|work experience|invalid date|job title|company/i.test(errors) && !/certification/i.test(errors)) {
        for (const key of [...sessionFlags.filledFields]) {
            if (/jobtitle|company|location|description|workdate/i.test(key)) {
                sessionFlags.filledFields.delete(key);
            }
        }
        sessionFlags.workHistoryInitialized = false;
        filled += await fillWorkdayWorkHistory(page, profile, emit, sessionFlags);
    }

    emit("workday_my_experience_gap_fill_done", { filled });
    return filled;
}

async function readRoleDescriptionValue(page, index) {
    const workId = await resolveWorkExperienceWorkId(page, index);
    if (workId) {
        const scoped = page.locator(`[id*="workExperience-${workId}"] textarea`).first();
        if (await scoped.count() > 0) {
            const value = String(await scoped.inputValue().catch(() => "")).trim();
            if (value) {
                return value;
            }
        }
    }

    const row = await resolveWorkExperienceRow(page, index);
    const rowTextarea = row.locator("textarea").first();
    if (await rowTextarea.count() > 0) {
        const value = String(await rowTextarea.inputValue().catch(() => "")).trim();
        if (value) {
            return value;
        }
    }

    const labeled = page.getByLabel(/Role Description/i);
    if (index < await labeled.count()) {
        return String(await labeled.nth(index).inputValue().catch(() => "")).trim();
    }

    return "";
}

async function fillWorkdayRoleDescriptionForRow(page, row, index, text, emit, sessionFlags = {}) {
    const descriptionKey = workdayFieldKey("description", "Role Description", index);
    const existing = await readRoleDescriptionValue(page, index);
    if (existing && existing.length > 20) {
        markWorkdayFieldHandled(sessionFlags, descriptionKey);
        emit("field_skipped", { field: "Role Description", index, reason: "already_set" });
        return 0;
    }

    if (isWorkdayFieldHandled(sessionFlags, descriptionKey)) {
        sessionFlags.filledFields.delete(descriptionKey);
    }

    await expandWorkdayRoleDescription(row, page);
    await row.scrollIntoViewIfNeeded().catch(() => {});

    const labeledAreas = page.getByLabel(/Role Description/i);
    if (index < await labeledAreas.count()) {
        const area = labeledAreas.nth(index);
        await area.scrollIntoViewIfNeeded().catch(() => {});
        await area.click({ force: true }).catch(() => {});
        await area.fill(text);
        await page.keyboard.press("Tab").catch(() => {});
        await page.waitForTimeout(PAUSE_SHORT);
        const after = await readRoleDescriptionValue(page, index);
        if (after.length > 20) {
            markWorkdayFieldHandled(sessionFlags, descriptionKey);
            emit("field_filled", { field: "Role Description", automationId: "description", index, method: "getByLabel" });
            return 1;
        }
    }

    const workId = await resolveWorkExperienceWorkId(page, index);
    const candidates = [];
    if (workId) {
        candidates.push(page.locator(`[id*="workExperience-${workId}"] textarea`).first());
    }
    candidates.push(
        row.locator("textarea").first(),
        getWorkExperienceBlock(page).locator("textarea").nth(index)
    );

    for (const candidate of candidates) {
        if (await candidate.count() === 0) {
            continue;
        }
        try {
            await candidate.scrollIntoViewIfNeeded().catch(() => {});
            await candidate.click({ force: true });
            await candidate.fill(text);
            await page.keyboard.press("Tab").catch(() => {});
            const after = await readRoleDescriptionValue(page, index);
            if (after.length > 20) {
                markWorkdayFieldHandled(sessionFlags, descriptionKey);
                emit("field_filled", { field: "Role Description", automationId: "description", index });
                return 1;
            }
        } catch {
            // try next candidate
        }
    }

    emit("field_missing", { field: "Role Description", automationId: "description", index, reason: "description_locator_empty" });
    return 0;
}

async function expandWorkdayRoleDescription(row, page) {
    const toggles = [
        row.locator('button[aria-expanded="false"]').filter({ hasText: /role description/i }).first(),
        row.locator('[data-automation-id*="roleDescription"] button[aria-expanded="false"]').first(),
        row.getByRole("button", { name: /role description/i }).first()
    ];

    for (const toggle of toggles) {
        if (await toggle.count() > 0 && await toggle.isVisible().catch(() => false)) {
            await toggle.scrollIntoViewIfNeeded().catch(() => {});
            await toggle.click({ force: true });
            await page.waitForTimeout(PAUSE_SHORT);
            break;
        }
    }
}

async function resolveWorkdayEditableField(field, page) {
    await field.scrollIntoViewIfNeeded().catch(() => {});
    await field.click({ force: true }).catch(() => {});
    await page.waitForTimeout(PAUSE_SHORT);

    const candidates = [
        field.locator("textarea").first(),
        field.locator('[contenteditable="true"]').first(),
        field.locator('[role="textbox"]').first(),
        field.locator("input:not([type='hidden'])").first()
    ];

    for (const candidate of candidates) {
        if (await candidate.count() > 0 && await candidate.isVisible().catch(() => false)) {
            return candidate;
        }
    }

    const isEditable = await field.evaluate((element) => (
        element.isContentEditable
        || element.getAttribute("contenteditable") === "true"
        || element.getAttribute("role") === "textbox"
    )).catch(() => false);

    if (isEditable) {
        return field;
    }

    throw new Error("No editable role description field found");
}

function promptOptionAliases(optionText) {
    const requested = String(optionText || "").trim();
    const aliases = [requested];

    if (/job board/i.test(requested)) {
        aliases.push("Job Boards", "Internet Job Board", "Job board");
    }

    if (/linkedin/i.test(requested)) {
        aliases.push("Linkedin Jobs", "LinkedIn Jobs", "LinkedIn");
    }

    return [...new Set(aliases)];
}

function promptLeafMatches(text, optionText) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    const requested = String(optionText || "").trim();
    const pattern = new RegExp(`^${requested.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

    if (pattern.test(normalized)) {
        return true;
    }

    const normalizedLower = normalized.toLowerCase();
    const requestedLower = requested.toLowerCase();

    if (normalizedLower.includes(requestedLower) || requestedLower.includes(normalizedLower)) {
        return true;
    }

    if (/job board/i.test(requestedLower) && /job board/i.test(normalizedLower)) {
        return true;
    }

    if (/linkedin/i.test(requestedLower) && /linkedin/i.test(normalizedLower)) {
        return true;
    }

    return false;
}

async function waitForWorkdayPromptReady(page) {
    const busyPrompt = page.locator('[data-automation-id="responsiveMonikerPrompt"][aria-busy="true"]');
    if (await busyPrompt.count() > 0) {
        await busyPrompt.first().waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    }
    await page.waitForTimeout(PAUSE_TINY);
}

async function clickWorkdayPromptLeaf(page, optionText) {
    await waitForWorkdayPromptReady(page);

    const selectors = [
        '[data-automation-id="promptLeafNode"]',
        '[data-automation-id="menuItem"]',
        '[data-automation-id="promptOption"]'
    ];

    for (const alias of promptOptionAliases(optionText)) {
        for (const selector of selectors) {
            const byText = page.locator(selector).filter({ hasText: new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first();
            if (await byText.count() > 0 && await byText.isVisible().catch(() => false)) {
                await byText.scrollIntoViewIfNeeded().catch(() => {});
                await byText.click({ force: true });
                await page.waitForTimeout(PAUSE_SHORT);
                return alias;
            }
        }

        for (const selector of selectors) {
            const leaves = page.locator(selector);
            const count = await leaves.count();

            for (let index = 0; index < count; index += 1) {
                const leaf = leaves.nth(index);
                if (!await leaf.isVisible().catch(() => false)) {
                    continue;
                }

                const automationLabel = await leaf.getAttribute("data-automation-label").catch(() => "");
                const text = automationLabel || await leaf.innerText().catch(() => "");
                if (!promptLeafMatches(text, alias)) {
                    continue;
                }

                await leaf.scrollIntoViewIfNeeded().catch(() => {});
                await leaf.click({ force: true });
                await page.waitForTimeout(PAUSE_SHORT);
                return String(text).trim();
            }
        }
    }

    const searchBox = page.locator(
        '[data-automation-id="searchBox"] input, input[placeholder*="Search" i], [data-automation-id="monikerSearchBox"] input'
    ).last();
    if (await searchBox.count() > 0 && await searchBox.isVisible().catch(() => false)) {
        await searchBox.fill(optionText);
        await page.waitForTimeout(PAUSE_SHORT);
        await page.keyboard.press("Enter").catch(() => {});
        await page.waitForTimeout(PAUSE_MED);
        return optionText;
    }

    throw new Error(`No prompt leaf matching "${optionText}"`);
}

async function isWorkdayHearAboutUsComplete(page, profile) {
    const detail = profile.workdaySourceDetail || "LinkedIn Jobs";
    const sourceSection = page.locator('[data-automation-id*="formField"], section, fieldset')
        .filter({ hasText: /how did you hear about us/i })
        .first();
    const sectionText = await sourceSection.innerText().catch(() => "");
    if (/source is required|field source is required/i.test(sectionText)) {
        return false;
    }

    const visibleError = sourceSection.locator(
        '[data-automation-id*="errorMessage"], [data-automation-id*="formFieldError"], [role="alert"]'
    ).first();
    if (await visibleError.count() > 0 && await visibleError.isVisible().catch(() => false)) {
        return false;
    }

    const chip = sourceSection.locator(
        '[data-automation-id="selectedItem"], [data-automation-id="chip"], [data-automation-id="selectedItemList"] *'
    ).filter({ hasText: /linkedin/i }).first();
    if (await chip.count() > 0 && await chip.isVisible().catch(() => false)) {
        const sourceInput = page.locator(
            '#source--source, [data-uxi-widget-type="selectinput"][id*="source"]'
        ).first();
        if (await sourceInput.count() > 0) {
            const currentSource = await getWorkdayFieldValue(sourceInput);
            if (currentSource && currentSource.trim().length > 2) {
                return true;
            }
        } else {
            return true;
        }
    }

    const sourceButton = page.locator('button[name="source"], [id*="source"][aria-haspopup="listbox"]').first();

    if (await sourceButton.count() > 0 && await sourceButton.isVisible().catch(() => false)) {
        const buttonText = await sourceButton.innerText().catch(() => "");
        if (!buttonText.trim() || /select one|required/i.test(buttonText)) {
            return false;
        }

        return workdayValuesMatch(detail, buttonText, "source")
            || /linkedin/i.test(buttonText);
    }

    const sourceInput = page.locator(
        '#source--source, [data-uxi-widget-type="selectinput"][id*="source"]'
    ).first();
    if (await sourceInput.count() > 0) {
        const currentSource = await getWorkdayFieldValue(sourceInput);
        return workdayValuesMatch(detail, currentSource, "source")
            || (/linkedin/i.test(currentSource) && String(currentSource).trim().length > 3);
    }

    return false;
}

function workdayQuestionAnswerCandidates(label, answer) {
    const candidates = [String(answer || "").trim()].filter(Boolean);
    const consentQuestion = /sms|automated tools.*ai/i.test(`${label}`);
    if (!consentQuestion) {
        return candidates;
    }

    const normalized = String(answer || "").trim().toLowerCase();
    const addCandidate = (value) => {
        if (value && !candidates.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
            candidates.push(value);
        }
    };

    if (/^(yes|true|1|agree|opt-?in)$/i.test(normalized)) {
        for (const fallback of ["Yes", "Opt-in", "Opt in", "I agree", "Agree"]) {
            addCandidate(fallback);
        }
    } else if (/^(no|false|0|opt-?out)$/i.test(normalized)) {
        for (const fallback of ["No", "Opt-out", "Opt out"]) {
            addCandidate(fallback);
        }
    }

    return candidates;
}

async function fillWorkdayQuestionInSection(page, sectionPattern, answer, emit, label) {
    const candidates = workdayQuestionAnswerCandidates(label, answer);

    for (const candidate of candidates) {
        if (await fillWorkdayRadioInSection(page, sectionPattern, candidate, emit, label)) {
            return true;
        }
    }

    const sectionLists = [
        page.locator("[data-automation-id*='formField']").filter({ hasText: sectionPattern }),
        page.locator("section, fieldset, div").filter({ hasText: sectionPattern })
    ];

    for (const sectionList of sectionLists) {
        const sectionCount = await sectionList.count();
        for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
            const section = sectionList.nth(sectionIndex);
            const dropdown = section.locator('button[aria-haspopup="listbox"], [role="combobox"]').first();
            if (await dropdown.count() === 0 || !await dropdown.isVisible().catch(() => false)) {
                continue;
            }

            const current = String(await getWorkdayFieldValue(dropdown)).trim();
            if (current && !/^(please )?select one/i.test(current)
                && candidates.some((candidate) => workdayValuesMatch(candidate, current, label))) {
                emit("field_skipped", { field: label, reason: "already_set", value: current });
                return false;
            }

            for (const candidate of candidates) {
                try {
                    const selected = await selectWorkdayListboxOption(page, dropdown, candidate);
                    emit("field_filled", { field: label, value: selected || candidate, method: "question_dropdown" });
                    return true;
                } catch (error) {
                    if (candidate === candidates[candidates.length - 1]) {
                        emit("field_failed", { field: label, message: error.message, method: "question_dropdown" });
                    }
                }
            }
        }
    }

    return false;
}

async function fillWorkdayRadioInSection(page, sectionPattern, answer, emit, label) {
    const roots = [
        page.locator("[data-automation-id*='formField']").filter({ hasText: sectionPattern }).first(),
        page.locator("section, fieldset, div").filter({ hasText: sectionPattern }).first()
    ];

    for (const section of roots) {
        if (await section.count() === 0) {
            continue;
        }

        const radios = section.locator("input[type='radio']");
        const count = await radios.count();

        for (let index = 0; index < count; index += 1) {
            const input = radios.nth(index);
            const id = await input.getAttribute("id");
            const optionLabel = id
                ? section.locator(`label[for="${id}"]`).first()
                : input.locator("xpath=following-sibling::label[1]");
            const text = (await optionLabel.innerText().catch(() => "")).trim();

            if (!optionMatches(text, answer)) {
                continue;
            }

            if (await input.isChecked().catch(() => false)) {
                emit("field_skipped", { field: label, reason: "already_set", value: text });
                return false;
            }

            await optionLabel.click({ force: true });
            emit("field_filled", { field: label, value: text });
            return true;
        }
    }

    const pageRadios = page.locator("input[type='radio']");
    const radioCount = await pageRadios.count();

    for (let index = 0; index < radioCount; index += 1) {
        const input = pageRadios.nth(index);
        const containerText = await input.evaluate((element) => {
            const container = element.closest("[data-automation-id*='formField'], fieldset, section");
            return container?.innerText || "";
        }).catch(() => "");

        if (!sectionPattern.test(containerText)) {
            continue;
        }

        const id = await input.getAttribute("id");
        const optionLabel = id
            ? page.locator(`label[for="${id}"]`).first()
            : input.locator("xpath=following-sibling::label[1]");
        const text = (await optionLabel.innerText().catch(() => "")).trim();

        if (!optionMatches(text, answer)) {
            continue;
        }

        if (await input.isChecked().catch(() => false)) {
            emit("field_skipped", { field: label, reason: "already_set", value: text });
            return false;
        }

        await optionLabel.click({ force: true });
        emit("field_filled", { field: label, value: text });
        return true;
    }

    return false;
}

async function fillWorkdayVeteranStatus(page, answer, emit) {
    if (!answer) {
        return false;
    }

    if (await fillWorkdayRadioInSection(page, /protected veteran/i, answer, emit, "Protected Veteran Status")) {
        return true;
    }

    const section = page.locator("[data-automation-id*='formField'], section, fieldset")
        .filter({ hasText: /protected veteran/i })
        .first();

    for (const candidate of demographicFallbacks(answer, "Protected Veteran Status")) {
        const option = section.getByText(candidate, { exact: false }).first();
        if (await option.count() > 0) {
            await option.click({ force: true });
            emit("field_filled", { field: "Protected Veteran Status", value: candidate, method: "veteran_label" });
            return true;
        }
    }

    return false;
}

function demographicFallbacks(answer, label) {
    const fallbacks = [answer];

    if (/gender/i.test(label)) {
        fallbacks.push("Female", "Woman", "Male", "Man", "I do not want to answer", "I don't wish to answer");
    }

    if (/veteran/i.test(label)) {
        fallbacks.push(
            "I AM NOT A PROTECTED VETERAN",
            "I am not a protected veteran",
            "I DON'T WISH TO ANSWER",
            "I do not want to answer"
        );
    }

    if (/disability/i.test(label)) {
        fallbacks.push(
            "No, I do not have a disability",
            "No, I don't have a disability",
            "I do not have a disability",
            "I do not want to answer",
            "I don't wish to answer"
        );
    }

    return [...new Set(fallbacks.filter(Boolean))];
}

async function fillWorkdayDemographicInSection(page, sectionPattern, answer, emit, label) {
    if (!answer) {
        return false;
    }

    const section = page.locator("[data-automation-id*='formField'], section, fieldset, div")
        .filter({ hasText: sectionPattern })
        .first();

    if (await section.count() === 0) {
        return false;
    }

    if (await fillWorkdayRadioInSection(page, sectionPattern, answer, emit, label)) {
        return true;
    }

    const dropdown = section.locator('button[aria-haspopup="listbox"], [role="combobox"]').first();
    if (await dropdown.count() === 0 || !await dropdown.isVisible().catch(() => false)) {
        return false;
    }

    await scrollWorkdayFieldIntoView(dropdown);
    await closeWorkdayPopups(page);

    for (const candidate of demographicFallbacks(answer, label)) {
        try {
            const selected = await selectWorkdayListboxOption(page, dropdown, candidate);
            emit("field_filled", { field: label, value: selected || candidate, method: "demographic_dropdown" });
            return true;
        } catch {
            try {
                await selectOption(dropdown, candidate, page, null, true);
                emit("field_filled", { field: label, value: candidate, method: "demographic_dropdown" });
                return true;
            } catch {
                // try the next Workday label variant
            }
        }
    }

    emit("field_failed", { field: label, message: `No option matching "${answer}"` });
    return false;
}

async function fillWorkdayGenderDropdown(page, answer, emit) {
    const label = "What is your gender?";
    const candidates = [...new Set([String(answer || "Female").trim(), "Female", "Woman"])].filter(Boolean);

    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
        const ready = await page.locator("[data-automation-id*='formField']")
            .filter({ hasText: /what is your gender/i })
            .locator('button[aria-haspopup="listbox"], [role="combobox"]')
            .first()
            .isVisible()
            .catch(() => false);
        if (ready) {
            break;
        }
        await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    const section = page.locator("[data-automation-id*='formField']").filter({ hasText: /what is your gender/i }).first();
    const dropdown = section.locator('button[aria-haspopup="listbox"], [role="combobox"]').first();
    if (await dropdown.count() === 0 || !await dropdown.isVisible().catch(() => false)) {
        emit("field_failed", { field: label, message: "Gender dropdown not found" });
        return false;
    }

    const current = String(await getWorkdayFieldValue(dropdown)).trim();
    if (current && !/^(please )?select one/i.test(current)
        && candidates.some((candidate) => optionMatches(current, candidate))) {
        emit("field_skipped", { field: label, reason: "already_set", value: current });
        return true;
    }

    for (const candidate of candidates) {
        try {
            const selected = await selectWorkdayListboxOption(page, dropdown, candidate);
            emit("field_filled", { field: label, value: selected || candidate, method: "gender_dropdown" });
            return true;
        } catch {
            await closeWorkdayPopups(page);
            await dropdown.click({ force: true });
            await page.waitForTimeout(600);
            const option = page.locator('[data-automation-id="promptOption"], [data-automation-id="menuItem"], [role="option"]')
                .filter({ hasText: new RegExp(`^${escapeRegExp(candidate)}$`, "i") })
                .first();
            if (await option.isVisible().catch(() => false)) {
                await option.click({ force: true });
                await page.waitForTimeout(PAUSE_SHORT);
                await closeWorkdayPopups(page);
                emit("field_filled", { field: label, value: candidate, method: "gender_option_click" });
                return true;
            }
            await closeWorkdayPopups(page);
        }
    }

    emit("field_failed", { field: label, message: `No option matching "${answer}"` });
    return false;
}

async function ensureWorkdayVoluntaryDisclosures(page, profile, emit) {
    const { getAnswer } = require("./answer-engine");
    let filled = 0;
    const demographics = profile.demographics || {};

    const genderAnswer = getAnswer("What is your gender?", profile) || profile.gender || "Female";
    if (await fillWorkdayGenderDropdown(page, genderAnswer, emit)) {
        filled += 1;
    }

    if (demographics.veteranStatus && await fillWorkdayVeteranStatus(page, demographics.veteranStatus, emit)) {
        filled += 1;
    }

    if (demographics.disabilityStatus
        && await fillWorkdayDemographicInSection(
            page,
            /disability|have a disability/i,
            demographics.disabilityStatus,
            emit,
            "Disability Status"
        )) {
        filled += 1;
    }

    const acknowledgmentRoots = [
        page.locator("[data-automation-id*='formField']").filter({
            hasText: /I acknowledge that I have read and understand how my information will be processed/i
        }).first(),
        page.locator("section, fieldset, div").filter({
            hasText: /I acknowledge that I have read and understand how my information will be processed/i
        }).first()
    ];

    for (const ackField of acknowledgmentRoots) {
        if (await ackField.count() === 0) {
            continue;
        }
        const ackCheckbox = ackField.locator('input[type="checkbox"]').first();
        if (await ackCheckbox.count() > 0 && !await ackCheckbox.isChecked().catch(() => false)) {
            const ackLabel = ackField.locator("label").first();
            if (await ackLabel.count() > 0) {
                await ackLabel.click({ force: true });
            } else {
                await ackCheckbox.check({ force: true });
            }
            filled += 1;
            emit("field_filled", {
                field: "I acknowledge that I have read and understand how my information will be processed.",
                method: "checkbox"
            });
            break;
        }
    }

    const termsField = page.locator("[data-automation-id*='formField']").filter({
        hasText: /terms and conditions|applicant privacy policy/i
    }).first();
    const termsCheckbox = termsField.locator('input[type="checkbox"]').first();

    if (await termsCheckbox.count() > 0 && !await termsCheckbox.isChecked().catch(() => false)) {
        await termsCheckbox.check({ force: true });
        filled += 1;
        emit("field_filled", { field: "Terms and Conditions", method: "checkbox" });
    }

    return filled;
}

async function ensureWorkdayApplicationQuestions(page, profile, emit, context = {}) {
    const { getAnswer } = require("./answer-engine");
    let filled = 0;

    const questions = [
        {
            pattern: /provide verification of your ident/i,
            label: "Can you provide verification of your identity upon hire?"
        },
        {
            pattern: /legally eligible to work in the job/i,
            label: "Are you legally eligible to work in the job's location?"
        },
        {
            pattern: /require sponsorship or assistance/i,
            label: "In order to begin or continue employment in the job's location, will you now or in the future require sponsorship or assistance?"
        },
        {
            pattern: /reach out to me via sms/i,
            label: "I agree that Visa may reach out to me via SMS regarding my application and candidate experience. Message and data rates may apply. I can opt-out at any time."
        },
        {
            pattern: /automated tools such as ai/i,
            label: "Visa may use automated tools such as AI to support review of your application. Opting out will not impact your eligibility for the position. Do you agree?"
        },
        {
            pattern: /legally authorized to work in the united states/i,
            label: "Are you legally authorized to work in the United States?"
        },
        {
            pattern: /require sponsorship for employment visa status/i,
            label: "Will you now or in the future require sponsorship for employment visa status (e.g. H-1B visa status)?"
        }
    ];

    for (const question of questions) {
        const answer = getAnswer(question.label, profile, context);
        if (!answer) {
            continue;
        }

        if (await fillWorkdayQuestionInSection(page, question.pattern, answer, emit, question.label)) {
            filled += 1;
        }
    }

    return filled;
}

async function openCollapsedMyExperienceSections(page, emit) {
    const collapsed = page.locator('[aria-expanded="false"][data-automation-id*="expand"], button[aria-expanded="false"]');
    const count = await collapsed.count();
    emit("workday_add_buttons_found", { selector: "expand_only", count });

    for (let index = 0; index < count; index += 1) {
        const button = collapsed.nth(index);
        if (!await button.isVisible().catch(() => false)) {
            continue;
        }

        await button.scrollIntoViewIfNeeded().catch(() => {});
        await button.click({ force: true, timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(PAUSE_SHORT);
    }
}

async function expandWorkdayExperienceSections(page, emit) {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await openCollapsedMyExperienceSections(page, emit);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(PAUSE_SHORT);
    await openCollapsedMyExperienceSections(page, emit);
}

async function readWorkdayMultiSelectValue(field) {
    const direct = String(await getWorkdayFieldValue(field).catch(() => "")).trim();
    if (direct && !/0 items selected/i.test(direct) && !/^(search|select)$/i.test(direct)) {
        return direct;
    }

    const container = field.locator(
        'xpath=ancestor::*[contains(@data-automation-id,"formField") or contains(@data-automation-id,"multiSelect")][1]'
    );
    if (await container.count() > 0) {
        const chip = container.locator(
            '[data-automation-id="selectedItem"], [data-automation-id="chip"], [data-automation-id="selectedItemList"] *'
        ).first();
        if (await chip.count() > 0) {
            const chipText = String(await chip.innerText().catch(() => "")).trim();
            if (chipText) {
                return chipText;
            }
        }

        const text = String(await container.innerText().catch(() => "")).trim();
        if (text && !/0 items selected/i.test(text)) {
            return text;
        }
    }

    return direct;
}

async function ensureWorkdayMyExperience(page, profile, emit, sessionFlags = {}) {
    emit("workday_my_experience_fill_start", {});
    let filled = 0;

    await expandWorkdayExperienceSections(page, emit);
    filled += await fillWorkdayWorkHistory(page, profile, emit, sessionFlags);
    filled += await fillWorkdayEducation(page, profile, emit, sessionFlags);

    const expectedWorkRows = sortWorkHistoryChronologically(profile.workHistory || []).length;
    let workRowsBeforeCleanup = await countWorkExperienceRows(page);
    if (expectedWorkRows > 0 && workRowsBeforeCleanup > expectedWorkRows) {
        await trimWorkExperienceRows(page, expectedWorkRows, emit);
        workRowsBeforeCleanup = await countWorkExperienceRows(page);
        emit("workday_work_history_trimmed_before_cleanup", { rowCount: workRowsBeforeCleanup, expected: expectedWorkRows });
    }
    emit("workday_work_history_before_cleanup", { rowCount: workRowsBeforeCleanup });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await openCollapsedMyExperienceSections(page, emit);
    filled += await removeWorkdayLanguageRowIfPresent(page, emit, sessionFlags);
    emit("workday_work_history_after_language_cleanup", { rowCount: await countWorkExperienceRows(page) });
    filled += await handleWorkdayCertifications(page, profile, emit, sessionFlags);
    emit("workday_work_history_after_cert_cleanup", { rowCount: await countWorkExperienceRows(page) });

    const workRowsAfterCleanup = await countWorkExperienceRows(page);
    emit("workday_work_history_after_cleanup", { rowCount: workRowsAfterCleanup });
    if (expectedWorkRows > 0 && workRowsAfterCleanup < expectedWorkRows) {
        emit("workday_work_history_row_lost", {
            before: workRowsBeforeCleanup,
            after: workRowsAfterCleanup,
            expected: expectedWorkRows,
            message: "Work experience row count dropped below profile history during optional-section cleanup"
        });
        sessionFlags.workHistoryInitialized = false;
        for (const key of [...sessionFlags.filledFields]) {
            if (/jobtitle|company|location|description|workdate/i.test(key)) {
                sessionFlags.filledFields.delete(key);
            }
        }
        filled += await fillWorkdayWorkHistory(page, profile, emit, sessionFlags);
        emit("workday_work_history_recovered", { rowCount: await countWorkExperienceRows(page) });
    }

    emit("workday_my_experience_fill_done", { filled });
    return filled;
}

async function isWorkHistoryComplete(page, profile) {
    const history = sortWorkHistoryChronologically(profile.workHistory || []);
    if (!history.length) {
        return true;
    }

    const rowCount = await getWorkExperienceTitleFields(page).count();
    if (rowCount < history.length) {
        return false;
    }

    for (let index = 0; index < history.length; index += 1) {
        const job = history[index];
        const titleField = getWorkExperienceTitleFields(page).nth(index);
        if (await titleField.count() === 0) {
            return false;
        }

        const titleValue = String(await getWorkdayFieldValue(titleField).catch(() => "")).trim();
        if (!workdayStrictTextMatch(job.title, titleValue)) {
            return false;
        }

        const companyField = getWorkExperienceCompanyFields(page).nth(index);
        const companyValue = String(await getWorkdayFieldValue(companyField).catch(() => "")).trim();
        if (!workdayStrictTextMatch(job.company, companyValue)) {
            return false;
        }

        const { monthInput, yearInput } = await resolveWorkExperienceDateSpinbuttons(page, index, "start");
        const startMonth = String(await getWorkdayFieldValue(monthInput).catch(() => "")).trim();
        const startYear = await yearInput.count() > 0
            ? String(await getWorkdayFieldValue(yearInput).catch(() => "")).trim()
            : "";
        const startValue = startYear ? `${startMonth}/${startYear}` : startMonth;
        const expectedStart = formatWorkdayMonthYear(job.startMonth, job.startYear);
        if (!expectedStart || !workDateFormattedMatches(expectedStart, startValue)) {
            return false;
        }

        if (!job.current && (job.endMonth || job.endYear)) {
            const endPair = await resolveWorkExperienceDateSpinbuttons(page, index, "end");
            const endMonth = String(await getWorkdayFieldValue(endPair.monthInput).catch(() => "")).trim();
            const endYear = await endPair.yearInput.count() > 0
                ? String(await getWorkdayFieldValue(endPair.yearInput).catch(() => "")).trim()
                : "";
            const endValue = endYear ? `${endMonth}/${endYear}` : endMonth;
            const expectedEnd = formatWorkdayMonthYear(job.endMonth, job.endYear);
            if (!expectedEnd || !workDateFormattedMatches(expectedEnd, endValue)) {
                return false;
            }
        }
    }

    return true;
}

async function isMyExperienceComplete(page, profile) {
    if (!await isWorkHistoryComplete(page, profile)) {
        return false;
    }

    if ((!Array.isArray(profile.certifications) || profile.certifications.length === 0)
        && await isWorkdayCertificationSectionPresent(page)) {
        return false;
    }

    if (profile.university) {
        const schoolField = page.locator(
            '[data-automation-id="formField-schoolName"] input, [data-automation-id*="schoolName"] input, input[aria-label*="School" i], input[aria-label*="University" i]'
        ).first();
        const schoolValue = await readWorkdayMultiSelectValue(schoolField);
        if (!schoolSelectionLooksValid(schoolValue)) {
            return false;
        }
    }

    if (profile.fieldOfStudy) {
        const fieldOfStudy = page.locator(
            '[data-automation-id="formField-fieldOfStudy"], [data-automation-id*="fieldOfStudy"]'
        ).first();
        const fieldText = String(await fieldOfStudy.innerText().catch(() => "")).trim();
        if (/0 items selected/i.test(fieldText)) {
            return false;
        }
    }

    const skillsSection = page.locator('[data-automation-id="skillsSection"], section, div')
        .filter({ hasText: /Skills/i })
        .first();
    const skillsField = skillsSection.locator(
        'input[aria-label*="Type to Add Skills" i], input[aria-label*="Add Skills" i]'
    ).first();
    const skillsBox = await resolveWorkdaySkillsBox(page, skillsField);
    const skillCount = await readWorkdaySkillsSelectedCount(skillsBox);
    if (!skillCount || skillCount <= 0) {
        return false;
    }

    if (profile.educationStartYear || profile.educationEndYear) {
        const educationSection = page.locator('[data-automation-id="educationSection"], section, div')
            .filter({ hasText: /Education/i })
            .first();
        const yearFields = educationSection.locator('[data-automation-id="dateSectionYear-input"]');
        const yearValues = [profile.educationStartYear, profile.educationEndYear];
        for (let index = 0; index < yearValues.length; index += 1) {
            const expected = String(yearValues[index] || "").trim();
            if (!expected || index >= await yearFields.count()) {
                continue;
            }
            const actual = String(await getWorkdayFieldValue(yearFields.nth(index)).catch(() => "")).trim();
            if (!actual || !workdayStrictTextMatch(expected, actual)) {
                return false;
            }
        }
    }

    return true;
}

async function ensureWorkdayMyInformationRequired(page, profile, emit, sessionFlags = {}) {
    if (sessionFlags.myInformationRequiredFilled) {
        emit("workday_my_information_skipped", { reason: "already_filled" });
        return 0;
    }

    let filled = 0;
    const hearLabel = "How Did You Hear About Us?";

    if (await isWorkdayHearAboutUsComplete(page, profile)) {
        sessionFlags.hearAboutHandled = true;
        emit("field_skipped", { field: hearLabel, reason: "already_set" });
    } else {
        const sourceField = page.locator(
            '#source--source, button[name="source"], [data-uxi-widget-type="selectinput"][id*="source"]'
        ).first();
        try {
            await fillWorkdayHearAboutUs(sourceField, profile, page, emit, sessionFlags);
            filled += 1;
            emit("field_filled", { field: hearLabel, cascade: "Job Board > LinkedIn Jobs" });
        } catch (error) {
            emit("field_failed", { field: hearLabel, message: error.message });
        }
    }

    const priorEmploymentPatterns = [
        {
            pattern: /ever worked for Visa Inc\. or any wholly/i,
            label: "Have you ever worked for Visa Inc.?"
        },
        {
            pattern: /ever worked for Visa/i,
            label: "Have you ever worked for Visa Inc.?"
        },
        {
            pattern: /previously worked for NVIDIA/i,
            label: "Have you previously worked for NVIDIA as an employee or contractor?"
        },
        {
            pattern: /worked for .* in any capacity/i,
            label: "Prior employment with employer"
        }
    ];

    const priorAnswer = profile.previousEmployee || "No";
    for (const entry of priorEmploymentPatterns) {
        const section = page.locator("[data-automation-id*='formField'], section, fieldset")
            .filter({ hasText: entry.pattern })
            .first();
        if (await section.count() === 0) {
            continue;
        }

        const wantsNo = /^no\b/i.test(priorAnswer);
        const target = wantsNo
            ? section.getByRole("radio", { name: /^no\b/i }).first()
            : section.getByRole("radio", { name: /^yes\b/i }).first();
        if (await target.count() === 0) {
            continue;
        }

        if (!await target.isChecked().catch(() => false)) {
            const didFill = await fillWorkdayRadioInSection(
                page,
                entry.pattern,
                priorAnswer,
                emit,
                entry.label
            );
            if (didFill) {
                filled += 1;
            } else if (!await target.isChecked().catch(() => false)) {
                await target.click({ force: true });
                await page.waitForTimeout(PAUSE_SHORT);
            }
        }

        if (await target.isChecked().catch(() => false)) {
            emit("field_filled", { field: entry.label, value: priorAnswer, method: "radio_verify" });
            filled += 1;
            break;
        }
    }

    sessionFlags.myInformationRequiredFilled = true;
    return filled;
}

function formatSelfIdentifyDate(date = new Date()) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = String(date.getFullYear());
    return `${month}/${day}/${year}`;
}

async function fillWorkdayDisabilityChoice(page, answer, emit) {
    const choiceSection = page.locator("[data-automation-id*='formField'], section, fieldset")
        .filter({ hasText: /please check one of the boxes below/i })
        .first();

    if (await choiceSection.count() === 0) {
        return false;
    }

    const candidates = demographicFallbacks(answer, "Disability Status");
    const inputs = choiceSection.locator('input[type="checkbox"], input[type="radio"]');
    const inputCount = await inputs.count();

    for (const candidate of candidates) {
        for (let index = 0; index < inputCount; index += 1) {
            const input = inputs.nth(index);
            const id = await input.getAttribute("id");
            const optionLabel = id
                ? page.locator(`label[for="${id}"]`).first()
                : input.locator("xpath=following-sibling::label[1]");
            const text = (await optionLabel.innerText().catch(() => "")).trim();

            if (!optionMatches(text, candidate)) {
                continue;
            }

            if (await input.isChecked().catch(() => false)) {
                emit("field_skipped", { field: "Disability Status", reason: "already_set", value: text });
                return false;
            }

            await optionLabel.click({ force: true });
            emit("field_filled", { field: "Disability Status", value: text, method: "disability_choice" });
            return true;
        }

        const textOption = choiceSection.getByText(candidate, { exact: false }).first();
        if (await textOption.count() > 0) {
            await textOption.click({ force: true });
            emit("field_filled", { field: "Disability Status", value: candidate, method: "disability_text" });
            return true;
        }
    }

    return false;
}

async function ensureWorkdaySelfIdentify(page, profile, emit) {
    let filled = 0;
    const demographics = profile.demographics || {};
    const today = new Date();
    const fullName = profile.fullName || [profile.firstName, profile.middleName, profile.lastName]
        .filter(Boolean)
        .join(" ");

    const nameField = page.locator('[data-automation-id*="formField"]')
        .filter({ hasText: /^Name\b/i })
        .locator('input:not([type="hidden"])')
        .first();

    if (await nameField.count() > 0) {
        const currentName = await getWorkdayFieldValue(nameField).catch(() => "");
        if (!currentName || currentName !== fullName) {
            await fillWorkdayField(nameField, fullName, page, { hint: "Name", force: true });
            filled += 1;
            emit("field_filled", { field: "Name", value: fullName });
        }
    }

    const dateValue = formatSelfIdentifyDate(today);
    const dateField = page.locator('[data-automation-id*="formField"]')
        .filter({ hasText: /^Date\b/i })
        .locator([
            'input:not([type="hidden"]):not([data-automation-id="dateSectionMonth-input"]):not([data-automation-id="dateSectionDay-input"]):not([data-automation-id="dateSectionYear-input"])',
            '[data-automation-id="dateSectionMonth-input"][id*="dateSignedOn"]'
        ].join(", "))
        .first();

    if (await dateField.count() > 0) {
        try {
            const automationId = await dateField.getAttribute("data-automation-id") || "";
            if (/dateSectionMonth-input/i.test(automationId)) {
                const monthInput = page.locator('[data-automation-id="dateSectionMonth-input"][id*="dateSignedOn"]').first();
                const dayInput = page.locator('[data-automation-id="dateSectionDay-input"][id*="dateSignedOn"]').first();
                const yearInput = page.locator('[data-automation-id="dateSectionYear-input"][id*="dateSignedOn"]').first();

                if (await monthInput.count() > 0) {
                    await fillSpinbuttonValue(monthInput, String(today.getMonth() + 1).padStart(2, "0"), page);
                }
                if (await dayInput.count() > 0) {
                    await fillSpinbuttonValue(dayInput, String(today.getDate()).padStart(2, "0"), page);
                }
                if (await yearInput.count() > 0) {
                    await fillSpinbuttonValue(yearInput, String(today.getFullYear()), page);
                }
            } else {
                await scrollWorkdayFieldIntoView(dateField);
                await dateField.fill(dateValue);
            }

            filled += 1;
            emit("field_filled", { field: "Disability Self-Identification Date", value: dateValue });
        } catch (error) {
            emit("field_failed", { field: "Disability Self-Identification Date", message: error.message });
        }
    }

    const disabilityAnswers = [
        demographics.disabilityStatus,
        "No, I do not have a disability",
        "I do not want to answer"
    ].filter(Boolean);

    for (const disabilityAnswer of [...new Set(disabilityAnswers)]) {
        if (await fillWorkdayDisabilityChoice(page, disabilityAnswer, emit)) {
            filled += 1;
            break;
        }
    }

    if (demographics.veteranStatus
        && await fillWorkdayDemographicInSection(
            page,
            /protected veteran/i,
            demographics.veteranStatus,
            emit,
            "Protected Veteran Status"
        )) {
        filled += 1;
    }

    const languageField = page.locator('[data-automation-id*="formField"]')
        .filter({ hasText: /language/i })
        .locator('button[aria-haspopup="listbox"], [role="combobox"]')
        .first();

    if (await languageField.count() > 0) {
        const currentLanguage = (await languageField.innerText().catch(() => "")).trim();
        if (!currentLanguage || /select/i.test(currentLanguage)) {
            try {
                await selectOption(languageField, "English", page, "English", true);
                filled += 1;
                emit("field_filled", { field: "Language", value: "English" });
            } catch (error) {
                emit("field_failed", { field: "Language", message: error.message });
            }
        }
    }

    return filled;
}

async function fillWorkdayHearAboutUs(field, profile, page, emit, sessionFlags = {}) {
    const category = profile.workdaySourceCategory || "Job Board";
    const detail = profile.workdaySourceDetail || "LinkedIn Jobs";

    if (sessionFlags.hearAboutHandled) {
        emit("field_skipped", { field: "How Did You Hear About Us?", reason: "session_locked" });
        return true;
    }

    try {
        await field.scrollIntoViewIfNeeded().catch(() => {});
        await closeWorkdayPopups(page);

        if (await isWorkdayHearAboutUsComplete(page, profile)) {
            sessionFlags.hearAboutHandled = true;
            emit("field_skipped", { field: "How Did You Hear About Us?", reason: "already_set" });
            return true;
        }

        const sourceButton = page.locator('button[name="source"], [id*="source"][aria-haspopup="listbox"]').first();
        const sourceInput = page.locator(
            '#source--source, [data-uxi-widget-type="selectinput"][id*="source"]'
        ).first();
        const opener = await sourceButton.count() > 0 && await sourceButton.isVisible().catch(() => false)
            ? sourceButton
            : (await sourceInput.count() > 0 ? sourceInput : field);

        try {
            await opener.click({ force: true, timeout: 5000 });
        } catch {
            await opener.focus().catch(() => {});
            await page.keyboard.press("ArrowDown").catch(() => {});
        }

        await page.locator(
            '[data-automation-id="promptLeafNode"], [data-automation-id="menuItem"], [data-automation-id="responsiveMonikerPrompt"], [role="listbox"]'
        ).first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(PAUSE_MED);
        await waitForWorkdayPromptReady(page);

        let categoryLabel;
        try {
            categoryLabel = await clickWorkdayPromptLeaf(page, category);
        } catch (error) {
            const searchBox = page.locator(
                '[data-automation-id="searchBox"] input, [data-automation-id="monikerSearchBox"] input, input[placeholder*="Search" i]'
            ).last();
            if (await searchBox.count() > 0 && await searchBox.isVisible().catch(() => false)) {
                await searchBox.fill(category);
                await page.waitForTimeout(PAUSE_SHORT);
                await page.keyboard.press("Enter").catch(() => {});
                categoryLabel = category;
            } else {
                throw error;
            }
        }
        emit("workday_source_category_selected", { category: categoryLabel || category });

        await page.waitForTimeout(PAUSE_MED);
        await waitForWorkdayPromptReady(page);

        let detailLabel;
        try {
            detailLabel = await clickWorkdayPromptLeaf(page, detail);
        } catch (error) {
            const searchBox = page.locator(
                '[data-automation-id="searchBox"] input, [data-automation-id="monikerSearchBox"] input, input[placeholder*="Search" i]'
            ).last();
            if (await searchBox.count() > 0 && await searchBox.isVisible().catch(() => false)) {
                await searchBox.fill(detail);
                await page.waitForTimeout(PAUSE_SHORT);
                await page.keyboard.press("Enter").catch(() => {});
                detailLabel = detail;
            } else {
                throw error;
            }
        }
        emit("workday_source_detail_selected", { detail: detailLabel || detail });

        await page.keyboard.press("Tab").catch(() => {});
        await page.waitForTimeout(PAUSE_SHORT);
        await closeWorkdayPopups(page);

        if (!await isWorkdayHearAboutUsComplete(page, profile)) {
            const sourceSearch = page.locator(
                '#source--source, [data-automation-id*="source"] input, input[aria-label*="How Did You Hear" i]'
            ).first();
            if (await sourceSearch.count() > 0 && await sourceSearch.isVisible().catch(() => false)) {
                await sourceSearch.click({ force: true }).catch(() => {});
                await sourceSearch.fill(detail);
                await page.waitForTimeout(PAUSE_SHORT);
                await page.keyboard.press("Enter").catch(() => {});
                await page.keyboard.press("Tab").catch(() => {});
                await page.waitForTimeout(PAUSE_SHORT);
            }
        }

        const complete = await isWorkdayHearAboutUsComplete(page, profile);
        sessionFlags.hearAboutHandled = complete;
        if (!complete) {
            emit("workday_source_verify_failed", { detail });
        }
        return complete;
    } finally {
        await closeWorkdayPopups(page);
    }
}

async function isWorkdayDropdownValueSet(field, expectedValue) {
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
    if (tagName !== "button") {
        return false;
    }

    const text = await field.innerText().catch(() => "");
    const requested = String(expectedValue || "").trim().toLowerCase();
    return requested.length > 0 && text.trim().toLowerCase().includes(requested);
}

async function fillWorkdayRadio(field, value, page) {
    await closeWorkdayPopups(page);

    const container = field.locator("xpath=ancestor::*[fieldset or @role='radiogroup'][1]");
    const inputs = container.locator("input[type='radio']");
    const count = await inputs.count();

    for (let index = 0; index < count; index += 1) {
        const input = inputs.nth(index);
        const id = await input.getAttribute("id");
        const label = id
            ? container.locator(`label[for="${id}"]`).first()
            : input.locator("xpath=following-sibling::label[1]");
        const text = await label.innerText().catch(() => "");

        if (optionMatches(text, value)) {
            await input.click({ force: true });
            return true;
        }
    }

    throw new Error(`No radio option matching "${value}"`);
}

async function fillWorkdayField(field, value, page, options = {}) {
    field = await resolveWorkdayFormField(field);
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase());
    const automationId = await field.getAttribute("data-automation-id");
    const type = (await field.getAttribute("type") || "").toLowerCase();
    const hint = options.hint || await getWorkdayFieldLabel(field) || "";
    const sessionFlags = options.sessionFlags;
    const fieldKey = options.fieldKey || workdayFieldKey(automationId, hint);

    if (isWorkdayFieldHandled(sessionFlags, fieldKey)) {
        return false;
    }

    if (await shouldSkipWorkdayFill(field, value, hint)) {
        markWorkdayFieldHandled(sessionFlags, fieldKey);
        return false;
    }

    if (automationId === "beecatcher" || type === "hidden") {
        return false;
    }

    if (type === "password" || automationId === "password" || automationId === "verifyPassword") {
        return false;
    }

    if (automationId === "createAccountCheckbox") {
        const affirmative = /^(yes|true|1|agree|accepted)$/i.test(String(value));
        await field.setChecked(affirmative);
        return true;
    }

    if (type === "radio") {
        const container = field.locator("xpath=ancestor::*[fieldset or @role='radiogroup'][1]");
        const selected = await container.locator("input[type='radio']:checked").first();
        if (await selected.count() > 0) {
            const selectedValue = await getWorkdayFieldValue(selected);
            if (workdayValuesMatch(value, selectedValue, hint)) {
                markWorkdayFieldHandled(sessionFlags, fieldKey);
                return false;
            }
        }

        await fillWorkdayRadio(field, value, page);
        markWorkdayFieldHandled(sessionFlags, fieldKey);
        return true;
    }

    if (tagName === "button" || (await field.getAttribute("role")) === "combobox") {
        const label = await getWorkdayFieldLabel(field);
        if (/\bstate\b/i.test(label || hint)) {
            await selectWorkdayStateField(page, field, value);
            markWorkdayFieldHandled(sessionFlags, fieldKey);
            return true;
        }

        const phoneFallbacks = /phone device type/i.test(label || "")
            ? ["Home", "Mobile", "Work", "Cell"]
            : null;
        const stateFallbacks = /\bstate\b/i.test(label || "")
            ? [value, "Haryana", "Haryana, India"]
            : null;
        const fallbacks = phoneFallbacks || stateFallbacks;

        const strictDemographic = /veteran|disability|ethnicity|race|gender/i.test(hint);

        try {
            await selectOption(field, value, page, fallbacks?.[0] || null, strictDemographic);
        } catch (error) {
            let selected = false;

            try {
                await selectWorkdayListboxOption(page, field, value);
                selected = true;
            } catch {
                // Fall back to alternate labels or Greenhouse-style selection.
            }

            if (!selected && fallbacks) {
                for (const fallback of fallbacks) {
                    try {
                        await selectWorkdayListboxOption(page, field, fallback);
                        selected = true;
                        break;
                    } catch {
                        try {
                            await selectOption(field, fallback, page);
                            selected = true;
                            break;
                        } catch {
                            // try next Workday dropdown label
                        }
                    }
                }
            }

            if (!selected) {
                throw error;
            }
        }
        markWorkdayFieldHandled(sessionFlags, fieldKey);
        return true;
    }

    await fillField(field, value, page);
    markWorkdayFieldHandled(sessionFlags, fieldKey);
    return true;
}

module.exports = {
    AUTOMATION_LABELS,
    completeWorkdayAuth,
    ensureCreateAccountForm,
    fillWorkdayField,
    clickWorkdaySectionAddByLabel,
    ensureWorkdayApplicationQuestions,
    ensureWorkdayMyExperience,
    gapFillPassThroughMyInformation,
    gapFillWorkdayMyExperience,
    unlockWorkdayFieldsFromValidation,
    ensureWorkdayMyInformationRequired,
    ensureWorkdayVoluntaryDisclosures,
    ensureWorkdaySelfIdentify,
    isMyExperienceComplete,
    fillWorkdayHearAboutUs,
    isWorkdayHearAboutUsComplete,
    getEducationDateLabelHint,
    getWorkdayFieldSection,
    isWorkdayDropdownValueSet,
    fillWorkdayEducation,
    fillWorkdaySkills,
    fillWorkdayWebsites,
    fillWorkdayWorkHistory,
    getEducationYearLabelHint,
    getWorkdayFieldLabel,
    resolveWorkdayQuestionLabel,
    getWorkdayFieldValue,
    shouldSkipWorkdayFill,
    workdayFieldKey,
    markWorkdayFieldHandled,
    isWorkdayFieldHandled,
    isWorkdayAccountExistsError,
    isWorkdayLoginRedirect,
    labelFromAutomationId,
    readWorkdayAuthError,
    submitWorkdayAuthForm
};
