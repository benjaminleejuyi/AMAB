export type QuestionStatus = 'Open' | 'Selected' | 'Answered'
export type QuestionCategory = string

export interface Comment {
  id: string
  author: string
  body: string
  time: string
}

export interface Question {
  id: string
  author: string
  avatar: string
  body: string
  category: QuestionCategory
  status: QuestionStatus
  upvotes: number
  downvotes: number
  viewerVote: -1 | 0 | 1
  comments: Comment[]
  createdAt: number
}
