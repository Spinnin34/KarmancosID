package com.karmancos.identity.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.Module;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.security.jackson2.SecurityJackson2Modules;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.OAuth2AccessToken;
import org.springframework.security.oauth2.core.OAuth2RefreshToken;
import org.springframework.security.oauth2.core.OAuth2Token;
import org.springframework.security.oauth2.core.OAuth2UserCode;
import org.springframework.security.oauth2.core.endpoint.OAuth2ParameterNames;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.endpoint.OidcParameterNames;
import org.springframework.security.oauth2.server.authorization.OAuth2Authorization;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationCode;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.jackson2.OAuth2AuthorizationServerJackson2Module;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

@Repository
public class MongoOAuth2AuthorizationService implements OAuth2AuthorizationService {
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() { };

    private final MongoTemplate mongoTemplate;
    private final RegisteredClientRepository clients;
    private final ObjectMapper objectMapper;

    public MongoOAuth2AuthorizationService(MongoTemplate mongoTemplate, RegisteredClientRepository clients) {
        this.mongoTemplate = mongoTemplate;
        this.clients = clients;
        this.objectMapper = new ObjectMapper();
        ClassLoader classLoader = MongoOAuth2AuthorizationService.class.getClassLoader();
        this.objectMapper.registerModules(SecurityJackson2Modules.getModules(classLoader));
        this.objectMapper.registerModule(new OAuth2AuthorizationServerJackson2Module());
    }

    @Override
    public void save(OAuth2Authorization authorization) {
        mongoTemplate.save(AuthorizationDocument.from(authorization, this::writeMap));
    }

    @Override
    public void remove(OAuth2Authorization authorization) {
        mongoTemplate.remove(Query.query(Criteria.where("_id").is(authorization.getId())), AuthorizationDocument.class);
    }

    @Override
    public OAuth2Authorization findById(String id) {
        AuthorizationDocument document = mongoTemplate.findById(id, AuthorizationDocument.class);
        return document == null ? null : document.toAuthorization(clients, this::readMap);
    }

    @Override
    public OAuth2Authorization findByToken(String token, OAuth2TokenType tokenType) {
        if (!StringUtils.hasText(token)) return null;
        Criteria criteria;
        if (tokenType == null) {
            criteria = new Criteria().orOperator(
                    Criteria.where("state").is(token),
                    Criteria.where("authorizationCodeValue").is(token),
                    Criteria.where("accessTokenValue").is(token),
                    Criteria.where("oidcIdTokenValue").is(token),
                    Criteria.where("refreshTokenValue").is(token),
                    Criteria.where("userCodeValue").is(token),
                    Criteria.where("deviceCodeValue").is(token));
        } else if (OAuth2ParameterNames.STATE.equals(tokenType.getValue())) {
            criteria = Criteria.where("state").is(token);
        } else if (OAuth2ParameterNames.CODE.equals(tokenType.getValue())) {
            criteria = Criteria.where("authorizationCodeValue").is(token);
        } else if (OAuth2TokenType.ACCESS_TOKEN.equals(tokenType)) {
            criteria = Criteria.where("accessTokenValue").is(token);
        } else if (OidcParameterNames.ID_TOKEN.equals(tokenType.getValue())) {
            criteria = Criteria.where("oidcIdTokenValue").is(token);
        } else if (OAuth2TokenType.REFRESH_TOKEN.equals(tokenType)) {
            criteria = Criteria.where("refreshTokenValue").is(token);
        } else if (OAuth2ParameterNames.USER_CODE.equals(tokenType.getValue())) {
            criteria = Criteria.where("userCodeValue").is(token);
        } else if (OAuth2ParameterNames.DEVICE_CODE.equals(tokenType.getValue())) {
            criteria = Criteria.where("deviceCodeValue").is(token);
        } else {
            return null;
        }
        AuthorizationDocument document = mongoTemplate.findOne(Query.query(criteria), AuthorizationDocument.class);
        return document == null ? null : document.toAuthorization(clients, this::readMap);
    }

    public void removeByClientId(String clientId) {
        mongoTemplate.remove(Query.query(Criteria.where("registeredClientId").is(clientId)), AuthorizationDocument.class);
    }

    public void removeByPrincipalName(String principalName) {
        mongoTemplate.remove(Query.query(Criteria.where("principalName").is(principalName)), AuthorizationDocument.class);
    }

    public void removeByClientIdAndPrincipalName(String clientId, String principalName) {
        mongoTemplate.remove(Query.query(Criteria.where("registeredClientId").is(clientId)
                .and("principalName").is(principalName)), AuthorizationDocument.class);
    }

    private String writeMap(Map<String, Object> values) {
        try {
            return objectMapper.writeValueAsString(values);
        } catch (Exception exception) {
            throw new IllegalArgumentException("No se pudo guardar la autorización de forma segura.", exception);
        }
    }

