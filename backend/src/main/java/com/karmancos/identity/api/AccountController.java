package com.karmancos.identity.api;

import com.karmancos.identity.audit.AuditService;
import com.karmancos.identity.security.LoginRateLimitService;
import com.karmancos.identity.security.AccountEmailService;
import com.karmancos.identity.security.MongoAuthorizationConsentService;
import com.karmancos.identity.security.MongoOAuth2AuthorizationService;
import com.karmancos.identity.security.SessionReference;
import com.karmancos.identity.user.IdentityAccountService;
import com.karmancos.identity.user.IdentityPrincipal;
import com.karmancos.identity.user.IdentityUser;
import com.karmancos.identity.user.IdentityUserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.data.mongo.MongoIndexedSessionRepository;
import org.springframework.session.data.mongo.MongoSession;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

@RestController
@RequestMapping("/api/account")
public class AccountController {
    private final IdentityUserRepository users;
    private final IdentityAccountService accounts;
    private final PasswordEncoder passwordEncoder;
    private final MongoIndexedSessionRepository sessions;
    private final MongoOAuth2AuthorizationService authorizations;
    private final MongoAuthorizationConsentService consents;
    private final LoginRateLimitService rateLimits;
    private final AuditService audit;
    private final ProfilePictureProcessor pictureProcessor;
    private final AccountEmailService accountEmail;

    public AccountController(
            IdentityUserRepository users,
            IdentityAccountService accounts,
            PasswordEncoder passwordEncoder,
            MongoIndexedSessionRepository sessions,
            MongoOAuth2AuthorizationService authorizations,
            MongoAuthorizationConsentService consents,
            LoginRateLimitService rateLimits,
            AuditService audit,
            ProfilePictureProcessor pictureProcessor,
            AccountEmailService accountEmail
    ) {
        this.users = users;
        this.accounts = accounts;
        this.passwordEncoder = passwordEncoder;
        this.sessions = sessions;
        this.authorizations = authorizations;
        this.consents = consents;
        this.rateLimits = rateLimits;
        this.audit = audit;
        this.pictureProcessor = pictureProcessor;
        this.accountEmail = accountEmail;
    }

    @PatchMapping("/profile")
    AuthController.MessageResponse updateProfile(
            @Valid @RequestBody ProfileRequest input,
            Authentication authentication,
            HttpServletRequest request
    ) {
        IdentityPrincipal principal = principal(authentication);
        IdentityUser user = findUser(principal.getId());
        verifyCurrentPassword(input.currentPassword(), user, request);

        String previousEmail = user.getEmail();
        accounts.updateIdentity(user, normalizeEmail(input.email()), normalizeIdentifier(input.username()),
                input.firstName().trim(), input.lastName().trim(), normalizeOptional(input.secondLastName()));
        if (!previousEmail.equalsIgnoreCase(user.getEmail())) accountEmail.sendVerification(user);
        revokeAccess(previousEmail, request);
        audit.record(previousEmail, "account.profile_changed", user.getEmail());
        return new AuthController.MessageResponse("Cambios guardados. Inicia sesión de nuevo para continuar.");
    }

