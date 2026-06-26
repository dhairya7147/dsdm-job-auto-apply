const NON_ENGLISH_MARKERS = /\b(candidatura|vaga|sobrenome|nome de preferência|telefone|escolaridade|emploi|candidature|bewerbung|curriculum|currículo|trabajo|solicitud|traduzir|traduire|übersetzen|você|não|para a vaga|descripción del puesto|postuler|candidat)\b/i;

function isEnglishLanguage(lang = "") {
    const normalized = String(lang).trim().toLowerCase();
    return !normalized || normalized.startsWith("en");
}

function looksEnglish(sample = "") {
    const text = String(sample);
    if (!text.trim()) {
        return true;
    }

    if (NON_ENGLISH_MARKERS.test(text)) {
        return false;
    }

    const letters = (text.match(/[a-z]/gi) || []).length;
    const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
    return letters === 0 || nonAscii < letters * 0.08;
}

async function readPageLanguage(target) {
    return target.evaluate(() => {
        const lang = document.documentElement.lang
            || document.querySelector('meta[http-equiv="content-language"]')?.content
            || "";
        const sample = [
            document.title,
            document.body?.innerText?.slice(0, 800) || ""
        ].join(" ");

        return {
            lang: String(lang).trim().toLowerCase(),
            sample
        };
    }).catch(() => ({ lang: "", sample: "" }));
}

function needsEnglish({ lang, sample }) {
    return !isEnglishLanguage(lang) || !looksEnglish(sample);
}

async function trySelectEnglishControl(page) {
    const patterns = [/english/i, /^en$/i, /anglais/i];

    for (const pattern of patterns) {
        const link = page.getByRole("link", { name: pattern }).first();
        if (await link.isVisible().catch(() => false)) {
            await link.click();
            await page.waitForTimeout(1200);
            return "language_link";
        }

        const button = page.getByRole("button", { name: pattern }).first();
        if (await button.isVisible().catch(() => false)) {
            await button.click();
            await page.waitForTimeout(1200);
            return "language_button";
        }
    }

    for (const selector of [
        'a[href*="locale=en"]',
        'a[href*="lang=en"]',
        'a[href*="language=en"]',
        '[data-locale="en"]',
        '[data-language="en"]'
    ]) {
        const control = page.locator(selector).first();
        if (await control.isVisible().catch(() => false)) {
            await control.click();
            await page.waitForTimeout(1200);
            return "language_selector";
        }
    }

    const langSelect = page.locator('select[name*="lang" i], select[id*="lang" i]').first();
    if (await langSelect.count() > 0 && await langSelect.isVisible().catch(() => false)) {
        await langSelect.selectOption({ label: /english/i }).catch(() => langSelect.selectOption("en").catch(() => {}));
        await page.waitForTimeout(1200);
        return "language_select";
    }

    return null;
}

async function tryReloadWithEnglishLocale(page) {
    const currentUrl = page.url();
    if (!/^https?:/i.test(currentUrl)) {
        return false;
    }

    const url = new URL(currentUrl);
    if (url.searchParams.get("locale") === "en" || url.searchParams.get("lang") === "en") {
        return false;
    }

    url.searchParams.set("locale", "en");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(600);
    return true;
}

async function tryChromeTranslatePrompt(page) {
    const translateControl = page.locator("button, [role='button'], a").filter({
        hasText: /translate|traduzir|traduire|übersetzen/i
    }).first();

    if (!await translateControl.isVisible({ timeout: 1500 }).catch(() => false)) {
        return false;
    }

    await translateControl.click();
    await page.waitForTimeout(1500);

    const englishOption = page.locator("button, [role='menuitem'], a, div").filter({
        hasText: /^english$/i
    }).first();

    if (await englishOption.isVisible({ timeout: 1500 }).catch(() => false)) {
        await englishOption.click();
        await page.waitForTimeout(2000);
    }

    return true;
}

