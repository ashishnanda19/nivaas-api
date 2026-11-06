import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Download } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/lib/api'
import type { Bill, PayMethod, Receipt } from '@/lib/api'
import { downloadFile } from '@/lib/csv'
import { fmtDate, inr, lateFeeNote } from '@/lib/format'
import { makePdf } from '@/lib/pdf'
import {
  Amount,
  Async,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Sheet,
  Skeleton,
  StatusPill,
  Tabs,
  toast,
} from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useResident } from './hooks'

export function downloadReceipt(r: Receipt) {
  const pdf = makePdf('Nivaas payment receipt', [
    `Receipt no: ${r.id}`,
    `Date: ${new Date(r.date).toLocaleString('en-IN')}`,
    `Flat: ${r.flatId}`,
    ...(r.residentName ? [`Resident: ${r.residentName}`] : []),
    '# Amount paid',
    `Rs. ${new Intl.NumberFormat('en-IN').format(r.amount)}`,
    `Method: ${r.method}`,
    `Reference: ${r.reference}`,
    '',
    'Test mode receipt. No real money was moved.',
  ])
  downloadFile(`receipt-${r.id}.pdf`, pdf, 'application/pdf')
}

function AnimatedCheck() {
  return (
    <motion.svg
      viewBox="0 0 52 52"
      className="h-20 w-20 text-success"
      initial="hidden"
      animate="show"
      aria-hidden
    >
      <motion.circle
        cx="26"
        cy="26"
        r="23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        variants={{ hidden: { pathLength: 0 }, show: { pathLength: 1 } }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
      <motion.path
        d="M15 27l8 8 14-16"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        variants={{ hidden: { pathLength: 0 }, show: { pathLength: 1 } }}
        transition={{ duration: 0.3, delay: 0.35, ease: 'easeOut' }}
      />
    </motion.svg>
  )
}

