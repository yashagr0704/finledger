import { addDays, endOfMonth, format, setHours, subMonths } from 'date-fns';
import { toDateKey } from '@/lib/dates';
import { withChecksum } from '@/lib/gstin';
import type {
  Broadcast,
  ChatMessage,
  Client,
  DocMovement,
  DriveFile,
  Dsc,
  Firm,
  Invoice,
  Note,
  Notice,
  Payment,
  Portal,
  Referrer,
  Reminder,
  Service,
  Task,
  User,
} from '@/types';

/**
 * Demo data for the modules added from the client's design brief: masters,
 * billing, notices, DSC, document register, WhatsApp, drive, notes and portals.
 * Everything here is fictional.
 */

export const SERVICES: Service[] = [
  { id: 'sv_gstr1', groupId: 'gst', name: 'GSTR-1', frequency: 'Monthly', defaultFee: 1500 },
  { id: 'sv_iff', groupId: 'gst', name: 'GSTR-1 IFF', frequency: 'Quarterly', defaultFee: 1000 },
  { id: 'sv_gstr3b', groupId: 'gst', name: 'GSTR-3B', frequency: 'Monthly', defaultFee: 1500 },
  { id: 'sv_cmp08', groupId: 'gst', name: 'CMP-08', frequency: 'Quarterly', defaultFee: 1000 },
  { id: 'sv_gstr9', groupId: 'gst', name: 'GSTR-9 Annual Return', frequency: 'Annual', defaultFee: 7500 },
  { id: 'sv_gstrecon', groupId: 'gst', name: 'GST Reconciliation', frequency: 'Monthly', defaultFee: 2500 },
  { id: 'sv_gstreg', groupId: 'gst', name: 'GST Registration / Amendment', frequency: 'One-time', defaultFee: 3000 },
  { id: 'sv_itr', groupId: 'itr', name: 'ITR Filing — Individual', frequency: 'Annual', defaultFee: 2500 },
  { id: 'sv_itrbiz', groupId: 'itr', name: 'ITR Filing — Business', frequency: 'Annual', defaultFee: 6000 },
  { id: 'sv_advtax', groupId: 'itr', name: 'Advance Tax Computation', frequency: 'Quarterly', defaultFee: 1000 },
  { id: 'sv_cg', groupId: 'itr', name: 'Capital Gains Computation', frequency: 'One-time', defaultFee: 3500 },
  { id: 'sv_tdsret', groupId: 'tds', name: 'TDS Return (24Q / 26Q)', frequency: 'Quarterly', defaultFee: 3000 },
  { id: 'sv_tdschallan', groupId: 'tds', name: 'TDS/TCS Payment', frequency: 'Monthly', defaultFee: 500 },
  { id: 'sv_books', groupId: 'acc', name: 'Bookkeeping', frequency: 'Monthly', defaultFee: 5000 },
  { id: 'sv_mis', groupId: 'acc', name: 'MIS Report', frequency: 'Monthly', defaultFee: 4000 },
  { id: 'sv_stat', groupId: 'aud', name: 'Statutory Audit', frequency: 'Annual', defaultFee: 75000 },
  { id: 'sv_taxaudit', groupId: 'aud', name: 'Tax Audit (3CD)', frequency: 'Annual', defaultFee: 25000 },
  { id: 'sv_internal', groupId: 'aud', name: 'Internal Audit', frequency: 'Quarterly', defaultFee: 40000 },
  { id: 'sv_payroll', groupId: 'pay', name: 'Payroll Processing', frequency: 'Monthly', defaultFee: 3000 },
  { id: 'sv_pfesi', groupId: 'pay', name: 'PF & ESI Returns', frequency: 'Monthly', defaultFee: 1000 },
  { id: 'sv_aoc4', groupId: 'roc', name: 'AOC-4', frequency: 'Annual', defaultFee: 5000 },
  { id: 'sv_mgt7', groupId: 'roc', name: 'MGT-7', frequency: 'Annual', defaultFee: 5000 },
  { id: 'sv_dir3', groupId: 'roc', name: 'DIR-3 KYC', frequency: 'Annual', defaultFee: 500 },
  { id: 'sv_form11', groupId: 'roc', name: 'LLP Form 11 / 8', frequency: 'Annual', defaultFee: 3000 },
  { id: 'sv_adv', groupId: 'adv', name: 'Advisory / Consultation', frequency: 'As required', defaultFee: 5000 },
];

