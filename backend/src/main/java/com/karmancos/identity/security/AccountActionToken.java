package com.karmancos.identity.security;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

@Document("account_action_tokens")
public class AccountActionToken {
    @Id
    private String digest;
    @Indexed
    private String userId;
    private String targetEmail;
    private String purpose;
    private Instant expiresAt;
    @Indexed(expireAfter = "0s")
    private Instant purgeAt;

    protected AccountActionToken() { }

    public AccountActionToken(String digest, String userId, String targetEmail, String purpose, Instant expiresAt) {
        this.digest = digest;
        this.userId = userId;
        this.targetEmail = targetEmail;
        this.purpose = purpose;
        this.expiresAt = expiresAt;
        this.purgeAt = expiresAt.plusSeconds(86400);
    }

    public String getDigest() { return digest; }
    public String getUserId() { return userId; }
    public String getTargetEmail() { return targetEmail; }
    public String getPurpose() { return purpose; }
    public Instant getExpiresAt() { return expiresAt; }
}
