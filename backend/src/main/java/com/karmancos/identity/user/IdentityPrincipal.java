package com.karmancos.identity.user;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import org.springframework.security.core.CredentialsContainer;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;

@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)
public final class IdentityPrincipal implements UserDetails, CredentialsContainer {
    private final String id;
    private final String email;
    private final String accountUsername;
    private final String firstName;
    private final String lastName;
    private final String secondLastName;
    private final String displayName;
    private final IdentityRole role;
    private final boolean active;
    private String passwordHash;

    public IdentityPrincipal(IdentityUser user) {
        this(user.getId(), user.getEmail(), user.getUsername(), user.getFirstName(), user.getLastName(),
                user.getSecondLastName(), user.getDisplayName(), user.getRole(), user.isActive(), user.getPasswordHash());
    }

    @JsonCreator
    public IdentityPrincipal(
            @JsonProperty("id") String id,
            @JsonProperty("email") String email,
            @JsonProperty("accountUsername") String accountUsername,
            @JsonProperty("firstName") String firstName,
            @JsonProperty("lastName") String lastName,
            @JsonProperty("secondLastName") String secondLastName,
            @JsonProperty("displayName") String displayName,
            @JsonProperty("role") IdentityRole role,
            @JsonProperty("active") boolean active,
            @JsonProperty("passwordHash") String passwordHash
    ) {
        this.id = id;
        this.email = email;
        this.accountUsername = accountUsername;
        this.firstName = firstName;
        this.lastName = lastName;
        this.secondLastName = secondLastName;
        this.displayName = displayName;
        this.role = role;
        this.active = active;
        this.passwordHash = passwordHash;
    }

    public String getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getAccountUsername() {
        return accountUsername;
    }

    public String getFirstName() {
        return firstName;
    }

    public String getLastName() {
        return lastName;
    }

    public String getSecondLastName() {
        return secondLastName;
    }

    public String getFamilyName() {
        return String.join(" ", lastName, secondLastName).trim().replaceAll("\\s+", " ");
    }

    public IdentityRole getRole() {
        return role;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return email;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return active;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return active;
    }

    @Override
    public void eraseCredentials() {
        passwordHash = null;
    }
}
