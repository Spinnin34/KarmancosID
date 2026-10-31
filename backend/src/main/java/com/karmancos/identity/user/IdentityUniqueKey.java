package com.karmancos.identity.user;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Document("identity_unique_keys")
public class IdentityUniqueKey {
    @Id
    private String id;
    private String ownerId;

    protected IdentityUniqueKey() {
    }

    public IdentityUniqueKey(String id, String ownerId) {
        this.id = id;
        this.ownerId = ownerId;
    }

    public String getId() { return id; }
    public String getOwnerId() { return ownerId; }
}
