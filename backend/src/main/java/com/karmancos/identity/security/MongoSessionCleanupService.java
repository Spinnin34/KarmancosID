package com.karmancos.identity.security;

import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Date;

@Service
public class MongoSessionCleanupService {
    private final MongoTemplate mongoTemplate;

    public MongoSessionCleanupService(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    @Scheduled(cron = "0 */5 * * * *")
    void removeExpiredSessions() {
        mongoTemplate.remove(Query.query(Criteria.where("expireAt").lt(Date.from(Instant.now()))), "karmancos_sessions");
    }
}