const KEYWORDS: [RegExp, string][] = [
  [/GSTR-1 IFF/i, 'sv_iff'],
  [/GSTR-1/i, 'sv_gstr1'],
  [/GSTR-3B/i, 'sv_gstr3b'],
  [/GSTR-9/i, 'sv_gstr9'],
  [/ITC|reconcil.*GST|GST review/i, 'sv_gstrecon'],
  [/registration/i, 'sv_gstreg'],
  [/Advance tax/i, 'sv_advtax'],
  [/Capital gains/i, 'sv_cg'],
  [/ITR-[3456]|Income tax return/i, 'sv_itr'],
  [/TDS return|24Q|26Q/i, 'sv_tdsret'],
  [/challan|TDS/i, 'sv_tdschallan'],
  [/MIS/i, 'sv_mis'],
  [/Statutory audit/i, 'sv_stat'],
  [/Tax audit|3CD/i, 'sv_taxaudit'],
  [/Internal audit/i, 'sv_internal'],
  [/PF|ESI/i, 'sv_pfesi'],
  [/Payroll/i, 'sv_payroll'],
  [/AOC-4/i, 'sv_aoc4'],
  [/MGT-7/i, 'sv_mgt7'],
  [/DIR-3/i, 'sv_dir3'],
  [/Form 11/i, 'sv_form11'],
];
const GROUP_DEFAULT: Record<string, string> = { gst: 'sv_gstr3b', itr: 'sv_itrbiz', tds: 'sv_tdsret', acc: 'sv_books', aud: 'sv_internal', pay: 'sv_payroll', roc: 'sv_aoc4', adv: 'sv_adv' };

export function serviceForTask(t: Pick<Task, 'title' | 'categoryId'>) {
  const hit = KEYWORDS.find(([re, id]) => re.test(t.title) && SERVICES.find((s) => s.id === id)?.groupId === t.categoryId);
  return hit?.[1] ?? GROUP_DEFAULT[t.categoryId] ?? 'sv_adv';
}

export const PORTALS: Portal[] = [
  { id: 'pt_gst', name: 'GST Portal', short: 'GST', url: 'https://www.gst.gov.in/', description: 'Returns, registration, notices', clicks: 412, hue: 220 },
  { id: 'pt_it', name: 'Income Tax e-Filing', short: 'IT', url: 'https://www.incometax.gov.in/iec/foportal/', description: 'ITR, e-proceedings, refunds', clicks: 365, hue: 25 },
  { id: 'pt_traces', name: 'TRACES', short: 'TDS', url: 'https://www.tdscpc.gov.in/', description: 'TDS statements, Form 16/16A', clicks: 188, hue: 160 },
  { id: 'pt_mca', name: 'MCA V3', short: 'MCA', url: 'https://www.mca.gov.in/', description: 'ROC filings, company master data', clicks: 141, hue: 265 },
  { id: 'pt_epfo', name: 'EPFO Employer', short: 'PF', url: 'https://unifiedportal-emp.epfindia.gov.in/', description: 'ECR filing, UAN', clicks: 96, hue: 200 },
  { id: 'pt_esic', name: 'ESIC', short: 'ESIC', url: 'https://www.esic.gov.in/', description: 'Monthly contributions', clicks: 74, hue: 340 },
  { id: 'pt_ewb', name: 'e-Way Bill', short: 'EWB', url: 'https://ewaybillgst.gov.in/', description: 'Generate and cancel e-way bills', clicks: 52, hue: 190 },
  { id: 'pt_einv', name: 'e-Invoice (IRP)', short: 'IRP', url: 'https://einvoice1.gst.gov.in/', description: 'IRN generation', clicks: 38, hue: 140 },
  { id: 'pt_udyam', name: 'Udyam (MSME)', short: 'MSME', url: 'https://udyamregistration.gov.in/', description: 'MSME registration', clicks: 21, hue: 45 },
  { id: 'pt_dgft', name: 'DGFT', short: 'DGFT', url: 'https://www.dgft.gov.in/', description: 'IEC, import–export', clicks: 17, hue: 0 },
  { id: 'pt_icegate', name: 'ICEGATE', short: 'ICE', url: 'https://www.icegate.gov.in/', description: 'Customs filings', clicks: 9, hue: 300 },
  { id: 'pt_ptax', name: 'Profession Tax (MH)', short: 'PT', url: 'https://www.mahagst.gov.in/', description: 'PTRC / PTEC returns', clicks: 28, hue: 100 },
];

export const REFERRERS: Referrer[] = [
  { id: 'rf_1', name: 'Anil Kothari', firmName: 'Kothari & Co. (Advocates)', mobile: '+91 98200 55101', email: 'anil@kotharilaw.demo', address: 'Fort, Mumbai' },
  { id: 'rf_2', name: 'Sunita Rao', firmName: 'Rao Insurance Advisors', mobile: '+91 98450 55102', email: 'sunita@raoadvisors.demo', address: 'Indiranagar, Bengaluru' },
  { id: 'rf_3', name: 'Deepak Jain', firmName: 'Jain Textiles Association', mobile: '+91 99250 55103', email: 'deepak@jta.demo', address: 'Ring Road, Surat' },
  { id: 'rf_4', name: 'Existing client', firmName: 'Client referral', mobile: '—', email: '—', address: '—' },
  { id: 'rf_5', name: 'Website enquiry', firmName: 'mehtaiyer.demo', mobile: '—', email: 'enquiry@mehtaiyer.demo', address: '—' },
];

