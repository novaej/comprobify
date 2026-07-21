-- Standard PK generator for every table in this project: UUIDv7 (time-ordered).
-- PostgreSQL's native uuidv7() only ships in PG18+; the target version here is
-- 14.x minimum, so this implements the well-known recipe by hand: a 48-bit
-- millisecond Unix timestamp as the leading bytes (so values sort chronologically
-- and B-tree index locality doesn't degrade the way random UUIDv4 inserts would),
-- followed by random bytes with the version/variant bits set per RFC 9562.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3 FOR 6);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112); -- version 7
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128); -- variant 10
  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;
