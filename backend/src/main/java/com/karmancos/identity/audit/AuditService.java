package com.karmancos.identity.audit;

import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class AuditService {
    private final MongoTemplate mongoTemplate;

    public AuditService(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    public void record(String actor, String action, String subject) {
        mongoTemplate.save(new AuditEvent(actor, action, subject));
    }

    public List<AuditEvent> listRecent(int limit) {
        Query query = new Query().with(Sort.by(Sort.Direction.DESC, "occurredAt")).limit(limit);
        return mongoTemplate.find(query, AuditEvent.class);
    }
}
