import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('AMA board', () => {
  it('posts a new pseudonymous question', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /ask a question/i }))
    fireEvent.change(screen.getByPlaceholderText('What would you like to ask?'), { target: { value: 'Can we have a volunteering day?' } })
    fireEvent.click(screen.getByRole('button', { name: /post question/i }))
    expect(screen.getByText('Can we have a volunteering day?')).toBeInTheDocument()
    expect(screen.getAllByText('Helpful Heron').length).toBeGreaterThan(0)
  })

  it('opens presentation mode for a question', () => {
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /present/i })[1])
    expect(screen.getByRole('dialog', { name: 'Presentation mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /end presentation/i })).toBeInTheDocument()
  })
})
