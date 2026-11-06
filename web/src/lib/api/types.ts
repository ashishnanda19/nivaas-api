export type Role = 'resident' | 'helpdesk' | 'committee' | 'guard'
export type MemberRole = 'owner' | 'family' | 'tenant'

export interface User {
  id: string
  name: string
  phone: string
  role: Role
  flatId?: string
  memberRole?: MemberRole
  title?: string
  /** Reported by a real backend. Absent for the demo logins. */
  consent?: boolean
}

export interface Flat {
  id: string // T07-1203
  tower: number
  area: number
  residentName: string
  tenant: boolean
  billed: number
  paid: number
  credit: number
  daysOverdue: number
  upiIds: string[]
}

export type BillStatus = 'paid' | 'due' | 'overdue' | 'partial'
export interface Bill {
  flatId: string
  monthLabel: string
  area: number
  rate: number
  billed: number
  paid: number
  outstanding: number
  lateFee: number
  total: number
  dueDate: string
  daysOverdue: number
  status: BillStatus
}

export interface LedgerEntry {
  id: string
  flatId: string
  date: string
  kind: 'bill' | 'payment' | 'late_fee'
  desc: string
  debit: number
  credit: number
  balance: number
}

export interface Receipt {
  id: string
  flatId: string
  date: string
  amount: number
  method: string
  reference: string
  residentName: string
}

export type ComplaintStatus = 'new' | 'assigned' | 'in_progress' | 'resolved'
export type Urgency = 'low' | 'normal' | 'high' | 'urgent'
export type Category =
  'plumbing' | 'electrical' | 'lift' | 'security' | 'housekeeping' | 'safety' | 'parking' | 'noise' | 'other'

export interface Comment {
  id: string
  by: string
  staff: boolean
  text: string
  at: string
}
export type TimelineStep = 'raised' | 'assigned' | 'in_progress' | 'resolved'

export interface Complaint {
  id: string
  flatId: string
  residentName: string
  text: string
  category: Category
  urgency: Urgency
  status: ComplaintStatus
  createdAt: string
  dueAt: string
  assignee?: string
  comments: Comment[]
  photo?: string
  clusterId?: string
  escalated: boolean
  aiCategory: Category
  aiUrgency: Urgency
  aiReason: string
  rating?: number
  reopened: number
  resolvedAt?: string
  timeline: { step: TimelineStep; at: string }[]
}

export interface Classification {
  category: Category
  urgency: Urgency
  reason: string
  escalated: boolean
}

export type VisitorStatus = 'waiting' | 'approved' | 'denied'
export interface Visitor {
  id: string
  gateId: string
  flatId: string
  name: string
  phone: string
  purpose: string
  photo?: string
  createdAt: string
  status: VisitorStatus
  source: 'guard' | 'code'
  decidedAt?: string
}
export interface PreApproval {
  id: string
  flatId: string
  name: string
  date: string
  code: string
  used: boolean
}

export interface Amenity {
  id: string
  name: string
  fee: number
  feeNote: string
  rules: string[]
  slots: string[]
}
export interface Booking {
  id: string
  amenityId: string
  amenityName: string
  flatId: string
  date: string
  slot: string
  fee: number
  status: 'confirmed' | 'cancelled'
}

export interface Notice {
  id: string
  title: string
  body: string
  at: string
}
export interface Member {
  id: string
  flatId: string
  name: string
  phone: string
  role: MemberRole
}
export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  target: string
  detail: string
}
export type ReminderKind = 'BEFORE_DUE' | 'ON_DUE' | 'OVERDUE'
export interface ReminderLog {
  id: string
  flatId: string
  period: string
  kind: ReminderKind
  language: string
  phone: string
  message: string
  status: 'SENT' | 'FAILED' | 'SKIPPED'
  at: string
}
export interface ReminderRun {
  checked: number
  sent: number
  failed: number
  skipped: number
  held: number
}
export interface Staff {
  id: string
  name: string
  skills: Category[]
}

export type PayMethod = 'upi' | 'card' | 'netbanking'

export interface FlatForMatch {
  id: string
  billed: number
  outstanding: number
  lateFee: number
  upiIds: string[]
  name: string
}
export interface StatementPosting {
  /** Set when the row came from the server, so posting targets the stored row. */
  rowId?: string
  allowDuplicate?: boolean
  flatId: string
  amount: number
  reference: string
  date: string
  upi: string
}

export interface DashboardStats {
  months: { label: string; billed: number; collected: number }[]
  collectedPct: number
  onTimePct: number
  ageing: { bucket: string; amount: number }[]
  towers: { tower: string; dues: number; flats: number }[]
  complaintsByWeek: { week: string; count: number }[]
  avgResponseH: number
  avgResolutionH: number
  reopenedPct: number
  /** How much of the statement work needs no hand matching: rows that qualify for one-click posting. */
  matching: { rows: number; oneClickPct: number; avgMinutesToPost: number | null }
  billedTotal: number
  collectedTotal: number
}
export interface BillRunPreview {
  month: string
  rate: number
  flats: number
  total: number
  rows: { flatId: string; name: string; area: number; amount: number }[]
}
