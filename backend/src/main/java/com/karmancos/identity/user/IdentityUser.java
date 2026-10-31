package com.karmancos.identity.user;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.UUID;

@Document("identity_users")
public class IdentityUser {
    @Id
    private String id;

    @Indexed(unique = true, name = "uk_identity_username")
    private String username;

    @Indexed(unique = true, name = "uk_identity_email")
    private String email;

    private String firstName;

    private String lastName;

    private String secondLastName;

    private String displayName;

    private byte[] profilePicture;

    private String profilePictureContentType;

    private Instant profilePictureUpdatedAt;

    private String passwordHash;

    private IdentityRole role;

    private boolean active;

    /** True only after the account owner has completed the email verification flow. */
    private boolean emailVerified;

    private Instant createdAt;

    protected IdentityUser() {
    }

    public IdentityUser(
            String email,
            String username,
            String firstName,
            String lastName,
            String secondLastName,
            String passwordHash,
            IdentityRole role
    ) {
        this.id = UUID.randomUUID().toString();
        this.email = email;
        this.username = username;
        this.firstName = firstName;
        this.lastName = lastName;
        this.secondLastName = secondLastName;
        this.displayName = String.join(" ", firstName, lastName, secondLastName).trim().replaceAll("\\s+", " ");
        this.passwordHash = passwordHash;
        this.role = role;
        this.active = true;
        this.createdAt = Instant.now();
    }

    public String getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getUsername() {
        return username;
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

    public String getDisplayName() {
        return displayName;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public IdentityRole getRole() {
        return role;
    }

    public boolean isActive() {
        return active;
    }

    public boolean isEmailVerified() {
        return emailVerified;
    }

    public void setEmailVerified(boolean emailVerified) {
        this.emailVerified = emailVerified;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public byte[] getProfilePicture() {
        return profilePicture == null ? null : profilePicture.clone();
    }

    public String getProfilePictureContentType() {
        return profilePictureContentType;
    }

    public Instant getProfilePictureUpdatedAt() {
        return profilePictureUpdatedAt;
    }

    public boolean hasProfilePicture() {
        return profilePicture != null && profilePicture.length > 0 && profilePictureContentType != null
                && profilePictureUpdatedAt != null;
    }

    public void updateProfilePicture(byte[] image, String contentType) {
        this.profilePicture = image.clone();
        this.profilePictureContentType = contentType;
        this.profilePictureUpdatedAt = Instant.now();
    }

    public void removeProfilePicture() {
        this.profilePicture = null;
        this.profilePictureContentType = null;
        this.profilePictureUpdatedAt = null;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public void setRole(IdentityRole role) {
        this.role = role;
    }

    public void updateIdentity(String email, String username, String firstName, String lastName, String secondLastName) {
        if (!this.email.equalsIgnoreCase(email)) {
            this.emailVerified = false;
        }
        this.email = email;
        this.username = username;
        this.firstName = firstName;
        this.lastName = lastName;
        this.secondLastName = secondLastName;
        this.displayName = String.join(" ", firstName, lastName, secondLastName).trim().replaceAll("\\s+", " ");
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }
}
