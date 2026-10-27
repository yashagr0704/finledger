export type Role = 'admin' | 'manager' | 'employee';
export type UserStatus = 'active' | 'invited' | 'deactivated';

/** Per-user access switches set by the admin. Unset values fall back to role defaults. */
export interface Permissions {
  viewAllTasks: boolean;
  createTaskForOthers: boolean;
  billing: boolean;
  manageClients: boolean;
  manageMasters: boolean;
  whatsapp: boolean;
  reports: boolean;
  deleteRecords: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  title: string;
  /** Manager this employee reports to (for managers' team scope). */
  managerId?: string;
  status: UserStatus;
  joinedAt: string;
  /** Weekly capacity in hours used for workload indicators. */
  capacityHours: number;
  avatarHue: number;
  username?: string;
  address?: string;
  /** Stored masked in the demo (last 4 digits only). */
  aadhaar?: string;
  pan?: string;
  permissions?: Partial<Permissions>;
}

export type EntityType =
  | 'Private Limited'
  | 'Public Limited'
  | 'LLP'
  | 'Partnership'
  | 'Proprietorship'
  | 'Individual'
  | 'HUF'
  | 'Trust';

export const ENTITY_TYPES: EntityType[] = [
  'Private Limited',
  'Public Limited',
  'LLP',
  'Partnership',
  'Proprietorship',
  'Individual',
  'HUF',
  'Trust',
];

export type ClientStatus = 'active' | 'onboarding' | 'inactive';

export interface Client {
  id: string;
  code: string;
  name: string;
  entityType: EntityType;
  industry: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  pan?: string;
  gstin?: string;
  relationshipManagerId: string;
  teamIds: string[];
  status: ClientStatus;
  since: string;
  notes?: string;
  billingName?: string;
  tradeName?: string;
  fileNo?: string;
  /** Date of birth (individuals) or incorporation. */
  incorporatedOn?: string;
  taxesApplicable?: TaxHead[];
  referredById?: string;
  /** Set when the client leaves; messaging stops automatically. */
  exitDate?: string;
  contacts?: ContactPerson[];
  customFields?: { label: string; value: string }[];
  portalLogins?: PortalLogin[];
  serviceIds?: string[];
}

export type TaxHead = 'GST' | 'Income Tax' | 'Other';

export interface ContactPerson {
  name: string;
  designation: string;
  phone: string;
  email: string;
}

export interface PortalLogin {
  /** Stable id so a saved password follows its login through edits. Older records may lack one. */
  id?: string;
  portalId: string;
  username: string;
  /** Empty when the server withholds it; fetch on demand. */
  password: string;
  hasPassword?: boolean;
  /** Non-secret extra sign-in details, e.g. TAN for TRACES or the OTP mobile. */
  extra?: string;
}

export type TaskStatus = 'not_started' | 'in_progress' | 'in_review' | 'changes_requested' | 'completed';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type FilingStage = 'preparation' | 'review' | 'ready_to_file' | 'filed';

