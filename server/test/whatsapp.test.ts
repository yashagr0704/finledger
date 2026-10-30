import { describe, expect, it } from 'vitest';
import { toWhatsAppNumber } from '../src/whatsapp';

describe('WhatsApp numbers', () => {
  it('formats client numbers the way Meta expects', () => {
    expect(toWhatsAppNumber('+91 98200 55101')).toBe('919820055101');
    expect(toWhatsAppNumber('98200 55101')).toBe('919820055101');
    expect(toWhatsAppNumber('098200-55101')).toBe('919820055101');
    expect(toWhatsAppNumber('+1 (555) 635-7734')).toBe('15556357734');
    expect(toWhatsAppNumber('12345')).toBeNull();
    expect(toWhatsAppNumber('')).toBeNull();
  });
});
