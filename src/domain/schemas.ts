import { z } from 'zod';
import type { CommandName } from './commands';

/**
 * Shape validation for command arguments arriving over the network. Business
 * rules (permissions, existence, uniqueness) are enforced by the commands.
 */
const s = (max = 200) => z.string().max(max);
const id = z.string().min(1).max(64);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date (YYYY-MM-DD)');
const iso = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'Expected a date-time');
const priority = z.enum(['low', 'medium', 'high', 'urgent']);
const status = z.enum(['not_started', 'in_progress', 'in_review', 'changes_requested', 'completed']);
const role = z.enum(['admin', 'manager', 'employee']);
const entityType = z.enum(['Private Limited', 'Public Limited', 'LLP', 'Partnership', 'Proprietorship', 'Individual', 'HUF', 'Trust']);
const fileRef = z.object({ name: s(200).min(1), sizeKb: z.number().min(0).max(1024 * 1024), fileId: id.optional() });

const taskInput = z.object({
  title: s(140),
  description: s(4000).default(''),
  clientId: id,
  categoryId: id,
  assigneeId: id,
  reviewerId: id.optional(),
  priority,
  startDate: dateKey,
  dueDate: dateKey,
  estimateHours: z.number().min(0).max(1000),
  requiresReview: z.boolean(),
  checklist: z.array(s(200)).max(100).default([]),
  serviceId: id.optional(),
  fee: z.number().min(0).max(1e9).optional(),
});

const permissions = z
  .object({
    viewAllTasks: z.boolean(),
    createTaskForOthers: z.boolean(),
    billing: z.boolean(),
    manageClients: z.boolean(),
    manageMasters: z.boolean(),
    whatsapp: z.boolean(),
    reports: z.boolean(),
    deleteRecords: z.boolean(),
  })
  .partial();

const clientInput = z
  .object({
    code: s(12),
    name: s(160),
    entityType,
    industry: s(80),
    contactName: s(120),
    email: s(160),
    phone: s(30),
    city: s(60),
    pan: s(10).optional(),
    gstin: s(15).optional(),
    relationshipManagerId: id,
    teamIds: z.array(id).max(50),
    status: z.enum(['active', 'onboarding', 'inactive']),
    notes: s(2000).optional(),
    billingName: s(160).optional(),
    tradeName: s(160).optional(),
    fileNo: s(20).optional(),
    incorporatedOn: dateKey.optional(),
    taxesApplicable: z.array(z.enum(['GST', 'Income Tax', 'Other'])).max(3).optional(),
    referredById: id.optional(),
    exitDate: dateKey.optional(),
    contacts: z.array(z.object({ name: s(120), designation: s(80), phone: s(30), email: s(160) })).max(30).optional(),
    customFields: z.array(z.object({ label: s(80), value: s(500) })).max(50).optional(),
    portalLogins: z.array(z.object({ portalId: id, username: s(120), password: s(200), hasPassword: z.boolean().optional() })).max(30).optional(),
    serviceIds: z.array(id).max(100).optional(),
  })
  .partial();

const memberFields = {
  name: s(120),
  email: s(160),
  role,
  title: s(80),
  managerId: id.optional(),
  phone: s(30).optional(),
  address: s(300).optional(),
  aadhaar: s(20).optional(),
  pan: s(10).optional(),
  username: s(60).optional(),
  permissions: permissions.optional(),
};

const templateInput = z.object({
  name: s(120),
  categoryId: id,
  description: s(2000),
  checklist: z.array(s(200)).max(100),
  assignmentRule: z.enum(['fixed', 'relationship_manager', 'unassigned']),
  defaultAssigneeId: id.optional(),
  reviewerId: id.optional(),
  frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'annual', 'custom']),
  intervalMonths: z.number().int().min(1).max(24).optional(),
  dueDay: z.number().int().min(1).max(31),
  dueMonthOffset: z.number().int().min(0).max(12),
  entityTypes: z.array(entityType).min(1),
  priority,
  estimateHours: z.number().min(0).max(1000),
  requiresReview: z.boolean(),
  active: z.boolean(),
});

