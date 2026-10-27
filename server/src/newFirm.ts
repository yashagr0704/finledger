import bcrypt from 'bcryptjs';
import { createSeed } from '@/data/seed';
import type { Database, User } from '@/types';
import { newId } from './crypto';
import type { FirmStore } from './firmStore';

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters for the password.';
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

/** A new, empty firm with sensible defaults copied from the demo (groups, services, portals, templates). */
export function newFirmDatabase(firmName: string, admin: { name: string; email: string }): { db: Database; firmId: string; adminId: string } {
  const demo = createSeed();
  const firmId = newId('firm');
  const adminId = newId('usr');
  const user: User = {
    id: adminId,
    name: admin.name.trim(),
    email: admin.email.trim().toLowerCase(),
    phone: '',
    role: 'admin',
    title: 'Partner',
    status: 'active',
    joinedAt: new Date().toISOString().slice(0, 10),
    capacityHours: 40,
    avatarHue: 245,
    username: admin.email.split('@')[0],
  };
  const db: Database = {
    ...demo,
    firm: { name: firmName.trim(), legalName: firmName.trim(), registrationNo: '', city: '', email: user.email, phone: '', atRiskDays: 3, invoicePrefix: 'INV', defaultGstRate: 18 },
    users: [user],
    clients: [],
    tasks: [],
    comments: [],
    activities: [],
    notifications: [],
    documents: [],
    reviews: [],
    templates: demo.templates.map((t) => ({ ...t, assignmentRule: 'unassigned', defaultAssigneeId: undefined, reviewerId: undefined, requiresReview: false, active: false, lastGeneratedAt: undefined })),
    referrers: [],
    notes: [],
    reminders: [],
    portals: demo.portals.map((p) => ({ ...p, clicks: 0 })),
    notices: [],
    invoices: [],
    payments: [],
    dscs: [],
    docMovements: [],
    chats: [],
    broadcasts: [],
    drive: [],
  };
  return { db, firmId, adminId };
}

/** Loads the full demo firm (Mehta Iyer & Associates) with a shared demo password. */
export async function seedDemoFirm(firms: FirmStore, password: string, firmId = 'firm_demo') {
  const db = createSeed();
  const hash = await hashPassword(password);
  const creds = Object.fromEntries(db.users.filter((u) => u.status === 'active').map((u) => [u.id, hash]));
  await firms.create(db, firmId, creds);
  return { firmId, users: db.users.filter((u) => u.status === 'active').map((u) => ({ email: u.email, role: u.role, name: u.name })) };
}
