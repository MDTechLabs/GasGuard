export default () => ({
  database: {
    host: process.env.DATABASE_HOST || "localhost",
    port: parseInt(process.env.DATABASE_PORT || "5432", 10),
    username: process.env.DATABASE_USERNAME || "postgres",
    password: process.env.DATABASE_PASSWORD || "postgres",
    name: process.env.DATABASE_NAME || "gasguard",
    synchronize: process.env.DATABASE_SYNCHRONIZE === "true",
    logging: process.env.DATABASE_LOGGING === "true",
    ssl: process.env.DATABASE_SSL === "true",
    maxQueryExecutionTime: parseInt(
      process.env.DATABASE_MAX_QUERY_TIME || "1000",
      10,
    ),
    // Connection pool settings
    maxConnections: parseInt(process.env.DATABASE_MAX_CONNECTIONS || "10", 10),
    minConnections: parseInt(process.env.DATABASE_MIN_CONNECTIONS || "1", 10),
    connectionTimeout: parseInt(
      process.env.DATABASE_CONNECTION_TIMEOUT || "30000",
      10,
    ),
    idleTimeout: parseInt(process.env.DATABASE_IDLE_TIMEOUT || "10000", 10),
  },
});