    @PostMapping(value = "/picture", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    PictureResponse updatePicture(
            @RequestParam("file") MultipartFile file,
            Authentication authentication,
            HttpServletRequest request
    ) {
        IdentityPrincipal principal = principal(authentication);
        IdentityUser user = findUser(principal.getId());
        enforcePictureRateLimit(user, request);
        ProfilePictureProcessor.ProcessedPicture picture = pictureProcessor.process(file);
        user.updateProfilePicture(picture.content(), picture.contentType());
        users.save(user);
        audit.record(user.getEmail(), "account.picture_changed", user.getId());
        return new PictureResponse("Foto de perfil actualizada.", ProfilePictureUrls.relative(user));
    }

    @DeleteMapping("/picture")
    PictureResponse deletePicture(Authentication authentication, HttpServletRequest request) {
        IdentityPrincipal principal = principal(authentication);
        IdentityUser user = findUser(principal.getId());
        enforcePictureRateLimit(user, request);
        if (user.hasProfilePicture()) {
            user.removeProfilePicture();
            users.save(user);
            audit.record(user.getEmail(), "account.picture_removed", user.getId());
        }
        return new PictureResponse("Foto de perfil eliminada.", null);
    }

    @PostMapping("/password")
    AuthController.MessageResponse changePassword(
            @Valid @RequestBody PasswordChangeRequest input,
            Authentication authentication,
            HttpServletRequest request
    ) {
        IdentityPrincipal principal = principal(authentication);
        IdentityUser user = findUser(principal.getId());
        verifyCurrentPassword(input.currentPassword(), user, request);
        if (passwordEncoder.matches(input.newPassword(), user.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Elige una contraseña distinta a la actual.");
        }

        user.setPasswordHash(passwordEncoder.encode(input.newPassword()));
        users.save(user);
        revokeAccess(user.getEmail(), request);
        audit.record(user.getEmail(), "account.password_changed", user.getEmail());
        return new AuthController.MessageResponse("Contraseña actualizada. Inicia sesión con tu nueva contraseña.");
    }

    @GetMapping("/sessions")
    List<AccountSessionView> listSessions(Authentication authentication, HttpServletRequest request) {
        String email = principal(authentication).getUsername();
        String currentSessionId = request.getSession(false) == null ? null : request.getSession(false).getId();
        return sessionsFor(email).stream()
                .sorted(Comparator.comparing(MongoSession::getLastAccessedTime).reversed())
                .map(session -> new AccountSessionView(
                        SessionReference.fromSessionId(session.getId()),
                        Objects.equals(currentSessionId, session.getId()),
                        session.getCreationTime(), session.getLastAccessedTime()))
                .toList();
    }

    @GetMapping("/apps")
    List<MongoAuthorizationConsentService.ConsentSummary> connectedApps(Authentication authentication) {
        return consents.listForPrincipalName(principal(authentication).getUsername());
    }

    @DeleteMapping("/apps/{clientId}")
    void revokeConnectedApp(@PathVariable String clientId, Authentication authentication) {
        String email = principal(authentication).getUsername();
        if (consents.findById(clientId, email) == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No existe un permiso para esa aplicación.");
        }
        consents.removeByClientIdAndPrincipalName(clientId, email);
        authorizations.removeByClientIdAndPrincipalName(clientId, email);
        audit.record(email, "consent.revoked", clientId);
    }

    @DeleteMapping("/sessions/{reference}")
    void revokeSession(@PathVariable String reference, Authentication authentication, HttpServletRequest request) {
        String email = principal(authentication).getUsername();
        String currentSessionId = request.getSession(false) == null ? null : request.getSession(false).getId();
        MongoSession target = sessionsFor(email).stream()
                .filter(session -> SessionReference.fromSessionId(session.getId()).equals(reference))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "La sesión ya no existe."));
        if (Objects.equals(currentSessionId, target.getId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Usa Cerrar sesión para terminar la sesión actual.");
        }
        sessions.deleteById(target.getId());
        audit.record(email, "session.revoked", reference);
    }

    @PostMapping("/sessions/revoke-others")
    AuthController.MessageResponse revokeOtherSessions(Authentication authentication, HttpServletRequest request) {
        String email = principal(authentication).getUsername();
        String currentSessionId = request.getSession(false) == null ? null : request.getSession(false).getId();
        sessionsFor(email).stream()
                .filter(session -> !Objects.equals(currentSessionId, session.getId()))
                .map(MongoSession::getId)
                .forEach(sessions::deleteById);
        audit.record(email, "sessions.others_revoked", email);
        return new AuthController.MessageResponse("Se cerraron las otras sesiones.");
    }

    private void verifyCurrentPassword(String currentPassword, IdentityUser user, HttpServletRequest request) {
        var limit = rateLimits.consume("account-change", request.getRemoteAddr(), user.getId(), 5, Duration.ofMinutes(15));
        if (!limit.allowed()) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Has alcanzado el límite de cambios. Prueba más tarde.");
        }
        if (!passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "La contraseña actual no es correcta.");
        }
    }

    private void enforcePictureRateLimit(IdentityUser user, HttpServletRequest request) {
        var limit = rateLimits.consume("account-picture", request.getRemoteAddr(), user.getId(), 8, Duration.ofHours(1));
        if (!limit.allowed()) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Has cambiado la foto varias veces. Prueba de nuevo más tarde.");
        }
    }

    private void revokeAccess(String email, HttpServletRequest request) {
        sessions.findByIndexNameAndIndexValue(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, email)
                .keySet().forEach(sessions::deleteById);
        authorizations.removeByPrincipalName(email);
        consents.removeByPrincipalName(email);
        var currentSession = request.getSession(false);
        if (currentSession != null) currentSession.invalidate();
    }

    private List<MongoSession> sessionsFor(String email) {
        return sessions.findByIndexNameAndIndexValue(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, email)
                .values().stream().toList();
    }

    private IdentityUser findUser(String id) {
        return users.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }

    private IdentityPrincipal principal(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof IdentityPrincipal identityPrincipal)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        return identityPrincipal;
    }

    private String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    private String normalizeIdentifier(String identifier) {
        return identifier.trim().toLowerCase(Locale.ROOT);
    }

    private String normalizeOptional(String value) {
        return value == null ? "" : value.trim();
    }

    public record ProfileRequest(
            @NotBlank(message = "Escribe un nombre de usuario.")
            @Pattern(regexp = "^[A-Za-z0-9._-]{3,32}$", message = "El usuario debe tener entre 3 y 32 caracteres válidos.")
            String username,
            @NotBlank(message = "Escribe tu nombre.") @Size(max = 80, message = "El nombre debe tener 80 caracteres o menos.") String firstName,
            @NotBlank(message = "Escribe tu primer apellido.") @Size(max = 80, message = "El apellido debe tener 80 caracteres o menos.") String lastName,
            @Size(max = 80, message = "El apellido debe tener 80 caracteres o menos.") String secondLastName,
            @NotBlank(message = "Escribe un correo electrónico.") @Email(message = "Escribe un correo electrónico válido.") @Size(max = 320) String email,
            @NotBlank(message = "Confirma los cambios con tu contraseña actual.") @Size(max = 128) String currentPassword
    ) { }

    public record PasswordChangeRequest(
            @NotBlank(message = "Escribe tu contraseña actual.") @Size(max = 128) String currentPassword,
            @NotBlank(message = "Escribe una contraseña nueva.") @Size(min = 12, max = 128, message = "La nueva contraseña debe tener entre 12 y 128 caracteres.") String newPassword
    ) { }

    public record AccountSessionView(String reference, boolean current, Instant createdAt, Instant lastAccessedAt) { }
    public record PictureResponse(String message, String picture) { }
}
