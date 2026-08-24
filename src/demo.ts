import type { Question } from './types'

const STORAGE_KEY = 'ama-board-demo-v2'
const PSEUDONYM_KEY = 'ama-board-demo-pseudonym-v1'
const adjectives = ['Brave', 'Bright', 'Calm', 'Clever', 'Curious', 'Friendly', 'Gentle', 'Helpful', 'Honest', 'Jolly', 'Kind', 'Lively', 'Patient', 'Quiet', 'Thoughtful', 'Wise']
const animals = ['Badger', 'Dolphin', 'Falcon', 'Fox', 'Heron', 'Koala', 'Otter', 'Owl', 'Panda', 'Penguin', 'Rabbit', 'Robin', 'Seal', 'Tiger', 'Turtle', 'Wombat']

const initialQuestions = (): Question[] => [
  {
    id: 'demo-strategy', author: 'Curious Koala', avatar: 'CK',
    body: 'What are the most important outcomes we want to achieve this year?', category: 'Strategy', status: 'Open',
    upvotes: 18, downvotes: 1, viewerVote: 0, comments: [], createdAt: Date.now() - 45 * 60 * 1000,
  },
  {
    id: 'demo-culture', author: 'Thoughtful Tiger', avatar: 'TT',
    body: 'What part of our culture should we protect as the organisation grows?', category: 'Culture', status: 'Open',
    upvotes: 12, downvotes: 0, viewerVote: 0,
    comments: [{ id: 'demo-comment', author: 'Brave Badger', body: 'I would also like to hear how new joiners experience this.', time: 'Earlier this session' }],
    createdAt: Date.now() - 25 * 60 * 1000,
  },
  {
    id: 'demo-product', author: 'Helpful Heron', avatar: 'HH',
    body: 'How is customer feedback influencing the next product roadmap?', category: 'Product', status: 'Open',
    upvotes: 9, downvotes: 2, viewerVote: 0, comments: [], createdAt: Date.now() - 10 * 60 * 1000,
  },
]

export const demoBoard = {
  title: 'Leadership AMA interactive demo',
  description: 'Try posting, voting, commenting, filtering, and presentation mode. Nothing here is sent to the server.',
  categories: ['Strategy', 'Product', 'Culture', 'People'],
}

export function readDemoQuestions(): Question[] {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) as Question[] : initialQuestions()
  } catch {
    return initialQuestions()
  }
}

export function writeDemoQuestions(questions: Question[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(questions))
}

export function resetDemoQuestions(): Question[] {
  sessionStorage.removeItem(STORAGE_KEY)
  return initialQuestions()
}

export function getDemoPseudonym(): string {
  const existing = sessionStorage.getItem(PSEUDONYM_KEY)
  if (existing) return existing
  const random = new Uint32Array(2)
  crypto.getRandomValues(random)
  const pseudonym = `${adjectives[random[0] % adjectives.length]} ${animals[random[1] % animals.length]}`
  sessionStorage.setItem(PSEUDONYM_KEY, pseudonym)
  return pseudonym
}