    private Map<String, Object> readMap(String json) {
        if (!StringUtils.hasText(json)) return Collections.emptyMap();
        try {
            return objectMapper.readValue(json, MAP_TYPE);
        } catch (Exception exception) {
            throw new IllegalArgumentException("No se pudo leer la autorización guardada.", exception);
        }
    }

    @Document("oauth_authorizations")
    static class AuthorizationDocument {
        @Id
        String id;
        @Indexed
        String registeredClientId;
        @Indexed
        String principalName;
        String authorizationGrantType;
        Set<String> authorizedScopes = Set.of();
        String attributesJson;
        @Indexed(sparse = true)
        String state;
        @Indexed(sparse = true)
        String authorizationCodeValue;
        Instant authorizationCodeIssuedAt;
        Instant authorizationCodeExpiresAt;
        String authorizationCodeMetadataJson;
        @Indexed(sparse = true)
        String accessTokenValue;
        Instant accessTokenIssuedAt;
        Instant accessTokenExpiresAt;
        String accessTokenMetadataJson;
        String accessTokenType;
        Set<String> accessTokenScopes = Set.of();
        @Indexed(sparse = true)
        String oidcIdTokenValue;
        Instant oidcIdTokenIssuedAt;
        Instant oidcIdTokenExpiresAt;
        String oidcIdTokenMetadataJson;
        @Indexed(sparse = true)
        String refreshTokenValue;
        Instant refreshTokenIssuedAt;
        Instant refreshTokenExpiresAt;
        String refreshTokenMetadataJson;
        @Indexed(sparse = true)
        String userCodeValue;
        Instant userCodeIssuedAt;
        Instant userCodeExpiresAt;
        String userCodeMetadataJson;
        @Indexed(sparse = true)
        String deviceCodeValue;
        Instant deviceCodeIssuedAt;
        Instant deviceCodeExpiresAt;
        String deviceCodeMetadataJson;

        static AuthorizationDocument from(OAuth2Authorization authorization, MapWriter writer) {
            AuthorizationDocument document = new AuthorizationDocument();
            document.id = authorization.getId();
            document.registeredClientId = authorization.getRegisteredClientId();
            document.principalName = authorization.getPrincipalName();
            document.authorizationGrantType = authorization.getAuthorizationGrantType().getValue();
            document.authorizedScopes = authorization.getAuthorizedScopes();
            document.attributesJson = writer.write(authorization.getAttributes());
            document.state = authorization.getAttribute(OAuth2ParameterNames.STATE);
            document.authorizationCodeValue = tokenValue(authorization, OAuth2AuthorizationCode.class);
            document.accessTokenValue = tokenValue(authorization, OAuth2AccessToken.class);
            document.oidcIdTokenValue = tokenValue(authorization, OidcIdToken.class);
            document.refreshTokenValue = tokenValue(authorization, OAuth2RefreshToken.class);
            document.userCodeValue = tokenValue(authorization, OAuth2UserCode.class);
            document.deviceCodeValue = tokenValue(authorization, org.springframework.security.oauth2.core.OAuth2DeviceCode.class);
            document.copyTokenMetadata(authorization, writer);
            return document;
        }

        private void copyTokenMetadata(OAuth2Authorization authorization, MapWriter writer) {
            OAuth2Authorization.Token<OAuth2AuthorizationCode> code = authorization.getToken(OAuth2AuthorizationCode.class);
            if (code != null) {
                authorizationCodeIssuedAt = code.getToken().getIssuedAt();
                authorizationCodeExpiresAt = code.getToken().getExpiresAt();
                authorizationCodeMetadataJson = writer.write(code.getMetadata());
            }
            OAuth2Authorization.Token<OAuth2AccessToken> access = authorization.getToken(OAuth2AccessToken.class);
            if (access != null) {
                accessTokenIssuedAt = access.getToken().getIssuedAt();
                accessTokenExpiresAt = access.getToken().getExpiresAt();
                accessTokenMetadataJson = writer.write(access.getMetadata());
                accessTokenType = access.getToken().getTokenType().getValue();
                accessTokenScopes = access.getToken().getScopes();
            }
            OAuth2Authorization.Token<OidcIdToken> idToken = authorization.getToken(OidcIdToken.class);
            if (idToken != null) {
                oidcIdTokenIssuedAt = idToken.getToken().getIssuedAt();
                oidcIdTokenExpiresAt = idToken.getToken().getExpiresAt();
                oidcIdTokenMetadataJson = writer.write(idToken.getMetadata());
            }
            OAuth2Authorization.Token<OAuth2RefreshToken> refresh = authorization.getToken(OAuth2RefreshToken.class);
            if (refresh != null) {
                refreshTokenIssuedAt = refresh.getToken().getIssuedAt();
                refreshTokenExpiresAt = refresh.getToken().getExpiresAt();
                refreshTokenMetadataJson = writer.write(refresh.getMetadata());
            }
            OAuth2Authorization.Token<OAuth2UserCode> userCode = authorization.getToken(OAuth2UserCode.class);
            if (userCode != null) {
                userCodeIssuedAt = userCode.getToken().getIssuedAt();
                userCodeExpiresAt = userCode.getToken().getExpiresAt();
                userCodeMetadataJson = writer.write(userCode.getMetadata());
            }
            OAuth2Authorization.Token<org.springframework.security.oauth2.core.OAuth2DeviceCode> deviceCode = authorization.getToken(org.springframework.security.oauth2.core.OAuth2DeviceCode.class);
            if (deviceCode != null) {
                deviceCodeIssuedAt = deviceCode.getToken().getIssuedAt();
                deviceCodeExpiresAt = deviceCode.getToken().getExpiresAt();
                deviceCodeMetadataJson = writer.write(deviceCode.getMetadata());
            }
        }