/** Demo festival calendar used by the WhatsApp wishes feature. Dates are indicative. */
export const FESTIVALS = [
  { name: 'Diwali', date: '2026-11-08' },
  { name: 'Bhai Dooj', date: '2026-11-11' },
  { name: 'Chhath Puja', date: '2026-11-15' },
  { name: 'Guru Nanak Jayanti', date: '2026-11-24' },
  { name: 'Christmas', date: '2026-12-25' },
  { name: 'New Year', date: '2027-01-01' },
  { name: 'Makar Sankranti / Pongal', date: '2027-01-14' },
  { name: 'Republic Day', date: '2027-01-26' },
  { name: 'Holi', date: '2027-03-22' },
  { name: 'Gudi Padwa / Ugadi', date: '2027-04-07' },
  { name: 'Eid al-Fitr', date: '2027-03-10' },
  { name: 'Independence Day', date: '2027-08-15' },
  { name: 'Ganesh Chaturthi', date: '2027-09-04' },
  { name: 'Durga Puja', date: '2027-10-14' },
  { name: 'Diwali', date: '2027-10-29' },
];

export function festivalSuggestions(festival: string, firm: string, variant = 0): string[] {
  const sets = [
    [
      `Wishing you and your family a very happy ${festival}! May this season bring prosperity, good health and success to your business. — Team ${firm}`,
      `Warm ${festival} greetings from all of us at ${firm}. Thank you for your continued trust — here’s to a bright and prosperous year ahead!`,
      `Happy ${festival}! 🪔 May your books stay balanced and your celebrations be full. Best wishes from ${firm}.`,
    ],
    [
      `On the joyous occasion of ${festival}, ${firm} wishes you happiness, peace and growth. It is a privilege to be part of your journey.`,
      `Season’s greetings! Celebrate ${festival} with your loved ones — we’ll keep your compliance on track. Warm regards, ${firm}.`,
      `May ${festival} light up new opportunities for you and your team. Heartfelt wishes from everyone at ${firm}.`,
    ],
  ];
  return sets[variant % sets.length];
}

