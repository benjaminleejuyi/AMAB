export interface AppConfig {
  region?: string
  userPoolId?: string
  userPoolClientId?: string
  appSyncEndpoint?: string
  appSyncApiKey?: string
}

export interface AuthSession {
  accessToken: string
  idToken: string
  refreshToken?: string
  email: string
  groups: string[]
}

declare global {
  interface Window { __AMA_BOARD_CONFIG__?: AppConfig }
}

export const appConfig = (): AppConfig => window.__AMA_BOARD_CONFIG__ ?? {}
const tokenPayload = (token: string) => JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
const tokenGroups = (token: string): string[] => tokenPayload(token)['cognito:groups'] ?? []
const participantId = () => {
  let id = localStorage.getItem('ama-board-participant')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('ama-board-participant', id) }
  return id
}

async function graphQL<T>(query: string, variables: Record<string, unknown>, idToken?: string): Promise<T> {
  const config = appConfig()
  if (!config.appSyncEndpoint) throw new Error('AppSync has not been configured for this deployment.')
  const authorization: Record<string, string> = idToken ? { Authorization: idToken } : config.appSyncApiKey ? { 'x-api-key': config.appSyncApiKey } : {}
  const response = await fetch(config.appSyncEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-participant-id': participantId(), ...authorization },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await response.json()
  if (!response.ok || payload.errors) throw new Error(payload.errors?.[0]?.message || 'The request could not be completed.')
  return payload.data
}

export class NewPasswordRequiredError extends Error {
  constructor(public challengeSession: string) { super('Choose a permanent password to finish setting up your account.') }
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const config = appConfig()
  if (!config.region || !config.userPoolClientId) throw new Error('Cognito has not been configured for this deployment.')
  const response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: config.userPoolClientId, AuthParameters: { USERNAME: email, PASSWORD: password } }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.message || 'Sign-in failed.')
  if (payload.ChallengeName === 'NEW_PASSWORD_REQUIRED') throw new NewPasswordRequiredError(payload.Session)
  const result = payload.AuthenticationResult
  const session = { accessToken: result.AccessToken, idToken: result.IdToken, refreshToken: result.RefreshToken, email, groups: tokenGroups(result.IdToken) }
  sessionStorage.setItem('ama-board-session', JSON.stringify(session))
  return session
}

export async function completeNewPassword(email: string, password: string, challengeSession: string): Promise<AuthSession> {
  const config = appConfig()
  if (!config.region || !config.userPoolClientId) throw new Error('Cognito has not been configured for this deployment.')
  const response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge' },
    body: JSON.stringify({ ChallengeName: 'NEW_PASSWORD_REQUIRED', ClientId: config.userPoolClientId, Session: challengeSession, ChallengeResponses: { USERNAME: email, NEW_PASSWORD: password } }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.message || 'Password setup failed.')
  const result = payload.AuthenticationResult
  const session = { accessToken: result.AccessToken, idToken: result.IdToken, refreshToken: result.RefreshToken, email, groups: tokenGroups(result.IdToken) }
  sessionStorage.setItem('ama-board-session', JSON.stringify(session))
  return session
}

export function readSession(): AuthSession | null {
  try {
    const session: AuthSession | null = JSON.parse(sessionStorage.getItem('ama-board-session') || 'null')
    if (!session) return null
    const payload = tokenPayload(session.idToken)
    if (payload.exp * 1000 <= Date.now()) { signOut(); return null }
    session.groups = payload['cognito:groups'] ?? []
    return session
  }
  catch { return null }
}

export function signOut() { sessionStorage.removeItem('ama-board-session') }

export async function inviteUser(boardId: string, email: string, idToken: string) {
  const config = appConfig()
  if (!config.appSyncEndpoint) throw new Error('AppSync has not been configured for this deployment.')
  const response = await fetch(config.appSyncEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: idToken },
    body: JSON.stringify({ query: 'mutation Invite($boardId: ID!, $email: AWSEmail!) { inviteUser(boardId: $boardId, email: $email) { boardId userId role } }', variables: { boardId, email } }),
  })
  const payload = await response.json()
  if (!response.ok || payload.errors) throw new Error(payload.errors?.[0]?.message || 'Could not invite user.')
  return payload.data.inviteUser
}

