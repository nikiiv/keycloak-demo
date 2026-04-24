plugins {
    `java-library`
}

group = "com.example.keycloak"
version = "1.0.0"

val keycloakVersion = "26.0.7"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

repositories {
    mavenCentral()
}

dependencies {
    compileOnly("org.keycloak:keycloak-core:$keycloakVersion")
    compileOnly("org.keycloak:keycloak-server-spi:$keycloakVersion")
    compileOnly("org.keycloak:keycloak-server-spi-private:$keycloakVersion")
    compileOnly("org.keycloak:keycloak-model-storage:$keycloakVersion")
    compileOnly("jakarta.ws.rs:jakarta.ws.rs-api:3.1.0")
}

tasks.jar {
    archiveBaseName.set("keycloak-demo-provider")
}
