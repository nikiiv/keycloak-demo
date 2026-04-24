package demo;

import io.micronaut.context.annotation.Value;
import io.micronaut.http.HttpResponse;
import io.micronaut.http.HttpStatus;
import io.micronaut.http.MediaType;
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.Produces;
import io.micronaut.security.annotation.Secured;
import io.micronaut.security.authentication.Authentication;

import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Controller("/api")
@Produces(MediaType.APPLICATION_JSON)
public class UserController {

    private final String source;
    private final List<String> allowedRoles;

    public UserController(@Value("${app.source:bff}") String source,
                          @Value("${app.allowed-roles:}") List<String> allowedRoles) {
        this.source = source;
        this.allowedRoles = allowedRoles.stream()
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    @Get("/user")
    @Secured({"isAuthenticated()"})
    public HttpResponse<Map<String, Object>> getUser(Authentication authentication) {
        Collection<String> roles = authentication.getRoles();
        if (!allowedRoles.isEmpty() && Collections.disjoint(allowedRoles, roles)) {
            Map<String, Object> body = new HashMap<>();
            body.put("error", "forbidden");
            body.put("reason", "not_allowed");
            body.put("message", "This app is restricted to role(s): " + String.join(", ", allowedRoles) + ".");
            body.put("username", authentication.getName());
            body.put("allowedRoles", allowedRoles);
            body.put("yourRoles", roles);
            body.put("source", source);
            return HttpResponse.<Map<String, Object>>status(HttpStatus.FORBIDDEN).body(body);
        }
        Map<String, Object> user = new HashMap<>();
        user.put("username", authentication.getName());
        user.put("roles", roles);
        user.put("allowedRoles", allowedRoles);
        user.put("source", source);
        authentication.getAttributes().forEach(user::put);
        return HttpResponse.ok(user);
    }

    @Get("/secure")
    @Secured({"isAuthenticated()"})
    public Map<String, String> getSecure() {
        Map<String, String> response = new HashMap<>();
        response.put("message", "Protected endpoint");
        response.put("source", source);
        response.put("timestamp", String.valueOf(System.currentTimeMillis()));
        return response;
    }

    @Get("/public")
    @Secured({"isAnonymous()"})
    public Map<String, String> getPublic() {
        Map<String, String> response = new HashMap<>();
        response.put("message", "Public endpoint");
        response.put("source", source);
        response.put("timestamp", String.valueOf(System.currentTimeMillis()));
        return response;
    }
}
