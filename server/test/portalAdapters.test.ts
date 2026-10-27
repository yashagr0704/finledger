import { describe, expect, it } from 'vitest';
import { adapterFor, isAllowedHost } from '@/config/portalAdapters';
import { PORTALS } from '@/data/seedExtras';
import type { Portal } from '@/types';

const portal = (id: string) => PORTALS.find((p) => p.id === id)!;

describe('portal adapters', () => {
  it('has a tuned adapter for each predefined statutory portal', () => {
    for (const id of ['pt_gst', 'pt_it', 'pt_traces', 'pt_mca', 'pt_epfo', 'pt_esic']) {
      const a = adapterFor(portal(id));
      expect(a.loginUrl).toMatch(/^https:\/\//);
      expect(isAllowedHost(a, a.loginUrl)).toBe(true);
      expect(a.password.length).toBeGreaterThan(0);
      expect(a.steps.length).toBeGreaterThan(0);
    }
  });

  it('only allows the portal’s own hosts', () => {
    const gst = adapterFor(portal('pt_gst'));
    expect(isAllowedHost(gst, 'https://services.gst.gov.in/services/login')).toBe(true);
    expect(isAllowedHost(gst, 'https://www.gst.gov.in/')).toBe(true);
    expect(isAllowedHost(gst, 'https://gst.gov.in.evil.example/login')).toBe(false);
    expect(isAllowedHost(gst, 'https://evilgst.gov.in/login')).toBe(false);
    expect(isAllowedHost(gst, 'https://www.incometax.gov.in/')).toBe(false);
    expect(isAllowedHost(gst, 'not a url')).toBe(false);
  });

  it('signs in to the new Flutter-based TRACES by filling the box the user clicks', () => {
    const a = adapterFor(portal('pt_traces'));
    expect(a.loginUrl).toBe('https://traces.tdscpc.gov.in/auth/login/loginScreen');
    expect(a.fillOnFocus).toBe(true);
    expect(isAllowedHost(a, 'https://traces.tdscpc.gov.in/auth/dashboard/taxpayerDashboardScreen')).toBe(true);
    expect(a.signedIn?.urlIncludes).toContain('/auth/dashboard/');
  });

  it('builds a generic adapter for custom portals from their sign-in page', () => {
    const custom: Portal = { id: 'portal_x', name: 'SEZ Online', short: 'SEZ', url: 'https://www.sezonline.gov.in/', loginUrl: 'https://login.sezonline.gov.in/auth', description: '', clicks: 0, hue: 0 };
    const a = adapterFor(custom);
    expect(a.loginUrl).toBe('https://login.sezonline.gov.in/auth');
    expect(a.hosts).toEqual(expect.arrayContaining(['login.sezonline.gov.in', 'sezonline.gov.in']));
    expect(a.signedIn).toBeUndefined(); // never claims a verified sign-in without a portal-specific check
  });
});
