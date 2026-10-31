package com.karmancos.identity.security;

import org.springframework.data.annotation.Id;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.OAuth2TokenFormat;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.stereotype.Repository;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Repository
public class MongoRegisteredClientRepository implements RegisteredClientRepository {
    private final MongoTemplate mongoTemplate;

    public MongoRegisteredClientRepository(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    @Override
    public void save(RegisteredClient registeredClient) {
        mongoTemplate.save(ClientDocument.from(registeredClient));
    }

    @Override
    public RegisteredClient findById(String id) {
        ClientDocument document = mongoTemplate.findById(id, ClientDocument.class);
        return document == null ? null : document.toRegisteredClient();
    }

    @Override
    public RegisteredClient findByClientId(String clientId) {
        ClientDocument document = mongoTemplate.findOne(
                Query.query(org.springframework.data.mongodb.core.query.Criteria.where("clientId").is(clientId)),
                ClientDocument.class);
        return document == null ? null : document.toRegisteredClient();
    }

    public List<RegisteredClient> findAll() {
        return mongoTemplate.find(new Query().with(Sort.by(Sort.Direction.DESC, "clientIdIssuedAt")), ClientDocument.class)
                .stream().map(ClientDocument::toRegisteredClient).toList();
    }

    public long count() {
        return mongoTemplate.count(new Query(), ClientDocument.class);
    }

    public List<String> allowedOrigins() {
        return mongoTemplate.find(new Query(), ClientDocument.class).stream()
                .flatMap(document -> document.allowedOrigins.stream()).distinct().toList();
    }

    public void deleteById(String id) {
        mongoTemplate.remove(Query.query(org.springframework.data.mongodb.core.query.Criteria.where("_id").is(id)), ClientDocument.class);
    }

    @Document("oauth_clients")
    static class ClientDocument {
        @Id
        String id;
        @Indexed(unique = true, name = "uk_oauth_client_id")
        String clientId;
        Instant clientIdIssuedAt;
        String clientSecret;
        Instant clientSecretExpiresAt;
        String clientName;
        List<String> clientAuthenticationMethods = new ArrayList<>();
        List<String> authorizationGrantTypes = new ArrayList<>();
        List<String> redirectUris = new ArrayList<>();
        List<String> postLogoutRedirectUris = new ArrayList<>();
        List<String> allowedOrigins = new ArrayList<>();
        List<String> scopes = new ArrayList<>();
        boolean requireProofKey;
        boolean requireAuthorizationConsent;
        String accessTokenTimeToLive;
        String refreshTokenTimeToLive;
        boolean reuseRefreshTokens;
        String accessTokenFormat;

        static ClientDocument from(RegisteredClient client) {
            ClientDocument document = new ClientDocument();
            document.id = client.getId();
            document.clientId = client.getClientId();
            document.clientIdIssuedAt = client.getClientIdIssuedAt();
            document.clientSecret = client.getClientSecret();
            document.clientSecretExpiresAt = client.getClientSecretExpiresAt();
            document.clientName = client.getClientName();
            client.getClientAuthenticationMethods().forEach(value -> document.clientAuthenticationMethods.add(value.getValue()));
            client.getAuthorizationGrantTypes().forEach(value -> document.authorizationGrantTypes.add(value.getValue()));
            document.redirectUris.addAll(client.getRedirectUris());
            document.postLogoutRedirectUris.addAll(client.getPostLogoutRedirectUris());
            Object origins = client.getClientSettings().getSetting("karmancos.allowed-origins");
            if (origins instanceof List<?> values) values.stream().filter(String.class::isInstance).map(String.class::cast).forEach(document.allowedOrigins::add);
            document.scopes.addAll(client.getScopes());
            document.requireProofKey = client.getClientSettings().isRequireProofKey();
            document.requireAuthorizationConsent = client.getClientSettings().isRequireAuthorizationConsent();
            document.accessTokenTimeToLive = client.getTokenSettings().getAccessTokenTimeToLive().toString();
            document.refreshTokenTimeToLive = client.getTokenSettings().getRefreshTokenTimeToLive().toString();
            document.reuseRefreshTokens = client.getTokenSettings().isReuseRefreshTokens();
            document.accessTokenFormat = client.getTokenSettings().getAccessTokenFormat().getValue();
            return document;
        }

        RegisteredClient toRegisteredClient() {
            RegisteredClient.Builder builder = RegisteredClient.withId(id)
                    .clientId(clientId)
                    .clientName(clientName)
                    .clientSettings(ClientSettings.builder()
                            .requireProofKey(requireProofKey)
                            .requireAuthorizationConsent(requireAuthorizationConsent)
                            .build())
                    .tokenSettings(TokenSettings.builder()
                            .accessTokenTimeToLive(Duration.parse(accessTokenTimeToLive))
                            .refreshTokenTimeToLive(Duration.parse(refreshTokenTimeToLive))
                            .reuseRefreshTokens(reuseRefreshTokens)
                            .accessTokenFormat(new OAuth2TokenFormat(accessTokenFormat))
                            .build());
            if (clientIdIssuedAt != null) builder.clientIdIssuedAt(clientIdIssuedAt);
            if (clientSecret != null) builder.clientSecret(clientSecret);
            if (clientSecretExpiresAt != null) builder.clientSecretExpiresAt(clientSecretExpiresAt);
            clientAuthenticationMethods.forEach(value -> builder.clientAuthenticationMethod(new ClientAuthenticationMethod(value)));
            authorizationGrantTypes.forEach(value -> builder.authorizationGrantType(new AuthorizationGrantType(value)));
            redirectUris.forEach(builder::redirectUri);
            postLogoutRedirectUris.forEach(builder::postLogoutRedirectUri);
            builder.clientSettings(ClientSettings.builder().requireProofKey(requireProofKey)
                    .requireAuthorizationConsent(requireAuthorizationConsent)
                    .settings(settings -> settings.put("karmancos.allowed-origins", List.copyOf(allowedOrigins)))
                    .build());
            scopes.forEach(builder::scope);
            return builder.build();
        }
    }
}
