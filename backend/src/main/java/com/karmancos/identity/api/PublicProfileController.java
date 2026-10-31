package com.karmancos.identity.api;

import com.karmancos.identity.user.IdentityUser;
import com.karmancos.identity.user.IdentityUserRepository;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import static org.springframework.http.HttpStatus.NOT_FOUND;

@RestController
@RequestMapping("/api/public/users")
public class PublicProfileController {
    private final IdentityUserRepository users;

    public PublicProfileController(IdentityUserRepository users) {
        this.users = users;
    }

    @GetMapping("/{id}/picture")
    ResponseEntity<byte[]> picture(@PathVariable String id, WebRequest request) {
        IdentityUser user = users.findById(id)
                .filter(IdentityUser::isActive)
                .filter(IdentityUser::hasProfilePicture)
                .orElseThrow(() -> new ResponseStatusException(NOT_FOUND));
        String etag = "\"" + user.getProfilePictureUpdatedAt().toEpochMilli() + "\"";
        CacheControl cache = CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic();
        if (request.checkNotModified(etag)) {
            return ResponseEntity.status(304).cacheControl(cache).eTag(etag).build();
        }
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(user.getProfilePictureContentType()))
                .cacheControl(cache)
                .eTag(etag)
                .header("X-Content-Type-Options", "nosniff")
                .body(user.getProfilePicture());
    }
}
