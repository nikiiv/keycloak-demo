package demo;

import io.micronaut.context.annotation.Value;
import io.micronaut.http.HttpResponse;
import io.micronaut.http.MediaType;
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.Produces;
import io.micronaut.security.annotation.Secured;
import io.micronaut.security.authentication.Authentication;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Controller("/api")
@Produces(MediaType.APPLICATION_JSON)
public class UserController {

    private final String source;
    private final String requiredRole;

    public UserController(@Value("${app.source:bff}") String source,
                          @Value("${app.required-role:}") String requiredRole) {
        this.source = source;
        this.requiredRole = requiredRole == null ? "" : requiredRole.trim();
    }

    @Get("/user")
    @Secured({"isAuthenticated()"})
    public HttpResponse<Map<String, Object>> getUser(Authentication authentication) {
        List<String> roles = authentication.getRoles();
        if (!requiredRole.isEmpty() && !roles.contains(requiredRole)) {
            Map<String, Object> forbidden = new HashMap<>();
            forbidden.put("error", "forbidden");
            forbidden.put("message", "Authenticated, but not authorized for this app.");
            forbidden.put("username", authentication.getName());
            forbidden.put("requiredRole", requiredRole);
            forbidden.put("yourRoles", roles);
            forbidden.put("source", source);
            return HttpResponse.<Map<String, Object>>status(io.micronaut.http.HttpStatus.FORBIDDEN).body(forbidden);
        }
        Map<String, Object> user = new HashMap<>();
        user.put("username", authentication.getName());
        user.put("roles", roles);
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
