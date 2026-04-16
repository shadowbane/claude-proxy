// Global test setup — set env vars before anything imports config
process.env['NODE_ENV'] = 'test';
process.env['DB_PATH'] = ':memory:';
process.env['UPSTREAM_BASE_URL'] = 'https://test.example.com';
process.env['UPSTREAM_API_KEY'] = 'sk-test-key';
process.env['JWT_SECRET'] = 'test-jwt-secret';
process.env['TOKEN_ENCRYPTION_KEY'] = 'test-encryption-key';
process.env['ADMIN_USERNAME'] = 'admin';
process.env['ADMIN_PASSWORD'] = 'testpass123';
process.env['LOG_DIR'] = './data/test-logs';
process.env['LOG_LEVEL'] = 'silent';
