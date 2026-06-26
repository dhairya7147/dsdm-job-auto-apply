const { prepareAshbyApplication } = require("../platforms/ashby/adapter");
const { prepareGreenhouseApplication } = require("../platforms/greenhouse/adapter");
const { prepareLeverApplication } = require("../platforms/lever/adapter");
const { prepareSmartRecruitersApplication } = require("../platforms/smartrecruiters/adapter");
const { prepareWorkdayApplication } = require("../platforms/workday/adapter");
const { requirePlatform } = require("./platform-registry");

const ADAPTERS = {
    ashby: prepareAshbyApplication,
    greenhouse: prepareGreenhouseApplication,
    lever: prepareLeverApplication,
    smartrecruiters: prepareSmartRecruitersApplication,
    workday: prepareWorkdayApplication
};

async function prepareApplication(page, profile, emit, applicationContext) {
    const platform = applicationContext.platform || requirePlatform(applicationContext.jobUrl);
    const adapter = ADAPTERS[platform];

    if (!adapter) {
        throw new Error(`No adapter registered for platform: ${platform}`);
    }

    emit("platform_detected", { platform });
    return adapter(page, profile, emit, { ...applicationContext, platform });
}

module.exports = {
    ADAPTERS,
    prepareApplication
};
