package com.karmancos.identity.security;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.proc.SecurityContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.authorization.config.annotation.web.configuration.OAuth2AuthorizationServerConfiguration;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.core.oidc.endpoint.OidcParameterNames;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.karmancos.identity.user.IdentityPrincipal;
import com.karmancos.identity.user.IdentityUser;
import com.karmancos.identity.user.IdentityUserRepository;
import com.karmancos.identity.api.ProfilePictureUrls;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.EnumSet;
import java.net.URI;
import java.nio.charset.StandardCharsets;

@Configuration
public class SigningKeyConfiguration {
    @Bean
    JWKSource<SecurityContext> jwkSource(Environment environment) throws Exception {
        KeyPair keyPair = environment.acceptsProfiles(Profiles.of("prod"))
                ? loadProductionKeyPair(environment)
                : loadOrCreateLocalKeyPair(environment);

        RSAPublicKey publicKey = (RSAPublicKey) keyPair.getPublic();
        RSAPrivateKey privateKey = (RSAPrivateKey) keyPair.getPrivate();
        String keyId = Base64.getUrlEncoder().withoutPadding().encodeToString(
                MessageDigest.getInstance("SHA-256").digest(publicKey.getEncoded()))
                .substring(0, 22);
        RSAKey signingKey = new RSAKey.Builder(publicKey)
                .privateKey(privateKey)
                .keyID(keyId)
                .build();
        JWKSet jwkSet = new JWKSet(signingKey);
        return (selector, context) -> selector.select(jwkSet);
    }

    @Bean
    JwtDecoder jwtDecoder(JWKSource<SecurityContext> jwkSource) {
        return OAuth2AuthorizationServerConfiguration.jwtDecoder(jwkSource);
    }

    @Bean
    AuthorizationServerSettings authorizationServerSettings(Environment environment) {
        return AuthorizationServerSettings.builder()
                .issuer(environment.getProperty("karmancos.issuer", "http://localhost:4321"))
                .build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    OAuth2TokenCustomizer<JwtEncodingContext> jwtTokenCustomizer(
            IdentityUserRepository users,
            @Value("${karmancos.issuer:http://localhost:4321}") String issuer,
            Environment environment
    ) {
        String subjectSecret = environment.getProperty("KARMANCOS_SUBJECT_HMAC_SECRET");
        if (environment.acceptsProfiles(Profiles.of("prod")) && (subjectSecret == null || subjectSecret.length() < 32)) {
            throw new IllegalStateException("Production requires KARMANCOS_SUBJECT_HMAC_SECRET with at least 32 characters.");
        }
        if (subjectSecret == null || subjectSecret.isBlank()) subjectSecret = "local-only-karmancosid-subject-secret";
        final String signingSecret = subjectSecret;
        return context -> {
            if (!(context.getPrincipal().getPrincipal() instanceof IdentityPrincipal principal)) {
                return;
            }

            boolean idToken = OidcParameterNames.ID_TOKEN.equals(context.getTokenType().getValue());
            boolean accessToken = OAuth2TokenType.ACCESS_TOKEN.equals(context.getTokenType());
            if (idToken || accessToken) {
                // Pairwise opaque subjects prevent email changes and cross-client correlation.
                context.getClaims().subject(pairwiseSubject(principal.getId(), context.getRegisteredClient(), signingSecret));
                if (context.getAuthorizedScopes().contains("profile")) {
                    context.getClaims()
                            .claim("name", principal.getDisplayName())
                            .claim("preferred_username", principal.getAccountUsername())
                            .claim("given_name", principal.getFirstName())
                            .claim("family_name", principal.getFamilyName());
                    users.findById(principal.getId())
                            .map(user -> ProfilePictureUrls.absolute(user, issuer))
                            .ifPresent(picture -> context.getClaims().claim("picture", picture));
                }
                if (context.getAuthorizedScopes().contains("email")) {
                    boolean emailVerified = users.findById(principal.getId())
                            .map(IdentityUser::isEmailVerified)
                            .orElse(false);
                    context.getClaims().claim("email", principal.getUsername())
                            .claim("email_verified", emailVerified);
                }
            }
        };
    }

    private String pairwiseSubject(String userId, org.springframework.security.oauth2.server.authorization.client.RegisteredClient client,
                                   String secret) {
        try {
            Object rawOrigins = client.getClientSettings().getSetting("karmancos.allowed-origins");
            String sector = rawOrigins instanceof java.util.List<?> origins && !origins.isEmpty()
                    ? origins.stream().filter(String.class::isInstance).map(String.class::cast).sorted().findFirst().orElse(client.getClientId())
                    : client.getRedirectUris().stream().map(uri -> {
                        try { return URI.create(uri).getHost(); } catch (IllegalArgumentException ignored) { return null; }
                    }).filter(java.util.Objects::nonNull).sorted().findFirst().orElse(client.getClientId());
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal((sector + "\u0000" + userId).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to derive an OIDC subject identifier.", exception);
        }
    }

    private KeyPair loadProductionKeyPair(Environment environment) throws Exception {
        Path privatePath = Path.of(environment.getRequiredProperty("KARMANCOS_PRIVATE_KEY_PATH"));
        Path publicPath = Path.of(environment.getRequiredProperty("KARMANCOS_PUBLIC_KEY_PATH"));
        return readKeyPair(privatePath, publicPath);
    }

    private KeyPair loadOrCreateLocalKeyPair(Environment environment) throws Exception {
        Path directory = Path.of(environment.getProperty("KARMANCOS_KEY_DIRECTORY", "./data/keys"));
        Files.createDirectories(directory);
        Path privatePath = directory.resolve("oidc-private.pem");
        Path publicPath = directory.resolve("oidc-public.pem");

        if (!Files.exists(privatePath) && !Files.exists(publicPath)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(3072);
            KeyPair generated = generator.generateKeyPair();
            writePem(privatePath, "PRIVATE KEY", generated.getPrivate().getEncoded());
            writePem(publicPath, "PUBLIC KEY", generated.getPublic().getEncoded());
            restrictPrivateFile(privatePath);
        } else if (!Files.exists(privatePath) || !Files.exists(publicPath)) {
            throw new IllegalStateException("Both local OIDC key files must exist; refusing to replace signing keys.");
        }

        return readKeyPair(privatePath, publicPath);
    }

    private KeyPair readKeyPair(Path privatePath, Path publicPath) throws Exception {
        RSAPrivateKey privateKey;
        RSAPublicKey publicKey;
        try (var privateInput = Files.newInputStream(privatePath);
             var publicInput = Files.newInputStream(publicPath)) {
            privateKey = RsaKeyConverters.pkcs8().convert(privateInput);
            publicKey = RsaKeyConverters.x509().convert(publicInput);
        }
        if (privateKey == null || publicKey == null) {
            throw new IllegalStateException("Unable to parse the configured RSA OIDC signing keys.");
        }
        return new KeyPair(publicKey, privateKey);
    }

    private void writePem(Path path, String type, byte[] bytes) throws IOException {
        String encoded = Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(bytes);
        Files.writeString(path, "-----BEGIN " + type + "-----\n" + encoded + "\n-----END " + type + "-----\n");
    }

    private void restrictPrivateFile(Path path) {
        try {
            Files.setPosixFilePermissions(path, EnumSet.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
        } catch (UnsupportedOperationException | IOException ignored) {
            // Windows does not expose POSIX permissions; the local development key stays outside version control.
        }
    }
}
