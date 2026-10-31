package com.karmancos.identity.api;

import com.karmancos.identity.audit.AuditEvent;
import com.karmancos.identity.audit.AuditService;
import com.karmancos.identity.security.MongoAuthorizationConsentService;
import com.karmancos.identity.security.MongoOAuth2AuthorizationService;
import com.karmancos.identity.security.MongoRegisteredClientRepository;
import com.karmancos.identity.security.SessionReference;
import com.karmancos.identity.user.IdentityAccountService;
import com.karmancos.identity.user.IdentityRole;
import com.karmancos.identity.user.IdentityUser;
import com.karmancos.identity.user.IdentityUserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.oidc.OidcScopes;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.data.mongo.MongoIndexedSessionRepository;
import org.springframework.session.data.mongo.MongoSession;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private static final Set<String> OIDC_SCOPES = Set.of(OidcScopes.OPENID, OidcScopes.PROFILE, OidcScopes.EMAIL);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final MongoRegisteredClientRepository clients;
    private final MongoOAuth2AuthorizationService authorizations;
    private final MongoAuthorizationConsentService consents;
    private final MongoIndexedSessionRepository sessions;
    private final IdentityUserRepository users;
    private final IdentityAccountService accounts;
    private final PasswordEncoder passwordEncoder;
    private final AuditService audit;

    public AdminController(
            MongoRegisteredClientRepository clients,
            MongoOAuth2AuthorizationService authorizations,
            MongoAuthorizationConsentService consents,
            MongoIndexedSessionRepository sessions,
            IdentityUserRepository users,
            IdentityAccountService accounts,
            PasswordEncoder passwordEncoder,
            AuditService audit
    ) {
        this.clients = clients;
        this.authorizations = authorizations;
        this.consents = consents;
        this.sessions = sessions;
        this.users = users;
        this.accounts = accounts;
        this.passwordEncoder = passwordEncoder;
        this.audit = audit;
    }

    @GetMapping("/overview")
    Overview overview() {
        return new Overview(users.count(), clients.count(), allSessions().size());
    }

    @GetMapping("/clients")
    List<ClientView> listClients() {
        return clients.findAll().stream().map(client -> new ClientView(
                client.getId(),
                client.getClientId(),
                client.getClientName(),
                client.getClientAuthenticationMethods().contains(ClientAuthenticationMethod.NONE) ? "public" : "confidential",
                List.copyOf(client.getRedirectUris()),
                allowedOrigins(client),
                List.copyOf(client.getPostLogoutRedirectUris()),
                List.copyOf(client.getScopes()),
                client.getClientIdIssuedAt())).toList();
    }

    @PostMapping("/clients")
    ClientCreateResponse createClient(@Valid @RequestBody ClientCreateRequest input, Authentication authentication) {
        List<String> redirectUris = validateUris(input.redirectUris());
        List<String> origins = validateOrigins(input.allowedOrigins());
        List<String> postLogoutUris = input.postLogoutRedirectUris() == null ? List.of() : validateUris(input.postLogoutRedirectUris());
        String clientType = input.clientType() == null ? "confidential" : input.clientType().toLowerCase();
        if (!clientType.equals("public") && !clientType.equals("confidential")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Elige un cliente público o confidencial.");
        }

        String clientId = "kmc_" + randomToken(18);
        String clientSecret = clientType.equals("confidential") ? randomToken(32) : null;
        RegisteredClient.Builder builder = RegisteredClient.withId(UUID.randomUUID().toString())
                .clientId(clientId)
                .clientName(input.name().trim())
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .clientSettings(ClientSettings.builder().requireProofKey(true).requireAuthorizationConsent(true)
                        .settings(settings -> settings.put("karmancos.allowed-origins", origins)).build())
                .tokenSettings(TokenSettings.builder()
                        .accessTokenTimeToLive(Duration.ofMinutes(5))
                        .refreshTokenTimeToLive(Duration.ofDays(30))
                        .reuseRefreshTokens(false)
                        .build());

        if (clientSecret == null) {
            builder.clientAuthenticationMethod(ClientAuthenticationMethod.NONE);
        } else {
            builder.clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                    .clientSecret(passwordEncoder.encode(clientSecret))
                    .authorizationGrantType(AuthorizationGrantType.REFRESH_TOKEN);
        }
        redirectUris.forEach(builder::redirectUri);
        postLogoutUris.forEach(builder::postLogoutRedirectUri);
        OIDC_SCOPES.forEach(builder::scope);
        clients.save(builder.build());
        audit.record(authentication.getName(), "client.created", input.name().trim());

        return new ClientCreateResponse(clientId, clientSecret, "Guarda el secreto ahora. No volverá a mostrarse.");
    }

    @DeleteMapping("/clients/{id}")
    void deleteClient(@PathVariable String id, Authentication authentication) {
        RegisteredClient client = clients.findById(id);
        if (client == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No se encontró ese cliente.");
        consents.removeByClientId(id);
        authorizations.removeByClientId(id);
        clients.deleteById(id);
        audit.record(authentication.getName(), "client.deleted", client.getClientName());
    }

    @GetMapping("/users")
    List<UserView> listUsers() {
        return users.findAll(Sort.by(Sort.Direction.DESC, "createdAt")).stream().map(this::toUserView).toList();
    }

    @PatchMapping("/users/{id}/access")
    UserView updateUserAccess(@PathVariable String id, @Valid @RequestBody UserAccessRequest input, Authentication authentication) {
        IdentityUser user = users.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No se encontró esa cuenta."));
        if (input.active() == null && input.role() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Elige un cambio de acceso.");
        }

        boolean active = input.active() == null ? user.isActive() : input.active();
        IdentityRole role = user.getRole();
        if (input.role() != null) {
            try {
                role = IdentityRole.valueOf(input.role().toUpperCase());
            } catch (IllegalArgumentException exception) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El rol debe ser USER o ADMIN.");
            }
        }

        if (user.getEmail().equalsIgnoreCase(authentication.getName()) && (!active || role != IdentityRole.ADMIN)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "No puedes quitarte tu propio acceso de administrador.");
        }
        if (user.getRole() == IdentityRole.ADMIN && role != IdentityRole.ADMIN && users.countByRole(IdentityRole.ADMIN) <= 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Debe quedar al menos una cuenta administradora.");
        }

        boolean accessChanged = active != user.isActive() || role != user.getRole();
        user.setActive(active);
        user.setRole(role);
        users.save(user);
        if (accessChanged) revokeUserSessionsAndGrants(user.getEmail());
        audit.record(authentication.getName(), "account.access_changed", user.getEmail());
        return toUserView(user);
    }

    @PatchMapping("/users/{id}/profile")
    UserView updateUserProfile(@PathVariable String id, @Valid @RequestBody UserProfileRequest input, Authentication authentication) {
        IdentityUser user = users.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No se encontró esa cuenta."));
        if (user.getEmail().equalsIgnoreCase(authentication.getName())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Edita tu propia identidad desde Mi cuenta para confirmar el cambio con tu contraseña.");
        }

        String previousEmail = user.getEmail();
        accounts.updateIdentity(user, input.email().trim().toLowerCase(java.util.Locale.ROOT),
                input.username().trim().toLowerCase(java.util.Locale.ROOT), input.firstName().trim(),
                input.lastName().trim(), input.secondLastName() == null ? "" : input.secondLastName().trim());
        revokeUserSessionsAndGrants(previousEmail);
        audit.record(authentication.getName(), "account.profile_admin_changed", user.getEmail());
        return toUserView(user);
    }

    @GetMapping("/sessions")
    List<SessionView> listSessions() {
        return allSessionEntries().stream()
                .sorted(Comparator.comparing(entry -> entry.session().getLastAccessedTime(), Comparator.reverseOrder()))
                .limit(50)
                .map(entry -> new SessionView(SessionReference.fromSessionId(entry.session().getId()), entry.email(),
                        entry.session().getCreationTime(), entry.session().getLastAccessedTime()))
                .toList();
    }

    @DeleteMapping("/sessions/{reference}")
    void revokeSession(@PathVariable String reference, Authentication authentication) {
        SessionEntry entry = allSessionEntries().stream()
                .filter(candidate -> SessionReference.fromSessionId(candidate.session().getId()).equals(reference))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "La sesión ya no existe."));
        sessions.deleteById(entry.session().getId());
        audit.record(authentication.getName(), "session.revoked", entry.email());
    }

    @GetMapping("/activity")
    List<ActivityView> listActivity() {
        return audit.listRecent(20).stream().map(event -> new ActivityView(
                event.getId(), event.getActorEmail(), event.getAction(), event.getSubject(), event.getOccurredAt())).toList();
    }

    private List<MongoSession> allSessions() {
        return allSessionEntries().stream().map(SessionEntry::session).toList();
    }

    private List<SessionEntry> allSessionEntries() {
        List<SessionEntry> result = new ArrayList<>();
        for (IdentityUser user : users.findAll()) {
            sessions.findByIndexNameAndIndexValue(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, user.getEmail())
                    .values().forEach(session -> result.add(new SessionEntry(user.getEmail(), session)));
        }
        return result;
    }

    private void revokeUserSessionsAndGrants(String email) {
        sessions.findByIndexNameAndIndexValue(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, email)
                .keySet().forEach(sessions::deleteById);
        authorizations.removeByPrincipalName(email);
        consents.removeByPrincipalName(email);
    }

    private UserView toUserView(IdentityUser user) {
        return new UserView(user.getId(), user.getEmail(), user.getUsername(), user.getFirstName(), user.getLastName(),
                user.getSecondLastName(), user.getDisplayName(),
                user.getRole().name(), user.isActive(), user.getCreatedAt(), ProfilePictureUrls.relative(user));
    }

    private List<String> validateUris(List<String> values) {
        if (values == null || values.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Añade al menos una URL de retorno.");
        }
        List<String> safe = new ArrayList<>();
        for (String value : values) {
            String text = value == null ? "" : value.trim();
            try {
                URI uri = URI.create(text);
                boolean loopbackHttp = "http".equalsIgnoreCase(uri.getScheme())
                        && ("localhost".equalsIgnoreCase(uri.getHost()) || "127.0.0.1".equals(uri.getHost())
                        || "::1".equals(uri.getHost()) || "[::1]".equals(uri.getHost()));
                boolean secureHttps = "https".equalsIgnoreCase(uri.getScheme());
                if (text.isBlank() || text.contains("*") || text.contains(",") || uri.getHost() == null
                        || uri.getUserInfo() != null || uri.getFragment() != null || (!loopbackHttp && !secureHttps)) {
                    throw new IllegalArgumentException("unsafe redirect");
                }
                safe.add(uri.toASCIIString());
            } catch (IllegalArgumentException exception) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Cada URL de retorno debe ser HTTPS; HTTP solo se permite en localhost durante desarrollo.");
            }
        }
        return safe.stream().distinct().toList();
    }

    private List<String> validateOrigins(List<String> values) {
        if (values == null) return List.of();
        List<String> result = new ArrayList<>();
        for (String value : values) {
            try {
                URI uri = URI.create(value.trim());
                String scheme = uri.getScheme();
                String host = uri.getHost();
                if (scheme == null || host == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                        || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/"))) {
                    throw new IllegalArgumentException();
                }
                boolean localhost = host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1") || host.equals("::1");
                if (!scheme.equalsIgnoreCase("https") && !(scheme.equalsIgnoreCase("http") && localhost)) {
                    throw new IllegalArgumentException();
                }
                result.add(scheme.toLowerCase() + "://" + host.toLowerCase() + (uri.getPort() < 0 ? "" : ":" + uri.getPort()));
            } catch (IllegalArgumentException exception) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Cada origen autorizado debe ser HTTPS y no contener ruta, consulta ni fragmento.");
            }
        }
        return result.stream().distinct().toList();
    }

    private List<String> allowedOrigins(RegisteredClient client) {
        Object value = client.getClientSettings().getSetting("karmancos.allowed-origins");
        if (value instanceof List<?> list) return list.stream().filter(String.class::isInstance).map(String.class::cast).toList();
        return List.of();
    }

    private String randomToken(int bytes) {
        byte[] value = new byte[bytes];
        RANDOM.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    public record Overview(long accounts, long clients, long activeSessions) { }
    public record ClientView(String id, String clientId, String name, String clientType, List<String> redirectUris,
                             List<String> allowedOrigins,
                             List<String> postLogoutRedirectUris, List<String> scopes, Instant createdAt) { }
    public record ClientCreateRequest(
            @NotBlank(message = "Escribe un nombre para el cliente.") @Size(max = 100, message = "El nombre debe tener 100 caracteres o menos.") String name,
            @NotEmpty(message = "Añade al menos una URL de retorno.") List<@NotBlank String> redirectUris,
            List<@NotBlank String> postLogoutRedirectUris,
            List<@NotBlank String> allowedOrigins,
            String clientType) { }
    public record ClientCreateResponse(String clientId, String clientSecret, String note) { }
    public record UserView(String id, String email, String username, String firstName, String lastName, String secondLastName,
                           String displayName, String role, boolean active, Instant createdAt, String picture) { }
    public record UserAccessRequest(Boolean active, String role) { }
    public record UserProfileRequest(
            @NotBlank(message = "Escribe un usuario.") @Pattern(regexp = "^[A-Za-z0-9._-]{3,32}$", message = "El usuario debe tener entre 3 y 32 caracteres válidos.") String username,
            @NotBlank(message = "Escribe un nombre.") @Size(max = 80) String firstName,
            @NotBlank(message = "Escribe un apellido.") @Size(max = 80) String lastName,
            @Size(max = 80) String secondLastName,
            @NotBlank(message = "Escribe un correo electrónico.") @Email(message = "Escribe un correo electrónico válido.") @Size(max = 320) String email
    ) { }
    public record SessionView(String reference, String email, Instant createdAt, Instant lastAccessedAt) { }
    public record ActivityView(String id, String actor, String action, String subject, Instant occurredAt) { }
    private record SessionEntry(String email, MongoSession session) { }
}
