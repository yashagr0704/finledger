import { addDays, addHours, differenceInCalendarDays, endOfMonth, format, parseISO, setHours, startOfMonth, subDays, subMonths } from 'date-fns';
import { brand } from '@/config/brand';
import { toDateKey } from '@/lib/dates';
import { fyLabel, monthLabel, quarterLabel } from '@/lib/periods';
import { createExtras } from './seedExtras';
import type {
  Activity,
  AppNotification,
  Category,
  Client,
  Comment,
  Database,
  DocumentRequest,
  FilingStage,
  Priority,
  ReviewRecord,
  Task,
  TaskStatus,
  TaskTemplate,
  User,
} from '@/types';

export const DB_VERSION = 6;

/** Deterministic PRNG so the demo looks the same on every reset. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const baseUsers: User[] = [
  { id: 'u_rohan', name: 'Rohan Mehta', email: 'rohan@mehtaiyer.demo', phone: '+91 98200 11001', role: 'admin', title: 'Managing Partner', status: 'active', joinedAt: '2014-04-01', capacityHours: 30, avatarHue: 245 },
  { id: 'u_ananya', name: 'Ananya Iyer', email: 'ananya@mehtaiyer.demo', phone: '+91 98200 11002', role: 'manager', title: 'Audit & Assurance Manager', status: 'active', joinedAt: '2017-06-12', capacityHours: 40, avatarHue: 330 },
  { id: 'u_vikram', name: 'Vikram Desai', email: 'vikram@mehtaiyer.demo', phone: '+91 98200 11003', role: 'manager', title: 'Tax Manager', status: 'active', joinedAt: '2018-01-08', capacityHours: 40, avatarHue: 200 },
  { id: 'u_priya', name: 'Priya Sharma', email: 'priya@mehtaiyer.demo', phone: '+91 98200 11004', role: 'employee', title: 'Senior Associate — Direct Tax', managerId: 'u_vikram', status: 'active', joinedAt: '2020-07-01', capacityHours: 45, avatarHue: 15 },
  { id: 'u_arjun', name: 'Arjun Nair', email: 'arjun@mehtaiyer.demo', phone: '+91 98200 11005', role: 'employee', title: 'Associate — GST', managerId: 'u_vikram', status: 'active', joinedAt: '2021-09-15', capacityHours: 45, avatarHue: 160 },
  { id: 'u_kavya', name: 'Kavya Reddy', email: 'kavya@mehtaiyer.demo', phone: '+91 98200 11006', role: 'employee', title: 'Audit Associate', managerId: 'u_ananya', status: 'active', joinedAt: '2021-04-05', capacityHours: 45, avatarHue: 280 },
  { id: 'u_siddharth', name: 'Siddharth Joshi', email: 'siddharth@mehtaiyer.demo', phone: '+91 98200 11007', role: 'employee', title: 'Accounts Executive', managerId: 'u_ananya', status: 'active', joinedAt: '2022-02-14', capacityHours: 45, avatarHue: 35 },
  { id: 'u_neha', name: 'Neha Kapoor', email: 'neha@mehtaiyer.demo', phone: '+91 98200 11008', role: 'employee', title: 'Associate — TDS & Payroll', managerId: 'u_vikram', status: 'active', joinedAt: '2022-08-01', capacityHours: 45, avatarHue: 350 },
  { id: 'u_farhan', name: 'Farhan Qureshi', email: 'farhan@mehtaiyer.demo', phone: '+91 98200 11009', role: 'employee', title: 'Article Assistant', managerId: 'u_ananya', status: 'active', joinedAt: '2024-01-10', capacityHours: 40, avatarHue: 120 },
  { id: 'u_isha', name: 'Isha Bansal', email: 'isha@mehtaiyer.demo', phone: '+91 98200 11010', role: 'employee', title: 'Associate — Accounting', managerId: 'u_ananya', status: 'invited', joinedAt: toDateKey(subDays(new Date(), 2)), capacityHours: 45, avatarHue: 60 },
];

const baseCategories: Category[] = [
  { id: 'gst', name: 'GST', colorSlot: 0, isFiling: true },
  { id: 'itr', name: 'Income Tax', colorSlot: 1, isFiling: true },
  { id: 'tds', name: 'TDS', colorSlot: 2, isFiling: true },
  { id: 'acc', name: 'Accounting', colorSlot: 3, isFiling: false },
  { id: 'aud', name: 'Audit', colorSlot: 4, isFiling: false },
  { id: 'pay', name: 'Payroll', colorSlot: 5, isFiling: false },
  { id: 'roc', name: 'ROC / MCA', colorSlot: 6, isFiling: true },
  { id: 'adv', name: 'Advisory', colorSlot: 7, isFiling: false },
];

const baseClients: Client[] = [
  { id: 'c_sunrise', code: 'SUN-001', name: 'Sunrise Textiles Pvt Ltd', entityType: 'Private Limited', industry: 'Textile manufacturing', contactName: 'Harish Agarwal', email: 'accounts@sunrisetextiles.demo', phone: '+91 99250 40001', city: 'Surat', pan: 'AAACS0001D', gstin: '24AAACS0001D1Z0', relationshipManagerId: 'u_vikram', teamIds: ['u_arjun', 'u_neha', 'u_priya', 'u_farhan'], status: 'active', since: '2016-05-10', notes: 'Large GST volume; exports under LUT. Prefers WhatsApp updates from the finance head.' },
  { id: 'c_kaveri', code: 'KAV-002', name: 'Kaveri Foods LLP', entityType: 'LLP', industry: 'Food processing', contactName: 'Lakshmi Narayan', email: 'finance@kaverifoods.demo', phone: '+91 99000 40002', city: 'Bengaluru', pan: 'AAKFK0002D', gstin: '29AAKFK0002D1Z1', relationshipManagerId: 'u_ananya', teamIds: ['u_kavya', 'u_siddharth', 'u_priya', 'u_farhan'], status: 'active', since: '2019-08-22' },
  { id: 'c_arora', code: 'ARO-003', name: 'Arora & Sons', entityType: 'Partnership', industry: 'Wholesale trade', contactName: 'Gurpreet Arora', email: 'arora.sons@example.demo', phone: '+91 98110 40003', city: 'New Delhi', pan: 'AAFFA0003D', gstin: '07AAFFA0003D1Z2', relationshipManagerId: 'u_vikram', teamIds: ['u_arjun', 'u_siddharth'], status: 'active', since: '2015-02-01' },
  { id: 'c_nimbus', code: 'NIM-004', name: 'Nimbus Software Solutions Pvt Ltd', entityType: 'Private Limited', industry: 'IT services', contactName: 'Aditi Kulkarni', email: 'cfo@nimbussoft.demo', phone: '+91 98220 40004', city: 'Pune', pan: 'AAGCN0004D', gstin: '27AAGCN0004D1Z3', relationshipManagerId: 'u_ananya', teamIds: ['u_kavya', 'u_neha', 'u_farhan', 'u_priya', 'u_vikram'], status: 'active', since: '2020-11-03', notes: 'Has overseas subsidiary — transfer pricing applicable.' },
  { id: 'c_meera', code: 'MKR-005', name: 'Dr. Meera Krishnan', entityType: 'Individual', industry: 'Medical practitioner', contactName: 'Dr. Meera Krishnan', email: 'meera.k@example.demo', phone: '+91 94440 40005', city: 'Chennai', pan: 'ABCPK0005D', relationshipManagerId: 'u_vikram', teamIds: ['u_priya'], status: 'active', since: '2018-07-15' },
  { id: 'c_bluewave', code: 'BLU-006', name: 'Bluewave Logistics Pvt Ltd', entityType: 'Private Limited', industry: 'Logistics', contactName: 'Sameer Khan', email: 'accounts@bluewave.demo', phone: '+91 98190 40006', city: 'Mumbai', pan: 'AAHCB0006D', gstin: '27AAHCB0006D1Z4', relationshipManagerId: 'u_ananya', teamIds: ['u_siddharth', 'u_arjun', 'u_kavya', 'u_farhan', 'u_neha'], status: 'active', since: '2021-01-19' },
  { id: 'c_patel', code: 'PAT-007', name: 'Patel Family HUF', entityType: 'HUF', industry: 'Investments', contactName: 'Mahesh Patel (Karta)', email: 'mahesh.patel@example.demo', phone: '+91 98250 40007', city: 'Ahmedabad', pan: 'AAJHP0007D', relationshipManagerId: 'u_vikram', teamIds: ['u_priya'], status: 'active', since: '2017-03-30' },
  { id: 'c_greenleaf', code: 'GRN-008', name: 'Greenleaf Organics', entityType: 'Proprietorship', industry: 'Organic retail', contactName: 'Sneha Patil', email: 'hello@greenleaf.demo', phone: '+91 97300 40008', city: 'Nashik', pan: 'ABKPP0008D', gstin: '27ABKPP0008D1Z5', relationshipManagerId: 'u_vikram', teamIds: ['u_arjun', 'u_siddharth'], status: 'active', since: '2022-06-01' },
  { id: 'c_horizon', code: 'HOR-009', name: 'Horizon Educational Trust', entityType: 'Trust', industry: 'Education', contactName: 'Fr. Joseph Fernandes', email: 'trustee@horizontrust.demo', phone: '+91 98200 40009', city: 'Mumbai', pan: 'AAATH0009D', relationshipManagerId: 'u_ananya', teamIds: ['u_kavya', 'u_farhan'], status: 'active', since: '2019-04-11' },
  { id: 'c_vardhan', code: 'VAR-010', name: 'Vardhan Steel Industries Ltd', entityType: 'Public Limited', industry: 'Steel manufacturing', contactName: 'Prakash Vardhan', email: 'cs@vardhansteel.demo', phone: '+91 98230 40010', city: 'Nagpur', pan: 'AAACV0010D', gstin: '27AAACV0010D1Z6', relationshipManagerId: 'u_rohan', teamIds: ['u_ananya', 'u_kavya', 'u_farhan', 'u_neha'], status: 'active', since: '2014-09-01', notes: 'Listed on SME platform. Audit committee meets in the second week of each quarter.' },
  { id: 'c_rajesh', code: 'RMA-011', name: 'Rajesh Malhotra', entityType: 'Individual', industry: 'Salaried & capital gains', contactName: 'Rajesh Malhotra', email: 'rajesh.m@example.demo', phone: '+91 98670 40011', city: 'Mumbai', pan: 'ABDPM0011D', relationshipManagerId: 'u_vikram', teamIds: ['u_priya', 'u_vikram'], status: 'active', since: '2020-05-20' },
  { id: 'c_coastal', code: 'CST-012', name: 'Coastal Hospitality Pvt Ltd', entityType: 'Private Limited', industry: 'Hospitality', contactName: 'Rhea D’Souza', email: 'finance@coastalhotels.demo', phone: '+91 98220 40012', city: 'Goa', pan: 'AAJCC0012D', gstin: '30AAJCC0012D1Z7', relationshipManagerId: 'u_ananya', teamIds: ['u_neha', 'u_siddharth', 'u_arjun'], status: 'active', since: '2021-10-05' },
  { id: 'c_zenith', code: 'ZEN-013', name: 'Zenith Pharma Distributors LLP', entityType: 'LLP', industry: 'Pharmaceutical distribution', contactName: 'Venkat Rao', email: 'accounts@zenithpharma.demo', phone: '+91 99490 40013', city: 'Hyderabad', pan: 'AALFZ0013D', gstin: '36AALFZ0013D1Z8', relationshipManagerId: 'u_vikram', teamIds: ['u_arjun', 'u_neha'], status: 'active', since: '2023-01-16' },
  { id: 'c_anvaya', code: 'ANV-014', name: 'Studio Anvaya', entityType: 'Proprietorship', industry: 'Design studio', contactName: 'Tara Menon', email: 'tara@studioanvaya.demo', phone: '+91 98330 40014', city: 'Mumbai', relationshipManagerId: 'u_rohan', teamIds: ['u_siddharth', 'u_arjun'], status: 'onboarding', since: toDateKey(subDays(new Date(), 18)), notes: 'New client — engagement letter signed. KYC and GST registration amendment in progress.' },
];

const CHECKLISTS: Record<string, string[]> = {
  gst: ['Collect sales & purchase registers', 'Reconcile with GSTR-2B', 'Verify HSN summary', 'Prepare return draft', 'Client approval of liability'],
  itr: ['Collect Form 16 / AIS / 26AS', 'Compute total income', 'Verify deductions & exemptions', 'Prepare return draft', 'Client approval'],
  tds: ['Download challan details', 'Validate deductee PANs', 'Prepare FVU file', 'Reconcile with books'],
  acc: ['Record vouchers', 'Bank reconciliation', 'Ledger scrutiny', 'Prepare trial balance'],
  aud: ['Planning & risk assessment', 'Vouching and verification', 'Obtain confirmations', 'Draft audit report', 'Partner review notes cleared'],
  pay: ['Collect attendance & leave data', 'Compute salaries & deductions', 'Generate payslips', 'Prepare PF/ESI challans'],
  roc: ['Collect board resolutions', 'Prepare e-form', 'Obtain DSC signatures', 'Upload & pay fees'],
  adv: ['Understand client objective', 'Research & analysis', 'Draft memo', 'Discuss with partner'],
};

interface Spec {
  title: string;
  client: string;
  cat: string;
  assignee: string;
  reviewer?: string;
  priority: Priority;
  status: TaskStatus;
  start: number;
  due: number;
  est: number;
  desc: string;
  filing?: FilingStage;
  /** Days ago the task was completed (completed tasks only). */
  doneAgo?: number;
  template?: string;
  period?: string;
}

