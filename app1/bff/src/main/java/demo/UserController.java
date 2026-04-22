package demo;

import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Get;
import io.micronaut.security.annotation.Secured;
import io.micronaut.security.authentication.Authentication;

import java.util.HashMap;
import java.util.Map;

@Controller("/api")
public class UserController {

    @Get("/user")
    @Secured({"isAuthenticated()"})
    public Map<String, Object> getUser(Authentication authentication) {
        Map<String, Object> user = new HashMap<>();
        user.put("username", authentication.getName());
        user.put("roles", authentication.getRoles());
        user.put("source", "app1-bff");
        authentication.getAttributes().forEach(user::put);
        return user;
    }

    @Get("/secure")
    @Secured({"isAuthenticated()"})
    public Map<String, String> getSecure() {
        Map<String, String> response = new HashMap<>();
        response.put("message", "This is a protected endpoint from App1 BFF");
        response.put("timestamp", String.valueOf(System.currentTimeMillis()));
        return response;
    }

    @Get("/public")
    @Secured({"isAnonymous()"})
    public Map<String, String> getPublic() {
        Map<String, String> response = new HashMap<>();
        response.put("message", "This is a public endpoint from App1 BFF");
        response.put("timestamp", String.valueOf(System.currentTimeMillis()));
        return response;
    }
}