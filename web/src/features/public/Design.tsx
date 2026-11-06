import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Amount,
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LanguageSwitcher,
  Modal,
  ProgressRing,
  Select,
  Sheet,
  Skeleton,
  Stat,
  StatusPill,
  Tabs,
  Textarea,
  Timeline,
  toast,
} from '@/components/ui'
import { useSession } from '@/app/store'

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-4 border-t border-line py-8">
    <h2 className="text-lg font-semibold">{title}</h2>
    {children}
  </section>
)

const TOKENS = [
  ['bg-bg border border-line', 'bg'],
  ['bg-sunken', 'sunken'],
  ['bg-line', 'line'],
  ['bg-fg', 'fg'],
  ['bg-muted', 'muted'],
  ['bg-accent', 'accent'],
  ['bg-accent-hover', 'accent-hover'],
  ['bg-accent-tint', 'accent-tint'],
  ['bg-success', 'success'],
  ['bg-warning', 'warning'],
  ['bg-danger', 'danger'],
]

/** Storybook-style catalogue of every shared component. Open /design. */
export default function Design() {
  const { theme, setTheme } = useSession()
  const [tab, setTab] = useState('a')
  const [sheet, setSheet] = useState(false)
  const [modal, setModal] = useState(false)
  const rows = [
    { id: 1, flat: 'T07-1203', bill: 7475 },
    { id: 2, flat: 'T12-0408', bill: 6370 },
    { id: 3, flat: 'T21-1601', bill: 106600 },
  ]
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-muted hover:text-fg">
            Nivaas
          </Link>
          <h1 className="text-3xl font-semibold">Design system</h1>
        </div>
        <Button variant="secondary" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Light' : 'Dark'} mode
        </Button>
      </header>

      <Section title="Colour tokens">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {TOKENS.map(([cls, n]) => (
            <div key={n}>
              <div className={`h-12 rounded-ctl ${cls}`} />
              <p className="mt-1 text-xs text-muted">{n}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Type and amounts">
        <p className="text-3xl font-semibold tracking-tight">Inter, tight and calm</p>
        <p className="text-muted">Amounts use tabular numerals and Indian grouping.</p>
        <div className="flex gap-6 text-xl font-semibold">
          {[7475, 106600, 1234567].map((n) => (
            <Amount key={n} value={n} />
          ))}
        </div>
        <p className="text-lg">देवनागरी पाठ लेआउट नहीं तोड़ता · मराठी मजकूर देखील</p>
      </Section>
      <Section title="Button">
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Guard size</Button>
        </div>
      </Section>
      <Section title="Input, Select, Textarea">
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Mobile number" placeholder="98000 00001" hint="We send a 6 digit code." />
          <Input label="With error" defaultValue="123" error="Enter a valid 10 digit mobile number." />
          <Select label="Category">
            <option>Plumbing</option>
            <option>Electrical</option>
          </Select>
          <Textarea label="Describe the problem" optionalLabel="optional" />
        </div>
      </Section>
      <Section title="Badge and StatusPill">
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            'paid',
            'due',
            'overdue',
            'new',
            'assigned',
            'in_progress',
            'resolved',
            'exact',
            'likely',
            'unclear',
          ].map((s) => (
            <StatusPill key={s} status={s} label={s.replace('_', ' ')} />
          ))}
        </div>
      </Section>
      <Section title="Card, Stat, ProgressRing, Avatar">
        <div className="grid items-center gap-4 sm:grid-cols-3">
          <Card className="p-5">
            <Stat label="Collected" value="₹1.62 Cr" hint="of ₹1.8 Cr billed" />
          </Card>
          <Card className="flex items-center justify-center p-5">
            <ProgressRing value={86} label="Collected" />
          </Card>
          <Card className="flex items-center gap-3 p-5">
            <Avatar name="Swati Joshi" />
            <Avatar name="Aamir Shaikh" size={48} />
          </Card>
        </div>
      </Section>
      <Section title="Tabs and LanguageSwitcher">
        <Tabs
          label="Demo"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'a', label: 'Bill' },
            { id: 'b', label: 'Ledger' },
            { id: 'c', label: 'Queue', badge: 4 },
          ]}
        />
        <div>
          <LanguageSwitcher />
        </div>
      </Section>
      <Section title="Sheet, Modal, Toast">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Open sheet
          </Button>
          <Button variant="secondary" onClick={() => setModal(true)}>
            Open modal
          </Button>
          <Button variant="secondary" onClick={() => toast.success('Payment received')}>
            Success toast
          </Button>
          <Button variant="secondary" onClick={() => toast.error('Could not save')}>
            Error toast
          </Button>
        </div>
        <Sheet
          open={sheet}
          onClose={() => setSheet(false)}
          title="Bottom sheet on mobile, drawer on desktop"
          footer={
            <Button block onClick={() => setSheet(false)}>
              Done
            </Button>
          }
        >
          <p className="text-sm text-muted">Esc closes. Focus is kept inside.</p>
        </Sheet>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="Confirm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(false)}>
                Cancel
              </Button>
              <Button onClick={() => setModal(false)}>Confirm</Button>
            </>
          }
        >
          <p className="text-sm text-muted">Modals are for confirmations only.</p>
        </Modal>
      </Section>
      <Section title="Skeleton, EmptyState, ErrorState">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="space-y-2 p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-10" />
            <Skeleton className="h-4 w-2/3" />
          </Card>
          <Card>
            <EmptyState
              title="No complaints here"
              body="When something needs fixing, tell us here."
              action={<Button>New complaint</Button>}
            />
          </Card>
          <Card>
            <ErrorState onRetry={() => toast.info('Retrying…')} />
          </Card>
        </div>
      </Section>
      <Section title="DataTable (cards below 768px)">
        <DataTable
          caption="Demo"
          rowKey={(r) => String(r.id)}
          rows={rows}
          columns={[
            { key: 'f', header: 'Flat', cell: (r) => r.flat, sortValue: (r) => r.flat },
            {
              key: 'b',
              header: 'Bill',
              cell: (r) => <Amount value={r.bill} />,
              sortValue: (r) => r.bill,
              className: 'text-right',
            },
          ]}
        />
      </Section>
      <Section title="Timeline">
        <Card className="max-w-xs p-4">
          <Timeline
            doneCount={3}
            steps={[
              { key: 'a', label: 'Raised', at: '5 Nov, 9:10 am' },
              { key: 'b', label: 'Assigned', at: '5 Nov, 9:22 am' },
              { key: 'c', label: 'In progress', at: '5 Nov, 11:00 am' },
              { key: 'd', label: 'Resolved' },
            ]}
          />
        </Card>
      </Section>
    </div>
  )
}
