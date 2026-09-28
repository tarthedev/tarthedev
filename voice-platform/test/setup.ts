// Test configuration: in-memory database, fake credentials, no real network calls.
process.env.DB_FILE = ":memory:";
process.env.APP_SECRET = "test-secret-0123456789";
process.env.PUBLIC_BASE_URL = "https://voice.example.test";
process.env.TWILIO_ACCOUNT_SID = "ACtest";
process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.ADMIN_PASSWORD = "pw";
process.env.SALES_CALLER_ID = "+12525550100";
process.env.DEMO_LINE_NUMBER = "+12525550101";
process.env.TIMEZONE = "America/New_York";
process.env.LOG_LEVEL = "silent";
