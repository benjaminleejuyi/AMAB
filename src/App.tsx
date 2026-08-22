import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUp, BarChart3, Check, ChevronDown, CircleHelp, Globe2,
  LayoutGrid, LockKeyhole, MessageCircle, MoreHorizontal, Plus, Presentation, Search,
  Send, Settings, Share2, ShieldCheck, Sparkles, Users, X,
} from 'lucide-react'
import { initialQuestions } from './data'
import type { Question, QuestionCategory } from './types'

type SortMode = 'Top' | 'Newest' | 'Oldest'

const categories: Array<'All' | QuestionCategory> = ['All', 'Strategy', 'Product', 'Culture', 'People']

function QuestionCard({ question, onVote, onPresent, onComment }: {
  question: Question
  onVote: (id: string, vote: -1 | 1) => void
  onPresent: (id: string) => void
  onComment: (id: string, body: string) => void
}) {
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comment, setComment] = useState('')
  const score = question.upvotes - question.downvotes

  const submitComment = () => {
    if (!comment.trim()) return
    onComment(question.id, comment.trim())
    setComment('')
  }

  return (
    <article className={`question-card ${question.status === 'Selected' ? 'is-selected' : ''}`}>
      {question.status === 'Selected' && <div className="live-label"><span /> Live now</div>}
      <div className="card-topline">
        <span className={`category category-${question.category.toLowerCase()}`}>{question.category}</span>
        <button className="icon-button" aria-label="Question options"><MoreHorizontal size={19} /></button>
      </div>
      <p className="question-copy">{question.body}</p>
      <div className="author-row">
        <span className="avatar">{question.avatar}</span>
        <span>{question.author}</span><span className="dot">·</span><span>18 min ago</span>
      </div>

      <div className="card-actions">
        <div className="vote-group" aria-label={`${score} net votes`}>
          <button className={question.viewerVote === 1 ? 'voted' : ''} onClick={() => onVote(question.id, 1)} aria-label="Upvote">
            <ArrowUp size={18} /><strong>{question.upvotes}</strong>
          </button>
          <span />
          <button className={question.viewerVote === -1 ? 'voted down' : ''} onClick={() => onVote(question.id, -1)} aria-label="Downvote">
            <ArrowDown size={18} />{question.downvotes > 0 && <small>{question.downvotes}</small>}
          </button>
        </div>
        <button className="text-button" onClick={() => setCommentsOpen(!commentsOpen)}>
          <MessageCircle size={17} /> {question.comments.length || ''} {question.comments.length === 1 ? 'Comment' : 'Comments'}
        </button>
        <button className="present-button" onClick={() => onPresent(question.id)}>
          <Presentation size={17} /> Present
        </button>
      </div>

      {commentsOpen && (
        <div className="comments">
          {question.comments.map(item => (
            <div className="comment" key={item.id}>
              <span className="mini-avatar">{item.author.split(' ').map(word => word[0]).join('').slice(0, 2)}</span>
              <div><b>{item.author}</b><span>{item.time}</span><p>{item.body}</p></div>
            </div>
          ))}
          <div className="comment-box">
            <input aria-label="Add a comment" value={comment} onChange={event => setComment(event.target.value)} onKeyDown={event => event.key === 'Enter' && submitComment()} placeholder="Add to the conversation…" />
            <button onClick={submitComment} aria-label="Post comment"><Send size={16} /></button>
          </div>
        </div>
      )}
    </article>
  )
}

