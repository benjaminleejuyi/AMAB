import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

describe('AMA board', () => {
  const idToken = `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, 'cognito:groups': ['Admins'] }))}.x`
  beforeEach(() => {
    vi.unstubAllGlobals()
    window.__AMA_BOARD_CONFIG__ = { appSyncEndpoint: 'https://appsync.example/graphql', appSyncApiKey: 'test-key' }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const query = JSON.parse(String(options.body)).query as string
      const question = { id: 'q1', boardId: 'all-company', body: 'What should we focus on?', authorDisplayName: 'Helpful Heron', category: 'Strategy', status: 'OPEN', upvotes: 4, downvotes: 0, comments: [], createdAt: new Date().toISOString() }
      const data = query.includes('query Board') ? { getBoard: { id: 'all-company', title: 'Ask the leadership team', description: 'Demo', visibility: 'PUBLIC', postingPolicy: 'ANYONE', votingMode: 'UP_DOWN', commentsEnabled: true, visibleVoteTotals: true, anonymousPosting: true, canModerate: Boolean(sessionStorage.getItem('ama-board-session')) } }
        : query.includes('query Questions') ? { listQuestions: { items: [question] } }
          : query.includes('mutation Post') ? { createQuestion: { ...question, id: 'new-question', body: JSON.parse(String(options.body)).variables.input.body } }
            : query.includes('mutation Present') ? { selectQuestion: { id: 'all-company', presentedQuestionId: 'q1' } }
              : query.includes('mutation OfficialReply') ? { addOfficialReply: { id: 'q1', status: 'ANSWERED', officialReply: { body: JSON.parse(String(options.body)).variables.input.body, authorDisplayName: 'admin@example.com', createdAt: new Date().toISOString() } } }
              : query.includes('query ListBoards') ? { listBoards: [] }
                : query.includes('query Org') ? { getOrganizationSettings: { organizationName: 'Anyhow Only', defaultVisibility: 'UNLISTED', defaultVotingMode: 'UP_DOWN', membersCanCreateBoards: false } }
                  : query.includes('query Me') ? { getMySettings: { userId: 'admin', defaultIdentity: 'ASK' } }
                    : {}
      return { ok: true, json: async () => ({ data }) }
    }))
    window.history.replaceState({}, '', '/')
    window.scrollTo = vi.fn()
    sessionStorage.clear()
  })
  afterEach(cleanup)

  it('shows a product landing page at the root', () => {
    render(<App />)
    expect(screen.getByText(/give every question/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AMA Board/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
  })

  it('posts a new pseudonymous question', async () => {
    window.history.replaceState({}, '', '/boards/all-company')
    render(<App />)
    await screen.findByText('What should we focus on?')
    fireEvent.click(screen.getByRole('button', { name: /ask a question/i }))
    fireEvent.change(screen.getByPlaceholderText('What would you like to ask?'), { target: { value: 'Can we have a volunteering day?' } })
    fireEvent.click(screen.getByRole('button', { name: /post question/i }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, options]) => {
      const request = JSON.parse(String(options?.body))
      return request.query.includes('mutation Post') && request.variables.input.body === 'Can we have a volunteering day?'
    })).toBe(true))
  })

  it('opens presentation mode for a question', async () => {
    window.history.replaceState({}, '', '/boards/all-company')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^present$/i }))
    expect(await screen.findByRole('dialog', { name: 'Presentation mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /end presentation/i })).toBeInTheDocument()
  })

  it('lets an administrator post a separate official reply and closes the question', async () => {
    window.history.replaceState({}, '', '/boards/all-company')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /official reply/i }))
    fireEvent.change(screen.getByPlaceholderText(/official response/i), { target: { value: 'Leadership has approved the proposal.' } })
    fireEvent.click(screen.getByRole('button', { name: /post reply and close/i }))
    expect(await screen.findByText('Leadership has approved the proposal.')).toBeInTheDocument()
    expect(screen.getByText(/this question is closed/i)).toBeInTheDocument()
  })

  it('offers configurable PDF export to administrators', async () => {
    window.history.replaceState({}, '', '/boards/all-company')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /export pdf/i }))
    expect(screen.getByRole('dialog', { name: /export official report/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Comments')).toBeChecked()
    expect(screen.getByLabelText('Upvotes and downvotes')).toBeChecked()
  })

  it('signs in through Cognito and opens a board', async () => {
    window.__AMA_BOARD_CONFIG__ = { region: 'ap-southeast-1', userPoolClientId: 'client-id' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ AuthenticationResult: { AccessToken: 'access', IdToken: idToken } }) }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••••••'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(window.location.pathname).toBe('/admin'))
  })

  it('explains and validates every permanent password requirement', async () => {
    window.__AMA_BOARD_CONFIG__ = { region: 'ap-southeast-1', userPoolClientId: 'client-id' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'challenge' }) }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /log in/i }))
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••••••'), { target: { value: 'temporary-password' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByText('At least 12 characters')).toBeInTheDocument()
    expect(screen.getByText('One uppercase letter')).toBeInTheDocument()
    expect(screen.getByText('One lowercase letter')).toBeInTheDocument()
    expect(screen.getByText('One number')).toBeInTheDocument()
    expect(screen.getByText('One symbol')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: /set password and sign in/i })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('New permanent password'), { target: { value: 'ValidPassword1!' } })
    fireEvent.change(screen.getByLabelText('Confirm permanent password'), { target: { value: 'different' } })
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(submit).toBeDisabled()
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
    fireEvent.click(screen.getByRole('button', { name: 'Moderators' }))
    expect(screen.getByRole('heading', { name: /board moderators/i })).toBeInTheDocument()
  })

  it('shows the signed-in account and site administration', () => {
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    expect(screen.queryByRole('button', { name: /log in/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /admin@example.com/i }))
    fireEvent.click(screen.getByRole('button', { name: /admin panel/i }))
    expect(screen.getByRole('heading', { name: 'Administration' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /welcome, admin@example.com/i })).toBeInTheDocument()
  })

  it('creates a board from the admin panel', async () => {
    window.history.replaceState({}, '', '/admin')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    window.__AMA_BOARD_CONFIG__ = { appSyncEndpoint: 'https://appsync.example/graphql' }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const query = JSON.parse(String(options.body)).query
      const data = query.includes('ListBoards') ? { listBoards: [] }
        : query.includes('query Org') ? { getOrganizationSettings: { organizationName: 'Anyhow Only', defaultVisibility: 'UNLISTED', defaultVotingMode: 'UP_DOWN', membersCanCreateBoards: false } }
          : query.includes('CreateBoard') ? { createBoard: { id: 'new-board', title: 'Product AMA' } }
            : query.includes('query Board') ? { getBoard: { id: 'new-board', title: 'Product AMA', description: '', visibility: 'UNLISTED', postingPolicy: 'ANYONE', votingMode: 'UP_DOWN', commentsEnabled: true, visibleVoteTotals: true, anonymousPosting: true } }
              : {}
      return { ok: true, json: async () => ({ data }) }
    }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /create board/i }))
    fireEvent.change(screen.getByPlaceholderText(/quarterly leadership/i), { target: { value: 'Product AMA' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create board' })[1])
    await waitFor(() => expect(window.location.pathname).toBe('/boards/new-board/settings'))
  })

  it('opens the about page', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    expect(screen.getByRole('heading', { name: /honest questions/i })).toBeInTheDocument()
  })
})
