package com.karmancos.identity.api;

import com.karmancos.identity.user.IdentityUser;

public final class ProfilePictureUrls {
    private ProfilePictureUrls() { }

    public static String relative(IdentityUser user) {
        if (user == null || !user.hasProfilePicture() || user.getProfilePictureUpdatedAt() == null) return null;
        return "/api/public/users/" + user.getId() + "/picture?v=" + user.getProfilePictureUpdatedAt().toEpochMilli();
    }

    public static String absolute(IdentityUser user, String issuer) {
        String path = relative(user);
        return path == null ? null : issuer.replaceAll("/+$", "") + path;
    }
}
