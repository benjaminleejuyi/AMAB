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

export interface PersistedComment { id: string, authorDisplayName: string, body: string, createdAt: string }
export interface PersistedOfficialReply { body: string, authorDisplayName: string, createdAt: string }
export interface PersistedQuestion { id: string, boardId: string, body: string, authorDisplayName: string, category: string, status: string, upvotes: number, downvotes: number, comments: PersistedComment[], officialReply?: PersistedOfficialReply, createdAt: string }
export interface PersistedBoard { id: string, title: string, description?: string, visibility: string, postingPolicy: string, votingMode: string, commentsEnabled: boolean, visibleVoteTotals: boolean, anonymousPosting: boolean, categories: string[], canModerate: boolean, presentedQuestionId?: string }

export const getBoard = async (id: string, token?: string) => (await graphQL<{ getBoard: PersistedBoard }>('query Board($id: ID!) { getBoard(id: $id) { id title description visibility postingPolicy votingMode commentsEnabled visibleVoteTotals anonymousPosting categories canModerate presentedQuestionId } }', { id }, token)).getBoard
export const getQuestions = async (boardId: string, token?: string) => (await graphQL<{ listQuestions: { items: PersistedQuestion[] } }>('query Questions($boardId: ID!) { listQuestions(boardId: $boardId) { items { id boardId body authorDisplayName category status upvotes downvotes createdAt comments { id authorDisplayName body createdAt questionId } officialReply { body authorDisplayName createdAt } } } }', { boardId }, token)).listQuestions.items
export const postQuestion = async (boardId: string, body: string, category: string, token?: string) => (await graphQL<{ createQuestion: PersistedQuestion }>('mutation Post($input: CreateQuestionInput!) { createQuestion(input: $input) { id boardId body authorDisplayName category status upvotes downvotes createdAt comments { id authorDisplayName body createdAt questionId } } }', { input: { boardId, body, category } }, token)).createQuestion
export const voteQuestion = async (boardId: string, questionId: string, value: number, token?: string) => (await graphQL<{ castVote: PersistedQuestion }>('mutation Vote($input: CastVoteInput!) { castVote(input: $input) { id upvotes downvotes updatedAt } }', { input: { boardId, questionId, value } }, token)).castVote
export const commentOnQuestion = async (boardId: string, questionId: string, body: string, token?: string) => (await graphQL<{ addComment: PersistedComment }>('mutation Comment($input: AddCommentInput!) { addComment(input: $input) { id questionId authorDisplayName body createdAt } }', { input: { boardId, questionId, body } }, token)).addComment
export const addOfficialReply = async (boardId: string, questionId: string, body: string, token: string) => (await graphQL<{ addOfficialReply: PersistedQuestion }>('mutation OfficialReply($input: AddOfficialReplyInput!) { addOfficialReply(input: $input) { id status updatedAt officialReply { body authorDisplayName createdAt } } }', { input: { boardId, questionId, body } }, token)).addOfficialReply
export const presentQuestion = async (boardId: string, questionId: string | null, token: string) => (await graphQL<{ selectQuestion: PersistedBoard }>('mutation Present($boardId: ID!, $questionId: ID) { selectQuestion(boardId: $boardId, questionId: $questionId) { id presentedQuestionId } }', { boardId, questionId }, token)).selectQuestion
export const saveBoard = async (input: Record<string, unknown>, token: string) => (await graphQL<{ updateBoard: PersistedBoard }>('mutation SaveBoard($input: UpdateBoardInput!) { updateBoard(input: $input) { id title description visibility postingPolicy votingMode commentsEnabled visibleVoteTotals anonymousPosting categories } }', { input }, token)).updateBoard
export const deleteBoard = async (id: string, token: string) => (await graphQL<{ deleteBoard: PersistedBoard }>('mutation DeleteBoard($id: ID!) { deleteBoard(id: $id) { id title } }', { id }, token)).deleteBoard
export const getOrganizationSettings = async (token: string) => (await graphQL<{ getOrganizationSettings: Record<string, unknown> }>('query Org { getOrganizationSettings { organizationName defaultVisibility defaultVotingMode membersCanCreateBoards } }', {}, token)).getOrganizationSettings
export const saveOrganizationSettings = async (input: Record<string, unknown>, token: string) => (await graphQL<{ updateOrganizationSettings: Record<string, unknown> }>('mutation Org($input: UpdateOrganizationSettingsInput!) { updateOrganizationSettings(input: $input) { organizationName defaultVisibility defaultVotingMode membersCanCreateBoards } }', { input }, token)).updateOrganizationSettings
export const getMySettings = async (token: string) => (await graphQL<{ getMySettings: { defaultIdentity: string } }>('query Me { getMySettings { userId defaultIdentity } }', {}, token)).getMySettings
export const saveMySettings = async (defaultIdentity: string, token: string) => (await graphQL<{ updateMySettings: { defaultIdentity: string } }>('mutation Me($input: UpdateUserSettingsInput!) { updateMySettings(input: $input) { userId defaultIdentity } }', { input: { defaultIdentity } }, token)).updateMySettings