async function tryGoogleTranslateWidget(target) {
    await target.evaluate(() => new Promise((resolve, reject) => {
        if (document.documentElement.classList.contains("translated-ltr")
            || document.documentElement.lang?.toLowerCase().startsWith("en")) {
            resolve();
            return;
        }

        let container = document.getElementById("google_translate_element");
        if (!container) {
            container = document.createElement("div");
            container.id = "google_translate_element";
            container.style.display = "none";
            document.body.prepend(container);
        }

        const timeout = setTimeout(() => reject(new Error("Google Translate widget timed out")), 10000);

        window.__jobAutoApplyTranslateInit = () => {
            try {
                // eslint-disable-next-line no-undef
                new google.translate.TranslateElement({
                    pageLanguage: "auto",
                    includedLanguages: "en",
                    autoDisplay: false
                }, "google_translate_element");

                const selectEnglish = (attempt = 0) => {
                    const combo = document.querySelector(".goog-te-combo");
                    if (!combo) {
                        if (attempt >= 25) {
                            clearTimeout(timeout);
                            reject(new Error("Google Translate combo not found"));
                            return;
                        }
                        setTimeout(() => selectEnglish(attempt + 1), 200);
                        return;
                    }

                    combo.value = "en";
                    combo.dispatchEvent(new Event("change"));
                    setTimeout(() => {
                        clearTimeout(timeout);
                        resolve();
                    }, 2000);
                };

                selectEnglish();
            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        };

        if (document.getElementById("job-auto-apply-translate-script")) {
            window.__jobAutoApplyTranslateInit();
            return;
        }

        const script = document.createElement("script");
        script.id = "job-auto-apply-translate-script";
        script.src = "https://translate.google.com/translate_a/element.js?cb=__jobAutoApplyTranslateInit";
        script.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("Failed to load Google Translate script"));
        };
        document.head.appendChild(script);
    }));

    await target.waitForTimeout(1500);
}

function isPlaywrightPage(target) {
    return Boolean(target && typeof target.goto === "function" && typeof target.context === "function");
}

async function ensureTargetEnglish(target, emit, scope = "page") {
    let state = await readPageLanguage(target);
    if (!needsEnglish(state)) {
        return { translated: false, lang: state.lang || "en", scope };
    }

    emit("page_language_detected", { scope, lang: state.lang, needsTranslation: true });

    const switchMethod = await trySelectEnglishControl(target);
    if (switchMethod) {
        state = await readPageLanguage(target);
        if (!needsEnglish(state)) {
            emit("page_translated", { scope, method: switchMethod, lang: state.lang || "en" });
            return { translated: true, lang: state.lang || "en", scope, method: switchMethod };
        }
    }

    if (isPlaywrightPage(target)) {
        const reloaded = await tryReloadWithEnglishLocale(target);
        if (reloaded) {
            state = await readPageLanguage(target);
            if (!needsEnglish(state)) {
                emit("page_translated", { scope, method: "locale_query", lang: state.lang || "en" });
                return { translated: true, lang: state.lang || "en", scope, method: "locale_query" };
            }
        }

        await tryChromeTranslatePrompt(target).catch(() => false);
        state = await readPageLanguage(target);
        if (!needsEnglish(state)) {
            emit("page_translated", { scope, method: "chrome_prompt", lang: state.lang || "en" });
            return { translated: true, lang: state.lang || "en", scope, method: "chrome_prompt" };
        }
    }

    try {
        await tryGoogleTranslateWidget(target);
        state = await readPageLanguage(target);
        emit("page_translated", {
            scope,
            method: "google_translate_widget",
            lang: state.lang || "en",
            stillNonEnglish: needsEnglish(state)
        });
        return {
            translated: true,
            lang: state.lang || "en",
            scope,
            method: "google_translate_widget",
            stillNonEnglish: needsEnglish(state)
        };
    } catch (error) {
        emit("page_translation_failed", { scope, message: error.message, lang: state.lang });
        return { translated: false, lang: state.lang, scope, error: error.message };
    }
}

async function ensurePageEnglish(page, emit) {
    const main = await ensureTargetEnglish(page, emit, "main");
    if (main.translated && !main.stillNonEnglish) {
        return main;
    }

    let latest = main;
    for (const frame of page.frames()) {
        if (frame === page.mainFrame()) {
            continue;
        }

        const frameState = await readPageLanguage(frame);
        if (!needsEnglish(frameState)) {
            continue;
        }

        const frameResult = await ensureTargetEnglish(frame, emit, `frame:${frame.url()}`);
        latest = frameResult.translated ? frameResult : latest;
    }

    const finalState = await readPageLanguage(page);
    if (!needsEnglish(finalState)) {
        emit("page_language_ok", { lang: finalState.lang || "en" });
    }

    return latest;
}

function buildBrowserContextOptions(overrides = {}) {
    return {
        locale: "en-US",
        extraHTTPHeaders: {
            "Accept-Language": "en-US,en;q=0.9"
        },
        viewport: { width: 1440, height: 1000 },
        ...overrides
    };
}

function buildBrowserLaunchArgs() {
    return ["--lang=en-US", "--accept-lang=en-US,en"];
}

module.exports = {
    buildBrowserContextOptions,
    buildBrowserLaunchArgs,
    ensurePageEnglish,
    isEnglishLanguage,
    looksEnglish,
    needsEnglish
};
