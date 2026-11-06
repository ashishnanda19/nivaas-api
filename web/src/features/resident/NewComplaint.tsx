import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import type { Category } from '@/lib/api'
import { Badge, Button, Select, Textarea, toast } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { PhotoPicker } from '@/components/PhotoPicker'
import { useResident } from './hooks'

const CATS: Category[] = [
  'plumbing',
  'electrical',
  'lift',
  'security',
  'housekeeping',
  'parking',
  'noise',
  'other',
]

export default function NewComplaint() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { flatId } = useResident()
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState<Category | ''>('')
  const [photo, setPhoto] = useState<string>()
  const [err, setErr] = useState('')

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text.trim()), 500)
    return () => clearTimeout(id)
  }, [text])
  const suggestion = useQuery({
    queryKey: ['suggest', debounced],
    queryFn: () => api.suggest(debounced),
    enabled: debounced.length >= 10,
  })

  const submit = useMutation({
    mutationFn: () =>
      api.createComplaint({ flatId, text: text.trim(), category: category || undefined, photo }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['complaints'] })
      toast.success(t('complaints.raised'))
      nav(`/app/complaints/${c.id}`, { replace: true })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('common.errorTitle')),
  })

  const s = suggestion.data
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim().length < 10) return setErr(t('complaints.tooShort'))
        setErr('')
        submit.mutate()
      }}
      className="space-y-5"
    >
      <PageHeader title={t('complaints.new')} back />
      <Textarea
        label={t('complaints.describe')}
        placeholder={t('complaints.placeholder')}
        value={text}
        error={err}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium">
          {t('complaints.addPhoto')} <span className="font-normal text-muted">({t('common.optional')})</span>
        </p>
        <PhotoPicker
          value={photo}
          onChange={setPhoto}
          addLabel={t('complaints.addPhoto')}
          removeLabel={t('complaints.removePhoto')}
          tooBig={t('complaints.photoTooBig')}
        />
      </div>
      {s?.escalated && (
        <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2.5 text-sm font-medium text-danger">
          {t('complaints.escalated')}
        </p>
      )}
      <div className="space-y-2">
        <Select
          label={t('complaints.category')}
          optionalLabel={t('common.optional')}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | '')}
          disabled={s?.escalated}
        >
          <option value="">
            {s
              ? `${t('complaints.suggested')}: ${t(`complaints.cats.${s.category}`)}`
              : t('complaints.suggested')}
          </option>
          {CATS.map((c) => (
            <option key={c} value={c}>
              {t(`complaints.cats.${c}`)}
            </option>
          ))}
        </Select>
        {s && !s.escalated && (
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink" aria-hidden />
            {s.reason} <Badge tone="neutral">{t(`complaints.urgency.${s.urgency}`)}</Badge>
          </p>
        )}
      </div>
      <Button type="submit" block loading={submit.isPending}>
        {t('complaints.submit')}
      </Button>
    </form>
  )
}