export async function createBoard(title: string, description: string, idToken: string) {
  const data = await graphQL<{ createBoard: BoardSummary }>('mutation CreateBoard($input: CreateBoardInput!) { createBoard(input: $input) { id title description visibility postingPolicy votingMode } }', { input: { title, description, postingPolicy: 'ANYONE', commentsEnabled: true } }, idToken)
  return data.createBoard
}

export interface BoardSummary { id: string, title: string, description?: string, visibility: string }

export async function listBoards(idToken: string): Promise<BoardSummary[]> {
  const data = await graphQL<{ listBoards: BoardSummary[] }>('query ListBoards { listBoards { id title description visibility } }', {}, idToken)
  return data.listBoards
}

export interface PersistedComment { id: string, boardId?: string, questionId?: string, authorDisplayName: string, body: string, createdAt: string }
export interface PersistedQuestion { id: string, boardId: string, body: string, authorDisplayName: string, category: string, status: string, rank: string, upvotes: number, downvotes: number, comments: PersistedComment[], createdAt: string, updatedAt?: string, deleted?: boolean }
export interface PersistedBoard { id: string, boardId?: string, title: string, description?: string, visibility: string, postingPolicy: string, votingMode: string, commentsEnabled: boolean, visibleVoteTotals: boolean, anonymousPosting: boolean, categories: string[], presentedQuestionId?: string }

export const getBoard = async (id: string, token?: string) => (await graphQL<{ getBoard: PersistedBoard }>('query Board($id: ID!) { getBoard(id: $id) { id title description visibility postingPolicy votingMode commentsEnabled visibleVoteTotals anonymousPosting categories presentedQuestionId } }', { id }, token)).getBoard
const questionFields = 'id boardId body authorDisplayName category status rank upvotes downvotes createdAt updatedAt deleted comments { id boardId authorDisplayName body createdAt questionId }'
export const getQuestions = async (boardId: string, token?: string) => (await graphQL<{ listQuestions: { items: PersistedQuestion[] } }>(`query Questions($boardId: ID!) { listQuestions(boardId: $boardId) { items { ${questionFields} } } }`, { boardId }, token)).listQuestions.items
export const postQuestion = async (boardId: string, body: string, category: string, token?: string, identifyAs?: string) => (await graphQL<{ createQuestion: PersistedQuestion }>(`mutation Post($input: CreateQuestionInput!) { createQuestion(input: $input) { ${questionFields} } }`, { input: { boardId, body, category, identifyAs } }, token)).createQuestion
export const voteQuestion = async (boardId: string, questionId: string, value: number, token?: string) => (await graphQL<{ castVote: PersistedQuestion }>(`mutation Vote($input: CastVoteInput!) { castVote(input: $input) { ${questionFields} } }`, { input: { boardId, questionId, value } }, token)).castVote
export const commentOnQuestion = async (boardId: string, questionId: string, body: string, token?: string) => (await graphQL<{ addComment: PersistedComment }>('mutation Comment($input: AddCommentInput!) { addComment(input: $input) { id boardId questionId authorDisplayName body createdAt } }', { input: { boardId, questionId, body } }, token)).addComment
export const updateQuestion = async (input: Record<string, unknown>, token: string) => (await graphQL<{ updateQuestion: PersistedQuestion }>(`mutation UpdateQuestion($input: UpdateQuestionInput!) { updateQuestion(input: $input) { ${questionFields} } }`, { input }, token)).updateQuestion
export const deleteQuestion = async (boardId: string, questionId: string, token: string) => (await graphQL<{ deleteQuestion: PersistedQuestion }>(`mutation DeleteQuestion($boardId: ID!, $questionId: ID!) { deleteQuestion(boardId: $boardId, questionId: $questionId) { ${questionFields} } }`, { boardId, questionId }, token)).deleteQuestion
export const reorderQuestions = async (boardId: string, questionIds: string[], token: string) => (await graphQL<{ reorderQuestions: PersistedQuestion[] }>(`mutation ReorderQuestions($boardId: ID!, $questionIds: [ID!]!) { reorderQuestions(boardId: $boardId, questionIds: $questionIds) { ${questionFields} } }`, { boardId, questionIds }, token)).reorderQuestions
export const presentQuestion = async (boardId: string, questionId: string | null, token: string) => (await graphQL<{ selectQuestion: PersistedBoard }>('mutation Present($boardId: ID!, $questionId: ID) { selectQuestion(boardId: $boardId, questionId: $questionId) { id boardId presentedQuestionId } }', { boardId, questionId }, token)).selectQuestion
export const saveBoard = async (input: Record<string, unknown>, token: string) => (await graphQL<{ updateBoard: PersistedBoard }>('mutation SaveBoard($input: UpdateBoardInput!) { updateBoard(input: $input) { id title description visibility postingPolicy votingMode commentsEnabled visibleVoteTotals anonymousPosting categories } }', { input }, token)).updateBoard
export const deleteBoard = async (id: string, token: string) => (await graphQL<{ deleteBoard: boolean }>('mutation DeleteBoard($id: ID!) { deleteBoard(id: $id) }', { id }, token)).deleteBoard
export const getOrganizationSettings = async (token: string) => (await graphQL<{ getOrganizationSettings: Record<string, unknown> }>('query Org { getOrganizationSettings { organizationName defaultVisibility defaultVotingMode membersCanCreateBoards } }', {}, token)).getOrganizationSettings
export const saveOrganizationSettings = async (input: Record<string, unknown>, token: string) => (await graphQL<{ updateOrganizationSettings: Record<string, unknown> }>('mutation Org($input: UpdateOrganizationSettingsInput!) { updateOrganizationSettings(input: $input) { organizationName defaultVisibility defaultVotingMode membersCanCreateBoards } }', { input }, token)).updateOrganizationSettings
export const getMySettings = async (token: string) => (await graphQL<{ getMySettings: { defaultIdentity: string } }>('query Me { getMySettings { userId defaultIdentity } }', {}, token)).getMySettings
export const saveMySettings = async (defaultIdentity: string, token: string) => (await graphQL<{ updateMySettings: { defaultIdentity: string } }>('mutation Me($input: UpdateUserSettingsInput!) { updateMySettings(input: $input) { userId defaultIdentity } }', { input: { defaultIdentity } }, token)).updateMySettings

