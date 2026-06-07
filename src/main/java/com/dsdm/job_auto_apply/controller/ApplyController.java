package com.dsdm.job_auto_apply.controller;

import com.dsdm.job_auto_apply.model.ApplicationJob;
import com.dsdm.job_auto_apply.model.ApplyRequest;
import com.dsdm.job_auto_apply.service.ApplicationJobService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.server.ResponseStatusException;

import java.util.Collection;
import java.util.UUID;

@RestController
@RequestMapping("/api/applications")
public class ApplyController {

    private final ApplicationJobService applicationJobService;

    public ApplyController(ApplicationJobService applicationJobService) {
        this.applicationJobService = applicationJobService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ApplicationJob create(@RequestBody ApplyRequest request) {
        if (request == null || request.getJobUrl() == null || request.getJobUrl().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "jobUrl is required");
        }

        try {
            return applicationJobService.start(request.getJobUrl());
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage(), exception);
        }
    }

    @GetMapping
    public Collection<ApplicationJob> list() {
        return applicationJobService.list();
    }

    @GetMapping("/{id}")
    public ApplicationJob get(@PathVariable UUID id) {
        return applicationJobService.find(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Application job not found"));
    }
}
