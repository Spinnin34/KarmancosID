package com.karmancos.identity.user;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public class BootstrapAdminRunner implements ApplicationRunner {
    private final IdentityUserRepository users;
    private final IdentityAccountService accounts;
    private final PasswordEncoder passwordEncoder;
    private final String email;
    private final String password;

    public BootstrapAdminRunner(
            IdentityUserRepository users,
            IdentityAccountService accounts,
            PasswordEncoder passwordEncoder,
            @Value("${KARMANCOS_BOOTSTRAP_ADMIN_EMAIL:}") String email,
            @Value("${KARMANCOS_BOOTSTRAP_ADMIN_PASSWORD:}") String password
    ) {
        this.users = users;
        this.accounts = accounts;
        this.passwordEncoder = passwordEncoder;
        this.email = email;
        this.password = password;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (email.isBlank() && password.isBlank()) {
            return;
        }
        if (email.isBlank() || password.length() < 16) {
            throw new IllegalStateException("Bootstrap admin requires an email and a password of at least 16 characters.");
        }

        String normalizedEmail = email.trim().toLowerCase();
        if (!users.existsByEmail(normalizedEmail)) {
            String username = normalizedEmail.split("@", 2)[0]
                    .replaceAll("[^a-z0-9._-]", "_");
            if (username.length() < 3) username = "admin";
            if (username.length() > 24) username = username.substring(0, 24);
            while (users.existsByUsername(username)) {
                username = username.substring(0, Math.min(username.length(), 24))
                        + "_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 6);
            }
            accounts.create(new IdentityUser(normalizedEmail, username, "Administrador", "", "",
                    passwordEncoder.encode(password), IdentityRole.ADMIN));
        }
    }
}
