package com.karmancos.identity.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.mongodb.core.index.IndexOperations;
import org.springframework.session.data.mongo.JacksonMongoSessionConverter;
import org.springframework.session.data.mongo.config.annotation.web.http.EnableMongoHttpSession;

@Configuration
@EnableMongoHttpSession(maxInactiveIntervalInSeconds = 1800, collectionName = "karmancos_sessions")
public class MongoSessionConfiguration {
    @Value("${MONGODB_CREATE_INDEXES:false}")
    private boolean createIndexes;

    @Bean
    JacksonMongoSessionConverter mongoSessionConverter() {
        return new JacksonMongoSessionConverter() {
            @Override
            protected void ensureIndexes(IndexOperations sessionCollectionIndexes) {
                if (createIndexes) super.ensureIndexes(sessionCollectionIndexes);
            }
        };
    }
}
