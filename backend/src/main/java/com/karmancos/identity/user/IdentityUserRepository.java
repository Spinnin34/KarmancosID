package com.karmancos.identity.user;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.Optional;

public interface IdentityUserRepository extends MongoRepository<IdentityUser, String> {
    Optional<IdentityUser> findByEmail(String email);

    Optional<IdentityUser> findByEmailOrUsername(String email, String username);

    boolean existsByEmail(String email);

    boolean existsByUsername(String username);

    long countByRole(IdentityRole role);
}
