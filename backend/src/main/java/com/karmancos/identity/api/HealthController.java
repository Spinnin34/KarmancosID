package com.karmancos.identity.api;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.bson.Document;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.List;
import java.util.Set;

@RestController
public class HealthController {
    private final MongoTemplate mongoTemplate;

    public HealthController(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    @GetMapping("/api/health")
    Map<String, Object> health() {
        try {
            Document response = mongoTemplate.getDb().runCommand(new Document("connectionStatus", 1).append("showPrivileges", true));
            Document authInfo = response.get("authInfo", Document.class);
            List<Document> privileges = authInfo == null ? List.of() : authInfo.getList("authenticatedUserPrivileges", Document.class, List.of());
            String database = mongoTemplate.getDb().getName();
            Set<String> collections = Set.of("identity_users", "identity_unique_keys", "oauth_clients", "oauth_authorizations",
                    "oauth_consents", "audit_events", "auth_rate_limits", "account_action_tokens", "client_application_requests", "karmancos_sessions");
            boolean canRead = collections.stream().allMatch(collection -> allows(privileges, database, collection, "find"));
            boolean canWrite = collections.stream().allMatch(collection ->
                    allows(privileges, database, collection, "insert")
                            && allows(privileges, database, collection, "update")
                            && allows(privileges, database, collection, "remove"));
            boolean ready = canRead && canWrite;
            return Map.of("status", ready ? "ok" : "degraded", "service", "karmancos-identity",
                    "database", "reachable", "databaseRead", canRead, "databaseWrite", canWrite);
        } catch (DataAccessException exception) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "MongoDB no está disponible.");
        }
    }

    private boolean allows(List<Document> privileges, String database, String collection, String action) {
        return privileges.stream().anyMatch(privilege -> {
            Document resource = privilege.get("resource", Document.class);
            if (resource == null) return false;
            String resourceDatabase = resource.getString("db");
            String resourceCollection = resource.getString("collection");
            boolean coversDatabase = database.equals(resourceDatabase) && (resourceCollection == null || resourceCollection.isEmpty());
            boolean coversCollection = database.equals(resourceDatabase) && collection.equals(resourceCollection);
            boolean anyDatabase = Boolean.TRUE.equals(resource.getBoolean("anyResource"));
            List<String> actions = privilege.getList("actions", String.class, List.of());
            return (coversDatabase || coversCollection || anyDatabase) && (actions.contains(action) || actions.contains("*"));
        });
    }
}