function PaymentSheet({ bill, open, onClose }: { bill: Bill; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [method, setMethod] = useState<PayMethod>('upi')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const pay = useMutation({
    mutationFn: () => api.payBill(bill.flatId, method),
    onSuccess: (r) => {
      setReceipt(r)
      void qc.invalidateQueries({ queryKey: ['bill'] })
      void qc.invalidateQueries({ queryKey: ['ledger'] })
      void qc.invalidateQueries({ queryKey: ['payments'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('common.errorTitle')),
  })
  const close = () => {
    onClose()
    setTimeout(() => {
      setReceipt(null)
      pay.reset()
    }, 250)
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={receipt ? t('pay.success') : t('pay.payNow', { amount: inr(bill.total) })}
      closeLabel={t('common.close')}
      footer={
        receipt ? (
          <div className="space-y-2">
            <Button block variant="secondary" onClick={() => downloadReceipt(receipt)}>
              <Download className="h-4 w-4" aria-hidden />
              {t('pay.receipt')}
            </Button>
            <Button block onClick={close}>
              {t('common.done')}
            </Button>
          </div>
        ) : (
          <Button block loading={pay.isPending} onClick={() => pay.mutate()}>
            {pay.isPending ? t('pay.processing') : t('pay.payNow', { amount: inr(bill.total) })}
          </Button>
        )
      }
    >
      {receipt ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AnimatedCheck />
          <p className="text-lg font-semibold">{t('pay.success')}</p>
          <Amount value={receipt.amount} className="text-3xl font-semibold" />
          <p className="text-sm text-muted">
            {receipt.method} · {receipt.reference}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="rounded-ctl bg-warning-tint px-3 py-2 text-sm text-warning">{t('pay.testMode')}</p>
          <div role="radiogroup" aria-label={t('pay.title')} className="grid grid-cols-3 gap-2">
            {(['upi', 'card', 'netbanking'] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={clsx(
                  'min-h-[48px] rounded-ctl border text-sm font-medium transition',
                  method === m ? 'border-accent bg-accent-tint text-ink' : 'border-line hover:bg-sunken',
                )}
              >
                {t(`pay.method.${m}`)}
              </button>
            ))}
          </div>
          {method === 'upi' && <Input label={t('pay.upiId')} defaultValue="test@upi" />}
          {method === 'card' && (
            <div className="space-y-3">
              <Input label={t('pay.cardNumber')} inputMode="numeric" defaultValue="4242 4242 4242 4242" />
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('pay.expiry')} defaultValue="12 / 30" />
                <Input label={t('pay.cvv')} inputMode="numeric" defaultValue="123" />
              </div>
            </div>
          )}
          {method === 'netbanking' && (
            <Select label={t('pay.bank')} defaultValue="hdfc">
              <option value="hdfc">HDFC Bank</option>
              <option value="sbi">State Bank of India</option>
              <option value="icici">ICICI Bank</option>
              <option value="axis">Axis Bank</option>
            </Select>
          )}
        </div>
      )}
    </Sheet>
  )
}

function BillTab({ flatId }: { flatId: string }) {
  const { t } = useTranslation()
  // The sheet lives outside Async: paying refetches the bill, which must not unmount the success screen.
  const [sheet, setSheet] = useState<{ bill: Bill; open: boolean } | null>(null)
  const q = useQuery({ queryKey: ['bill', flatId], queryFn: () => api.getBill(flatId) })
  return (
    <>
      <Async query={q} skeleton={<Skeleton className="h-64" />}>
        {(b) =>
          b.total <= 0 ? (
            <Card>
              <EmptyState title={t('pay.allPaidTitle')} body={t('pay.allPaidBody')} />
            </Card>
          ) : (
            <>
              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="font-medium">{b.monthLabel}</p>
                  <StatusPill
                    status={b.status}
                    label={
                      b.status === 'overdue'
                        ? t('home.overdueBy', { count: b.daysOverdue })
                        : t('home.dueOn', { date: fmtDate(b.dueDate, 'en', false) })
                    }
                  />
                </div>
                <dl className="space-y-3 text-sm">
                  <Row
                    label={t('pay.billed')}
                    sub={t('pay.areaRate', { area: b.area, rate: b.rate.toFixed(2) })}
                    value={<Amount value={b.billed} />}
                  />
                  {b.paid > 0 && <Row label={t('pay.alreadyPaid')} value={<Amount value={-b.paid} />} />}
                  {b.lateFee > 0 && (
                    <Row
                      label={t('pay.lateFee')}
                      sub={lateFeeNote(b.daysOverdue)}
                      value={<Amount value={b.lateFee} className="text-danger" />}
                    />
                  )}
                  <div className="flex items-baseline justify-between border-t border-line pt-3">
                    <dt className="font-medium">{t('pay.total')}</dt>
                    <dd>
                      <Amount value={b.total} className="text-2xl font-semibold" />
                    </dd>
                  </div>
                </dl>
              </Card>
              <Button block size="md" className="mt-4" onClick={() => setSheet({ bill: b, open: true })}>
                {t('pay.payNow', { amount: inr(b.total) })}
              </Button>
            </>
          )
        }
      </Async>
      {sheet && (
        <PaymentSheet
          bill={sheet.bill}
          open={sheet.open}
          onClose={() => setSheet((s) => s && { ...s, open: false })}
        />
      )}
    </>
  )
}

const Row = ({ label, sub, value }: { label: string; sub?: string; value: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-4">
    <dt>
      <span className="block">{label}</span>
      {sub && <span className="block text-xs text-muted">{sub}</span>}
    </dt>
    <dd>{value}</dd>
  </div>
)

function LedgerTab({ flatId }: { flatId: string }) {
  const { t, i18n } = useTranslation()
  const q = useQuery({ queryKey: ['ledger', flatId], queryFn: () => api.getLedger(flatId) })
  return (
    <Async
      query={q}
      skeleton={<Skeleton className="h-64" />}
      isEmpty={(d) => !d.length}
      empty={<EmptyState title={t('pay.noHistory')} />}
    >
      {(rows) => (
        <ul className="divide-y divide-line rounded-card border border-line">
          {rows.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">{e.desc}</p>
                <p className="text-xs text-muted">{fmtDate(e.date, i18n.language)}</p>
              </div>
              <div className="shrink-0 text-right">
                <Amount
                  value={e.credit > 0 ? e.credit : -e.debit}
                  className={e.credit > 0 ? 'text-success' : ''}
                />
                <p className="text-xs text-muted">
                  {t('pay.balance')} <Amount value={e.balance} />
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Async>
  )
}

function HistoryTab({ flatId }: { flatId: string }) {
  const { t, i18n } = useTranslation()
  const q = useQuery({ queryKey: ['payments', flatId], queryFn: () => api.getPayments(flatId) })
  return (
    <Async
      query={q}
      skeleton={<Skeleton className="h-48" />}
      isEmpty={(d) => !d.length}
      empty={<EmptyState title={t('pay.noHistory')} body={t('pay.noHistoryBody')} />}
    >
      {(rows) => (
        <ul className="divide-y divide-line rounded-card border border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <Amount value={r.amount} className="font-medium" />
                <p className="text-xs text-muted">
                  {t('pay.paidOn', { date: fmtDate(r.date, i18n.language) })} · {r.method}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => downloadReceipt(r)}
                aria-label={`${t('pay.receipt')} ${r.id}`}
              >
                <Download className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Async>
  )
}

export default function Pay() {
  const { t } = useTranslation()
  const { flatId } = useResident()
  const [tab, setTab] = useState<'bill' | 'ledger' | 'history'>('bill')
  return (
    <>
      <PageHeader title={t('pay.title')} />
      <div className="mb-4">
        <Tabs
          label={t('pay.title')}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'bill', label: t('pay.currentBill') },
            { id: 'ledger', label: t('pay.ledger') },
            { id: 'history', label: t('pay.history') },
          ]}
        />
      </div>
      {tab === 'bill' && <BillTab flatId={flatId} />}
      {tab === 'ledger' && <LedgerTab flatId={flatId} />}
      {tab === 'history' && <HistoryTab flatId={flatId} />}
    </>
  )
}
