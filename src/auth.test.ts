import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeToBoard } from './auth'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CLOSED = 3
  readyState = 1
  sent: string[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onerror?: () => void
  onclose?: () => void
  constructor(public url: string, public protocol: string) { MockWebSocket.instances.push(this) }
  send(value: string) { this.sent.push(value) }
  close() { this.readyState = MockWebSocket.CLOSED }
}

describe('AppSync realtime client', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    window.__AMA_BOARD_CONFIG__ = { appSyncEndpoint: 'https://example.appsync-api.ap-southeast-1.amazonaws.com/graphql', appSyncApiKey: 'key' }
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  it('connects, registers all board subscriptions, and dispatches events', async () => {
    const question = vi.fn()
    const status = vi.fn()
    const dispose = subscribeToBoard('board-1', async () => undefined, { question, comment: vi.fn(), presentation: vi.fn(), reordered: vi.fn(), status, resync: vi.fn() })
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1))
    const socket = MockWebSocket.instances[0]
    expect(socket.url).toContain('appsync-realtime-api')
    socket.onopen?.()
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'connection_init' })
    socket.onmessage?.({ data: JSON.stringify({ type: 'connection_ack' }) })
    expect(socket.sent.filter(message => JSON.parse(message).type === 'start')).toHaveLength(4)
    socket.onmessage?.({ data: JSON.stringify({ type: 'data', payload: { data: { questionChanged: { id: 'q1', boardId: 'board-1' } } } }) })
    expect(question).toHaveBeenCalledWith({ id: 'q1', boardId: 'board-1' })
    expect(status).toHaveBeenCalledWith('connected')
    dispose()
  })
})
