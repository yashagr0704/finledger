import type { Database, Invoice } from '@/types';
import { todayKey } from './dates';

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
export const inrShort = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(n >= 1000000 ? 1 : 2)}L` : n >= 1000 ? `₹${(n / 1000).toFixed(1)}k` : inr(n));

export const invoiceSubtotal = (inv: Invoice) => inv.items.reduce((s, i) => s + i.amount, 0);
export const invoiceTax = (inv: Invoice) => Math.round((invoiceSubtotal(inv) * inv.gstRate) / 100);
export const invoiceTotal = (inv: Invoice) => invoiceSubtotal(inv) + invoiceTax(inv);

export function invoicePaid(db: Database, inv: Invoice) {
  return db.payments.filter((p) => p.invoiceId === inv.id).reduce((s, p) => s + p.amount, 0);
}

export type InvoiceStatus = 'paid' | 'partial' | 'overdue' | 'unpaid';
export function invoiceStatus(db: Database, inv: Invoice): InvoiceStatus {
  const paid = invoicePaid(db, inv);
  const total = invoiceTotal(inv);
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return inv.dueDate < todayKey() ? 'overdue' : 'unpaid';
}

export function billingSummary(db: Database) {
  const unbilled = db.tasks.filter((t) => t.status === 'completed' && !t.invoiceId && (t.fee ?? 0) > 0);
  const wip = db.tasks.filter((t) => t.status !== 'completed');
  const billed = db.invoices.reduce((s, i) => s + invoiceTotal(i), 0);
  const received = db.payments.filter((p) => p.kind === 'receipt').reduce((s, p) => s + p.amount, 0);
  const advances = db.payments.filter((p) => p.kind === 'advance').reduce((s, p) => s + p.amount, 0);
  const month = todayKey().slice(0, 7);
  return {
    unbilled,
    unbilledValue: unbilled.reduce((s, t) => s + (t.fee ?? 0), 0),
    wip,
    wipValue: wip.reduce((s, t) => s + (t.fee ?? 0), 0),
    billed,
    outstanding: billed - received,
    advances,
    collectedThisMonth: db.payments.filter((p) => p.date.slice(0, 7) === month).reduce((s, p) => s + p.amount, 0),
    billedThisMonth: db.invoices.filter((i) => i.date.slice(0, 7) === month).reduce((s, i) => s + invoiceTotal(i), 0),
  };
}

/** Client ledger: invoices are debits, receipts and advances are credits. */
export function clientLedger(db: Database, clientId: string) {
  const rows = [
    ...db.invoices.filter((i) => i.clientId === clientId).map((i) => ({ date: i.date, particulars: `Invoice ${i.number}`, debit: invoiceTotal(i), credit: 0, ref: i.id })),
    ...db.payments
      .filter((p) => p.clientId === clientId)
      .map((p) => ({ date: p.date, particulars: p.kind === 'advance' ? `Advance received (${p.mode})` : `Receipt ${p.mode} · ${p.reference}`, debit: 0, credit: p.amount, ref: p.id })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let bal = 0;
  return rows.map((r) => ({ ...r, balance: (bal += r.debit - r.credit) }));
}