function BoardPage({ boardId, navigate }: { boardId: string, navigate: (path: string) => void }) {
  const [questions, setQuestions] = useState(initialQuestions)
  const [category, setCategory] = useState<(typeof categories)[number]>('All')
  const [sort, setSort] = useState<SortMode>('Top')
  const [query, setQuery] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [newQuestion, setNewQuestion] = useState('')
  const [newCategory, setNewCategory] = useState<QuestionCategory>('Strategy')
  const [presenting, setPresenting] = useState<Question | null>(null)
  const [shareNotice, setShareNotice] = useState(false)
  const boardTitle = boardId === 'all-company' ? 'Ask the leadership team' : boardId.split('-').map(word => word[0]?.toUpperCase() + word.slice(1)).join(' ')

  const visibleQuestions = useMemo(() => questions
    .filter(item => category === 'All' || item.category === category)
    .filter(item => item.body.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'Top' ? (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes) : sort === 'Newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt),
  [questions, category, query, sort])

  const vote = (id: string, nextVote: -1 | 1) => setQuestions(current => current.map(item => {
    if (item.id !== id) return item
    const voteValue = item.viewerVote === nextVote ? 0 : nextVote
    return {
      ...item,
      upvotes: item.upvotes - (item.viewerVote === 1 ? 1 : 0) + (voteValue === 1 ? 1 : 0),
      downvotes: item.downvotes - (item.viewerVote === -1 ? 1 : 0) + (voteValue === -1 ? 1 : 0),
      viewerVote: voteValue,
    }
  }))

  const addComment = (id: string, body: string) => setQuestions(current => current.map(item => item.id === id ? {
    ...item, comments: [...item.comments, { id: crypto.randomUUID(), author: 'Helpful Heron', body, time: 'Just now' }],
  } : item))

  const submitQuestion = () => {
    if (!newQuestion.trim()) return
    setQuestions(current => [{
      id: crypto.randomUUID(), author: 'Helpful Heron', avatar: 'HH', body: newQuestion.trim(), category: newCategory,
      status: 'Open', upvotes: 1, downvotes: 0, viewerVote: 1, comments: [], createdAt: Date.now(),
    }, ...current])
    setNewQuestion('')
    setComposerOpen(false)
  }

  const startPresentation = (id: string) => {
    const selected = questions.find(item => item.id === id)
    if (!selected) return
    setQuestions(current => current.map(item => ({ ...item, status: item.id === id ? 'Selected' : item.status === 'Selected' ? 'Open' : item.status })))
    setPresenting(selected)
  }

  const shareBoard = async () => {
    const url = `${window.location.origin}/boards/${boardId}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      window.history.replaceState({}, '', `/boards/${boardId}`)
    }
    setShareNotice(true)
    window.setTimeout(() => setShareNotice(false), 2200)
  }

  return (
    <div className="app-shell">
      <header>
        <button className="brand brand-button" onClick={() => navigate('/')}><span><Sparkles size={20} /></span> AMA Board</button>
        <nav aria-label="Main navigation"><button className="active"><LayoutGrid size={17} /> Board</button><button onClick={() => navigate('/about')}><CircleHelp size={17} /> About</button></nav>
        <div className="header-actions"><button className="share" onClick={shareBoard}><Share2 size={16} /> Share</button><button className="settings" onClick={() => navigate(`/boards/${boardId}/settings`)} aria-label="Board settings"><Settings size={18} /></button><span className="profile">MC</span></div>
      </header>

      <main>
        <section className="hero">
          <div className="eyebrow"><span className="pulse" /> LIVE AMA · ALL COMPANY</div>
          <div className="hero-heading">
            <div><h1>{boardTitle}</h1><p>Vote for what matters. We’ll answer the most important questions live.</p></div>
            <button className="ask-button" onClick={() => setComposerOpen(true)}><Plus size={20} /> Ask a question</button>
          </div>
          <div className="board-meta"><span>Hosted by <b>Morgan Chen</b></span><span>Friday, 2:00 PM</span><span>128 participants</span></div>
        </section>

        <section className="toolbar">
          <div className="category-tabs">{categories.map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
          <div className="tools">
            <label className="search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search questions" /></label>
            <label className="sort">Sort: <select value={sort} onChange={event => setSort(event.target.value as SortMode)}><option>Top</option><option>Newest</option><option>Oldest</option></select><ChevronDown size={15} /></label>
          </div>
        </section>

        <section className="content-heading"><div><h2>Questions</h2><span>{visibleQuestions.length} of {questions.length}</span></div><span className="live-update"><i /> Live updates on</span></section>
        <section className="question-list">
          {visibleQuestions.map(question => <QuestionCard key={question.id} question={question} onVote={vote} onPresent={startPresentation} onComment={addComment} />)}
          {visibleQuestions.length === 0 && <div className="empty"><Search size={28} /><h3>No questions found</h3><p>Try a different search or category.</p></div>}
        </section>
      </main>

      {composerOpen && <div className="modal-backdrop" onMouseDown={() => setComposerOpen(false)}><section className="composer" role="dialog" aria-modal="true" aria-labelledby="ask-title" onMouseDown={event => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setComposerOpen(false)} aria-label="Close"><X size={20} /></button>
        <span className="composer-icon"><MessageCircle size={22} /></span><h2 id="ask-title">Ask a question</h2><p>Share what’s on your mind. You’ll appear as <b>Helpful Heron</b>.</p>
        <textarea autoFocus maxLength={280} value={newQuestion} onChange={event => setNewQuestion(event.target.value)} placeholder="What would you like to ask?" />
        <div className="composer-footer"><select value={newCategory} onChange={event => setNewCategory(event.target.value as QuestionCategory)}>{categories.slice(1).map(item => <option key={item}>{item}</option>)}</select><span>{newQuestion.length}/280</span><button onClick={submitQuestion}>Post question <ArrowUp size={17} /></button></div>
      </section></div>}

      {presenting && <div className="presentation" role="dialog" aria-modal="true" aria-label="Presentation mode">
        <button className="end-presentation" onClick={() => setPresenting(null)}><X size={18} /> End presentation</button>
        <div className="presentation-brand"><Sparkles size={23} /> AMA Board</div>
        <div className="presentation-card"><span className={`category category-${presenting.category.toLowerCase()}`}>{presenting.category}</span><h2>{presenting.body}</h2><p>{presenting.author}</p><div><ArrowUp size={24} /> {presenting.upvotes - presenting.downvotes} votes</div></div>
        <p className="presentation-footer">All-company AMA · Questions update live</p>
      </div>}
      {shareNotice && <div className="toast" role="status"><Check size={17} /> Board link copied</div>}
    </div>
  )
}

function PublicHeader({ navigate, onLogin }: { navigate: (path: string) => void, onLogin: () => void }) {
  return <header className="public-header">
    <button className="brand brand-button" onClick={() => navigate('/')}><span><Sparkles size={20} /></span> AMA Board</button>
    <nav aria-label="Main navigation"><button onClick={() => navigate('/about')}>About</button><button onClick={() => navigate('/boards/all-company')}>View demo</button></nav>
    <button className="login-button" onClick={onLogin}>Log in <ArrowRight size={16} /></button>
  </header>
}

function LoginDialog({ onClose, navigate }: { onClose: () => void, navigate: (path: string) => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="login-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title" onMouseDown={event => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
      <span className="composer-icon"><LockKeyhole size={22} /></span>
      <h2 id="login-title">Welcome back</h2><p>Sign in with your organisation account to manage boards.</p>
      <label>Email address<input type="email" placeholder="you@company.com" /></label>
      <label>Password<input type="password" placeholder="••••••••••••" /></label>
      <button className="dialog-primary" onClick={() => navigate('/boards/all-company')}>Continue <ArrowRight size={17} /></button>
      <small>Authentication will be provided by your organisation’s Cognito account.</small>
    </section>
  </div>
}

function LandingPage({ navigate }: { navigate: (path: string) => void }) {
  const [loginOpen, setLoginOpen] = useState(false)
  return <div className="marketing-shell">
    <PublicHeader navigate={navigate} onLogin={() => setLoginOpen(true)} />
    <main className="landing-main">
      <section className="landing-hero">
        <div className="landing-copy"><div className="marketing-eyebrow"><Sparkles size={14} /> Better conversations, together</div>
          <h1>Give every question<br /><em>a place to be heard.</em></h1>
          <p>Run focused AMAs where people ask freely, vote together, and leaders answer what matters most.</p>
          <div className="landing-actions"><button onClick={() => setLoginOpen(true)}>Create your board <ArrowRight size={18} /></button><button onClick={() => navigate('/boards/all-company')}>Explore the demo</button></div>
          <div className="trust-line"><span><Check size={14} /> Anonymous by choice</span><span><Check size={14} /> Live voting</span><span><Check size={14} /> Presentation ready</span></div>
        </div>
        <div className="hero-visual" aria-label="AMA Board product preview">
          <div className="visual-glow" /><div className="mini-board"><div className="mini-top"><span><Sparkles size={13} /> AMA Board</span><i>LIVE</i></div><h3>Ask the leadership team</h3>
            <div className="mini-question featured"><b>Strategy</b><p>What are the most important bets we’re making this year?</p><span>↑ 42</span></div>
            <div className="mini-question"><b>Culture</b><p>What should we protect as our team grows?</p><span>↑ 27</span></div>
            <div className="mini-question"><b>Product</b><p>How is customer feedback shaping the roadmap?</p><span>↑ 19</span></div>
          </div><div className="floating-card"><Users size={18} /><div><strong>128 voices</strong><span>One shared conversation</span></div></div>
        </div>
      </section>
      <section className="feature-strip"><div><MessageCircle /><h3>Ask safely</h3><p>Use your name or a friendly pseudonym.</p></div><div><BarChart3 /><h3>Prioritise together</h3><p>Visible voting brings the key topics forward.</p></div><div><Presentation /><h3>Answer with focus</h3><p>Move any question into presentation mode.</p></div></section>
    </main>
    {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} navigate={navigate} />}
  </div>
}

function AboutPage({ navigate }: { navigate: (path: string) => void }) {
  const [loginOpen, setLoginOpen] = useState(false)
  return <div className="marketing-shell"><PublicHeader navigate={navigate} onLogin={() => setLoginOpen(true)} />
    <main className="simple-page"><div className="marketing-eyebrow">About AMA Board</div><h1>Honest questions make<br />stronger organisations.</h1><p className="page-lead">AMA Board creates an open, organised space for every voice—before, during, and after your AMA.</p>
      <section className="values-grid"><article><Globe2 /><h2>Open by default</h2><p>Public and unlisted boards make it effortless to join while administrators stay in control.</p></article><article><ShieldCheck /><h2>Safe to speak</h2><p>Participants can identify themselves or use a consistent, friendly pseudonym.</p></article><article><Presentation /><h2>Built for the room</h2><p>Present the selected question clearly without losing the live audience conversation.</p></article></section>
      <button className="page-cta" onClick={() => navigate('/boards/all-company')}>See AMA Board in action <ArrowRight size={18} /></button>
    </main>{loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} navigate={navigate} />}</div>
}

function SettingsPage({ boardId, navigate }: { boardId: string, navigate: (path: string) => void }) {
  const [saved, setSaved] = useState(false)
  const [comments, setComments] = useState(true)
  const [anonymous, setAnonymous] = useState(true)
  return <div className="settings-shell"><header><button className="brand brand-button" onClick={() => navigate('/')}><span><Sparkles size={20} /></span> AMA Board</button><button className="back-board" onClick={() => navigate(`/boards/${boardId}`)}>← Back to board</button><span className="profile">MC</span></header>
    <main className="settings-page"><div className="settings-title"><div><span>Board administration</span><h1>Board settings</h1><p>Control how people find and participate in this AMA.</p></div><button onClick={() => { setSaved(true); window.setTimeout(() => setSaved(false), 2000) }}>{saved ? <><Check size={17} /> Saved</> : 'Save changes'}</button></div>
      <section className="settings-grid"><aside><button className="active">General</button><button>Participation</button><button>Moderators</button><button>Presentation</button></aside><div className="settings-panels">
        <article><h2>Board details</h2><p>The information participants see at the top of this board.</p><label>Board title<input defaultValue="Ask the leadership team" /></label><label>Description<textarea defaultValue="Vote for what matters. We’ll answer the most important questions live." /></label></article>
        <article><h2>Access and participation</h2><p>Choose how your organisation can take part.</p><label>Board visibility<select defaultValue="unlisted"><option value="public">Public</option><option value="unlisted">Unlisted — link only</option></select></label><div className="setting-row"><div><b>Allow comments</b><span>Participants can comment without pre-moderation.</span></div><button className={`switch ${comments ? 'on' : ''}`} onClick={() => setComments(!comments)} aria-label="Allow comments"><i /></button></div><div className="setting-row"><div><b>Allow pseudonyms</b><span>Assign a friendly identity when no name is provided.</span></div><button className={`switch ${anonymous ? 'on' : ''}`} onClick={() => setAnonymous(!anonymous)} aria-label="Allow pseudonyms"><i /></button></div></article>
      </div></section>
    </main></div>
}

export function App() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const navigate = (nextPath: string) => {
    window.history.pushState({}, '', nextPath)
    setPath(nextPath)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const settingsMatch = path.match(/^\/boards\/([^/]+)\/settings\/?$/)
  const boardMatch = path.match(/^\/boards\/([^/]+)\/?$/)
  if (settingsMatch) return <SettingsPage boardId={settingsMatch[1]} navigate={navigate} />
  if (boardMatch) return <BoardPage boardId={boardMatch[1]} navigate={navigate} />
  if (path === '/about') return <AboutPage navigate={navigate} />
  return <LandingPage navigate={navigate} />
}
