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
}

declare global {
  interface Window { __AMA_BOARD_CONFIG__?: AppConfig }
}

export const appConfig = (): AppConfig => window.__AMA_BOARD_CONFIG__ ?? {}

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
  const session = { accessToken: result.AccessToken, idToken: result.IdToken, refreshToken: result.RefreshToken, email }
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
  const session = { accessToken: result.AccessToken, idToken: result.IdToken, refreshToken: result.RefreshToken, email }
  sessionStorage.setItem('ama-board-session', JSON.stringify(session))
  return session
}

export function readSession(): AuthSession | null {
  try { return JSON.parse(sessionStorage.getItem('ama-board-session') || 'null') }
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
