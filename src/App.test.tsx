import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

describe('AMA board', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    window.scrollTo = vi.fn()
  })

  it('shows a product landing page at the root', () => {
    render(<App />)
    expect(screen.getByText(/give every question/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AMA Board/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
  })

  it('posts a new pseudonymous question', () => {
    window.history.replaceState({}, '', '/boards/all-company')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /ask a question/i }))
    fireEvent.change(screen.getByPlaceholderText('What would you like to ask?'), { target: { value: 'Can we have a volunteering day?' } })
    fireEvent.click(screen.getByRole('button', { name: /post question/i }))
    expect(screen.getByText('Can we have a volunteering day?')).toBeInTheDocument()
    expect(screen.getAllByText('Helpful Heron').length).toBeGreaterThan(0)
  })

  it('opens presentation mode for a question', () => {
    window.history.replaceState({}, '', '/boards/all-company')
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /present/i })[1])
    expect(screen.getByRole('dialog', { name: 'Presentation mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /end presentation/i })).toBeInTheDocument()
  })

  it('opens settings for the current board', () => {
    window.history.replaceState({}, '', '/boards/all-company')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /board settings/i }))
    expect(screen.getByRole('heading', { name: /board settings/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/boards/all-company/settings')
  })

  it('opens the about page', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    expect(screen.getByRole('heading', { name: /honest questions/i })).toBeInTheDocument()
  })
})