        @SuppressWarnings("unchecked")
        OAuth2Authorization toAuthorization(RegisteredClientRepository clients, MapReader reader) {
            RegisteredClient registeredClient = clients.findById(registeredClientId);
            if (registeredClient == null) throw new IllegalStateException("No se encontró el cliente de la autorización.");
            Map<String, Object> attributes = new HashMap<>(reader.read(attributesJson));
            OAuth2Authorization.Builder builder = OAuth2Authorization.withRegisteredClient(registeredClient)
                    .id(id)
                    .principalName(principalName)
                    .authorizationGrantType(new AuthorizationGrantType(authorizationGrantType))
                    .authorizedScopes(authorizedScopes)
                    .attributes(values -> values.putAll(attributes));
            if (StringUtils.hasText(authorizationCodeValue)) {
                OAuth2AuthorizationCode token = new OAuth2AuthorizationCode(authorizationCodeValue, authorizationCodeIssuedAt, authorizationCodeExpiresAt);
                builder.token(token, metadata -> metadata.putAll(reader.read(authorizationCodeMetadataJson)));
            }
            if (StringUtils.hasText(accessTokenValue)) {
                OAuth2AccessToken.TokenType type = "DPoP".equalsIgnoreCase(accessTokenType)
                        ? OAuth2AccessToken.TokenType.DPOP : OAuth2AccessToken.TokenType.BEARER;
                OAuth2AccessToken token = new OAuth2AccessToken(type, accessTokenValue, accessTokenIssuedAt,
                        accessTokenExpiresAt, accessTokenScopes);
                builder.token(token, metadata -> metadata.putAll(reader.read(accessTokenMetadataJson)));
            }
            if (StringUtils.hasText(oidcIdTokenValue)) {
                Map<String, Object> metadata = reader.read(oidcIdTokenMetadataJson);
                Object claims = metadata.get(OAuth2Authorization.Token.CLAIMS_METADATA_NAME);
                Map<String, Object> idTokenClaims = claims instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
                OidcIdToken token = new OidcIdToken(oidcIdTokenValue, oidcIdTokenIssuedAt, oidcIdTokenExpiresAt, idTokenClaims);
                builder.token(token, values -> values.putAll(metadata));
            }
            if (StringUtils.hasText(refreshTokenValue)) {
                builder.token(new OAuth2RefreshToken(refreshTokenValue, refreshTokenIssuedAt, refreshTokenExpiresAt),
                        metadata -> metadata.putAll(reader.read(refreshTokenMetadataJson)));
            }
            if (StringUtils.hasText(userCodeValue)) {
                builder.token(new OAuth2UserCode(userCodeValue, userCodeIssuedAt, userCodeExpiresAt),
                        metadata -> metadata.putAll(reader.read(userCodeMetadataJson)));
            }
            if (StringUtils.hasText(deviceCodeValue)) {
                builder.token(new org.springframework.security.oauth2.core.OAuth2DeviceCode(deviceCodeValue, deviceCodeIssuedAt, deviceCodeExpiresAt),
                        metadata -> metadata.putAll(reader.read(deviceCodeMetadataJson)));
            }
            if (StringUtils.hasText(state)) builder.attribute(OAuth2ParameterNames.STATE, state);
            return builder.build();
        }

        private static <T extends OAuth2Token> String tokenValue(OAuth2Authorization authorization, Class<T> type) {
            OAuth2Authorization.Token<T> token = authorization.getToken(type);
            return token == null ? null : token.getToken().getTokenValue();
        }
    }

    @FunctionalInterface
    interface MapWriter { String write(Map<String, Object> values); }

    @FunctionalInterface
    interface MapReader { Map<String, Object> read(String json); }
}