export const commandSchemas: Record<CommandName, z.ZodTypeAny> = {
  createTask: z.tuple([taskInput]),
  updateTask: z.tuple([id, taskInput.partial()]),
  transitionTask: z.tuple([id, status]).rest(s(4000).optional()),
  setFilingStage: z.tuple([id, z.enum(['preparation', 'review', 'ready_to_file', 'filed'])]).rest(s(100).optional()),
  toggleChecklistItem: z.tuple([id, id]),
  addChecklistItem: z.tuple([id, s(200)]),
  removeChecklistItem: z.tuple([id, id]),
  addComment: z.tuple([id, s(8000)]),
  addAttachment: z.tuple([id, fileRef]),
  removeAttachment: z.tuple([id, id]),
  bulkReassign: z.tuple([z.array(id).max(500), id]),
  deleteTask: z.tuple([id]),
  createClient: z.tuple([clientInput]),
  updateClient: z.tuple([id, clientInput]),
  setClientExit: z.tuple([id]).rest(dateKey.optional()),
  requestDocument: z.tuple([z.object({ clientId: id, taskId: id.optional(), name: s(200), dueDate: dateKey.optional() })]),
  setDocumentStatus: z.tuple([id, z.enum(['pending', 'received'])]),
  inviteMember: z.tuple([z.object(memberFields)]),
  updateMember: z.tuple([id, z.object({ ...memberFields, status: z.enum(['active', 'invited', 'deactivated']), capacityHours: z.number().min(1).max(100) }).partial()]),
  deleteMember: z.tuple([id]),
  updateFirm: z.tuple([
    z
      .object({
        name: s(160),
        legalName: s(200),
        registrationNo: s(60),
        city: s(60),
        email: s(160),
        phone: s(30),
        atRiskDays: z.number().int(),
        whatsappNumber: s(30),
        invoicePrefix: s(12),
        defaultGstRate: z.number().min(0).max(28),
        gstin: s(15),
        address: s(300),
      })
      .partial(),
  ]),
  addCategory: z.tuple([s(60), z.boolean()]),
  markNotificationRead: z.tuple([id]).rest(z.boolean().optional()),
  markAllNotificationsRead: z.tuple([]),
  saveTemplate: z.tuple([templateInput]).rest(id.optional()),
  generateFromTemplate: z.tuple([id]),
  saveNote: z.tuple([z.object({ title: s(200), body: s(10000), color: z.enum(['yellow', 'blue', 'green', 'pink', 'slate']), pinned: z.boolean(), clientId: id.optional() })]).rest(id.optional()),
  deleteNote: z.tuple([id]),
  saveReminder: z.tuple([z.object({ title: s(200), dueAt: iso, clientId: id.optional(), repeat: z.enum(['none', 'daily', 'weekly', 'monthly']) })]),
  toggleReminder: z.tuple([id]),
  deleteReminder: z.tuple([id]),
  trackPortalOpen: z.tuple([id]),
  savePortal: z.tuple([z.object({ name: s(80), short: s(6), url: s(500), description: s(200) })]),
  updateNotice: z.tuple([id, z.object({ status: z.enum(['new', 'in_progress', 'replied', 'closed']), assigneeId: id.optional() }).partial()]),
  addNotice: z.tuple([
    z.object({
      clientId: id,
      source: z.enum(['GST', 'Income Tax', 'TDS', 'Other']),
      form: s(60),
      subject: s(500),
      reference: s(80),
      issuedOn: dateKey,
      dueOn: dateKey,
      amount: z.number().min(0).max(1e11).optional(),
      assigneeId: id.optional(),
    }),
  ]),
  fetchNotices: z.tuple([]),
  noticeToTask: z.tuple([id]),
  createInvoice: z.tuple([id, z.array(id).min(1).max(200)]),
  recordPayment: z.tuple([
    z.object({ clientId: id, invoiceId: id.optional(), date: dateKey, amount: z.number().positive().max(1e11), mode: z.enum(['UPI', 'NEFT', 'Cheque', 'Cash']), kind: z.enum(['advance', 'receipt']), reference: s(80) }),
  ]),
  setTaskFee: z.tuple([id, z.number().min(0).max(1e9)]),
  saveDsc: z
    .tuple([
      z.object({
        clientId: id,
        holder: s(120),
        type: z.enum(['Signing', 'Signing & Encryption']),
        provider: s(60),
        tokenSerial: s(60),
        issuedOn: dateKey,
        expiresOn: dateKey,
        custody: z.enum(['firm', 'client']),
      }),
    ])
    .rest(id.optional()),
  moveDsc: z.tuple([id]),
  addDocMovement: z.tuple([
    z.object({
      clientId: id,
      document: s(300),
      direction: z.enum(['in', 'out']),
      date: dateKey,
      mode: z.enum(['By hand', 'Courier', 'Email', 'Post']),
      person: s(120),
      expectedReturn: dateKey.optional(),
      remarks: s(1000).optional(),
    }),
  ]),
  markDocReturned: z.tuple([id]),
  sendChat: z.tuple([id, s(4096)]),
  sendBroadcast: z.tuple([z.object({ title: s(120), body: s(4096), kind: z.enum(['festival', 'compliance', 'custom']), clientIds: z.array(id).max(5000) })]),
  addDriveFiles: z.tuple([id, s(200), z.array(fileRef).min(1).max(50)]),
  deleteDriveFile: z.tuple([id]),
  saveService: z.tuple([z.object({ groupId: id, name: s(120), frequency: s(40), defaultFee: z.number().min(0).max(1e9) })]).rest(id.optional()),
  deleteService: z.tuple([id]),
  saveReferrer: z.tuple([z.object({ name: s(120), firmName: s(160), mobile: s(30), email: s(160), address: s(300) })]).rest(id.optional()),
  deleteReferrer: z.tuple([id]),
};

/** Parses raw JSON arguments for a command, dropping trailing `undefined`s. */
export function parseCommandArgs(name: CommandName, raw: unknown): unknown[] {
  const schema = commandSchemas[name];
  const r = schema.safeParse(Array.isArray(raw) ? raw : []);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new ArgsError(`Invalid request: ${issue.path.join('.') || 'arguments'} — ${issue.message}`);
  }
  return r.data as unknown[];
}

export class ArgsError extends Error {}
