package com.dsdm.job_auto_apply.service;

import com.dsdm.job_auto_apply.model.ApplicationJob;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collection;
import java.util.Comparator;
import java.util.Optional;
import java.util.UUID;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class ApplicationJobService {

    private final ConcurrentHashMap<UUID, ApplicationJob> jobs = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Path projectDirectory;
    private final String nodeCommand;
    private final String profilePath;
    private final boolean headless;
    private final long reviewTimeoutMs;

    public ApplicationJobService(
            @Value("${job-auto-apply.project-directory:${user.dir}}") String projectDirectory,
            @Value("${job-auto-apply.node-command:node}") String nodeCommand,
            @Value("${job-auto-apply.profile-path:profile.json}") String profilePath,
            @Value("${job-auto-apply.headless:false}") boolean headless,
            @Value("${job-auto-apply.review-timeout-ms:60000}") long reviewTimeoutMs
    ) {
        this.projectDirectory = Path.of(projectDirectory).toAbsolutePath().normalize();
        this.nodeCommand = nodeCommand;
        this.profilePath = profilePath;
        this.headless = headless;
        this.reviewTimeoutMs = reviewTimeoutMs;
    }

    public ApplicationJob start(String jobUrl) {
        return start(jobUrl, null, null, null);
    }

    public ApplicationJob start(
            String jobUrl,
            String jobLocation,
            Boolean headlessOverride,
            Long reviewTimeoutOverride
    ) {
        validateJobUrl(jobUrl);

        ApplicationJob job = new ApplicationJob(UUID.randomUUID(), jobUrl);
        jobs.put(job.getId(), job);
        executor.submit(() -> run(job, jobLocation, headlessOverride, reviewTimeoutOverride));
        return job;
    }

    public Optional<ApplicationJob> find(UUID id) {
        return Optional.ofNullable(jobs.get(id));
    }

    public Collection<ApplicationJob> list() {
        return jobs.values().stream()
                .sorted(Comparator.comparing(ApplicationJob::getCreatedAt).reversed())
                .toList();
    }

    private void validateJobUrl(String jobUrl) {
        URI uri;
        try {
            uri = URI.create(jobUrl);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("jobUrl must be a valid URL", exception);
        }

        if (!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalArgumentException("jobUrl must use http or https");
        }
        if (uri.getHost() == null || uri.getHost().isBlank()) {
            throw new IllegalArgumentException("jobUrl must include a host");
        }
    }

    private void run(ApplicationJob job, String jobLocation, Boolean headlessOverride, Long reviewTimeoutOverride) {
        Path artifactDirectory = projectDirectory.resolve("artifacts").resolve(job.getId().toString());
        boolean runHeadless = headlessOverride != null ? headlessOverride : headless;
        long runReviewTimeoutMs = reviewTimeoutOverride != null ? reviewTimeoutOverride : reviewTimeoutMs;

        try {
            Files.createDirectories(artifactDirectory);
            job.markRunning(artifactDirectory.toString());

            ProcessBuilder processBuilder = new ProcessBuilder(
                    nodeCommand,
                    "apply.js",
                    job.getJobUrl(),
                    "--profile",
                    profilePath,
                    "--artifact-dir",
                    artifactDirectory.toString(),
                    "--review-timeout-ms",
                    Long.toString(runReviewTimeoutMs)
            );
            if (runHeadless) {
                processBuilder.command().add("--headless");
            }
            if (jobLocation != null && !jobLocation.isBlank()) {
                processBuilder.command().add("--job-location");
                processBuilder.command().add(jobLocation);
            }
            processBuilder.directory(projectDirectory.toFile());
            configureChildProcessEnvironment(processBuilder.environment());

            Process process = processBuilder.start();
            executor.submit(() -> capture(process.getInputStream(), "stdout", job));
            executor.submit(() -> capture(process.getErrorStream(), "stderr", job));
            job.finish(process.waitFor());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            job.fail("Application process was interrupted");
        } catch (IOException exception) {
            job.fail("Could not start application process: " + exception.getMessage());
        }
    }

    private void configureChildProcessEnvironment(Map<String, String> environment) {
        String browsersPath = environment.get("PLAYWRIGHT_BROWSERS_PATH");
        if (browsersPath != null && browsersPath.contains("cursor-sandbox-cache")) {
            environment.remove("PLAYWRIGHT_BROWSERS_PATH");
        }
    }

    private void capture(InputStream inputStream, String stream, ApplicationJob job) {
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(inputStream, StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                job.addLog(stream, line);
            }
        } catch (IOException exception) {
            job.addLog("system", "Could not read " + stream + ": " + exception.getMessage());
        }
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
