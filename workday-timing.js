// Tunable Workday pacing — lower = faster, but too low can flake on slow networks.
const PAUSE_TINY = 120;
const PAUSE_SHORT = 250;
const PAUSE_MED = 500;
const PAUSE_LONG = 900;

const POLL_INTERVAL_MS = 350;
const STEP_READY_BUFFER_MS = 300;
const ROW_ADD_WAIT_MS = 1500;
const ADVANCE_WAIT_MS = 700;
const NETWORK_IDLE_MS = 5000;

module.exports = {
    PAUSE_TINY,
    PAUSE_SHORT,
    PAUSE_MED,
    PAUSE_LONG,
    POLL_INTERVAL_MS,
    STEP_READY_BUFFER_MS,
    ROW_ADD_WAIT_MS,
    ADVANCE_WAIT_MS,
    NETWORK_IDLE_MS
};