export interface Category {
  id: string;
  name: string;
  /** Index into the categorical chart palette. */
  colorSlot: number;
  /** Filing categories carry a filing milestone separate from task status. */
  isFiling: boolean;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  sizeKb: number;
  /** Stored file (backend mode only). */
  fileId?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Recurrence {
  templateId: string;
  frequency: Frequency;
  periodLabel: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  clientId: string;
  categoryId: string;
  assigneeId: string;
  reviewerId?: string;
  priority: Priority;
  status: TaskStatus;
  startDate: string;
  dueDate: string;
  estimateHours: number;
  checklist: ChecklistItem[];
  attachments: Attachment[];
  requiresReview: boolean;
  filingStage?: FilingStage;
  filingReference?: string;
  recurrence?: Recurrence;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  submittedAt?: string;
  completedAt?: string;
  serviceId?: string;
  /** Professional fee for billing (demo). */
  fee?: number;
  invoiceId?: string;
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export type ActivityType =
  | 'task_created'
  | 'status_changed'
  | 'reassigned'
  | 'due_changed'
  | 'commented'
  | 'review_approved'
  | 'review_returned'
  | 'attachment_added'
  | 'checklist_updated'
  | 'filing_updated'
  | 'client_created'
  | 'client_updated'
  | 'document_received'
  | 'document_requested'
  | 'member_invited'
  | 'member_updated'
  | 'task_updated';

export interface Activity {
  id: string;
  type: ActivityType;
  actorId: string;
  taskId?: string;
  clientId?: string;
  userId?: string;
  createdAt: string;
  /** Free-form structured details: from/to values, note text, etc. */
  meta?: Record<string, string>;
}

export type NotificationType =
  | 'assigned'
  | 'due_soon'
  | 'overdue'
  | 'submitted'
  | 'approved'
  | 'changes_requested'
  | 'due_changed'
  | 'comment'
  | 'document';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  taskId?: string;
  clientId?: string;
  createdAt: string;
  read: boolean;
  /** De-duplication key for notifications created by scheduled jobs. */
  refKey?: string;
}

export type DocumentStatus = 'pending' | 'received';

export interface DocumentRequest {
  id: string;
  clientId: string;
  taskId?: string;
  name: string;
  status: DocumentStatus;
  requestedAt: string;
  dueDate?: string;
  receivedAt?: string;
}

export interface ReviewRecord {
  id: string;
  taskId: string;
  reviewerId: string;
  submittedAt: string;
  decidedAt: string;
  decision: 'approved' | 'returned';
  note?: string;
}

export type Frequency = 'monthly' | 'quarterly' | 'half_yearly' | 'annual' | 'custom';

export interface TaskTemplate {
  id: string;
  name: string;
  categoryId: string;
  description: string;
  checklist: string[];
  /** 'relationship_manager' assigns to the client's RM; otherwise a fixed user id. */
  assignmentRule: 'fixed' | 'relationship_manager' | 'unassigned';
  defaultAssigneeId?: string;
  reviewerId?: string;
  frequency: Frequency;
  /** For 'custom' frequency: number of months between occurrences. */
  intervalMonths?: number;
  /** Due date rule: day of month, N months after the period ends. */
  dueDay: number;
  dueMonthOffset: number;
  entityTypes: EntityType[];
  priority: Priority;
  estimateHours: number;
  requiresReview: boolean;
  active: boolean;
  createdAt: string;
  lastGeneratedAt?: string;
}

export interface Service {
  id: string;
  groupId: string;
  name: string;
  frequency: string;
  defaultFee: number;
}

export interface Referrer {
  id: string;
  name: string;
  firmName: string;
  mobile: string;
  email: string;
  address: string;
}

export interface Note {
  id: string;
  userId: string;
  title: string;
  body: string;
  color: 'yellow' | 'blue' | 'green' | 'pink' | 'slate';
  pinned: boolean;
  clientId?: string;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  userId: string;
  title: string;
  dueAt: string;
  clientId?: string;
  repeat: 'none' | 'daily' | 'weekly' | 'monthly';
  done: boolean;
  notifiedAt?: string;
}

export interface Portal {
  id: string;
  name: string;
  short: string;
  url: string;
  /** Sign-in page, when it differs from the home page. */
  loginUrl?: string;
  description: string;
  clicks: number;
  hue: number;
}

export type NoticeSource = 'GST' | 'Income Tax' | 'TDS' | 'Other';
export type NoticeStatus = 'new' | 'in_progress' | 'replied' | 'closed';

export interface Notice {
  id: string;
  clientId: string;
  source: NoticeSource;
  form: string;
  subject: string;
  reference: string;
  issuedOn: string;
  dueOn: string;
  amount?: number;
  status: NoticeStatus;
  assigneeId?: string;
  fetchedAt: string;
  taskId?: string;
}

export interface InvoiceItem {
  taskId?: string;
  description: string;
  amount: number;
}

export interface Invoice {
  id: string;
  number: string;
  clientId: string;
  date: string;
  dueDate: string;
  items: InvoiceItem[];
  gstRate: number;
}

export interface Payment {
  id: string;
  clientId: string;
  invoiceId?: string;
  date: string;
  amount: number;
  mode: 'UPI' | 'NEFT' | 'Cheque' | 'Cash';
  kind: 'advance' | 'receipt';
  reference: string;
}

export interface Dsc {
  id: string;
  clientId: string;
  holder: string;
  type: 'Signing' | 'Signing & Encryption';
  provider: string;
  tokenSerial: string;
  issuedOn: string;
  expiresOn: string;
  custody: 'firm' | 'client';
  lastMovedAt: string;
}

export interface DocMovement {
  id: string;
  clientId: string;
  document: string;
  direction: 'in' | 'out';
  date: string;
  mode: 'By hand' | 'Courier' | 'Email' | 'Post';
  person: string;
  handledBy: string;
  expectedReturn?: string;
  returned: boolean;
  remarks?: string;
}

export interface ChatMessage {
  id: string;
  clientId: string;
  direction: 'in' | 'out';
  body: string;
  at: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  authorId?: string;
  /** Message id from the WhatsApp provider. */
  externalId?: string;
}

export interface Broadcast {
  id: string;
  title: string;
  body: string;
  kind: 'festival' | 'compliance' | 'custom';
  sentAt: string;
  recipients: number;
  sentBy: string;
}

export interface DriveFile {
  id: string;
  clientId: string;
  folder: string;
  name: string;
  sizeKb: number;
  uploadedBy: string;
  uploadedAt: string;
  fileId?: string;
}

export interface Firm {
  name: string;
  legalName: string;
  registrationNo: string;
  city: string;
  email: string;
  phone: string;
  /** Days before the due date at which a task is considered "at risk". */
  atRiskDays: number;
  whatsappNumber?: string;
  invoicePrefix?: string;
  defaultGstRate?: number;
  gstin?: string;
  address?: string;
  /** Demo firms get simulated integrations (notice fetch etc.). */
  isDemo?: boolean;
}

export interface Database {
  version: number;
  seededAt: string;
  /** Highest task number in the firm (sent by the server so new IDs don't collide). */
  taskSeq?: number;
  firm: Firm;
  users: User[];
  clients: Client[];
  categories: Category[];
  tasks: Task[];
  comments: Comment[];
  activities: Activity[];
  notifications: AppNotification[];
  documents: DocumentRequest[];
  reviews: ReviewRecord[];
  templates: TaskTemplate[];
  services: Service[];
  referrers: Referrer[];
  notes: Note[];
  reminders: Reminder[];
  portals: Portal[];
  notices: Notice[];
  invoices: Invoice[];
  payments: Payment[];
  dscs: Dsc[];
  docMovements: DocMovement[];
  chats: ChatMessage[];
  broadcasts: Broadcast[];
  drive: DriveFile[];
}
