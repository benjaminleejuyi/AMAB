import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

describe('AMA board', () => {
  const idToken = `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, email: 'admin@example.com', 'cognito:groups': ['Admins'] }))}.x`
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    window.scrollTo = vi.fn()
    sessionStorage.clear()
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

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

  it('signs in through Cognito and opens a board', async () => {
    window.__AMA_BOARD_CONFIG__ = { region: 'ap-southeast-1', userPoolClientId: 'client-id' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ AuthenticationResult: { AccessToken: 'access', IdToken: idToken } }) }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••••••'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(window.location.pathname).toBe('/settings'))
  })

  it('opens settings for an authenticated administrator', () => {
    window.history.replaceState({}, '', '/boards/all-company')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /board settings/i }))
    expect(screen.getByRole('heading', { name: /board settings/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/boards/all-company/settings')
    fireEvent.click(screen.getByRole('button', { name: 'Participation' }))
    expect(screen.getByRole('heading', { name: /access and participation/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    expect(screen.getByRole('heading', { name: /board team/i })).toBeInTheDocument()
  })

  it('shows account settings with an administrator-only tab', () => {
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    expect(screen.queryByRole('button', { name: /log in/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /account/i }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Administration' }))
    expect(screen.getByRole('heading', { name: /organisation administration/i })).toBeInTheDocument()
  })

  it('does not expose administration to a regular member', () => {
    const memberToken = `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, email: 'member@example.com', 'cognito:groups': ['Users'] }))}.x`
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken: memberToken, email: 'member@example.com', groups: ['Users'] }))
    window.history.replaceState({}, '', '/settings')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument()
  })

  it('opens the about page', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    expect(screen.getByRole('heading', { name: /honest questions/i })).toBeInTheDocument()
  })
})
