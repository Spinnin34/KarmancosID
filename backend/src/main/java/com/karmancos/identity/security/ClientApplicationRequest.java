package com.karmancos.identity.security;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

@Document("client_application_requests")
public class ClientApplicationRequest {
    @Id private String id;
    private String name;
    private String contactEmail;
    private String description;
    private String clientType;
    private List<String> redirectUris;
    private List<String> postLogoutRedirectUris;
    @Indexed private String status;
    private Instant submittedAt;
    private Instant reviewedAt;

    protected ClientApplicationRequest() { }

    public ClientApplicationRequest(String name, String contactEmail, String description, String clientType,
                                    List<String> redirectUris, List<String> postLogoutRedirectUris) {
        this.name = name;
        this.contactEmail = contactEmail;
        this.description = description;
        this.clientType = clientType;
        this.redirectUris = List.copyOf(redirectUris);
        this.postLogoutRedirectUris = List.copyOf(postLogoutRedirectUris);
        this.status = "PENDING";
        this.submittedAt = Instant.now();
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public String getContactEmail() { return contactEmail; }
    public String getDescription() { return description; }
    public String getClientType() { return clientType; }
    public List<String> getRedirectUris() { return redirectUris; }
    public List<String> getPostLogoutRedirectUris() { return postLogoutRedirectUris; }
    public String getStatus() { return status; }
    public Instant getSubmittedAt() { return submittedAt; }
    public Instant getReviewedAt() { return reviewedAt; }
    public void review(String status) { this.status = status; this.reviewedAt = Instant.now(); }
}