export async function activeIdToken(session: AuthSession): Promise<string> {
  if (tokenPayload(session.idToken).exp * 1000 > Date.now() + 60_000) return session.idToken
  const config = appConfig()
  if (!session.refreshToken || !config.region || !config.userPoolClientId) return session.idToken
  const response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
    method: 'POST', headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: config.userPoolClientId, AuthParameters: { REFRESH_TOKEN: session.refreshToken } }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.message || 'Session refresh failed.')
  const refreshed = { ...session, accessToken: payload.AuthenticationResult.AccessToken, idToken: payload.AuthenticationResult.IdToken, groups: tokenGroups(payload.AuthenticationResult.IdToken) }
  sessionStorage.setItem('ama-board-session', JSON.stringify(refreshed))
  return refreshed.idToken
}

export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
export interface BoardRealtimeHandlers {
  question: (question: PersistedQuestion) => void
  comment: (comment: PersistedComment & { boardId: string, questionId: string }) => void
  presentation: (board: { id: string, boardId: string, presentedQuestionId?: string }) => void
  reordered: (questions: PersistedQuestion[]) => void
  status: (status: RealtimeStatus) => void
  resync: () => void
}

// AppSync expects the websocket query parameters to contain ordinary padded
// base64, URL-escaped as a query-string value. Removing the padding (or placing
// raw `+`, `/` and `=` characters in the URL) can make AppSync reject the
// handshake with "Request headers are invalid" before connection_ack.
const websocketParameter = (value: string) => encodeURIComponent(btoa(value))

