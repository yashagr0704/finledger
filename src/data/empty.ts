import type { Database } from '@/types';

/** Placeholder state used in backend mode before the server responds. */
export function emptyDatabase(): Database {
  return {
    version: 0,
    seededAt: new Date().toISOString(),
    firm: { name: '', legalName: '', registrationNo: '', city: '', email: '', phone: '', atRiskDays: 3 },
    users: [],
    clients: [],
    categories: [],
    tasks: [],
    comments: [],
    activities: [],
    notifications: [],
    documents: [],
    reviews: [],
    templates: [],
    services: [],
    referrers: [],
    notes: [],
    reminders: [],
    portals: [],
    notices: [],
    invoices: [],
    payments: [],
    dscs: [],
    docMovements: [],
    chats: [],
    broadcasts: [],
    drive: [],
  };
}
