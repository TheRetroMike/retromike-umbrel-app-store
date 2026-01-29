-- Create the Miningcore DB + role once on first initialization of the Postgres data directory.
-- This runs only when /var/lib/postgresql/data is empty.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'miningcore') THEN
    CREATE ROLE miningcore LOGIN PASSWORD 'miningcore';
  END IF;
END$$;

SELECT 'CREATE DATABASE miningcore OWNER miningcore'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'miningcore')\gexec