export function subscribeToBoard(boardId: string, tokenProvider: () => Promise<string | undefined>, handlers: BoardRealtimeHandlers) {
  const config = appConfig()
  if (!config.appSyncEndpoint || typeof WebSocket === 'undefined') { handlers.status('disconnected'); return () => undefined }
  let socket: WebSocket | undefined
  let disposed = false
  let attempts = 0
  let reconnectTimer = 0
  let watchdogTimer = 0
  let tokenTimer = 0
  let connectedOnce = false
  const subscriptions = [
    ['question', `subscription QuestionChanged($boardId: ID!) { questionChanged(boardId: $boardId) { ${questionFields} } }`],
    ['comment', 'subscription CommentAdded($boardId: ID!) { commentAdded(boardId: $boardId) { id boardId questionId authorDisplayName body createdAt } }'],
    ['presentation', 'subscription PresentationChanged($boardId: ID!) { presentationChanged(boardId: $boardId) { id boardId presentedQuestionId } }'],
    ['reordered', `subscription QuestionsReordered($boardId: ID!) { questionsReordered(boardId: $boardId) { ${questionFields} } }`],
  ] as const
  const clearTimers = () => { window.clearTimeout(reconnectTimer); window.clearTimeout(watchdogTimer); window.clearTimeout(tokenTimer) }
  const scheduleWatchdog = () => { window.clearTimeout(watchdogTimer); watchdogTimer = window.setTimeout(() => socket?.close(4000, 'Heartbeat timeout'), 90_000) }
  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return
    handlers.status('reconnecting')
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5)) + Math.floor(Math.random() * 500)
    reconnectTimer = window.setTimeout(() => { reconnectTimer = 0; connect() }, delay)
  }
  const connect = async () => {
    if (disposed || !config.appSyncEndpoint || !navigator.onLine) { if (!disposed) handlers.status('disconnected'); return }
    handlers.status(attempts ? 'reconnecting' : 'connecting')
    try {
      const token = (await tokenProvider())?.trim()
      const endpoint = new URL(config.appSyncEndpoint.trim())
      const apiKey = config.appSyncApiKey?.trim()
      const authorization: Record<string, string> = token ? { host: endpoint.host, Authorization: token } : apiKey ? { host: endpoint.host, 'x-api-key': apiKey } : { host: endpoint.host }
      const realtimeHost = endpoint.host.replace('appsync-api', 'appsync-realtime-api')
      const url = `wss://${realtimeHost}${endpoint.pathname}?header=${websocketParameter(JSON.stringify(authorization))}&payload=${websocketParameter('{}')}`
      socket = new WebSocket(url, 'graphql-ws')
      socket.onopen = () => { socket?.send(JSON.stringify({ type: 'connection_init' })); scheduleWatchdog() }
      socket.onmessage = event => {
        scheduleWatchdog()
        let message
        try { message = JSON.parse(String(event.data)) }
        catch { handlers.status('error'); socket?.close(4003, 'Invalid realtime message'); return }
        if (message.type === 'connection_ack') {
          subscriptions.forEach(([id, query]) => socket?.send(JSON.stringify({ id, type: 'start', payload: { data: JSON.stringify({ query, variables: { boardId } }), extensions: { authorization } } })))
          attempts = 0; handlers.status('connected')
          if (connectedOnce) handlers.resync()
          connectedOnce = true
          if (token) { const expiresIn = Math.max(30_000, tokenPayload(token).exp * 1000 - Date.now() - 60_000); tokenTimer = window.setTimeout(() => socket?.close(4001, 'Refreshing credentials'), expiresIn) }
        } else if (message.type === 'data') {
          const data = message.payload?.data
          if (data?.questionChanged) handlers.question(data.questionChanged)
          if (data?.commentAdded) handlers.comment(data.commentAdded)
          if (data?.presentationChanged) handlers.presentation(data.presentationChanged)
          if (data?.questionsReordered) handlers.reordered(data.questionsReordered)
        } else if (message.type === 'connection_error') {
          console.error('AppSync realtime connection rejected:', message.payload)
          handlers.status('error'); socket?.close(4006, 'AppSync rejected realtime authentication')
        } else if (message.type === 'error') { handlers.status('error'); socket?.close(4004, 'Subscription error') }
      }
      socket.onerror = () => { handlers.status('error'); socket?.close(4005, 'WebSocket error') }
      socket.onclose = () => { clearTimers(); if (!disposed) scheduleReconnect() }
    } catch { handlers.status('error'); scheduleReconnect() }
  }
  const online = () => { if (!socket || socket.readyState === WebSocket.CLOSED) connect() }
  const offline = () => { handlers.status('disconnected'); socket?.close(4002, 'Browser offline') }
  const visibility = () => { if (document.visibilityState === 'visible' && (!socket || socket.readyState === WebSocket.CLOSED)) connect() }
  window.addEventListener('online', online); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', visibility)
  connect()
  return () => { disposed = true; clearTimers(); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visibility); socket?.close(1000, 'Board closed'); handlers.status('disconnected') }
}
