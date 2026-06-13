package com.dsdm.job_auto_apply.model;

public class ApplyRequest {

    private String jobUrl;
    private String jobLocation;
    private Boolean headless;
    private Long reviewTimeoutMs;

    public String getJobUrl() {
        return jobUrl;
    }

    public void setJobUrl(String jobUrl) {
        this.jobUrl = jobUrl;
    }

    public String getJobLocation() {
        return jobLocation;
    }

    public void setJobLocation(String jobLocation) {
        this.jobLocation = jobLocation;
    }

    public Boolean getHeadless() {
        return headless;
    }

    public void setHeadless(Boolean headless) {
        this.headless = headless;
    }

    public Long getReviewTimeoutMs() {
        return reviewTimeoutMs;
    }

    public void setReviewTimeoutMs(Long reviewTimeoutMs) {
        this.reviewTimeoutMs = reviewTimeoutMs;
    }
}
