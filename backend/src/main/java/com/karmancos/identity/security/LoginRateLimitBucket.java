package com.karmancos.identity.security;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

@Document("auth_rate_limits")
public class LoginRateLimitBucket {
    @Id
    private String key;
    private Instant windowStartedAt;
    private long requestCount;

    protected LoginRateLimitBucket() {
    }

    public LoginRateLimitBucket(String key, Instant windowStartedAt, long requestCount) {
        this.key = key;
        this.windowStartedAt = windowStartedAt;
        this.requestCount = requestCount;
    }

    public String getKey() { return key; }
    public Instant getWindowStartedAt() { return windowStartedAt; }
    public long getRequestCount() { return requestCount; }
}
