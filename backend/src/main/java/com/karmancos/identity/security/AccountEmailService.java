package com.karmancos.identity.security;

import com.karmancos.identity.user.IdentityUser;
import com.karmancos.identity.user.IdentityUserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import jakarta.annotation.PostConstruct;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.beans.factory.ObjectProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;

@Service
public class AccountEmailService {
    private static final Logger log = LoggerFactory.getLogger(AccountEmailService.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private final MongoTemplate mongo;
    private final IdentityUserRepository users;
    private final ObjectProvider<JavaMailSender> mail;
    private final String baseUrl;
    private final String from;
    private final Environment environment;
    private final String smtpHost;

    public AccountEmailService(MongoTemplate mongo, IdentityUserRepository users, ObjectProvider<JavaMailSender> mail,
                               @Value("${karmancos.public-base-url}") String baseUrl,
                               @Value("${karmancos.mail-from}") String from,
                               @Value("${spring.mail.host:}") String smtpHost,
                               Environment environment) {
        this.mongo = mongo;
        this.users = users;
        this.mail = mail;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.from = from;
        this.smtpHost = smtpHost;
        this.environment = environment;
    }

    @PostConstruct
    void validateProductionMail() {
        if (environment.acceptsProfiles(Profiles.of("prod")) && smtpHost.isBlank()) {
            throw new IllegalStateException("Production requires SPRING_MAIL_HOST for verification and recovery emails.");
        }
    }

    public void sendVerification(IdentityUser user) {
        String token = createToken(user, "verify", Duration.ofHours(24));
        send(user, "Confirma tu correo de Karmancos ID", "/verificar-correo?token=" + encode(token),
                "Confirma tu correo electrónico para completar la configuración de tu cuenta.");
    }

    public void requestPasswordReset(IdentityUser user) {
        String token = createToken(user, "reset", Duration.ofMinutes(30));
        send(user, "Recupera tu cuenta de Karmancos ID", "/restablecer-contrasena?token=" + encode(token),
                "Solicitaste cambiar la contraseña. Si no fuiste tú, ignora este mensaje.");
    }

    public void verifyEmail(String rawToken) {
        AccountActionToken token = consume(rawToken, "verify");
        IdentityUser user = users.findById(token.getUserId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "El enlace ha caducado o ya se ha usado."));
        if (!user.getEmail().equalsIgnoreCase(token.getTargetEmail())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El enlace ha caducado o ya se ha usado.");
        }
        user.setEmailVerified(true);
        users.save(user);
    }

    public IdentityUser consumePasswordReset(String rawToken) {
        AccountActionToken token = consume(rawToken, "reset");
        IdentityUser user = users.findById(token.getUserId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "El enlace ha caducado o ya se ha usado."));
        if (!user.getEmail().equalsIgnoreCase(token.getTargetEmail())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El enlace ha caducado o ya se ha usado.");
        }
        return user;
    }

    private String createToken(IdentityUser user, String purpose, Duration lifetime) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expires = Instant.now().plus(lifetime);
        mongo.remove(Query.query(Criteria.where("userId").is(user.getId()).and("purpose").is(purpose)), AccountActionToken.class);
        mongo.save(new AccountActionToken(digest(raw), user.getId(), user.getEmail(), purpose, expires));
        return raw;
    }

    private AccountActionToken consume(String raw, String purpose) {
        if (raw == null || raw.length() < 40 || raw.length() > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El enlace ha caducado o ya se ha usado.");
        }
        Query query = Query.query(Criteria.where("_id").is(digest(raw))
                .and("purpose").is(purpose).and("expiresAt").gt(Instant.now()));
        AccountActionToken token = mongo.findAndRemove(query, AccountActionToken.class);
        if (token == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El enlace ha caducado o ya se ha usado.");
        return token;
    }

    private void send(IdentityUser user, String subject, String path, String intro) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(user.getEmail());
        message.setSubject(subject);
        message.setText(intro + "\n\n" + baseUrl + path + "\n\nSi no solicitaste esta acción, puedes ignorar este mensaje.");
        JavaMailSender sender = mail.getIfAvailable();
        if (sender == null) {
            log.error("Account email could not be sent because SMTP is not configured.");
            return;
        }
        try {
            sender.send(message);
        } catch (RuntimeException exception) {
            log.error("Account email delivery failed ({}).", exception.getClass().getSimpleName());
        }
    }

    private String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }

    private String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
