import { describe, expect, it } from 'vitest';
import { postgresOptions } from '../src/db';

describe('PostgreSQL connection options', () => {
  it('verifies AWS RDS servers against Amazon’s CA with full certificate checks', () => {
    const o = postgresOptions('postgresql://app:p%40ss@ledger.abc123.ap-south-1.rds.amazonaws.com:5432/ledgerflow?sslmode=require', {});
    expect(o.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(String((o.ssl as { ca: string }).ca)).toContain('BEGIN CERTIFICATE');
    // SSL switches move out of the URL (they would override `ssl`); credentials and db stay.
    expect(o.connectionString).toBe('postgresql://app:p%40ss@ledger.abc123.ap-south-1.rds.amazonaws.com:5432/ledgerflow');
  });

  it('leaves other databases and explicit SSL settings alone', () => {
    const plain = 'postgres://u:p@db.example.com:5432/app?sslmode=require';
    expect(postgresOptions(plain, {})).toEqual({ connectionString: plain, max: 10 });
    const own = 'postgres://u:p@x.rds.amazonaws.com/app?sslmode=verify-full&sslrootcert=/etc/ca.pem';
    expect(postgresOptions(own, {}).ssl).toBeUndefined();
    const off = 'postgres://u:p@x.rds.amazonaws.com/app?sslmode=disable';
    expect(postgresOptions(off, {}).ssl).toBeUndefined();
  });

  it('uses DATABASE_CA_FILE for any host and honours PG_POOL_MAX', () => {
    const o = postgresOptions('postgres://u:p@10.0.0.5/app', { DATABASE_CA_FILE: 'server/certs/rds-global-bundle.pem', PG_POOL_MAX: '4' });
    expect(o.max).toBe(4);
    expect(o.ssl).toMatchObject({ rejectUnauthorized: true });
  });
});