export function createExtras(ctx: { now: Date; rand: () => number; users: User[]; clients: Client[]; tasks: Task[]; firm: Firm }) {
  const { now, rand, users, clients, tasks } = ctx;
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const day = (o: number) => toDateKey(addDays(now, o));
  const at = (o: number, h = 11, m = 0) => {
    const d = setHours(addDays(now, o), h);
    d.setMinutes(m, 0, 0);
    return (d > now ? now : d).toISOString();
  };

  Object.assign(ctx.firm, {
    whatsappNumber: '+91 98200 11000',
    invoicePrefix: 'MIA',
    defaultGstRate: 18,
    gstin: withChecksum('27AAAFM0000A1Z5'),
    address: '402, Trade Centre, Bandra Kurla Complex, Mumbai 400051',
  });

  // --- People: extra employee fields.
  for (const u of users) {
    u.username = u.email.split('@')[0];
    u.address = ['Andheri East, Mumbai', 'Thane West', 'Powai, Mumbai', 'Vashi, Navi Mumbai', 'Borivali, Mumbai'][u.avatarHue % 5];
    u.aadhaar = u.role === 'employee' ? `XXXX XXXX ${String(1000 + ((u.avatarHue * 37) % 9000)).slice(0, 4)}` : undefined;
    u.pan = u.role !== 'admin' ? `ABCP${String.fromCharCode(65 + (u.avatarHue % 26))}${String(1000 + u.avatarHue).slice(-4)}K` : undefined;
  }
  // Demo: Priya may view all firm tasks; Arjun can assign work to others.
  users.find((u) => u.id === 'u_priya')!.permissions = { viewAllTasks: false, createTaskForOthers: false };
  users.find((u) => u.id === 'u_arjun')!.permissions = { createTaskForOthers: true };
  users.find((u) => u.id === 'u_vikram')!.permissions = { billing: true };

  // --- Clients: master fields.
  const contactsFor: Record<string, [string, string][]> = {
    c_sunrise: [['Harish Agarwal', 'Director'], ['Kunal Shah', 'Accounts Manager']],
    c_nimbus: [['Aditi Kulkarni', 'CFO'], ['Rahul Menon', 'HR Lead']],
    c_vardhan: [['Prakash Vardhan', 'Managing Director'], ['Shilpa Joshi', 'Company Secretary']],
    c_bluewave: [['Sameer Khan', 'Finance Head']],
  };
  clients.forEach((c, i) => {
    if (c.gstin) c.gstin = withChecksum(c.gstin);
    const company = /Pvt Ltd|Ltd$/.test(c.name);
    c.billingName = company ? c.name.replace('Pvt Ltd', 'Private Limited').replace(/ Ltd$/, ' Limited') : c.name;
    c.tradeName = c.entityType === 'Proprietorship' ? c.name : c.entityType === 'Individual' || c.entityType === 'HUF' ? undefined : c.name.split(' ').slice(0, 2).join(' ');
    c.fileNo = `F-${String(101 + i).padStart(3, '0')}`;
    c.incorporatedOn = c.entityType === 'Individual' ? `19${70 + ((i * 7) % 20)}-0${1 + (i % 9)}-1${i % 9}` : `20${String(5 + (i % 15)).padStart(2, '0')}-0${1 + (i % 9)}-2${i % 8}`;
    c.taxesApplicable = c.gstin ? ['GST', 'Income Tax'] : ['Income Tax'];
    if (['c_vardhan', 'c_nimbus', 'c_coastal'].includes(c.id)) c.taxesApplicable.push('Other');
    c.referredById = REFERRERS[i % REFERRERS.length].id;
    c.contacts = (contactsFor[c.id] ?? [[c.contactName, c.entityType === 'Individual' ? 'Self' : 'Partner / Owner']]).map(([name, designation], k) => ({
      name,
      designation,
      phone: k === 0 ? c.phone : c.phone.replace(/\d{2}$/, '9' + k),
      email: k === 0 ? c.email : `${name.split(' ')[0].toLowerCase()}@${c.email.split('@')[1]}`,
    }));
    c.customFields = [
      { label: 'Financial year end', value: '31 March' },
      ...(company ? [{ label: 'Bank', value: pick(['HDFC Bank', 'ICICI Bank', 'Axis Bank', 'SBI']) + ', ' + c.city }] : []),
      { label: 'Billing cycle', value: pick(['Monthly retainer', 'Quarterly', 'Per assignment']) },
    ];
    c.portalLogins = [
      ...(c.gstin ? [{ portalId: 'pt_gst', username: `${c.code.toLowerCase().replace('-', '')}_gst`, password: 'Demo@2026' }] : []),
      { portalId: 'pt_it', username: c.pan ?? c.code, password: 'Demo#ITR26' },
      ...(company ? [{ portalId: 'pt_traces', username: `${c.code.slice(0, 3)}TAN01`, password: 'Traces@123' }] : []),
    ];
    c.serviceIds = [...new Set(tasks.filter((t) => t.clientId === c.id).map((t) => serviceForTask(t)))];
  });

  // A client who left the firm — messaging is switched off for them.
  const exitedId = 'c_ganesh';
  clients.push({
    id: exitedId,
    code: 'SGT-015',
    name: 'Shree Ganesh Traders',
    entityType: 'Proprietorship',
    industry: 'Hardware trading',
    contactName: 'Ramesh Gupta',
    email: 'sgtraders@example.demo',
    phone: '+91 98221 40015',
    city: 'Pune',
    pan: 'ABRPG0015D',
    gstin: withChecksum('27ABRPG0015D1Z9'),
    relationshipManagerId: 'u_vikram',
    teamIds: ['u_arjun'],
    status: 'inactive',
    since: '2019-06-01',
    exitDate: day(-62),
    billingName: 'Shree Ganesh Traders',
    tradeName: 'Shree Ganesh Traders',
    fileNo: 'F-115',
    taxesApplicable: ['GST', 'Income Tax'],
    referredById: 'rf_4',
    contacts: [{ name: 'Ramesh Gupta', designation: 'Proprietor', phone: '+91 98221 40015', email: 'sgtraders@example.demo' }],
    customFields: [{ label: 'Reason for exit', value: 'Business closed' }],
    portalLogins: [],
    serviceIds: ['sv_gstr1', 'sv_gstr3b'],
    notes: 'Engagement ended. All records handed over.',
  });

  // --- Tasks: service mapping and fees.
  for (const t of tasks) {
    t.serviceId = serviceForTask(t);
    const base = SERVICES.find((s) => s.id === t.serviceId)!.defaultFee;
    t.fee = Math.round((base * (0.8 + rand() * 0.5)) / 100) * 100;
  }

  // --- Billing: invoice completed work from previous months; this month's stays unbilled.
  const invoices: Invoice[] = [];
  const payments: Payment[] = [];
  let invNo = 1;
  const fyLabel = (d: Date) => {
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  };
  for (let m = 5; m >= 1; m -= 1) {
    const month = subMonths(now, m);
    const key = format(month, 'yyyy-MM');
    const byClient = new Map<string, Task[]>();
    tasks
      .filter((t) => t.status === 'completed' && t.completedAt?.slice(0, 7) === key)
      .forEach((t) => {
        // Leave a little of last month's work unbilled.
        if (m === 1 && rand() < 0.3) return;
        byClient.set(t.clientId, [...(byClient.get(t.clientId) ?? []), t]);
      });
    for (const [clientId, ts] of byClient) {
      const date = endOfMonth(month);
      const inv: Invoice = {
        id: `inv_${invNo}`,
        number: `MIA/${fyLabel(date)}/${String(invNo).padStart(4, '0')}`,
        clientId,
        date: toDateKey(date),
        dueDate: toDateKey(addDays(date, 15)),
        gstRate: 18,
        items: ts.map((t) => ({ taskId: t.id, description: t.title, amount: t.fee ?? 0 })),
      };
      ts.forEach((t) => (t.invoiceId = inv.id));
      invoices.push(inv);
      const total = Math.round(inv.items.reduce((s, x) => s + x.amount, 0) * 1.18);
      const age = (now.getTime() - date.getTime()) / 86400000;
      const paid = age > 60 ? total : age > 25 ? (rand() < 0.5 ? total : Math.round(total / 2)) : rand() < 0.25 ? total : 0;
      if (paid)
        payments.push({
          id: `pay_${invNo}`,
          clientId,
          invoiceId: inv.id,
          date: toDateKey(addDays(date, 6 + Math.floor(rand() * 15))),
          amount: paid,
          mode: pick(['UPI', 'NEFT', 'NEFT', 'Cheque']),
          kind: 'receipt',
          reference: `UTR${Math.floor(100000000 + rand() * 899999999)}`,
        });
      invNo += 1;
    }
  }
  [
    ['c_vardhan', 50000, -20],
    ['c_nimbus', 25000, -12],
    ['c_kaveri', 15000, -9],
    ['c_sunrise', 10000, -5],
  ].forEach(([clientId, amount, ago], i) =>
    payments.push({ id: `adv_${i}`, clientId: clientId as string, date: day(ago as number), amount: amount as number, mode: 'NEFT', kind: 'advance', reference: `ADV-${101 + i}` }),
  );

  // --- Notices (simulated auto-fetch).
  const noticeSpecs: [string, Notice['source'], string, string, number, number, Notice['status'], string | undefined, number?][] = [
    ['c_zenith', 'GST', 'ASMT-10', 'Scrutiny of returns — mismatch between GSTR-1 and GSTR-3B for FY 2024-25', -6, 24, 'new', 'u_arjun', 184500],
    ['c_sunrise', 'GST', 'DRC-01A', 'Intimation of tax ascertained — excess ITC claimed', -11, 4, 'in_progress', 'u_arjun', 92300],
    ['c_greenleaf', 'GST', 'GSTR-3A', 'Notice for non-filing of return (Aug 2026)', -3, 12, 'new', 'u_siddharth'],
    ['c_rajesh', 'Income Tax', '143(1)(a)', 'Proposed adjustment — difference in capital gains reported', -8, 22, 'in_progress', 'u_priya', 46800],
    ['c_meera', 'Income Tax', '139(9)', 'Defective return — Schedule BP incomplete', -2, 13, 'new', 'u_priya'],
    ['c_patel', 'Income Tax', '245', 'Intimation of refund adjustment against outstanding demand', -15, 15, 'replied', 'u_priya', 12600],
    ['c_kaveri', 'Income Tax', '148A(b)', 'Show cause — information suggests income escaped assessment (AY 2022-23)', -20, -2, 'in_progress', 'u_vikram', 0],
    ['c_bluewave', 'TDS', 'TRACES Demand', 'Short deduction and late filing fee — Q1 FY 2026-27', -9, 21, 'new', 'u_neha', 18450],
    ['c_vardhan', 'TDS', 'Form 16A Default', 'PAN errors in 26Q — Q4 FY 2025-26', -30, -10, 'closed', 'u_neha', 3200],
    ['c_coastal', 'Other', 'PF 7A', 'EPFO inquiry — contractor employees coverage', -4, 26, 'new', 'u_neha'],
    ['c_arora', 'GST', 'REG-03', 'Clarification sought on amendment of principal place of business', -1, 6, 'new', 'u_arjun'],
  ];
  const notices: Notice[] = noticeSpecs.map(([clientId, source, form, subject, issued, due, status, assigneeId, amount], i) => ({
    id: `nt_${i}`,
    clientId,
    source,
    form,
    subject,
    reference: `${source === 'GST' ? 'ZD' : source === 'TDS' ? 'TR' : source === 'Other' ? 'MH/BAN' : 'ITBA/AST'}${Math.floor(10000000 + rand() * 89999999)}`,
    issuedOn: day(issued),
    dueOn: day(due),
    amount,
    status,
    assigneeId,
    fetchedAt: at(issued + 1, 7, 5),
  }));

  // --- DSC register.
  const dscSpecs: [string, string, number, number, Dsc['custody']][] = [
    ['c_sunrise', 'Harish Agarwal', -600, 130, 'firm'],
    ['c_sunrise', 'Kunal Shah', -700, 25, 'firm'],
    ['c_nimbus', 'Aditi Kulkarni', -300, 430, 'client'],
    ['c_vardhan', 'Prakash Vardhan', -720, 8, 'firm'],
    ['c_vardhan', 'Shilpa Joshi', -400, 330, 'firm'],
    ['c_kaveri', 'Lakshmi Narayan', -760, -12, 'client'],
    ['c_bluewave', 'Sameer Khan', -200, 530, 'firm'],
    ['c_coastal', 'Rhea D’Souza', -710, 19, 'client'],
    ['c_zenith', 'Venkat Rao', -500, 230, 'firm'],
    ['c_rajesh', 'Rajesh Malhotra', -740, -40, 'client'],
    ['c_horizon', 'Fr. Joseph Fernandes', -100, 630, 'firm'],
  ];
  const dscs: Dsc[] = dscSpecs.map(([clientId, holder, issued, expires, custody], i) => ({
    id: `dsc_${i}`,
    clientId,
    holder,
    type: i % 3 === 0 ? 'Signing & Encryption' : 'Signing',
    provider: pick(['eMudhra', 'Capricorn', 'Vsign', 'PantaSign']),
    tokenSerial: `TKN-${Math.floor(100000 + rand() * 899999)}`,
    issuedOn: day(issued),
    expiresOn: day(expires),
    custody,
    lastMovedAt: day(-Math.floor(rand() * 40)),
  }));

  // --- Physical document register.
  const userIds = ['u_siddharth', 'u_kavya', 'u_farhan', 'u_arjun', 'u_priya'];
  const docSpecs: [string, string, DocMovement['direction'], number, DocMovement['mode'], string, boolean, number?][] = [
    ['c_vardhan', 'Original purchase invoices (Apr–Sep) — 4 box files', 'in', -18, 'By hand', 'Driver — Vardhan Steel', false, 12],
    ['c_vardhan', 'Fixed asset register (signed copy)', 'in', -12, 'Courier', 'Blue Dart', true],
    ['c_kaveri', 'Bank statements & cheque books', 'in', -9, 'By hand', 'Lakshmi Narayan', false, 7],
    ['c_rajesh', 'Property sale deed (original)', 'in', -6, 'By hand', 'Rajesh Malhotra', false, 2],
    ['c_rajesh', 'Property sale deed (original)', 'out', -1, 'By hand', 'Rajesh Malhotra', true],
    ['c_patel', 'Share certificates for verification', 'in', -14, 'By hand', 'Mahesh Patel', false, -3],
    ['c_sunrise', 'Stock statements (bank format)', 'in', -4, 'Email', 'Kunal Shah', true],
    ['c_horizon', 'Donation receipt books (FY 2025-26)', 'in', -21, 'Courier', 'DTDC', false, 4],
    ['c_bluewave', 'Truck purchase invoices — originals', 'out', -3, 'Courier', 'Sameer Khan', true],
    ['c_coastal', 'Signed financial statements (H1)', 'out', -2, 'By hand', 'Rhea D’Souza', true],
    ['c_ganesh', 'All books of account (handover on exit)', 'out', -60, 'By hand', 'Ramesh Gupta', true],
    ['c_meera', 'Form 16 and investment proofs', 'in', -11, 'Email', 'Dr. Meera Krishnan', true],
  ];
  const docMovements: DocMovement[] = docSpecs.map(([clientId, document, direction, ago, mode, person, returned, ret], i) => ({
    id: `dm_${i}`,
    clientId,
    document,
    direction,
    date: day(ago),
    mode,
    person,
    handledBy: userIds[i % userIds.length],
    expectedReturn: ret !== undefined ? day(ret) : undefined,
    returned,
  }));

  // --- WhatsApp conversations.
  const chats: ChatMessage[] = [];
  const thread = (clientId: string, msgs: [ChatMessage['direction'], string, number, number, string?][]) =>
    msgs.forEach(([direction, body, ago, hour, authorId], i) =>
      chats.push({ id: `wa_${clientId}_${i}`, clientId, direction, body, at: at(ago, hour, (i * 7) % 60), status: direction === 'out' ? (i === msgs.length - 1 ? 'delivered' : 'read') : 'read', authorId }),
    );
  thread('c_zenith', [
    ['out', 'Hello Venkat ji, we still need the credit-note register for September to file GSTR-1. Could you share it today?', -2, 10, 'u_arjun'],
    ['in', 'Sorry for the delay. Our accountant is on leave, will send by tomorrow morning.', -2, 13],
    ['out', 'Thank you. Please note the return is already past the due date — late fee is accruing daily.', -1, 9, 'u_arjun'],
    ['in', 'Understood. Sharing now.', 0, 10],
    ['in', '📎 Credit_notes_Sep.xlsx', 0, 10],
  ]);
  thread('c_rajesh', [
    ['out', 'Hi Rajesh, we need your ICICI Direct capital gains statement for FY 2025-26 to complete your ITR.', -4, 11, 'u_priya'],
    ['in', 'Sure, how do I download it?', -4, 12],
    ['out', 'Login → Portfolio → Reports → Capital Gains → select FY 2025-26 → Download PDF.', -4, 12, 'u_priya'],
    ['in', 'Will do this weekend.', -3, 19],
  ]);
  thread('c_sunrise', [
    ['in', 'Good morning sir, GST notice received on portal. Forwarding PDF.', -10, 9],
    ['out', 'Received. This is DRC-01A for excess ITC. We will prepare the reply — please send the purchase register for Q3.', -10, 11, 'u_vikram'],
    ['in', 'Ok sir 🙏', -10, 11],
  ]);
  thread('c_meera', [
    ['out', 'Dear Dr. Meera, your ITR computation is ready. Total tax payable: ₹0, refund of ₹12,400. Shall we file?', -1, 16, 'u_priya'],
    ['in', 'Yes please go ahead. Thank you!', -1, 18],
  ]);
  thread('c_vardhan', [
    ['out', 'Sir, statutory audit fieldwork is 80% complete. Draft report expected by 31 Oct.', -3, 17, 'u_ananya'],
    ['in', 'Thanks Ananya. Please share the related-party schedule first.', -3, 18],
  ]);
  thread('c_kaveri', [['out', 'Reminder: Your advance tax instalment is due on 15 Dec. We will share the computation next week.', -5, 12, 'u_priya']]);
  thread('c_ganesh', [
    ['out', 'Dear Ramesh ji, as discussed all your records have been handed over. Wishing you the best.', -60, 12, 'u_vikram'],
    ['in', 'Thank you for all your support over the years.', -60, 15],
  ]);

  const broadcasts: Broadcast[] = [
    { id: 'bc_1', title: 'Navratri & Dussehra wishes', body: 'Wishing you a joyous Navratri and a victorious Dussehra! — Team Mehta Iyer & Associates', kind: 'festival', sentAt: at(-14, 9), recipients: 13, sentBy: 'u_rohan' },
    { id: 'bc_2', title: 'GSTR-3B data reminder', body: 'Gentle reminder: please share your September purchase and sales data by 12 Oct so we can file GSTR-3B on time.', kind: 'compliance', sentAt: at(-17, 10), recipients: 8, sentBy: 'u_vikram' },
    { id: 'bc_3', title: 'Independence Day wishes', body: 'Happy Independence Day! 🇮🇳 — Team Mehta Iyer & Associates', kind: 'festival', sentAt: at(-72, 9), recipients: 14, sentBy: 'u_rohan' },
  ];

  // --- Client documents drive.
  const fyNow = `FY ${fyLabel(now)}`;
  const fyPrev = `FY ${fyLabel(subMonths(now, 12))}`;
  const drive: DriveFile[] = [];
  let fileN = 0;
  const addFile = (clientId: string, folder: string, name: string, ago: number) =>
    drive.push({ id: `df_${fileN++}`, clientId, folder, name, sizeKb: 80 + Math.floor(rand() * 2400), uploadedBy: pick(userIds), uploadedAt: at(ago, 12, fileN % 60) });
  for (const c of clients) {
    addFile(c.id, 'KYC', `PAN_${c.code}.pdf`, -400);
    if (c.entityType !== 'Individual' && c.entityType !== 'HUF') addFile(c.id, 'KYC', 'Certificate_of_incorporation.pdf', -400);
    if (c.gstin) {
      addFile(c.id, 'KYC', 'GST_Registration_Certificate.pdf', -380);
      for (let m = 1; m <= 3; m += 1) {
        const lbl = format(subMonths(now, m), 'MMM_yyyy');
        addFile(c.id, `${fyNow}/GST`, `GSTR-3B_${lbl}_ack.pdf`, -m * 30 + 22);
        addFile(c.id, `${fyNow}/GST`, `GSTR-1_${lbl}_ack.pdf`, -m * 30 + 12);
      }
    }
    addFile(c.id, `${fyPrev}/Income Tax`, 'ITR_acknowledgement.pdf', -90);
    addFile(c.id, `${fyPrev}/Income Tax`, 'Computation_of_income.pdf', -92);
    if (rand() < 0.6) addFile(c.id, `${fyPrev}/Financials`, 'Balance_sheet_and_PL.pdf', -120);
    if (rand() < 0.4) addFile(c.id, `${fyNow}/TDS`, 'Form_27A_Q1.pdf', -80);
  }

  // --- Notes & reminders.
  const notes: Note[] = [
    { id: 'no_1', userId: 'u_rohan', title: 'Partner meeting agenda', body: '• Fee revision for retainer clients\n• Hiring 2 article assistants\n• Diwali bonus\n• Move to cloud practice software (this one!)', color: 'yellow', pinned: true, updatedAt: at(-1, 18) },
    { id: 'no_2', userId: 'u_rohan', title: 'Vardhan Steel — audit committee', body: 'Present draft report on 2nd Thursday. Ask Ananya for KAM write-up on inventory.', color: 'blue', pinned: false, clientId: 'c_vardhan', updatedAt: at(-3, 10) },
    { id: 'no_3', userId: 'u_rohan', title: 'Fee follow-ups', body: 'Coastal Hospitality — 2 invoices overdue. Call Rhea before month end.', color: 'pink', pinned: false, clientId: 'c_coastal', updatedAt: at(-2, 12) },
    { id: 'no_4', userId: 'u_priya', title: 'ITR checklist for salaried clients', body: '1. Form 16 Part A & B\n2. AIS/TIS\n3. Capital gains statements (all brokers)\n4. Rent receipts / home loan certificate', color: 'green', pinned: true, updatedAt: at(-6, 11) },
    { id: 'no_5', userId: 'u_priya', title: 'Rajesh — ESOP perquisite', body: 'FMV on exercise date from employer letter. Check TDS on perquisite in Form 16.', color: 'yellow', pinned: false, clientId: 'c_rajesh', updatedAt: at(-2, 15) },
    { id: 'no_6', userId: 'u_vikram', title: 'GST notice responses', body: 'Zenith ASMT-10: reconcile GSTR-1 vs 3B month-wise. Sunrise DRC-01A: Rule 36(4) workings.', color: 'blue', pinned: true, updatedAt: at(-1, 9) },
    { id: 'no_7', userId: 'u_arjun', title: 'Portal tip', body: 'Use the GSTR-2B Excel download (not JSON) for vendor-wise reconciliation.', color: 'slate', pinned: false, updatedAt: at(-8, 16) },
  ];
  const reminders: Reminder[] = [
    { id: 'rm_1', userId: 'u_rohan', title: 'Call Prakash Vardhan about audit timeline', dueAt: at(0, 16), clientId: 'c_vardhan', repeat: 'none', done: false },
    { id: 'rm_2', userId: 'u_rohan', title: 'Review WIP & unbilled report', dueAt: new Date(addDays(now, 1).setHours(10, 0, 0, 0)).toISOString(), repeat: 'weekly', done: false },
    { id: 'rm_3', userId: 'u_rohan', title: 'Renew professional indemnity insurance', dueAt: new Date(addDays(now, 9).setHours(11, 0, 0, 0)).toISOString(), repeat: 'none', done: false },
    { id: 'rm_4', userId: 'u_rohan', title: 'Approve October salaries', dueAt: at(-1, 12), repeat: 'monthly', done: true },
    { id: 'rm_5', userId: 'u_priya', title: 'Follow up Rajesh for ICICI statement', dueAt: new Date(addDays(now, 1).setHours(11, 0, 0, 0)).toISOString(), clientId: 'c_rajesh', repeat: 'none', done: false },
    { id: 'rm_6', userId: 'u_priya', title: 'Check AIS update for Dr. Meera', dueAt: at(-1, 15), clientId: 'c_meera', repeat: 'none', done: false },
    { id: 'rm_7', userId: 'u_vikram', title: 'Draft reply — Sunrise DRC-01A', dueAt: new Date(addDays(now, 2).setHours(12, 0, 0, 0)).toISOString(), clientId: 'c_sunrise', repeat: 'none', done: false },
    { id: 'rm_8', userId: 'u_arjun', title: 'Download GSTR-2B for all clients', dueAt: new Date(addDays(now, 3).setHours(10, 0, 0, 0)).toISOString(), repeat: 'monthly', done: false },
  ];

  return {
    services: SERVICES.map((s) => ({ ...s })),
    referrers: REFERRERS.map((r) => ({ ...r })),
    portals: PORTALS.map((p) => ({ ...p })),
    notes,
    reminders,
    notices,
    invoices,
    payments,
    dscs,
    docMovements,
    chats,
    broadcasts,
    drive,
  };
}
