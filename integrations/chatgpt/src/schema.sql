-- Apply explicitly to the auth database, never to a source read connection.
CREATE SCHEMA IF NOT EXISTS chatgpt_oauth;
CREATE TABLE IF NOT EXISTS chatgpt_oauth.records (
 kind text NOT NULL, key text NOT NULL, data jsonb NOT NULL,
 expires_at timestamptz NOT NULL, PRIMARY KEY(kind,key)
);
CREATE INDEX IF NOT EXISTS records_expiry ON chatgpt_oauth.records(expires_at);
