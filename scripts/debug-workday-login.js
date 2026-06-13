const { chromium } = require("playwright");

async function main() {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage();
    const url = "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/login?redirect=%2Fen-US%2FNVIDIAExternalCareerSite%2Fjob%2FIsrael-Yokneam%2FSoftware-Engineer--SPE_JR2015623%2Fapply%2FapplyManually";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(8000);
    const info = await page.evaluate(() => ({
        title: document.title,
        body: document.body.innerText.slice(0, 1500),
        inputs: [...document.querySelectorAll("input")].map((el) => ({
            type: el.type,
            automationId: el.getAttribute("data-automation-id"),
            visible: el.offsetParent !== null
        }))
    }));
    console.log(JSON.stringify(info, null, 2));
    await browser.close();
}

main();
