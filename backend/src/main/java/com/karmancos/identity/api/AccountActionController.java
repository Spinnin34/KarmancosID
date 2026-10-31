package com.karmancos.identity.api;

import com.karmancos.identity.audit.AuditService;
import com.karmancos.identity.security.AccountEmailService;
import com.karmancos.identity.security.LoginRateLimitService;
import com.karmancos.identity.security.MongoAuthorizationConsentService;
import com.karmancos.identity.security.MongoOAuth2AuthorizationService;
import com.karmancos.identity.user.IdentityUser;
import com.karmancos.identity.user.IdentityUserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.data.mongo.MongoIndexedSessionRepository;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.util.Locale;

@RestController
@RequestMapping("/api/auth")
public class AccountActionController {
    private final IdentityUserRepository users;
    private final AccountEmailService email;
    private final PasswordEncoder passwords;
    private final LoginRateLimitService limits;
    private final MongoIndexedSessionRepository sessions;
    private final MongoOAuth2AuthorizationService authorizations;
    private final MongoAuthorizationConsentService consents;
    private final AuditService audit;

    public AccountActionController(IdentityUserRepository users, AccountEmailService email, PasswordEncoder passwords,
                                   LoginRateLimitService limits, MongoIndexedSessionRepository sessions,
                                   MongoOAuth2AuthorizationService authorizations,
                                   MongoAuthorizationConsentService consents, AuditService audit) {
        this.users = users;
        this.email = email;
        this.passwords = passwords;
        this.limits = limits;
        this.sessions = sessions;
        this.authorizations = authorizations;
        this.consents = consents;
        this.audit = audit;
    }

    @PostMapping("/email/verify")
    AuthController.MessageResponse verifyEmail(@Valid @RequestBody TokenRequest input) {
        email.verifyEmail(input.token());
        return new AuthController.MessageResponse("Correo electrónico verificado.");
    }

    @PostMapping("/email/resend")
    ResponseEntity<AuthController.MessageResponse> resendVerification(@Valid @RequestBody EmailRequest input,
                                                                       HttpServletRequest request) {
        String address = normalizeEmail(input.email());
        if (!limits.consume("email-verify", request.getRemoteAddr(), address, 3, Duration.ofHours(1)).allowed()) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(new AuthController.MessageResponse("Espera antes de volver a solicitar un correo."));
        }
        users.findByEmail(address).filter(user -> user.isActive() && !user.isEmailVerified()).ifPresent(email::sendVerification);
        return ResponseEntity.accepted().body(new AuthController.MessageResponse(
                "Si la cuenta existe y necesita verificación, enviaremos un enlace al correo indicado."));
    }

    @PostMapping("/password/reset-request")
    ResponseEntity<AuthController.MessageResponse> requestPasswordReset(@Valid @RequestBody EmailRequest input,
                                                                        HttpServletRequest request) {
        String address = normalizeEmail(input.email());
        if (!limits.consume("password-reset", request.getRemoteAddr(), address, 4, Duration.ofHours(1)).allowed()) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(new AuthController.MessageResponse("Espera antes de volver a solicitar una recuperación."));
        }
        users.findByEmail(address).ifPresent(email::requestPasswordReset);
        return ResponseEntity.accepted().body(new AuthController.MessageResponse(
                "Si existe una cuenta para ese correo, recibirás instrucciones para restablecer la contraseña."));
    }

    @PostMapping("/password/reset")
    AuthController.MessageResponse resetPassword(@Valid @RequestBody PasswordResetRequest input) {
        IdentityUser user = email.consumePasswordReset(input.token());
        user.setPasswordHash(passwords.encode(input.newPassword()));
        users.save(user);
        sessions.findByIndexNameAndIndexValue(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, user.getEmail())
                .keySet().forEach(sessions::deleteById);
        authorizations.removeByPrincipalName(user.getEmail());
        consents.removeByPrincipalName(user.getEmail());
        audit.record(user.getEmail(), "account.password_reset", user.getId());
        return new AuthController.MessageResponse("Contraseña actualizada. Ya puedes iniciar sesión.");
    }

    private String normalizeEmail(String value) { return value.trim().toLowerCase(Locale.ROOT); }

    public record EmailRequest(@NotBlank @Email @Size(max = 320) String email) { }
    public record TokenRequest(@NotBlank @Size(min = 40, max = 100) String token) { }
    public record PasswordResetRequest(@NotBlank @Size(min = 40, max = 100) String token,
                                       @NotBlank @Size(min = 12, max = 128) String newPassword) { }
}
