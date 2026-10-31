package com.karmancos.identity.api;

import com.karmancos.identity.security.ClientApplicationRequest;
import com.karmancos.identity.security.LoginRateLimitService;
import com.karmancos.identity.audit.AuditService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Locale;

@RestController
public class ClientApplicationController {
    private final MongoTemplate mongo;
    private final LoginRateLimitService limits;
    private final AuditService audit;

    public ClientApplicationController(MongoTemplate mongo, LoginRateLimitService limits, AuditService audit) {
        this.mongo = mongo;
        this.limits = limits;
        this.audit = audit;
    }

    @PostMapping("/api/public/applications")
    ResponseEntity<AuthController.MessageResponse> submit(@Valid @RequestBody ApplicationInput input,
                                                           HttpServletRequest request) {
        String email = input.contactEmail().trim().toLowerCase(Locale.ROOT);
        if (!limits.consume("client-application", request.getRemoteAddr(), email, 3, Duration.ofDays(1)).allowed()) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Has alcanzado el límite de solicitudes. Prueba mañana.");
        }
        String type = input.clientType().toLowerCase(Locale.ROOT);
        if (!type.equals("public") && !type.equals("confidential")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Elige el tipo público o confidencial.");
        }
        List<String> callbacks = validate(input.redirectUris());
        List<String> logout = input.postLogoutRedirectUris() == null ? List.of() : validate(input.postLogoutRedirectUris());
        mongo.save(new ClientApplicationRequest(input.name().trim(), email, input.description().trim(), type, callbacks, logout));
        return ResponseEntity.accepted().body(new AuthController.MessageResponse(
                "Solicitud recibida. El equipo revisará el dominio y las URL de retorno antes de activar el cliente."));
    }

    @GetMapping("/api/admin/applications")
    List<ApplicationView> list() {
        return mongo.find(new Query().with(Sort.by(Sort.Direction.DESC, "submittedAt")), ClientApplicationRequest.class)
                .stream().map(ApplicationView::from).toList();
    }

    @PatchMapping("/api/admin/applications/{id}")
    ApplicationView review(@PathVariable String id, @Valid @RequestBody ReviewInput input, Authentication authentication) {
        ClientApplicationRequest current = mongo.findById(id, ClientApplicationRequest.class);
        if (current == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No se encontró la solicitud.");
        String status = input.status().toUpperCase(Locale.ROOT);
        if (!status.equals("APPROVED") && !status.equals("REJECTED")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Estado inválido.");
        Query pending = Query.query(Criteria.where("_id").is(id).and("status").is("PENDING"));
        ClientApplicationRequest application = mongo.findAndModify(pending,
                new Update().set("status", status).set("reviewedAt", java.time.Instant.now()),
                FindAndModifyOptions.options().returnNew(true), ClientApplicationRequest.class);
        if (application == null) throw new ResponseStatusException(HttpStatus.CONFLICT, "La solicitud ya se revisó.");
        audit.record(authentication.getName(), "client.application_" + status.toLowerCase(Locale.ROOT), application.getName());
        return ApplicationView.from(application);
    }

    private List<String> validate(List<String> values) {
        if (values == null || values.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Añade al menos una URL exacta.");
        return values.stream().map(value -> {
            try {
                URI uri = URI.create(value.trim());
                String host = uri.getHost();
                boolean local = "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host);
                if (host == null || uri.getUserInfo() != null || uri.getFragment() != null
                        || (!"https".equalsIgnoreCase(uri.getScheme()) && !(local && "http".equalsIgnoreCase(uri.getScheme())))) {
                    throw new IllegalArgumentException();
                }
                return uri.toASCIIString();
            } catch (IllegalArgumentException exception) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Las URL deben ser absolutas, HTTPS y sin credenciales ni fragmentos.");
            }
        }).distinct().toList();
    }

    public record ApplicationInput(@NotBlank @Size(max = 100) String name,
                                   @NotBlank @Email @Size(max = 320) String contactEmail,
                                   @NotBlank @Size(max = 1000) String description,
                                   @NotBlank String clientType,
                                   @NotEmpty @Size(max = 10) List<@NotBlank @Size(max = 2048) String> redirectUris,
                                   @Size(max = 10) List<@NotBlank @Size(max = 2048) String> postLogoutRedirectUris) { }
    public record ReviewInput(@NotBlank @Pattern(regexp = "(?i)APPROVED|REJECTED") String status) { }
    public record ApplicationView(String id, String name, String contactEmail, String description, String clientType,
                                  List<String> redirectUris, List<String> postLogoutRedirectUris, String status,
                                  java.time.Instant submittedAt, java.time.Instant reviewedAt) {
        static ApplicationView from(ClientApplicationRequest request) {
            return new ApplicationView(request.getId(), request.getName(), request.getContactEmail(), request.getDescription(),
                    request.getClientType(), request.getRedirectUris(), request.getPostLogoutRedirectUris(), request.getStatus(),
                    request.getSubmittedAt(), request.getReviewedAt());
        }
    }
}
