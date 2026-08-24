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
      const question = { id: 'q1', boardId: 'all-company', body: 'What should we focus on?', authorDisplayName: 'Helpful Heron', category: 'Strategy', status: 'OPEN', upvotes: 4, downvotes: 0, comments: [{ id: 'c1', boardId: 'all-company', questionId: 'q1', authorDisplayName: 'Curious Otter', body: 'Please share the timeline.', createdAt: new Date().toISOString(), hidden: false }], createdAt: new Date().toISOString() }
      const data = query.includes('query Board(') ? { getBoard: { id: 'all-company', title: 'Ask the leadership team', description: 'Demo', visibility: 'PUBLIC', postingPolicy: 'ANYONE', votingMode: 'UP_DOWN', commentsEnabled: true, visibleVoteTotals: true, anonymousPosting: true, categories: ['Strategy', 'Product'] } }
        : query.includes('query BoardAccess') ? { getMyBoardAccess: { role: 'OWNER', canEditBoard: true, canModerateQuestions: true, canModerateComments: true, canPresent: true, canDeleteBoard: true } }
          : query.includes('query BoardMembers') ? { listBoardMembers: [{ boardId: 'all-company', userId: 'owner-1', email: 'admin@example.com', role: 'OWNER' }, { boardId: 'all-company', userId: 'moderator-1', email: 'moderator@example.com', role: 'MODERATOR' }] }
            : query.includes('query ModerationEvents') ? { listModerationEvents: [{ id: 'audit-1', boardId: 'all-company', actorId: 'owner-1', action: 'COMMENT_HIDDEN', targetType: 'COMMENT', targetId: 'c1', createdAt: new Date().toISOString() }] }
              : query.includes('mutation RemoveBoardMember') ? { removeBoardMember: true }
            : query.includes('query Questions') ? { listQuestions: { items: [question] } }
          : query.includes('mutation Post') ? { createQuestion: { ...question, id: 'new-question', body: JSON.parse(String(options.body)).variables.input.body } }
            : query.includes('mutation UpdateQuestion') ? { updateQuestion: { ...question, ...JSON.parse(String(options.body)).variables.input, status: JSON.parse(String(options.body)).variables.input.status || question.status, rank: new Date().toISOString() } }
              : query.includes('mutation ModerateComment') ? { setCommentVisibility: { id: 'c1', boardId: 'all-company', questionId: 'q1', hidden: JSON.parse(String(options.body)).variables.hidden } }
              : query.includes('mutation DeleteQuestion') ? { deleteQuestion: { ...question, deleted: true } }
            : query.includes('mutation Present') ? { selectQuestion: { id: 'all-company', presentedQuestionId: 'q1' } }
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

  it('keeps demo questions in the browser session without calling AppSync', async () => {
    window.history.replaceState({}, '', '/boards/demo')
    render(<App />)
    await screen.findByText(/most important outcomes/i)
    vi.mocked(fetch).mockClear()
    fireEvent.click(screen.getByRole('button', { name: /ask a question/i }))
    fireEvent.change(screen.getByPlaceholderText('What would you like to ask?'), { target: { value: 'Can we have a volunteering day?' } })
    fireEvent.click(screen.getByRole('button', { name: /post question/i }))
    expect(await screen.findByText('Can we have a volunteering day?')).toBeInTheDocument()
    expect(sessionStorage.getItem('ama-board-demo-v2')).toContain('Can we have a volunteering day?')
    expect(sessionStorage.getItem('ama-board-demo-pseudonym-v1')).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    expect(sessionStorage.getItem('ama-board-demo-v2')).not.toContain('Guest ')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('opens presentation mode for a question', async () => {
    window.history.replaceState({}, '', '/boards/demo')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /^present$/i }))[0])
    expect(await screen.findByRole('dialog', { name: 'Presentation mode' })).toBeInTheDocument()
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
    await waitFor(() => expect(window.location.pathname).toBe('/admin'))
  })

  it('opens settings for an authenticated administrator', async () => {
    window.history.replaceState({}, '', '/boards/real-board')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /board settings/i }))
    expect(screen.getByRole('heading', { name: /board settings/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/boards/real-board/settings')
    fireEvent.click(screen.getByRole('button', { name: 'Participation' }))
    expect(screen.getByRole('heading', { name: /access and participation/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Moderators' }))
    expect(screen.getByRole('heading', { name: /board members/i })).toBeInTheDocument()
    expect(await screen.findByText('moderator@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('moderator@example.com')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
    expect(await screen.findByText('comment hidden')).toBeInTheDocument()
  })

  it('allows an administrator to edit a persisted question', async () => {
    window.history.replaceState({}, '', '/boards/real-board')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    await screen.findByText('What should we focus on?')
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    const dialog = screen.getByRole('dialog', { name: /edit question/i })
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: 'What is the updated priority?' } })
    expect(screen.getByDisplayValue('What is the updated priority?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, options]) => String(options?.body).includes('mutation UpdateQuestion'))).toBe(true))
    expect(await screen.findByText('What is the updated priority?')).toBeInTheDocument()
  })

  it('hides archived questions by default and lets administrators filter and restore them', async () => {
    window.history.replaceState({}, '', '/boards/real-board')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    await screen.findByText('What should we focus on?')
    fireEvent.click(screen.getByRole('button', { name: /^archive$/i }))
    await waitFor(() => expect(screen.queryByText('What should we focus on?')).not.toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/view:/i), { target: { value: 'Archived' } })
    expect(await screen.findByText('What should we focus on?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^restore$/i })).toBeInTheDocument()
  })

  it('uses an in-app confirmation dialog before deleting a question', async () => {
    window.history.replaceState({}, '', '/boards/real-board')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    await screen.findByText('What should we focus on?')
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(screen.getByRole('alertdialog', { name: /delete this question/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /delete question/i }))
    await waitFor(() => expect(screen.queryByText('What should we focus on?')).not.toBeInTheDocument())
  })

  it('allows an administrator to hide and restore a comment', async () => {
    window.history.replaceState({}, '', '/boards/real-board')
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    await screen.findByText('What should we focus on?')
    fireEvent.click(screen.getByRole('button', { name: /1 comment/i }))
    expect(screen.getByText('Please share the timeline.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(await screen.findByText('Hidden from participants')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => String(options?.body).includes('mutation ModerateComment'))).toBe(true)
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

  it('opens the browser-only demo without another login', () => {
    sessionStorage.setItem('ama-board-session', JSON.stringify({ accessToken: 'access', idToken, email: 'admin@example.com', groups: ['Admins'] }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /explore the interactive demo/i }))
    expect(window.location.pathname).toBe('/boards/demo')
    expect(screen.queryByRole('dialog', { name: /welcome back/i })).not.toBeInTheDocument()
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
            : query.includes('query Board(') ? { getBoard: { id: 'new-board', title: 'Product AMA', description: '', visibility: 'UNLISTED', postingPolicy: 'ANYONE', votingMode: 'UP_DOWN', commentsEnabled: true, visibleVoteTotals: true, anonymousPosting: true, categories: ['General'] } }
              : query.includes('query BoardMembers') ? { listBoardMembers: [] }
                : query.includes('query ModerationEvents') ? { listModerationEvents: [] }
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
