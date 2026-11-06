import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DashboardStats } from '@/lib/api'
import { inrCompact } from '@/lib/format'

const tick = { fill: 'rgb(var(--muted))', fontSize: 12 }
const tip = {
  contentStyle: {
    background: 'rgb(var(--surface))',
    border: '1px solid rgb(var(--line))',
    borderRadius: 8,
    fontSize: 12,
    color: 'rgb(var(--fg))',
  },
  cursor: { fill: 'rgb(var(--sunken))' },
}

export function CollectionChart({ data }: { data: DashboardStats['months'] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} barGap={4}>
        <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
        <YAxis
          tick={tick}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => inrCompact(v)}
          width={64}
        />
        <Tooltip {...tip} formatter={(v: number, n: string) => [inrCompact(v), n]} />
        <Bar dataKey="billed" name="Billed" fill="rgb(var(--line-strong))" radius={[4, 4, 0, 0]} />
        <Bar dataKey="collected" name="Collected" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function SimpleBars({ data, x, y, money }: { data: object[]; x: string; y: string; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
        <XAxis dataKey={x} tick={tick} axisLine={false} tickLine={false} />
        <YAxis
          tick={tick}
          axisLine={false}
          tickLine={false}
          width={money ? 64 : 40}
          tickFormatter={(v: number) => (money ? inrCompact(v) : String(v))}
        />
        <Tooltip {...tip} formatter={(v: number) => [money ? inrCompact(v) : v, '']} />
        <Bar dataKey={y} fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
