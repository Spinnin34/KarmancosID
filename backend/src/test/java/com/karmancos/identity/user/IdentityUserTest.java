package com.karmancos.identity.user;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IdentityUserTest {
    @Test
    void emailStartsUnverifiedAndChangingItRequiresVerificationAgain() {
        IdentityUser user = new IdentityUser("ana@example.com", "ana", "Ana", "Luz", "",
                "{bcrypt}hash", IdentityRole.USER);
        assertFalse(user.isEmailVerified());

        user.setEmailVerified(true);
        user.updateIdentity("ana@example.com", "ana", "Ana", "Luz", "");
        assertTrue(user.isEmailVerified());

        user.updateIdentity("ana.new@example.com", "ana", "Ana", "Luz", "");
        assertFalse(user.isEmailVerified());
    }
}