export function createSeed(): Database {
  const now = new Date();
  // Fresh copies: the seed mutates these while adding demo-only fields.
  const users = structuredClone(baseUsers);
  const clients = structuredClone(baseClients);
  const categories = structuredClone(baseCategories);
  const rand = mulberry32(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const day = (offset: number) => toDateKey(addDays(now, offset));
  const at = (offsetDays: number, hour = 10, minute = 0) => {
    const d = setHours(addDays(now, offsetDays), hour);
    d.setMinutes(minute, 0, 0);
    // Never place seeded events in the future.
    return (d > now ? now : d).toISOString();
  };

  const prevMonth = monthLabel(subMonths(now, 1));
  const lastQuarterEnd = (() => {
    let d = subMonths(now, 1);
    while (![5, 8, 11, 2].includes(d.getMonth())) d = subMonths(d, 1);
    return endOfMonth(d);
  })();
  const prevQuarter = quarterLabel(lastQuarterEnd);
  const prevFy = fyLabel(subMonths(now, 12));

  const specs: Spec[] = [
    { title: `GSTR-1 return — ${prevMonth}`, client: 'c_sunrise', cat: 'gst', assignee: 'u_arjun', reviewer: 'u_vikram', priority: 'high', status: 'in_progress', start: -8, due: 2, est: 4, filing: 'preparation', template: 'tpl_gstr1', period: prevMonth, desc: 'Prepare outward supply return including export invoices under LUT. Cross-check e-invoice IRNs against the sales register before finalising.' },
    { title: `GSTR-3B return — ${prevMonth}`, client: 'c_sunrise', cat: 'gst', assignee: 'u_arjun', reviewer: 'u_vikram', priority: 'urgent', status: 'not_started', start: -3, due: 5, est: 3, filing: 'preparation', template: 'tpl_gstr3b', period: prevMonth, desc: 'Compute net tax liability after ITC as per GSTR-2B. Flag ineligible ITC on blocked credits and confirm cash ledger balance with the client.' },
    { title: `GSTR-1 return — ${prevMonth}`, client: 'c_arora', cat: 'gst', assignee: 'u_arjun', reviewer: 'u_vikram', priority: 'high', status: 'in_review', start: -6, due: 1, est: 3, filing: 'review', template: 'tpl_gstr1', period: prevMonth, desc: 'Monthly outward supplies for the wholesale business. B2B invoices uploaded through IFF earlier in the quarter must be excluded.' },
    { title: `GSTR-3B return — ${prevMonth}`, client: 'c_arora', cat: 'gst', assignee: 'u_arjun', reviewer: 'u_vikram', priority: 'medium', status: 'not_started', start: -2, due: 6, est: 2, filing: 'preparation', template: 'tpl_gstr3b', period: prevMonth, desc: 'Summary return and tax payment. Await purchase register from client before computing ITC.' },
    { title: `GSTR-1 return — ${prevMonth}`, client: 'c_zenith', cat: 'gst', assignee: 'u_arjun', reviewer: 'u_vikram', priority: 'high', status: 'in_progress', start: -10, due: -2, est: 5, filing: 'preparation', template: 'tpl_gstr1', period: prevMonth, desc: 'High-volume invoice data (~2,400 invoices). Client delayed sharing the credit-note register — follow up daily until received.' },
    { title: `GSTR-3B return — ${prevMonth}`, client: 'c_greenleaf', cat: 'gst', assignee: 'u_siddharth', reviewer: 'u_vikram', priority: 'medium', status: 'changes_requested', start: -5, due: 3, est: 2, filing: 'review', template: 'tpl_gstr3b', period: prevMonth, desc: 'Composition-to-regular transition month; verify that ITC claimed on opening stock matches ITC-01 workings.' },
    { title: 'GSTR-2B vs books ITC reconciliation', client: 'c_bluewave', cat: 'gst', assignee: 'u_siddharth', reviewer: 'u_ananya', priority: 'medium', status: 'in_progress', start: -4, due: 4, est: 6, desc: 'Reconcile vendor-wise ITC for the half year. Share a mismatch report with the client so vendors can be chased before the annual return.' },
    { title: `TDS return 24Q — ${prevQuarter}`, client: 'c_nimbus', cat: 'tds', assignee: 'u_neha', reviewer: 'u_vikram', priority: 'high', status: 'in_progress', start: -9, due: -1, est: 4, filing: 'preparation', template: 'tpl_tds', period: prevQuarter, desc: 'Salary TDS quarterly statement for 180 employees. Validate PANs and lower-deduction certificates before generating the FVU.' },
    { title: `TDS return 26Q — ${prevQuarter}`, client: 'c_vardhan', cat: 'tds', assignee: 'u_neha', reviewer: 'u_ananya', priority: 'urgent', status: 'in_review', start: -12, due: 3, est: 5, filing: 'review', template: 'tpl_tds', period: prevQuarter, desc: 'Non-salary TDS statement covering contractor, professional fee and rent payments.' },
    { title: `TDS return 26Q — ${prevQuarter}`, client: 'c_sunrise', cat: 'tds', assignee: 'u_neha', reviewer: 'u_vikram', priority: 'high', status: 'not_started', start: -1, due: 8, est: 3, filing: 'preparation', template: 'tpl_tds', period: prevQuarter, desc: 'Quarterly non-salary TDS statement. Include TDS on purchase of goods (194Q) entries.' },
    { title: 'TDS challan payment & reconciliation', client: 'c_coastal', cat: 'tds', assignee: 'u_neha', reviewer: 'u_vikram', priority: 'medium', status: 'completed', start: -9, due: -2, est: 1, filing: 'filed', doneAgo: 5, desc: 'Monthly TDS deposit for contractor and rent payments. Challan details shared with the client.' },
    { title: `Payroll processing — ${monthLabel(now)}`, client: 'c_nimbus', cat: 'pay', assignee: 'u_neha', reviewer: 'u_ananya', priority: 'high', status: 'in_progress', start: -4, due: 1, est: 8, template: 'tpl_payroll', period: monthLabel(now), desc: 'Run monthly payroll including variable pay and two full-and-final settlements.' },
    { title: `Payroll processing — ${monthLabel(now)}`, client: 'c_coastal', cat: 'pay', assignee: 'u_neha', priority: 'medium', status: 'not_started', start: 0, due: 7, est: 5, template: 'tpl_payroll', period: monthLabel(now), desc: 'Seasonal staff onboarding this month — confirm joining dates with HR.' },
    { title: `Payroll processing — ${prevMonth}`, client: 'c_vardhan', cat: 'pay', assignee: 'u_neha', reviewer: 'u_ananya', priority: 'high', status: 'completed', start: -20, due: -12, est: 6, doneAgo: 8, desc: 'Monthly payroll for plant and head-office staff.' },
    { title: `Statutory audit — ${prevFy}`, client: 'c_vardhan', cat: 'aud', assignee: 'u_kavya', reviewer: 'u_ananya', priority: 'urgent', status: 'in_progress', start: -40, due: 9, est: 80, desc: 'Statutory audit under the Companies Act. Inventory valuation and related-party transactions are key focus areas. Audit committee presentation to follow.' },
    { title: `Tax audit (Form 3CD) — ${prevFy}`, client: 'c_kaveri', cat: 'aud', assignee: 'u_kavya', reviewer: 'u_ananya', priority: 'high', status: 'changes_requested', start: -25, due: -4, est: 24, desc: 'Tax audit report with clause-wise annexures. Reviewer flagged clause 44 GST break-up and clause 26 disallowances for rework.' },
    { title: 'Internal audit — procurement cycle', client: 'c_bluewave', cat: 'aud', assignee: 'u_farhan', reviewer: 'u_ananya', priority: 'medium', status: 'in_progress', start: -7, due: 12, est: 20, desc: 'Test procure-to-pay controls for the half year. Sample 40 purchase orders across three branches.' },
    { title: `Trust audit & Form 10B — ${prevFy}`, client: 'c_horizon', cat: 'aud', assignee: 'u_kavya', reviewer: 'u_ananya', priority: 'high', status: 'in_review', start: -18, due: 2, est: 18, desc: 'Audit of the trust accounts and preparation of the audit report in Form 10B. Verify application of income and corpus donations.' },
    { title: 'Stock audit for bank', client: 'c_sunrise', cat: 'aud', assignee: 'u_farhan', reviewer: 'u_ananya', priority: 'medium', status: 'not_started', start: 4, due: 18, est: 12, desc: 'Physical verification of finished goods and yarn inventory as required by the lending bank. Coordinate warehouse visit dates.' },
    { title: `Bank reconciliation — ${prevMonth}`, client: 'c_kaveri', cat: 'acc', assignee: 'u_siddharth', reviewer: 'u_ananya', priority: 'low', status: 'completed', start: -10, due: -4, est: 3, doneAgo: 3, desc: 'Reconcile three current accounts and the cash-credit account.' },
    { title: `Monthly bookkeeping — ${prevMonth}`, client: 'c_greenleaf', cat: 'acc', assignee: 'u_siddharth', priority: 'medium', status: 'in_progress', start: -6, due: 5, est: 8, template: 'tpl_books', period: prevMonth, desc: 'Record sales, purchases and expenses from the POS export and bank statements.' },
    { title: 'Opening balances & ledger setup', client: 'c_anvaya', cat: 'acc', assignee: 'u_siddharth', priority: 'low', status: 'not_started', start: 1, due: 10, est: 6, desc: 'New client onboarding: set up chart of accounts and import opening balances from the previous accountant’s trial balance.' },
    { title: 'Fixed asset register update', client: 'c_bluewave', cat: 'acc', assignee: 'u_siddharth', reviewer: 'u_ananya', priority: 'low', status: 'not_started', start: 2, due: 15, est: 5, desc: 'Add the 12 new trucks purchased this quarter and compute depreciation under both Companies Act and Income Tax rates.' },
    { title: `MIS report — ${prevMonth}`, client: 'c_nimbus', cat: 'acc', assignee: 'u_kavya', reviewer: 'u_ananya', priority: 'medium', status: 'in_review', start: -5, due: 0, est: 6, desc: 'Monthly management report with revenue by customer, cash runway and variance against budget.' },
    { title: 'Half-yearly books finalisation', client: 'c_coastal', cat: 'acc', assignee: 'u_siddharth', reviewer: 'u_ananya', priority: 'high', status: 'in_progress', start: -15, due: -6, est: 16, desc: 'Close books for H1 including accruals, prepaid expenses and inter-property transfers.' },
    { title: `ITR-3 filing — ${prevFy}`, client: 'c_meera', cat: 'itr', assignee: 'u_priya', reviewer: 'u_vikram', priority: 'high', status: 'in_review', start: -9, due: 0, est: 6, filing: 'review', desc: 'Professional income under presumptive scheme (44ADA) plus rental income and capital gains on mutual funds.' },
    { title: `ITR-2 filing — ${prevFy}`, client: 'c_rajesh', cat: 'itr', assignee: 'u_priya', reviewer: 'u_vikram', priority: 'urgent', status: 'in_progress', start: -11, due: -3, est: 8, filing: 'preparation', desc: 'Salary, ESOP perquisites and long-term capital gains on listed shares. Waiting on broker capital-gains statement for one account.' },
    { title: `Income tax return — ${prevFy}`, client: 'c_patel', cat: 'itr', assignee: 'u_priya', reviewer: 'u_vikram', priority: 'medium', status: 'not_started', start: 0, due: 9, est: 5, filing: 'preparation', desc: 'HUF return with dividend income and capital gains on property sale. Confirm indexation workings with the Karta.' },
    { title: 'Advance tax computation — Q3', client: 'c_rajesh', cat: 'itr', assignee: 'u_priya', reviewer: 'u_vikram', priority: 'medium', status: 'not_started', start: 10, due: 25, est: 2, desc: 'Estimate income for the year and compute the advance tax instalment. Share challan details with client.' },
    { title: 'Advance tax computation — Q3', client: 'c_meera', cat: 'itr', assignee: 'u_priya', priority: 'low', status: 'not_started', start: 12, due: 27, est: 2, desc: 'Estimate professional receipts for the year and compute the instalment.' },
    { title: `ITR-5 filing — ${prevFy}`, client: 'c_kaveri', cat: 'itr', assignee: 'u_priya', reviewer: 'u_vikram', priority: 'high', status: 'in_progress', start: -6, due: 8, est: 10, filing: 'preparation', desc: 'LLP return — depends on completion of the tax audit report.' },
    { title: `ITR-6 filing — ${prevFy}`, client: 'c_nimbus', cat: 'itr', assignee: 'u_priya', reviewer: 'u_vikram', priority: 'high', status: 'not_started', start: 1, due: 10, est: 12, filing: 'preparation', desc: 'Company return including MAT/115BAA evaluation and foreign tax credit (Form 67).' },
    { title: `AOC-4 annual filing — ${prevFy}`, client: 'c_vardhan', cat: 'roc', assignee: 'u_farhan', reviewer: 'u_ananya', priority: 'high', status: 'in_progress', start: -5, due: 7, est: 4, filing: 'preparation', desc: 'File audited financial statements with the Registrar. Requires board report and auditor’s report PDFs.' },
    { title: `MGT-7 annual return — ${prevFy}`, client: 'c_nimbus', cat: 'roc', assignee: 'u_farhan', reviewer: 'u_ananya', priority: 'medium', status: 'not_started', start: 14, due: 38, est: 4, filing: 'preparation', desc: 'Annual return with shareholding pattern and director details.' },
    { title: `Form 11 (LLP annual return) — ${prevFy}`, client: 'c_kaveri', cat: 'roc', assignee: 'u_farhan', reviewer: 'u_ananya', priority: 'medium', status: 'completed', start: -14, due: -3, est: 2, filing: 'filed', doneAgo: 2, desc: 'Annual return of the LLP filed with the Registrar.' },
    { title: 'DIR-3 KYC for directors', client: 'c_bluewave', cat: 'roc', assignee: 'u_farhan', priority: 'low', status: 'completed', start: -16, due: -9, est: 1, filing: 'filed', doneAgo: 11, desc: 'Annual KYC for three directors.' },
    { title: 'GST registration amendment', client: 'c_anvaya', cat: 'gst', assignee: 'u_arjun', priority: 'low', status: 'in_progress', start: -3, due: 4, est: 2, filing: 'preparation', desc: 'Add the new studio premises as an additional place of business. Rent agreement and NOC needed from the client.' },
    { title: 'Transfer pricing documentation', client: 'c_nimbus', cat: 'adv', assignee: 'u_vikram', reviewer: 'u_rohan', priority: 'high', status: 'not_started', start: 5, due: 30, est: 30, desc: 'Prepare TP study for transactions with the Singapore subsidiary, including benchmarking and Form 3CEB inputs.' },
    { title: 'Capital gains tax planning memo', client: 'c_rajesh', cat: 'adv', assignee: 'u_vikram', reviewer: 'u_rohan', priority: 'medium', status: 'in_progress', start: -4, due: 6, est: 5, desc: 'Advise on reinvestment options for proceeds from the sale of a residential flat.' },
    { title: 'CMA data & loan documentation', client: 'c_sunrise', cat: 'adv', assignee: 'u_ananya', reviewer: 'u_rohan', priority: 'high', status: 'in_review', start: -10, due: 1, est: 12, desc: 'Credit monitoring arrangement data and projections for the working-capital enhancement request.' },
    { title: `GSTR-9 annual return — ${prevFy}`, client: 'c_zenith', cat: 'gst', assignee: 'u_arjun', reviewer: 'u_vikram', priority: 'medium', status: 'not_started', start: 15, due: 40, est: 10, filing: 'preparation', desc: 'Annual GST return reconciling monthly filings with audited books.' },
    { title: '12A / 80G registration renewal', client: 'c_horizon', cat: 'adv', assignee: 'u_kavya', reviewer: 'u_ananya', priority: 'medium', status: 'not_started', start: 3, due: 20, est: 6, desc: 'Prepare renewal application with activity reports for the last three years.' },
    { title: 'Vendor TDS reconciliation', client: 'c_bluewave', cat: 'tds', assignee: 'u_neha', reviewer: 'u_ananya', priority: 'medium', status: 'changes_requested', start: -8, due: 2, est: 4, desc: 'Reconcile TDS deducted on transporter payments with Form 26AS of vendors who raised disputes.' },
    { title: `Quarterly GST review — ${prevQuarter}`, client: 'c_coastal', cat: 'gst', assignee: 'u_arjun', reviewer: 'u_vikram', priority: 'low', status: 'completed', start: -8, due: -1, est: 3, filing: 'filed', doneAgo: 1, desc: 'Review of GST positions for room tariffs and restaurant services.' },
    { title: `PF & ESI returns — ${prevMonth}`, client: 'c_sunrise', cat: 'pay', assignee: 'u_neha', reviewer: 'u_vikram', priority: 'medium', status: 'not_started', start: -6, due: -1, est: 2, desc: 'Monthly ECR filing for provident fund and ESI contributions.' },
    { title: 'Audit planning memorandum', client: 'c_kaveri', cat: 'aud', assignee: 'u_kavya', reviewer: 'u_ananya', priority: 'low', status: 'completed', start: -14, due: -7, est: 4, doneAgo: 6, desc: 'Document materiality, risk assessment and audit approach.' },
    { title: 'Capital gains statement — property sale', client: 'c_patel', cat: 'itr', assignee: 'u_priya', reviewer: 'u_vikram', priority: 'medium', status: 'in_review', start: -7, due: 4, est: 3, desc: 'Compute LTCG with indexation and evaluate 54/54EC exemption eligibility.' },
    { title: 'Depreciation schedule', client: 'c_vardhan', cat: 'acc', assignee: 'u_farhan', reviewer: 'u_ananya', priority: 'medium', status: 'in_progress', start: -12, due: -5, est: 6, desc: 'Block-wise depreciation under the Income Tax Act for the tax audit.' },
    { title: 'Client KYC & engagement documentation', client: 'c_anvaya', cat: 'adv', assignee: 'u_rohan', priority: 'medium', status: 'in_progress', start: -10, due: 3, est: 2, desc: 'Complete onboarding checklist: engagement letter, KYC documents and previous accountant clearance.' },
    { title: 'Inventory valuation working papers', client: 'c_vardhan', cat: 'aud', assignee: 'u_kavya', reviewer: 'u_ananya', priority: 'high', status: 'not_started', start: 0, due: 5, est: 10, desc: 'Test NRV and costing of finished goods and WIP for the statutory audit.' },
  ];

  const tasks: Task[] = [];
  const comments: Comment[] = [];
  const activities: Activity[] = [];
  const reviews: ReviewRecord[] = [];
  let seq = 1001;
  const nextId = () => `${brand.taskPrefix}-${seq++}`;
  const managerOf = (userId: string) => users.find((u) => u.id === userId)?.managerId ?? 'u_rohan';

  const makeChecklist = (cat: string, fraction: number, taskId: string) => {
    const items = CHECKLISTS[cat] ?? [];
    const done = Math.round(items.length * fraction);
    return items.map((label, i) => ({ id: `${taskId}_ck${i}`, label, done: i < done }));
  };

  // --- Historical completed work (last 6 months + earlier this month) for trends.
  const histTitles: Record<string, string[]> = {
    gst: ['GSTR-1 return', 'GSTR-3B return', 'ITC reconciliation'],
    tds: ['TDS challan payment', 'TDS return'],
    acc: ['Monthly bookkeeping', 'Bank reconciliation', 'MIS report'],
    pay: ['Payroll processing', 'PF & ESI returns'],
    itr: ['Income tax return', 'Advance tax computation'],
    aud: ['Internal audit review', 'Audit fieldwork'],
    roc: ['Board meeting compliance', 'ROC e-form filing'],
    adv: ['Tax advisory memo'],
  };
  const catAssignees: Record<string, string[]> = {
    gst: ['u_arjun', 'u_arjun', 'u_siddharth'],
    tds: ['u_neha'],
    acc: ['u_siddharth', 'u_kavya', 'u_farhan'],
    pay: ['u_neha'],
    itr: ['u_priya'],
    aud: ['u_kavya', 'u_farhan'],
    roc: ['u_farhan'],
    adv: ['u_vikram', 'u_priya'],
  };
  const histCats = ['gst', 'gst', 'gst', 'tds', 'acc', 'acc', 'pay', 'itr', 'itr', 'aud', 'roc', 'adv'];
  const monthlyVolume = [11, 14, 17, 21, 16, 19, 8];
  for (let m = 6; m >= 0; m -= 1) {
    const monthStart = startOfMonth(subMonths(now, m));
    const lastDay = m === 0 ? Math.max(1, now.getDate() - 1) : endOfMonth(monthStart).getDate();
    const volume = m === 0 ? Math.min(monthlyVolume[6], lastDay) : monthlyVolume[6 - m];
    for (let i = 0; i < volume; i += 1) {
      const cat = pick(histCats);
      const client = pick(clients.filter((c) => c.status === 'active'));
      const assignee = pick(catAssignees[cat]);
      const completedDay = 1 + Math.floor(rand() * lastDay);
      const completed = setHours(addDays(monthStart, completedDay - 1), 11 + Math.floor(rand() * 6));
      // ~18% of historical work finished after its due date.
      const late = rand() < 0.18;
      const due = addDays(completed, late ? -(1 + Math.floor(rand() * 5)) : 1 + Math.floor(rand() * 6));
      const start = subDays(completed, 4 + Math.floor(rand() * 10));
      const requiresReview = cat !== 'acc' || rand() < 0.5;
      const reviewer = requiresReview ? (assignee === 'u_vikram' ? 'u_rohan' : managerOf(assignee)) : undefined;
      const id = nextId();
      const label = monthLabel(subMonths(monthStart, 1));
      const cat0 = categories.find((c) => c.id === cat)!;
      tasks.push({
        id,
        title: `${pick(histTitles[cat])} — ${label}`,
        description: 'Recurring engagement completed as part of the monthly compliance cycle.',
        clientId: client.id,
        categoryId: cat,
        assigneeId: assignee,
        reviewerId: reviewer,
        priority: pick<Priority>(['low', 'medium', 'medium', 'high']),
        status: 'completed',
        startDate: toDateKey(start),
        dueDate: toDateKey(due),
        estimateHours: 2 + Math.floor(rand() * 8),
        checklist: makeChecklist(cat, 1, id),
        attachments: [],
        requiresReview,
        filingStage: cat0.isFiling ? 'filed' : undefined,
        filingReference: cat0.isFiling ? `ACK${Math.floor(100000000 + rand() * 899999999)}` : undefined,
        createdBy: reviewer ?? 'u_rohan',
        createdAt: start.toISOString(),
        updatedAt: completed.toISOString(),
        updatedBy: reviewer ?? assignee,
        submittedAt: requiresReview ? subDays(completed, 0).toISOString() : undefined,
        completedAt: completed.toISOString(),
      });
      if (requiresReview && reviewer) {
        const turnaroundHours = 3 + Math.floor(rand() * (m > 3 ? 70 : 40));
        const submitted = addHours(completed, -turnaroundHours);
        tasks[tasks.length - 1].submittedAt = submitted.toISOString();
        // Some work was returned once before being approved.
        if (rand() < 0.16) {
          const firstSubmit = addHours(submitted, -(20 + Math.floor(rand() * 30)));
          const returnedAt = addHours(firstSubmit, 4 + Math.floor(rand() * 14));
          reviews.push({ id: `rv_${id}_r`, taskId: id, reviewerId: reviewer, submittedAt: firstSubmit.toISOString(), decidedAt: returnedAt.toISOString(), decision: 'returned', note: 'Please attach supporting workings before resubmitting.' });
        }
        reviews.push({ id: `rv_${id}`, taskId: id, reviewerId: reviewer, submittedAt: submitted.toISOString(), decidedAt: completed.toISOString(), decision: 'approved' });
      }
    }
  }

  // --- Live work.
  for (const s of specs) {
    const id = nextId();
    const createdAt = at(s.start - 1, 9, 30);
    const fraction =
      s.status === 'completed' ? 1 : s.status === 'in_review' ? 1 : s.status === 'changes_requested' ? 0.8 : s.status === 'in_progress' ? 0.4 + rand() * 0.3 : 0;
    const completedAt = s.status === 'completed' ? at(-(s.doneAgo ?? 1), 16, 20) : undefined;
    const submittedAt =
      s.status === 'in_review' ? at(-1 - Math.floor(rand() * 2), 15, 10) : s.status === 'completed' && s.reviewer ? at(-(s.doneAgo ?? 1) - 1, 12, 0) : undefined;
    const lastTouch = completedAt ?? submittedAt ?? at(-Math.floor(rand() * 3), 9 + Math.floor(rand() * 8), Math.floor(rand() * 59));
    const createdBy = s.client === 'c_vardhan' || s.cat === 'adv' ? 'u_rohan' : clients.find((c) => c.id === s.client)!.relationshipManagerId;
    const task: Task = {
      id,
      title: s.title,
      description: s.desc,
      clientId: s.client,
      categoryId: s.cat,
      assigneeId: s.assignee,
      reviewerId: s.reviewer,
      priority: s.priority,
      status: s.status,
      startDate: day(s.start),
      dueDate: day(s.due),
      estimateHours: s.est,
      checklist: makeChecklist(s.cat, fraction, id),
      attachments: [],
      requiresReview: Boolean(s.reviewer),
      filingStage: s.filing,
      filingReference: s.filing === 'filed' ? `ACK${Math.floor(100000000 + rand() * 899999999)}` : undefined,
      recurrence: s.template ? { templateId: s.template, frequency: s.template === 'tpl_tds' ? 'quarterly' : 'monthly', periodLabel: s.period! } : undefined,
      createdBy,
      createdAt,
      updatedAt: lastTouch,
      updatedBy: s.assignee,
      submittedAt,
      completedAt,
    };
    tasks.push(task);

    activities.push({ id: `a_${id}_c`, type: 'task_created', actorId: createdBy, taskId: id, clientId: s.client, createdAt });
    if (s.status !== 'not_started') {
      activities.push({ id: `a_${id}_s1`, type: 'status_changed', actorId: s.assignee, taskId: id, clientId: s.client, createdAt: at(s.start, 11, 15), meta: { from: 'not_started', to: 'in_progress' } });
    }
    if (s.status === 'in_review' && submittedAt) {
      activities.push({ id: `a_${id}_s2`, type: 'status_changed', actorId: s.assignee, taskId: id, clientId: s.client, createdAt: submittedAt, meta: { from: 'in_progress', to: 'in_review' } });
    }
    if (s.status === 'changes_requested' && s.reviewer) {
      const sub = at(-3, 14, 0);
      const ret = at(-1, 17, 45);
      const note =
        s.cat === 'aud'
          ? 'Clause 44 break-up does not tie to the GST returns. Please rework and attach the reconciliation.'
          : s.cat === 'tds'
            ? 'Three vendor PANs are still mismatched — please confirm with the client before resubmitting.'
            : 'ITC on opening stock is higher than the ITC-01 workings. Please recheck and attach supporting.';
      activities.push({ id: `a_${id}_s2`, type: 'status_changed', actorId: s.assignee, taskId: id, clientId: s.client, createdAt: sub, meta: { from: 'in_progress', to: 'in_review' } });
      activities.push({ id: `a_${id}_r`, type: 'review_returned', actorId: s.reviewer, taskId: id, clientId: s.client, createdAt: ret, meta: { note } });
      reviews.push({ id: `rv_${id}`, taskId: id, reviewerId: s.reviewer, submittedAt: sub, decidedAt: ret, decision: 'returned', note });
      comments.push({ id: `cm_${id}_r`, taskId: id, authorId: s.reviewer, body: note, createdAt: ret });
    }
    if (s.status === 'completed' && completedAt) {
      if (s.reviewer && submittedAt) {
        activities.push({ id: `a_${id}_s2`, type: 'status_changed', actorId: s.assignee, taskId: id, clientId: s.client, createdAt: submittedAt, meta: { from: 'in_progress', to: 'in_review' } });
        activities.push({ id: `a_${id}_ap`, type: 'review_approved', actorId: s.reviewer, taskId: id, clientId: s.client, createdAt: completedAt });
        reviews.push({ id: `rv_${id}`, taskId: id, reviewerId: s.reviewer, submittedAt, decidedAt: completedAt, decision: 'approved' });
      } else {
        activities.push({ id: `a_${id}_s2`, type: 'status_changed', actorId: s.assignee, taskId: id, clientId: s.client, createdAt: completedAt, meta: { from: 'in_progress', to: 'completed' } });
      }
    }
  }

  const byTitle = (client: string, prefix: string) => tasks.find((t) => t.clientId === client && t.title.startsWith(prefix) && t.status !== 'completed')!;

  // --- Conversations on live tasks.
  const convo: [Task, string, string, number][] = [
    [byTitle('c_zenith', 'GSTR-1'), 'u_arjun', 'Client has shared sales data but the credit-note register is still pending. Called Venkat — promised by tomorrow morning.', -2],
    [byTitle('c_zenith', 'GSTR-1'), 'u_vikram', 'This is now past the internal deadline. Please escalate to their CFO if it is not received by 11 am.', -1],
    [byTitle('c_vardhan', 'Statutory audit'), 'u_kavya', 'Inventory observation completed at the Butibori plant. Two minor count differences noted in WIP — documented in the working papers.', -6],
    [byTitle('c_vardhan', 'Statutory audit'), 'u_ananya', 'Good. Please prioritise the related-party confirmations; the audit committee wants the draft report early next week.', -5],
    [byTitle('c_rajesh', 'ITR-2'), 'u_priya', 'Broker statement for the Zerodha account received. Still waiting on the ICICI Direct capital gains report.', -2],
    [byTitle('c_meera', 'ITR-3'), 'u_priya', 'Draft computation shared. Total income ₹38.6 lakh, refund of ₹12,400 after TDS. Submitted for review.', -1],
    [byTitle('c_sunrise', 'CMA data'), 'u_ananya', 'Projections assume 14% revenue growth per management. Rohan, please review the DSCR sensitivity before we send to the bank.', -1],
    [byTitle('c_nimbus', 'TDS return 24Q'), 'u_neha', 'Two employees have invalid PANs in the payroll master. Requested corrected PAN cards from HR.', -3],
    [byTitle('c_coastal', 'Half-yearly'), 'u_siddharth', 'Inter-property stock transfers are not matching between Calangute and Panjim units. Investigating.', -4],
    [byTitle('c_bluewave', 'GSTR-2B'), 'u_siddharth', 'First pass done — 23 vendors with mismatches totalling ₹4.2 lakh ITC. Sharing the list with the client today.', 0],
  ];
  convo.forEach(([t, author, body, ago], i) => {
    const createdAt = at(ago, 10 + (i % 6), 5 + i * 3);
    comments.push({ id: `cm_${t.id}_${i}`, taskId: t.id, authorId: author, body, createdAt });
    activities.push({ id: `a_${t.id}_cm${i}`, type: 'commented', actorId: author, taskId: t.id, clientId: t.clientId, createdAt });
  });

  // --- Attachments.
  const attach: [Task, string, number, string, number][] = [
    [byTitle('c_vardhan', 'Statutory audit'), 'Inventory_observation_Butibori.xlsx', 842, 'u_kavya', -6],
    [byTitle('c_vardhan', 'Statutory audit'), 'Related_party_confirmations.pdf', 1730, 'u_kavya', -3],
    [byTitle('c_meera', 'ITR-3'), 'Computation_of_income_draft.pdf', 214, 'u_priya', -1],
    [byTitle('c_meera', 'ITR-3'), 'AIS_TIS_extract.pdf', 388, 'u_priya', -4],
    [byTitle('c_arora', 'GSTR-1'), 'Sales_register_export.xlsx', 1290, 'u_arjun', -3],
    [byTitle('c_sunrise', 'CMA data'), 'CMA_projections_v3.xlsx', 615, 'u_ananya', -1],
    [byTitle('c_horizon', 'Trust audit'), 'Form_10B_draft.pdf', 502, 'u_kavya', -2],
    [byTitle('c_kaveri', 'Tax audit'), 'Form_3CD_annexures.xlsx', 920, 'u_kavya', -5],
  ];
  attach.forEach(([t, name, sizeKb, by, ago], i) => {
    const uploadedAt = at(ago, 13, i * 4);
    t.attachments.push({ id: `att_${t.id}_${i}`, name, sizeKb, uploadedBy: by, uploadedAt });
    activities.push({ id: `a_${t.id}_att${i}`, type: 'attachment_added', actorId: by, taskId: t.id, clientId: t.clientId, createdAt: uploadedAt, meta: { name } });
  });

  // --- Document requests.
  const docSpecs: [string, string, 'pending' | 'received', number, number, Task | undefined][] = [
    ['c_zenith', 'Credit-note register', 'pending', -9, -3, byTitle('c_zenith', 'GSTR-1')],
    ['c_zenith', 'Purchase register', 'received', -9, -3, byTitle('c_zenith', 'GSTR-1')],
    ['c_rajesh', 'ICICI Direct capital gains statement', 'pending', -10, -2, byTitle('c_rajesh', 'ITR-2')],
    ['c_rajesh', 'Zerodha tax P&L', 'received', -10, -2, byTitle('c_rajesh', 'ITR-2')],
    ['c_rajesh', 'ESOP allotment letters', 'pending', -6, 2, byTitle('c_rajesh', 'ITR-2')],
    ['c_arora', 'Purchase register', 'pending', -3, 2, byTitle('c_arora', 'GSTR-3B')],
    ['c_nimbus', 'Corrected PAN cards (2 employees)', 'pending', -3, 1, byTitle('c_nimbus', 'TDS return 24Q')],
    ['c_nimbus', 'Intercompany agreements', 'pending', -2, 12, byTitle('c_nimbus', 'Transfer pricing')],
    ['c_anvaya', 'Rent agreement for new premises', 'pending', -4, 1, byTitle('c_anvaya', 'GST registration')],
    ['c_anvaya', 'Previous accountant trial balance', 'pending', -12, -2, byTitle('c_anvaya', 'Opening balances')],
    ['c_anvaya', 'Proprietor KYC (PAN, Aadhaar)', 'received', -15, -10, undefined],
    ['c_patel', 'Property sale deed & purchase deed', 'received', -8, -4, byTitle('c_patel', 'Capital gains')],
    ['c_patel', 'Dividend statements', 'pending', -3, 5, byTitle('c_patel', 'Income tax return')],
    ['c_vardhan', 'Bank balance confirmations', 'received', -20, -10, byTitle('c_vardhan', 'Statutory audit')],
    ['c_vardhan', 'Board report draft', 'pending', -5, 3, byTitle('c_vardhan', 'AOC-4')],
    ['c_coastal', 'Inter-property transfer register', 'pending', -5, -1, byTitle('c_coastal', 'Half-yearly')],
    ['c_sunrise', 'Stock statements (bank format)', 'pending', -2, 10, byTitle('c_sunrise', 'Stock audit')],
    ['c_kaveri', 'GST returns summary for clause 44', 'received', -6, -4, byTitle('c_kaveri', 'Tax audit')],
    ['c_horizon', 'Donation receipts register', 'received', -14, -8, byTitle('c_horizon', 'Trust audit')],
    ['c_greenleaf', 'ITC-01 workings', 'pending', -2, 2, byTitle('c_greenleaf', 'GSTR-3B')],
  ];
  const documents: DocumentRequest[] = docSpecs.map(([clientId, name, status, reqAgo, dueOff, t], i) => {
    const requestedAt = at(reqAgo, 10, i);
    const receivedAt = status === 'received' ? at(Math.min(-1, reqAgo + 3), 15, i) : undefined;
    activities.push({ id: `a_doc${i}`, type: 'document_requested', actorId: t?.assigneeId ?? 'u_rohan', taskId: t?.id, clientId, createdAt: requestedAt, meta: { name } });
    if (receivedAt) activities.push({ id: `a_docr${i}`, type: 'document_received', actorId: t?.assigneeId ?? 'u_rohan', taskId: t?.id, clientId, createdAt: receivedAt, meta: { name } });
    return { id: `doc_${i}`, clientId, taskId: t?.id, name, status, requestedAt, dueDate: day(dueOff), receivedAt };
  });

  activities.push({ id: 'a_client_anvaya', type: 'client_created', actorId: 'u_rohan', clientId: 'c_anvaya', createdAt: at(-18, 12, 0) });
  activities.push({ id: 'a_invite_isha', type: 'member_invited', actorId: 'u_rohan', userId: 'u_isha', createdAt: at(-2, 16, 30) });

  // --- Notifications for every user, derived from the live work above.
  const notifications: AppNotification[] = [];
  const live = tasks.filter((t) => t.status !== 'completed' && t.createdAt > subDays(now, 60).toISOString());
  const clientName = (id: string) => clients.find((c) => c.id === id)!.name;
  let n = 0;
  const push = (userId: string, type: AppNotification['type'], title: string, body: string, t: Task, ago: number, read: boolean) => {
    notifications.push({ id: `nt_${n++}`, userId, type, title, body, taskId: t.id, clientId: t.clientId, createdAt: at(ago, 9 + (n % 8), (n * 7) % 60), read });
  };
  for (const t of live) {
    const dueIn = differenceInCalendarDays(parseISO(t.dueDate), now);
    push(t.assigneeId, 'assigned', 'New task assigned', `${t.title} · ${clientName(t.clientId)}`, t, Math.min(-1, Math.round((new Date(t.createdAt).getTime() - now.getTime()) / 86400000)), true);
    if (dueIn < 0) push(t.assigneeId, 'overdue', 'Task overdue', `${t.title} was due ${format(parseISO(t.dueDate), 'd MMM')}`, t, 0, false);
    else if (dueIn <= 2) push(t.assigneeId, 'due_soon', 'Deadline approaching', `${t.title} is due ${dueIn === 0 ? 'today' : dueIn === 1 ? 'tomorrow' : 'in 2 days'}`, t, 0, rand() < 0.3);
    if (t.status === 'in_review' && t.reviewerId) push(t.reviewerId, 'submitted', 'Submitted for review', `${users.find((u) => u.id === t.assigneeId)!.name} submitted ${t.title}`, t, -1, rand() < 0.3);
    if (t.status === 'changes_requested') push(t.assigneeId, 'changes_requested', 'Changes requested', `Reviewer returned ${t.title} with comments`, t, -1, false);
  }
  for (const c of comments) {
    const t = tasks.find((x) => x.id === c.taskId)!;
    const target = c.authorId === t.assigneeId ? t.reviewerId : t.assigneeId;
    if (target && target !== c.authorId) push(target, 'comment', 'New comment', `${users.find((u) => u.id === c.authorId)!.name}: “${c.body.slice(0, 70)}${c.body.length > 70 ? '…' : ''}”`, t, Math.round((new Date(c.createdAt).getTime() - now.getTime()) / 86400000), rand() < 0.5);
  }
  for (const t of tasks.filter((x) => x.status === 'completed' && x.completedAt && x.reviewerId && x.completedAt > subDays(now, 12).toISOString())) {
    push(t.assigneeId, 'approved', 'Review approved', `${t.title} was approved and marked complete`, t, Math.round((new Date(t.completedAt!).getTime() - now.getTime()) / 86400000), true);
  }
  for (const d of documents.filter((x) => x.status === 'received' && x.taskId)) {
    const t = tasks.find((x) => x.id === d.taskId)!;
    push(t.assigneeId, 'document', 'Document received', `${d.name} received from ${clientName(d.clientId)}`, t, Math.round((new Date(d.receivedAt!).getTime() - now.getTime()) / 86400000), true);
  }
  const shifted = byTitle('c_sunrise', 'Stock audit');
  push(shifted.assigneeId, 'due_changed', 'Deadline changed', `${shifted.title} moved to ${format(parseISO(shifted.dueDate), 'd MMM')} at the bank’s request`, shifted, -2, false);
  activities.push({ id: 'a_due_stock', type: 'due_changed', actorId: 'u_ananya', taskId: shifted.id, clientId: shifted.clientId, createdAt: at(-2, 11, 0), meta: { from: day(14), to: shifted.dueDate } });
  // Admin sees firm-wide escalations.
  for (const t of live.filter((x) => x.dueDate < toDateKey(now)).slice(0, 4)) {
    push('u_rohan', 'overdue', 'Overdue escalation', `${t.title} · ${clientName(t.clientId)} is past due`, t, 0, false);
  }

  const templates: TaskTemplate[] = [
    { id: 'tpl_gstr1', name: 'GSTR-1 monthly return', categoryId: 'gst', description: 'Monthly statement of outward supplies.', checklist: CHECKLISTS.gst, assignmentRule: 'fixed', defaultAssigneeId: 'u_arjun', reviewerId: 'u_vikram', frequency: 'monthly', dueDay: 11, dueMonthOffset: 1, entityTypes: ['Private Limited', 'Public Limited', 'LLP', 'Partnership', 'Proprietorship'], priority: 'high', estimateHours: 4, requiresReview: true, active: true, createdAt: at(-200) },
    { id: 'tpl_gstr3b', name: 'GSTR-3B monthly return', categoryId: 'gst', description: 'Monthly summary return and tax payment.', checklist: CHECKLISTS.gst, assignmentRule: 'fixed', defaultAssigneeId: 'u_arjun', reviewerId: 'u_vikram', frequency: 'monthly', dueDay: 20, dueMonthOffset: 1, entityTypes: ['Private Limited', 'Public Limited', 'LLP', 'Partnership', 'Proprietorship'], priority: 'high', estimateHours: 3, requiresReview: true, active: true, createdAt: at(-200) },
    { id: 'tpl_tds', name: 'Quarterly TDS statement', categoryId: 'tds', description: 'Quarterly TDS return (24Q / 26Q) for deductors.', checklist: CHECKLISTS.tds, assignmentRule: 'fixed', defaultAssigneeId: 'u_neha', reviewerId: 'u_vikram', frequency: 'quarterly', dueDay: 31, dueMonthOffset: 1, entityTypes: ['Private Limited', 'Public Limited', 'LLP'], priority: 'high', estimateHours: 4, requiresReview: true, active: true, createdAt: at(-180) },
    { id: 'tpl_payroll', name: 'Monthly payroll', categoryId: 'pay', description: 'Salary processing, payslips and statutory contributions.', checklist: CHECKLISTS.pay, assignmentRule: 'fixed', defaultAssigneeId: 'u_neha', reviewerId: 'u_ananya', frequency: 'monthly', dueDay: 28, dueMonthOffset: 0, entityTypes: ['Private Limited', 'Public Limited'], priority: 'medium', estimateHours: 6, requiresReview: true, active: true, createdAt: at(-160) },
    { id: 'tpl_books', name: 'Monthly bookkeeping', categoryId: 'acc', description: 'Record transactions and reconcile bank accounts.', checklist: CHECKLISTS.acc, assignmentRule: 'fixed', defaultAssigneeId: 'u_siddharth', frequency: 'monthly', dueDay: 10, dueMonthOffset: 1, entityTypes: ['Proprietorship', 'Partnership'], priority: 'medium', estimateHours: 8, requiresReview: false, active: true, createdAt: at(-150) },
    { id: 'tpl_itr', name: 'Annual income tax return — individuals', categoryId: 'itr', description: 'Return of income for individuals and HUFs.', checklist: CHECKLISTS.itr, assignmentRule: 'fixed', defaultAssigneeId: 'u_priya', reviewerId: 'u_vikram', frequency: 'annual', dueDay: 31, dueMonthOffset: 4, entityTypes: ['Individual', 'HUF'], priority: 'high', estimateHours: 6, requiresReview: true, active: true, createdAt: at(-300) },
    { id: 'tpl_advtax', name: 'Advance tax computation', categoryId: 'itr', description: 'Estimate income and compute the advance tax instalment.', checklist: ['Estimate income for the year', 'Compute instalment', 'Share challan with client'], assignmentRule: 'relationship_manager', frequency: 'quarterly', dueDay: 15, dueMonthOffset: 0, entityTypes: ['Individual', 'HUF'], priority: 'medium', estimateHours: 2, requiresReview: false, active: true, createdAt: at(-120) },
    { id: 'tpl_audit', name: 'Statutory audit', categoryId: 'aud', description: 'Annual statutory audit engagement.', checklist: CHECKLISTS.aud, assignmentRule: 'fixed', defaultAssigneeId: 'u_kavya', reviewerId: 'u_ananya', frequency: 'annual', dueDay: 30, dueMonthOffset: 6, entityTypes: ['Private Limited', 'Public Limited'], priority: 'urgent', estimateHours: 60, requiresReview: true, active: false, createdAt: at(-90) },
  ];

  activities.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const firm = {
    name: 'Mehta Iyer & Associates',
    legalName: 'Mehta Iyer & Associates, Chartered Accountants',
    registrationNo: 'FRN 000000W (demo)',
    city: 'Mumbai',
    email: 'office@mehtaiyer.demo',
    phone: '+91 22 4000 0000',
    atRiskDays: 3,
    isDemo: true,
  };
  const extras = createExtras({ now, rand, users, clients, tasks, firm });

  return {
    version: DB_VERSION,
    seededAt: now.toISOString(),
    firm,
    users,
    clients,
    categories,
    tasks,
    comments,
    activities,
    notifications,
    documents,
    reviews,
    templates,
    ...extras,
  };
}

