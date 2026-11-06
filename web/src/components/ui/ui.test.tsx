import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Amount, Button, DataTable, Input } from '.'

describe('Amount', () => {
  it('renders Indian grouping with tabular numerals', () => {
    render(<Amount value={106600} />)
    const el = screen.getByText('₹1,06,600')
    expect(el).toHaveClass('tabular-nums')
  })
})

describe('Input', () => {
  it('connects the label and the error to the control', () => {
    render(<Input label="Mobile number" error="Enter a valid number" />)
    const input = screen.getByLabelText('Mobile number')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter a valid number')
  })
})

describe('Button', () => {
  it('does not fire while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Pay
      </Button>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('DataTable', () => {
  it('sorts when a sortable header is clicked', async () => {
    const rows = [
      { id: 'b', n: 2 },
      { id: 'a', n: 1 },
    ]
    render(
      <DataTable
        caption="t"
        rows={rows}
        rowKey={(r) => r.id}
        columns={[{ key: 'n', header: 'N', cell: (r) => r.n, sortValue: (r) => r.n }]}
      />,
    )
    await userEvent.click(screen.getAllByRole('button', { name: 'N' })[0])
    const cells = screen.getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['1', '2'])
  })
})
