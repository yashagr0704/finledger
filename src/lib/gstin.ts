/**
 * GSTIN helpers. Format and check-digit validation are done offline (free).
 * Fetching registered details needs a GST API provider; the demo uses a small
 * fictional directory instead.
 */

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinCheckChar(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export const withChecksum = (gstin: string) => gstin.slice(0, 14) + gstinCheckChar(gstin.slice(0, 14));

export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '36': 'Telangana', '37': 'Andhra Pradesh',
};

const PAN_TYPE: Record<string, string> = { C: 'Private Limited', F: 'Partnership', P: 'Proprietorship', H: 'HUF', T: 'Trust' };

export type GstinCheck =
  | { ok: false; error: string }
  | { ok: true; pan: string; state: string; checksumOk: boolean; entityHint?: string };

export function checkGstin(raw: string): GstinCheck {
  const g = raw.trim().toUpperCase();
  if (g.length !== 15) return { ok: false, error: 'A GSTIN has exactly 15 characters.' };
  if (!GSTIN_RE.test(g)) return { ok: false, error: 'This doesn’t match the GSTIN format (e.g. 27ABCDE1234F1Z5).' };
  const state = STATE_CODES[g.slice(0, 2)];
  if (!state) return { ok: false, error: `State code ${g.slice(0, 2)} isn’t valid.` };
  return { ok: true, pan: g.slice(2, 12), state, checksumOk: gstinCheckChar(g.slice(0, 14)) === g[14], entityHint: PAN_TYPE[g[5]] };
}

export interface GstRecord {
  gstin: string;
  legalName: string;
  tradeName: string;
  entityType: string;
  registeredOn: string;
  status: 'Active' | 'Cancelled';
  taxpayerType: 'Regular' | 'Composition';
  address: string;
  city: string;
  natureOfBusiness: string;
}

/** Fictional records standing in for a GST API response. */
export const DEMO_GST_DIRECTORY: GstRecord[] = [
  { gstin: withChecksum('27AABCO1234P1Z0'), legalName: 'Orbit Analytics Private Limited', tradeName: 'Orbit Analytics', entityType: 'Private Limited', registeredOn: '2019-07-01', status: 'Active', taxpayerType: 'Regular', address: 'Office 7, Baner Road', city: 'Pune', natureOfBusiness: 'Supplier of services' },
  { gstin: withChecksum('24AAFFK5678M1Z0'), legalName: 'Kumar Brothers', tradeName: 'Kumar Brothers', entityType: 'Partnership', registeredOn: '2017-07-01', status: 'Active', taxpayerType: 'Regular', address: 'Shop 12, Relief Road', city: 'Ahmedabad', natureOfBusiness: 'Wholesale business, Retail business' },
  { gstin: withChecksum('29ABCPN4321Q1Z0'), legalName: 'Nandini Rao', tradeName: 'Nandini Sweets', entityType: 'Proprietorship', registeredOn: '2021-02-15', status: 'Active', taxpayerType: 'Composition', address: '45, 4th Block, Jayanagar', city: 'Bengaluru', natureOfBusiness: 'Retail business' },
];

export function lookupGstin(gstin: string) {
  return DEMO_GST_DIRECTORY.find((r) => r.gstin === gstin.trim().toUpperCase());
}
