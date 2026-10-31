package com.karmancos.identity.api;

import org.springframework.http.HttpStatus;
import com.karmancos.identity.security.MongoRegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/public/clients")
public class PublicClientController {
    private final MongoRegisteredClientRepository clients;

    public PublicClientController(MongoRegisteredClientRepository clients) {
        this.clients = clients;
    }

    @GetMapping("/{clientId}")
    ClientMetadata client(@PathVariable String clientId) {
        RegisteredClient client = clients.findByClientId(clientId);
        if (client == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No se encontró el servicio que solicita acceso.");
        }
        String domain = client.getRedirectUris().stream().findFirst()
                .map(uri -> {
                    try { return java.net.URI.create(uri).getHost(); }
                    catch (IllegalArgumentException ignored) { return ""; }
                }).orElse("");
        return new ClientMetadata(client.getClientId(), client.getClientName(), domain);
    }

    public record ClientMetadata(String clientId, String name, String domain) {
    }
}
