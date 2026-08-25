import type { Question } from './types'

export const initialQuestions: Question[] = [
  {
    id: 'q1', author: 'Anonymous Alpaca', avatar: 'AA', category: 'Strategy', status: 'Selected',
    body: 'What are the three most important bets we’re making in the next twelve months?',
    upvotes: 42, downvotes: 2, viewerVote: 0, createdAt: 5,
    comments: [{ id: 'c1', author: 'Helpful Heron', body: 'Would love to hear how customer feedback shaped these.', time: '8 min ago' }],
  },
  {
    id: 'q2', author: 'Priya Nair', avatar: 'PN', category: 'Product', status: 'Open',
    body: 'How are we balancing requests from our largest customers with improvements that benefit everyone?',
    upvotes: 31, downvotes: 1, viewerVote: 1, createdAt: 4, comments: [],
  },
  {
    id: 'q3', author: 'Curious Otter', avatar: 'CO', category: 'Culture', status: 'Open',
    body: 'What is one part of our culture you want us to protect as the team grows?',
    upvotes: 27, downvotes: 0, viewerVote: 0, createdAt: 3,
    comments: [{ id: 'c2', author: 'Bright Badger', body: 'And what is one thing we should intentionally change?', time: '12 min ago' }],
  },
  {
    id: 'q4', author: 'Daniel Kim', avatar: 'DK', category: 'People', status: 'Answered',
    body: 'Will we introduce more opportunities for short-term rotations between teams?',
    upvotes: 19, downvotes: 3, viewerVote: 0, createdAt: 2, comments: [],
  },
]
