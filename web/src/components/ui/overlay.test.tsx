import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Modal, Sheet } from '.'

// A form in a sheet re-renders on every keystroke and passes a new onClose each time. That must not move the focus.
function Form({ kind }: { kind: 'sheet' | 'modal' }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const body = (
    <>
      <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
    </>
  )
  return kind === 'sheet' ? (
    <Sheet open onClose={() => setName('')} title="Invite">{body}</Sheet>
  ) : (
    <Modal open onClose={() => setName('')} title="Invite">{body}</Modal>
  )
}

describe.each(['sheet', 'modal'] as const)('a form inside a %s', (kind) => {
  beforeAll(() => {
    // The sheet picks a layout from a media query, which the test browser does not implement.
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  })
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('keeps the cursor in the field being typed in, past the first keystroke', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Form kind={kind} />)
    await act(async () => { vi.advanceTimersByTime(100) }) // the dialog focuses its first field when it opens
    expect(screen.getByLabelText('Name')).toHaveFocus()
    const phone = screen.getByLabelText('Phone')
    await user.click(phone)
    await user.keyboard('9876543210')
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(phone).toHaveValue('9876543210')
    expect(phone).toHaveFocus()
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })
})
