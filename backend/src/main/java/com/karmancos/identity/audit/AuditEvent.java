package com.karmancos.identity.audit;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.UUID;

@Document("audit_events")
public class AuditEvent {
    @Id
    private String id;
    @Indexed
    private String actorEmail;
    private String action;
    private String subject;
    @Indexed
    private Instant occurredAt;

    protected AuditEvent() {
    }

    public AuditEvent(String actorEmail, String action, String subject) {
        this.id = UUID.randomUUID().toString();
        this.actorEmail = actorEmail;
        this.action = action;
        this.subject = subject;
        this.occurredAt = Instant.now();
    }

    public String getId() { return id; }
    public String getActorEmail() { return actorEmail; }
    public String getAction() { return action; }
    public String getSubject() { return subject; }
    public Instant getOccurredAt() { return occurredAt; }
}
