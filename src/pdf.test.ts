import { describe, expect, it } from 'vitest'
import { createBoardReport } from './pdf'
import type { Question } from './types'

const question: Question = {
  id: 'q1', author: 'Helpful Heron', avatar: 'HH', body: 'What is the delivery plan?', category: 'Strategy',
  status: 'Answered', upvotes: 12, downvotes: 2, viewerVote: 0, createdAt: Date.now(),
  officialReply: { body: 'Delivery starts next quarter.', author: 'admin@example.com', time: 'Today' },
  comments: [{ id: 'c1', author: 'Curious Cat', body: 'Thank you for clarifying.', time: 'Today' }],
}

describe('official PDF report', () => {
  it('creates a PDF containing selected report components', async () => {
    const report = createBoardReport('Leadership AMA', [question], { officialReplies: true, comments: true, votes: true, authors: true })
    expect(report.type).toBe('application/pdf')
    const contents = await report.text()
    expect(contents.startsWith('%PDF-1.4')).toBe(true)
    expect(contents).toContain('OFFICIAL REPLY')
    expect(contents).toContain('12 up | 2 down | 10 net')
    expect(contents).toContain('Thank you for clarifying.')
  })

  it('omits components that the moderator deselects', async () => {
    const contents = await createBoardReport('Leadership AMA', [question], { officialReplies: false, comments: false, votes: false, authors: false }).text()
    expect(contents).not.toContain('OFFICIAL REPLY')
    expect(contents).not.toContain('Thank you for clarifying.')
    expect(contents).not.toContain('12 up')
  })
})
