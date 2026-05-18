plugins {
    `java-library`
    id("org.openapi.generator") version "7.7.0"
    id("com.gradleup.shadow") version "8.3.5"
}

group = "com.example.keycloak"
version = "1.0.0"

val keycloakVersion = "26.0.7"
val jacksonVersion = "2.17.2"

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
    // EmailOtpAuthenticator uses jakarta.ws.rs types; Keycloak's SPI jars
    // don't expose them at compile time.
    compileOnly("jakarta.ws.rs:jakarta.ws.rs-api:3.1.0")

    // The generated `java`/`native` client uses java.net.http (JDK 17, no
    // extra runtime) plus Jackson. Jackson is bundled and RELOCATED into the
    // provider jar (see shadowJar) so it can't clash with the Jackson Keycloak
    // ships on the provider classpath.
    implementation("com.fasterxml.jackson.core:jackson-databind:$jacksonVersion")
    implementation("com.fasterxml.jackson.core:jackson-core:$jacksonVersion")
    implementation("com.fasterxml.jackson.core:jackson-annotations:$jacksonVersion")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310:$jacksonVersion")

    // @jakarta.annotation.Nullable/@Generated used by the generated client.
    implementation("jakarta.annotation:jakarta.annotation-api:2.1.1")
}

// --- Contract-first: generate the REST client from the shared spec ---
openApiGenerate {
    generatorName.set("java")
    library.set("native")
    inputSpec.set("$rootDir/../user-api/openapi.yaml")
    outputDir.set("$buildDir/generated/openapi")
    apiPackage.set("com.example.keycloak.client.api")
    modelPackage.set("com.example.keycloak.client.model")
    invokerPackage.set("com.example.keycloak.client.invoker")
    configOptions.set(mapOf(
            "library" to "native",
            "useJakartaEe" to "true",
            "hideGenerationTimestamp" to "true",
            "openApiNullable" to "false"
    ))
}

sourceSets["main"].java.srcDir("$buildDir/generated/openapi/src/main/java")

tasks.named("compileJava") {
    dependsOn("openApiGenerate")
}

tasks.shadowJar {
    archiveBaseName.set("keycloak-demo-provider")
    archiveClassifier.set("")
    // Keycloak ships its own Jackson on the provider classpath; relocate ours
    // so the in-JVM SPI client can never collide with it.
    relocate("com.fasterxml.jackson", "com.example.keycloak.shaded.jackson")
    // Preserve META-INF/services/...UserStorageProviderFactory so Keycloak
    // still discovers the SPI.
    mergeServiceFiles()
}

tasks.named("build") {
    dependsOn(tasks.shadowJar)
}
