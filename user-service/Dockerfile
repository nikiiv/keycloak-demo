# Build context is the repo root (see docker-compose.yml) so the contract at
# user-api/openapi.yaml is reachable. user-service and user-api are laid out as
# siblings under /app so the build's $rootDir/../user-api path resolves.
FROM gradle:8.5-jdk17 AS builder
WORKDIR /app/user-service

COPY user-service/settings.gradle user-service/build.gradle user-service/gradle.properties user-service/openapi-generator-ignore ./
COPY user-api /app/user-api
RUN gradle --no-daemon dependencies > /dev/null 2>&1 || true

COPY user-service/src ./src
RUN gradle --no-daemon shadowJar -x test

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /app/user-service/build/libs/*-all.jar /app/user-service.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/user-service.jar"]
