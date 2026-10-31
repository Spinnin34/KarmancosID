package com.karmancos.identity.security;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsent;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

@Repository
public class MongoAuthorizationConsentService implements OAuth2AuthorizationConsentService {
    private final MongoTemplate mongoTemplate;
    private final RegisteredClientRepository clients;

    public MongoAuthorizationConsentService(MongoTemplate mongoTemplate, RegisteredClientRepository clients) {
        this.mongoTemplate = mongoTemplate;
        this.clients = clients;
    }

    @Override
    public void save(OAuth2AuthorizationConsent consent) {
        ConsentDocument document = new ConsentDocument();
        document.id = idFor(consent.getRegisteredClientId(), consent.getPrincipalName());
        document.registeredClientId = consent.getRegisteredClientId();
        document.principalName = consent.getPrincipalName();
        document.authorities = consent.getAuthorities().stream().map(authority -> authority.getAuthority()).toList();
        mongoTemplate.save(document);
    }

    @Override
    public void remove(OAuth2AuthorizationConsent consent) {
        mongoTemplate.remove(Query.query(Criteria.where("_id").is(idFor(consent.getRegisteredClientId(), consent.getPrincipalName()))), ConsentDocument.class);
    }

    @Override
    public OAuth2AuthorizationConsent findById(String registeredClientId, String principalName) {
        ConsentDocument document = mongoTemplate.findById(idFor(registeredClientId, principalName), ConsentDocument.class);
        if (document == null) return null;

        RegisteredClient client = clients.findById(document.registeredClientId);
        if (client == null) return null;
        OAuth2AuthorizationConsent.Builder builder = OAuth2AuthorizationConsent.withId(client.getId(), document.principalName);
        document.authorities.forEach(value -> builder.authority(new SimpleGrantedAuthority(value)));
        return builder.build();
    }

    public void removeByClientId(String clientId) {
        mongoTemplate.remove(Query.query(Criteria.where("registeredClientId").is(clientId)), ConsentDocument.class);
    }

    public void removeByPrincipalName(String principalName) {
        mongoTemplate.remove(Query.query(Criteria.where("principalName").is(principalName)), ConsentDocument.class);
    }

    public void removeByClientIdAndPrincipalName(String clientId, String principalName) {
        mongoTemplate.remove(Query.query(Criteria.where("registeredClientId").is(clientId)
                .and("principalName").is(principalName)), ConsentDocument.class);
    }

    public List<ConsentSummary> listForPrincipalName(String principalName) {
        return mongoTemplate.find(Query.query(Criteria.where("principalName").is(principalName)), ConsentDocument.class)
                .stream().map(document -> {
                    RegisteredClient client = clients.findById(document.registeredClientId);
                    if (client == null) return null;
                    List<String> scopes = document.authorities.stream().map(value -> value.replaceFirst("^SCOPE_", "")).toList();
                    return new ConsentSummary(client.getId(), client.getClientName(), scopes);
                }).filter(java.util.Objects::nonNull).toList();
    }

    public record ConsentSummary(String id, String name, List<String> scopes) { }

    private String idFor(String clientId, String principalName) {
        try {
            byte[] input = (clientId + "\u0000" + principalName).getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    @Document("oauth_consents")
    static class ConsentDocument {
        @Id
        String id;
        @Indexed
        String registeredClientId;
        @Indexed
        String principalName;
        List<String> authorities = List.of();
    }
}
