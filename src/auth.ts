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

function tokenClaims(idToken: string): { email?: string, 'cognito:groups'?: string[], exp?: number } {
  return JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
}

function createSession(result: { AccessToken: string, IdToken: string, RefreshToken?: string }, fallbackEmail: string): AuthSession {
  const claims = tokenClaims(result.IdToken)
  const session = { accessToken: result.AccessToken, idToken: result.IdToken, refreshToken: result.RefreshToken, email: claims.email ?? fallbackEmail, groups: claims['cognito:groups'] ?? [] }
  sessionStorage.setItem('ama-board-session', JSON.stringify(session))
  return session
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
  return createSession(payload.AuthenticationResult, email)
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
  return createSession(payload.AuthenticationResult, email)
}

export function readSession(): AuthSession | null {
  try {
    const session: AuthSession | null = JSON.parse(sessionStorage.getItem('ama-board-session') || 'null')
    if (!session) return null
    const payload = tokenClaims(session.idToken)
    if (!payload.exp || payload.exp * 1000 <= Date.now()) { signOut(); return null }
    return { ...session, email: payload.email ?? session.email, groups: payload['cognito:groups'] ?? session.groups ?? [] }
  }
  catch { return null }
}

export function signOut() { sessionStorage.removeItem('ama-board-session') }

async function appSyncMutation(query: string, variables: Record<string, string>, idToken: string) {
  const config = appConfig()
  if (!config.appSyncEndpoint) throw new Error('AppSync has not been configured for this deployment.')
  const response = await fetch(config.appSyncEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: idToken },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await response.json()
  if (!response.ok || payload.errors) throw new Error(payload.errors?.[0]?.message || 'Could not invite user.')
  return payload.data
}

export async function inviteOrganizationUser(email: string, idToken: string) {
  const data = await appSyncMutation('mutation InviteUser($email: AWSEmail!) { inviteOrganizationUser(email: $email) { userId email status } }', { email }, idToken)
  return data.inviteOrganizationUser
}

export async function assignBoardRole(boardId: string, email: string, role: 'OWNER' | 'MODERATOR', idToken: string) {
  const data = await appSyncMutation('mutation AssignRole($boardId: ID!, $email: AWSEmail!, $role: BoardRole!) { assignBoardRole(boardId: $boardId, email: $email, role: $role) { boardId userId role } }', { boardId, email, role }, idToken)
  return data.assignBoardRole
}
