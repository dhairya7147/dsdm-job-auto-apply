package com.dsdm.job_auto_apply.model;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class ApplicationJobTests {

    @Test
    void tracksTheSuccessfulJobLifecycle() {
        ApplicationJob job = new ApplicationJob(UUID.randomUUID(), "https://example.com/jobs/1");

        assertThat(job.getStatus()).isEqualTo(ApplicationStatus.QUEUED);

        job.markRunning("/tmp/artifacts");
        job.addLog("stdout", "{\"event\":\"ready_for_review\"}");

        assertThat(job.getStatus()).isEqualTo(ApplicationStatus.READY_FOR_REVIEW);
        assertThat(job.getStartedAt()).isNotNull();
        assertThat(job.getLogs()).hasSize(1);

        job.finish(0);

        assertThat(job.getStatus()).isEqualTo(ApplicationStatus.COMPLETED);
        assertThat(job.getExitCode()).isZero();
        assertThat(job.getFinishedAt()).isNotNull();
    }

    @Test
    void recordsFailures() {
        ApplicationJob job = new ApplicationJob(UUID.randomUUID(), "https://example.com/jobs/1");

        job.fail("Could not start");

        assertThat(job.getStatus()).isEqualTo(ApplicationStatus.FAILED);
        assertThat(job.getLogs().getFirst().message()).contains("Could not start");
    }
}
