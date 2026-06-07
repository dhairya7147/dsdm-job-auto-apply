package com.dsdm.job_auto_apply.model;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class ApplicationJob {

    private final UUID id;
    private final String jobUrl;
    private final Instant createdAt;
    private final List<ApplicationLog> logs = new ArrayList<>();
    private ApplicationStatus status;
    private Instant startedAt;
    private Instant finishedAt;
    private Integer exitCode;
    private String artifactDirectory;

    public ApplicationJob(UUID id, String jobUrl) {
        this.id = id;
        this.jobUrl = jobUrl;
        this.createdAt = Instant.now();
        this.status = ApplicationStatus.QUEUED;
    }

    public UUID getId() {
        return id;
    }

    public String getJobUrl() {
        return jobUrl;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public synchronized ApplicationStatus getStatus() {
        return status;
    }

    public synchronized Instant getStartedAt() {
        return startedAt;
    }

    public synchronized Instant getFinishedAt() {
        return finishedAt;
    }

    public synchronized Integer getExitCode() {
        return exitCode;
    }

    public synchronized String getArtifactDirectory() {
        return artifactDirectory;
    }

    public synchronized List<ApplicationLog> getLogs() {
        return List.copyOf(logs);
    }

    public synchronized void markRunning(String artifactDirectory) {
        this.status = ApplicationStatus.RUNNING;
        this.startedAt = Instant.now();
        this.artifactDirectory = artifactDirectory;
    }

    public synchronized void markReadyForReview() {
        if (status == ApplicationStatus.RUNNING) {
            status = ApplicationStatus.READY_FOR_REVIEW;
        }
    }

    public synchronized void finish(int exitCode) {
        this.exitCode = exitCode;
        this.finishedAt = Instant.now();
        this.status = exitCode == 0 ? ApplicationStatus.COMPLETED : ApplicationStatus.FAILED;
    }

    public synchronized void fail(String message) {
        logs.add(new ApplicationLog(Instant.now(), "system", message));
        finishedAt = Instant.now();
        status = ApplicationStatus.FAILED;
    }

    public synchronized void addLog(String stream, String message) {
        logs.add(new ApplicationLog(Instant.now(), stream, message));
        if (logs.size() > 500) {
            logs.removeFirst();
        }
        if (message.contains("\"event\":\"ready_for_review\"")) {
            markReadyForReview();
        }
    }
}
