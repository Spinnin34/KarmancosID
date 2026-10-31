package com.karmancos.identity.api;

import com.karmancos.identity.audit.AuditService;
import com.karmancos.identity.security.LoginRateLimitService;
import com.karmancos.identity.security.AccountEmailService;
import com.karmancos.identity.security.MongoRegisteredClientRepository;
import com.karmancos.identity.user.IdentityPrincipal;
import com.karmancos.identity.user.IdentityRole;
import com.karmancos.identity.user.IdentityUser;
import com.karmancos.identity.user.IdentityUserRepository;
import com.karmancos.identity.user.IdentityAccountService;
import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.savedrequest.RequestCache;
import org.springframework.security.web.savedrequest.SavedRequest;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import org.springframework.dao.DataIntegrityViolationException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final IdentityUserRepository users;
    private final IdentityAccountService accounts;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository securityContextRepository;
    private final SessionAuthenticationStrategy sessionAuthenticationStrategy;
    private final RequestCache requestCache;
    private final MongoRegisteredClientRepository clients;
    private final LoginRateLimitService rateLimits;
    private final AuditService audit;
    private final AccountEmailService accountEmail;

    public AuthController(
            IdentityUserRepository users,
            IdentityAccountService accounts,
            PasswordEncoder passwordEncoder,
            AuthenticationManager authenticationManager,
            SecurityContextRepository securityContextRepository,
            SessionAuthenticationStrategy sessionAuthenticationStrategy,
            RequestCache requestCache,
            MongoRegisteredClientRepository clients,
            LoginRateLimitService rateLimits,
            AuditService audit,
            AccountEmailService accountEmail
    ) {
        this.users = users;
        this.accounts = accounts;
        this.passwordEncoder = passwordEncoder;
        this.authenticationManager = authenticationManager;
        this.securityContextRepository = securityContextRepository;
        this.sessionAuthenticationStrategy = sessionAuthenticationStrategy;
        this.requestCache = requestCache;
        this.clients = clients;
        this.rateLimits = rateLimits;
        this.audit = audit;
        this.accountEmail = accountEmail;
    }

    @GetMapping("/csrf")
    CsrfResponse csrf(CsrfToken token) {
        return new CsrfResponse(token.getToken(), token.getHeaderName());
    }

    @GetMapping("/continue")
    LoginContinueContext loginContinueContext(HttpServletRequest request, HttpServletResponse response) {
        SavedRequest savedRequest = requestCache.getRequest(request, response);
        String[] clientIds = savedRequest == null ? null : savedRequest.getParameterValues("client_id");
        if (clientIds == null || clientIds.length == 0 || clientIds[0].isBlank()) {
            return LoginContinueContext.none();
        }

        RegisteredClient client = clients.findByClientId(clientIds[0]);
        if (client == null) return LoginContinueContext.none();

        String domain = client.getRedirectUris().stream().findFirst()
                .map(uri -> {
                    try { return URI.create(uri).getHost(); }
                    catch (IllegalArgumentException ignored) { return ""; }
                }).orElse("");
        return new LoginContinueContext(true, client.getClientName(), domain);
    }

    @PostMapping("/register")
    ResponseEntity<MessageResponse> register(
            @Valid @RequestBody RegistrationRequest input,
            HttpServletRequest request
    ) {
        String email = normalizeEmail(input.email());
        String username = normalizeIdentifier(input.username());
        var limit = rateLimits.consume("register", request.getRemoteAddr(), email, 4, Duration.ofHours(1));
        if (!limit.allowed()) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Has alcanzado el límite de registros. Prueba más tarde.");
        }
        if (users.existsByEmail(email) || users.existsByUsername(username)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "No se pudo crear la cuenta con esos datos.");
        }

        String firstName = input.firstName().trim();
        String lastName = input.lastName().trim();
        String secondLastName = input.secondLastName() == null ? "" : input.secondLastName().trim();
        try {
            IdentityUser created = accounts.create(new IdentityUser(email, username, firstName, lastName, secondLastName,
                    passwordEncoder.encode(input.password()), IdentityRole.USER));
            accountEmail.sendVerification(created);
        } catch (DataIntegrityViolationException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "No se pudo crear la cuenta con esos datos.");
        }
        audit.record(email, "account.created", email);
        return ResponseEntity.status(HttpStatus.CREATED).body(new MessageResponse("Cuenta creada. Revisa tu correo para verificar la dirección."));
    }

    @PostMapping("/login")
    ResponseEntity<?> login(
            @Valid @RequestBody LoginRequest input,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        String identifier = normalizeIdentifier(input.identifier());
        var limit = rateLimits.consume("login", request.getRemoteAddr(), identifier, 6, Duration.ofMinutes(15));
        if (!limit.allowed()) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .header("Retry-After", Long.toString(limit.retryAfterSeconds()))
                    .body(new MessageResponse("Demasiados intentos. Espera un poco antes de volver a probar."));
        }

        try {
            Authentication authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(identifier, input.password()));
            sessionAuthenticationStrategy.onAuthentication(authentication, request, response);
            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(authentication);
            SecurityContextHolder.setContext(context);
            securityContextRepository.saveContext(context, request, response);

            String next = nextPath(requestCache.getRequest(request, response), request);
            requestCache.removeRequest(request, response);
            String canonicalEmail = authentication.getName();
            audit.record(canonicalEmail, "account.signed_in", canonicalEmail);
            return ResponseEntity.ok(new LoginResponse(next));
        } catch (BadCredentialsException | DisabledException exception) {
            SecurityContextHolder.clearContext();
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new MessageResponse("El usuario o la contraseña no son correctos."));
        } catch (AuthenticationException exception) {
            SecurityContextHolder.clearContext();
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new MessageResponse("El usuario o la contraseña no son correctos."));
        }
    }

    @GetMapping("/me")
    UserResponse me(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof IdentityPrincipal principal)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        IdentityUser user = users.findById(principal.getId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        return new UserResponse(user.getId(), user.getEmail(), user.isEmailVerified(), user.getDisplayName(), user.getRole().name(),
                user.getUsername(), user.getFirstName(), user.getLastName(), user.getSecondLastName(),
                ProfilePictureUrls.relative(user));
    }

    private String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    private String normalizeIdentifier(String identifier) {
        return identifier.trim().toLowerCase(Locale.ROOT);
    }

    private String nextPath(SavedRequest savedRequest, HttpServletRequest request) {
        if (savedRequest == null) {
            Authentication current = SecurityContextHolder.getContext().getAuthentication();
            return current != null && current.getAuthorities().stream().anyMatch(authority -> authority.getAuthority().equals("ROLE_ADMIN"))
                    ? "/admin"
                    : "/cuenta";
        }
        try {
            URI target = URI.create(savedRequest.getRedirectUrl());
            String currentHost = request.getServerName();
            if (target.getHost() != null && !target.getHost().equalsIgnoreCase(currentHost)) {
                return "/cuenta";
            }
            String path = target.getRawPath();
            if (path == null || !path.startsWith("/") || path.startsWith("//")) {
                return "/cuenta";
            }
            return path + (target.getRawQuery() == null ? "" : "?" + target.getRawQuery());
        } catch (IllegalArgumentException exception) {
            return "/cuenta";
        }
    }

    public record RegistrationRequest(
            @NotBlank(message = "Elige un nombre de usuario.")
            @Pattern(regexp = "^[A-Za-z0-9._-]{3,32}$", message = "El usuario debe tener entre 3 y 32 caracteres válidos.") String username,
            @NotBlank(message = "Escribe tu nombre.") @Size(max = 80, message = "El nombre debe tener 80 caracteres o menos.") String firstName,
            @NotBlank(message = "Escribe tu primer apellido.") @Size(max = 80, message = "El apellido debe tener 80 caracteres o menos.") String lastName,
            @Size(max = 80, message = "El apellido debe tener 80 caracteres o menos.") String secondLastName,
            @NotBlank(message = "Escribe tu correo electrónico.") @Email(message = "Escribe un correo electrónico válido.") @Size(max = 320) String email,
            @NotBlank(message = "Escribe una contraseña.") @Size(min = 12, max = 128, message = "La contraseña debe tener entre 12 y 128 caracteres.") String password
    ) {
    }

    public record LoginRequest(
            @JsonAlias("email") @NotBlank(message = "Escribe tu usuario o correo electrónico.") @Size(max = 320) String identifier,
            @NotBlank(message = "Escribe tu contraseña.") @Size(max = 128) String password
    ) {
    }

    public record CsrfResponse(String token, String headerName) {
    }

    public record LoginContinueContext(boolean requested, String name, String domain) {
        static LoginContinueContext none() { return new LoginContinueContext(false, "", ""); }
    }

    public record LoginResponse(String next) {
    }

    public record MessageResponse(String message) {
    }

    public record UserResponse(
            String id,
            String email,
            boolean emailVerified,
            String displayName,
            String role,
            String username,
            String firstName,
            String lastName,
            String secondLastName,
            String picture
    ) {
    }
}
