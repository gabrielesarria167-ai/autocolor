-- The hardening. Run last, after the tables have data and the functions exist.
--
-- Needs the application role's password:
--     psql -v app_pw="..." -f sql/80_neon_grants.sql
--
-- CREATE THIS ROLE WITH SQL, NEVER IN THE NEON CONSOLE. A role created in the
-- console is granted neon_superuser, which reads every table in the database
-- and makes everything below decorative. This is the single most important
-- line in the file.
--
-- Order is deliberate: the role exists before anything is granted to it; each
-- REVOKE precedes its matching GRANT, so a Postgres default is cleared before
-- the intended right is added; ALTER DEFAULT PRIVILEGES is last, because it
-- governs only what is created after it.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. The role
-- ---------------------------------------------------------------------------

-- Created if absent, re-passworded if present, in one statement. \gexec and
-- not a DO block because psql does not substitute :'app_pw' inside a
-- dollar-quoted string, and not a GUC because that would leave the password
-- readable in the session. push.sh reads it from the environment rather than
-- passing it as an argument, where ps would show it.
SELECT format('CREATE ROLE colordb_app LOGIN NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'colordb_app')
UNION ALL
SELECT format('ALTER ROLE colordb_app PASSWORD %L', :'app_pw')
 WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'colordb_app')
\gexec

-- Only the two a managed Postgres will let the project owner set.
--
-- A new role is already NOSUPERUSER, NOREPLICATION and NOBYPASSRLS, and on
-- Neon nobody can say so out loud: the project owner holds neon_superuser, not
-- SUPERUSER, and only a true superuser may change those three attributes --
-- even to switch them off. Asserting them stops the script with "permission
-- denied to alter role" after the role has been created but before a single
-- grant is made.
ALTER ROLE colordb_app NOCREATEDB NOCREATEROLE;

-- Neon's free tier is a small compute shared with the requests database. Eight
-- is twice the application pool, leaving room for a deploy overlapping itself.
ALTER ROLE colordb_app CONNECTION LIMIT 8;

-- So the three that cannot be set are checked instead, which is worth more
-- than setting them would have been: this also catches a colordb_app created
-- in the Neon console, which arrives holding neon_superuser and can read every
-- table in the database no matter what the rest of this file grants. That is
-- the mistake this whole file is written around, and until now nothing here
-- would have noticed it.
DO $$
DECLARE r record; memberships text;
BEGIN
    SELECT rolsuper, rolreplication, rolbypassrls, rolcreatedb, rolcreaterole
      INTO r FROM pg_roles WHERE rolname = 'colordb_app';

    IF r.rolsuper OR r.rolreplication OR r.rolbypassrls
       OR r.rolcreatedb OR r.rolcreaterole THEN
        RAISE EXCEPTION 'colordb_app holds attributes it must not: superuser=%, replication=%, bypassrls=%, createdb=%, createrole=%',
            r.rolsuper, r.rolreplication, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole;
    END IF;

    -- It must belong to nothing. neon_superuser is granted by membership, not
    -- as an attribute, so the check above would not see it.
    SELECT string_agg(g.rolname, ', ') INTO memberships
    FROM pg_auth_members m
    JOIN pg_roles g ON g.oid = m.roleid
    JOIN pg_roles u ON u.oid = m.member
    WHERE u.rolname = 'colordb_app';

    IF memberships IS NOT NULL THEN
        RAISE EXCEPTION 'colordb_app is a member of: %. It must belong to no role. Was it created in the Neon console?', memberships;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The database: connect, and nothing else
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO colordb_app', current_database());
END $$;

-- ---------------------------------------------------------------------------
-- 3. public schema: nothing, for anybody
-- ---------------------------------------------------------------------------

REVOKE ALL    ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. The data. The application role is never granted USAGE here, which is what
--    makes "only through functions" a privilege rather than a convention: it
--    cannot name a table, so it cannot write a query against one.
-- ---------------------------------------------------------------------------

REVOKE ALL ON SCHEMA colour                  FROM PUBLIC;
REVOKE ALL ON ALL TABLES    IN SCHEMA colour FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA colour FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. The functions. Postgres grants EXECUTE to PUBLIC on every new function,
--    so the REVOKE is not optional, and each grant is named individually: a
--    blanket GRANT ON ALL FUNCTIONS would quietly publish the next one added.
-- ---------------------------------------------------------------------------

REVOKE ALL ON SCHEMA api                  FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api FROM PUBLIC;

GRANT USAGE ON SCHEMA api TO colordb_app;
GRANT EXECUTE ON FUNCTION api.makes()                                          TO colordb_app;
GRANT EXECUTE ON FUNCTION api.models(integer)                                  TO colordb_app;
GRANT EXECUTE ON FUNCTION api.colours_for(integer, integer, integer, integer)  TO colordb_app;
GRANT EXECUTE ON FUNCTION api.colour_by_code(integer, text)                    TO colordb_app;
GRANT EXECUTE ON FUNCTION api.colour(text)                                     TO colordb_app;
GRANT EXECUTE ON FUNCTION api.stats()                                          TO colordb_app;

-- ---------------------------------------------------------------------------
-- 6. Anything added later is private until somebody says otherwise
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA api    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA colour REVOKE ALL     ON TABLES    FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 7. Session defaults, scoped to the role in this database so the owner's own
--    loading and rebuilding are untouched.
-- ---------------------------------------------------------------------------

DO $$
DECLARE db text := current_database();
BEGIN
    -- A transaction property rather than a privilege, so it refuses writes
    -- even inside a SECURITY DEFINER function owned by the table owner.
    EXECUTE format('ALTER ROLE colordb_app IN DATABASE %I SET default_transaction_read_only = on', db);
    -- Forces the application to write api.makes() in full. Each function
    -- carries its own search_path, so their bodies still resolve the tables.
    EXECUTE format('ALTER ROLE colordb_app IN DATABASE %I SET search_path = ''''', db);
    EXECUTE format('ALTER ROLE colordb_app IN DATABASE %I SET statement_timeout = ''5s''', db);
    EXECUTE format('ALTER ROLE colordb_app IN DATABASE %I SET idle_in_transaction_session_timeout = ''10s''', db);
    EXECUTE format('ALTER ROLE colordb_app IN DATABASE %I SET lock_timeout = ''2s''', db);
END $$;

-- ---------------------------------------------------------------------------
-- 8. Say what was granted, so the deploy log shows it
-- ---------------------------------------------------------------------------

\echo ''
\echo '=== what colordb_app may execute ==='
SELECT p.proname || '(' || pg_get_function_arguments(p.oid) || ')' AS function,
       p.prosecdef AS security_definer,
       array_to_string(p.proconfig, ', ') AS pinned
FROM pg_proc p
WHERE p.pronamespace = 'api'::regnamespace
  AND has_function_privilege('colordb_app', p.oid, 'EXECUTE')
ORDER BY p.proname;

\echo ''
\echo '=== schemas colordb_app may use (api only) ==='
SELECT nspname FROM pg_namespace
WHERE has_schema_privilege('colordb_app', oid, 'USAGE')
  AND nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY nspname;
