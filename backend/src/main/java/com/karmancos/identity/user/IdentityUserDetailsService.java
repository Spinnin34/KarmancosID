package com.karmancos.identity.user;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class IdentityUserDetailsService implements UserDetailsService {
    private final IdentityUserRepository users;

    public IdentityUserDetailsService(IdentityUserRepository users) {
        this.users = users;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        String identifier = username.trim().toLowerCase(java.util.Locale.ROOT);
        return users.findByEmailOrUsername(identifier, identifier)
                .map(IdentityPrincipal::new)
                .orElseThrow(() -> new UsernameNotFoundException("Account not found"));
    }
}
