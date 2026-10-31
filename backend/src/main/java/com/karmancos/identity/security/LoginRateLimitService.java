package com.karmancos.identity.security;

import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;

@Service
public class LoginRateLimitService {
    private final MongoTemplate mongoTemplate;

    public LoginRateLimitService(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    public LimitResult consume(String category, String address, String identifier, int limit, Duration window) {
        Instant now = Instant.now();
        Instant cutoff = now.minus(window);
        String key = digest(category + "\u0000" + address + "\u0000" + identifier);

        Query expired = Query.query(Criteria.where("_id").is(key).and("windowStartedAt").lt(cutoff));
        LoginRateLimitBucket bucket = mongoTemplate.findAndModify(
                expired,
                new Update().set("windowStartedAt", now).set("requestCount", 1L),
                FindAndModifyOptions.options().returnNew(true),
                LoginRateLimitBucket.class);

        if (bucket == null) {
            Query byKey = Query.query(Criteria.where("_id").is(key));
            Update increment = new Update()
                    .setOnInsert("windowStartedAt", now)
                    .inc("requestCount", 1L);
            bucket = mongoTemplate.findAndModify(
                    byKey,
                    increment,
                    FindAndModifyOptions.options().upsert(true).returnNew(true),
                    LoginRateLimitBucket.class);
        }

        if (bucket.getRequestCount() <= limit) {
            return new LimitResult(true, 0);
        }
        long retrySeconds = Math.max(1, Duration.between(now, bucket.getWindowStartedAt().plus(window)).toSeconds());
        return new LimitResult(false, retrySeconds);
    }

    @Scheduled(cron = "0 17 * * * *")
    void removeExpiredBuckets() {
        mongoTemplate.remove(Query.query(Criteria.where("windowStartedAt").lt(Instant.now().minus(Duration.ofDays(2)))), LoginRateLimitBucket.class);
    }

    private String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    public record LimitResult(boolean allowed, long retryAfterSeconds) {
    }
}
