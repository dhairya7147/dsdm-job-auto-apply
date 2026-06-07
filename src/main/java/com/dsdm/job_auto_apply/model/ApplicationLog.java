package com.dsdm.job_auto_apply.model;

import java.time.Instant;

public record ApplicationLog(Instant timestamp, String stream, String message) {
}
