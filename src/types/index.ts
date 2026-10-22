export type Role = 'admin' | 'manager' | 'employee';
export type UserStatus = 'active' | 'invited' | 'deactivated';

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

export interface Firm {
  name: string;
  legalName: string;
  registrationNo: string;
  city: string;
  email: string;
  phone: string;
  /** Days before the due date at which a task is considered "at risk". */
  atRiskDays: number;
}

export interface Database {
  version: number;
  seededAt: string;
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
}
