import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { UserPlus } from 'lucide-react'
import { api } from '@/lib/api'
import type { MemberRole } from '@/lib/api'
import {
  Async,
  Avatar,
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Sheet,
  Skeleton,
  toast,
} from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useResident } from './hooks'

export default function Family() {
  const { t } = useTranslation()
  const { flatId, user } = useResident()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<MemberRole>('family')
  const [err, setErr] = useState('')
  const q = useQuery({ queryKey: ['members', flatId], queryFn: () => api.listMembers(flatId) })
  const invite = useMutation({
    mutationFn: () => api.inviteMember({ flatId, name: name.trim(), phone, role }),
    onSuccess: () => {
      toast.success(t('family.added'))
      setOpen(false)
      setName('')
      setPhone('')
      void qc.invalidateQueries({ queryKey: ['members'] })
    },
    onError: (e) => setErr(e instanceof Error ? e.message : t('common.errorTitle')),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.removeMember(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['members'] }),
  })
  const isOwner = user.memberRole === 'owner'
  return (
    <>
      <PageHeader
        title={t('family.title')}
        back
        action={
          isOwner || user.memberRole === 'family' ? (
            <Button
              onClick={() => {
                setErr('')
                setOpen(true)
              }}
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              {t('family.invite')}
            </Button>
          ) : undefined
        }
      />
      <Async
        query={q}
        skeleton={<Skeleton className="h-40" />}
        isEmpty={(d) => !d.length}
        empty={<EmptyState title={t('family.empty')} />}
      >
        {(list) => (
          <ul className="divide-y divide-line rounded-card border border-line">
            {list.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={m.name} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="text-xs tabular-nums text-muted">+91 {m.phone}</p>
                </div>
                <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'}>{t(`family.roles.${m.role}`)}</Badge>
                {isOwner && m.phone !== user.phone && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={remove.isPending && remove.variables === m.id}
                    onClick={() => remove.mutate(m.id)}
                  >
                    {t('family.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Async>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('family.invite')}
        closeLabel={t('common.close')}
        footer={
          <Button
            block
            loading={invite.isPending}
            disabled={!name.trim() || phone.length < 10}
            onClick={() => {
              setErr('')
              invite.mutate()
            }}
          >
            {t('family.invite')}
          </Button>
        }
      >
        <div className="space-y-4">
          <Input label={t('family.name')} value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label={t('family.phone')}
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={phone}
            error={err}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
          />
          <Select
            label={t('family.role')}
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
          >
            {(['family', 'tenant', 'owner'] as const).map((r) => (
              <option key={r} value={r}>
                {t(`family.roles.${r}`)}
              </option>
            ))}
          </Select>
        </div>
      </Sheet>
    </>
  )
}
