package demo.userservice;

import demo.userservice.api.AbstractUsersController;
import demo.userservice.model.User;
import demo.userservice.model.VerifyCredentialsRequest;
import demo.userservice.model.VerifyCredentialsResponse;
import io.micronaut.http.HttpStatus;
import io.micronaut.http.annotation.Controller;
import io.micronaut.http.exceptions.HttpStatusException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Map;

/**
 * The standalone user store. This is the data that used to live as a hardcoded
 * Map inside the Keycloak User Storage SPI; it now lives here and is reached
 * over REST. The routing/annotations come from {@link AbstractUsersController},
 * which is generated from user-api/openapi.yaml — this class only supplies the
 * delegate logic.
 */
@Controller
public class UserController extends AbstractUsersController {

    private static final Logger LOG = LoggerFactory.getLogger(UserController.class);

    /** Same three demo users (and same plaintext passwords) as the old SPI map. */
    private record DemoUserRecord(String username, String password, String email,
                                  String firstName, String lastName, List<String> roles) {
    }

    private static final Map<String, DemoUserRecord> USERS = Map.of(
            "demoadmin",  new DemoUserRecord("demoadmin",  "123", "petarnenovpetrov+admin@gmail.com",  "Demo", "Admin",  List.of("admin", "user")),
            "demouser",   new DemoUserRecord("demouser",   "123", "petarnenovpetrov+user@gmail.com",   "Demo", "User",   List.of("user")),
            "democlient", new DemoUserRecord("democlient", "123", "petarnenovpetrov+client@gmail.com", "Demo", "Client", List.of("client"))
    );

    @Override
    public User getUserByUsername(String username) {
        LOG.info("getUserByUsername: {}", username);
        DemoUserRecord record = USERS.get(username);
        if (record == null) {
            throw new HttpStatusException(HttpStatus.NOT_FOUND, "No such user: " + username);
        }
        return toUser(record);
    }

    @Override
    public User getUserByEmail(String email) {
        LOG.info("getUserByEmail: {}", email);
        return USERS.values().stream()
                .filter(r -> r.email().equalsIgnoreCase(email))
                .findFirst()
                .map(UserController::toUser)
                .orElseThrow(() -> new HttpStatusException(HttpStatus.NOT_FOUND, "No user with email: " + email));
    }

    @Override
    public VerifyCredentialsResponse verifyCredentials(VerifyCredentialsRequest request) {
        DemoUserRecord record = USERS.get(request.getUsername());
        boolean valid = record != null && record.password().equals(request.getPassword());
        LOG.info("verifyCredentials: {} -> {}", request.getUsername(), valid);
        return new VerifyCredentialsResponse(valid);
    }

    private static User toUser(DemoUserRecord record) {
        User user = new User(record.username(), List.copyOf(record.roles()));
        user.setEmail(record.email());
        user.setFirstName(record.firstName());
        user.setLastName(record.lastName());
        return user;
    }
}
