package com.karmancos.identity.user;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.ArrayList;
import java.util.List;

@Service
public class IdentityAccountService {
    private final MongoTemplate mongoTemplate;
    private final IdentityUserRepository users;

    public IdentityAccountService(MongoTemplate mongoTemplate, IdentityUserRepository users) {
        this.mongoTemplate = mongoTemplate;
        this.users = users;
    }

    public IdentityUser create(IdentityUser user) {
        String emailKey = key("email", user.getEmail());
        String usernameKey = key("username", user.getUsername());
        boolean emailLockAcquired = false;
        boolean usernameLockAcquired = false;
        try {
            mongoTemplate.insert(new IdentityUniqueKey(emailKey, user.getId()));
            emailLockAcquired = true;
            mongoTemplate.insert(new IdentityUniqueKey(usernameKey, user.getId()));
            usernameLockAcquired = true;
            return users.insert(user);
        } catch (RuntimeException exception) {
            if (usernameLockAcquired) release(usernameKey, user.getId());
            if (emailLockAcquired) release(emailKey, user.getId());
            if (exception instanceof DuplicateKeyException) {
                throw new DuplicateKeyException("La cuenta ya existe.", exception);
            }
            throw exception;
        }
    }

    public IdentityUser updateIdentity(IdentityUser user, String email, String username,
                                       String firstName, String lastName, String secondLastName) {
        String oldEmailKey = key("email", user.getEmail());
        String oldUsernameKey = key("username", user.getUsername());
        String newEmailKey = key("email", email);
        String newUsernameKey = key("username", username);
        List<String> acquired = new ArrayList<>();
        boolean persisted = false;

        try {
            if (!oldEmailKey.equals(newEmailKey)) {
                mongoTemplate.insert(new IdentityUniqueKey(newEmailKey, user.getId()));
                acquired.add(newEmailKey);
            }
            if (!oldUsernameKey.equals(newUsernameKey)) {
                mongoTemplate.insert(new IdentityUniqueKey(newUsernameKey, user.getId()));
                acquired.add(newUsernameKey);
            }

            user.updateIdentity(email, username, firstName, lastName, secondLastName);
            IdentityUser saved = users.save(user);
            persisted = true;

            if (!oldEmailKey.equals(newEmailKey)) release(oldEmailKey, user.getId());
            if (!oldUsernameKey.equals(newUsernameKey)) release(oldUsernameKey, user.getId());
            return saved;
        } catch (RuntimeException exception) {
            if (!persisted) acquired.forEach(value -> release(value, user.getId()));
            if (exception instanceof DuplicateKeyException) {
                throw new DuplicateKeyException("La cuenta ya existe.", exception);
            }
            throw exception;
        }
    }

    private void release(String key, String ownerId) {
        mongoTemplate.remove(Query.query(Criteria.where("_id").is(key).and("ownerId").is(ownerId)), IdentityUniqueKey.class);
    }

    private String key(String type, String value) {
        try {
            byte[] input = (type + "\u0000" + value).getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
