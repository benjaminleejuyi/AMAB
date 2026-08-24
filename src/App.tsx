import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUp, BarChart3, Check, ChevronDown, CircleHelp, Globe2,
  LayoutGrid, LockKeyhole, LogOut, MessageCircle, MoreHorizontal, Plus, Presentation, Search,
  Send, Settings, Share2, ShieldCheck, Sparkles, UserCog, Users, X,
} from 'lucide-react'
import type { Question, QuestionCategory } from './types'
import { commentOnQuestion, completeNewPassword, createBoard, getBoard, getMySettings, getOrganizationSettings, getQuestions, inviteUser, listBoards, NewPasswordRequiredError, postQuestion, presentQuestion, readSession, saveBoard, saveMySettings, saveOrganizationSettings, signIn, signOut, voteQuestion, type AuthSession, type BoardSummary, type PersistedQuestion } from './auth'

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

function BoardPage({ boardId, navigate, session }: { boardId: string, navigate: (path: string) => void, session: AuthSession | null }) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [boardTitle, setBoardTitle] = useState('Loading board…')
  const [boardError, setBoardError] = useState('')
  const [category, setCategory] = useState<(typeof categories)[number]>('All')
  const [sort, setSort] = useState<SortMode>('Top')
  const [query, setQuery] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [newQuestion, setNewQuestion] = useState('')
  const [newCategory, setNewCategory] = useState<QuestionCategory>('Strategy')
  const [presenting, setPresenting] = useState<Question | null>(null)
  const [shareNotice, setShareNotice] = useState(false)
  const initials = session?.email.slice(0, 2).toUpperCase() ?? 'GU'
  const toQuestion = (item: PersistedQuestion, index = 0): Question => ({ id: item.id, author: item.authorDisplayName, avatar: item.authorDisplayName.split(' ').map(word => word[0]).join('').slice(0, 2), body: item.body, category: item.category as QuestionCategory, status: item.status === 'SELECTED' ? 'Selected' : item.status === 'ANSWERED' ? 'Answered' : 'Open', upvotes: item.upvotes, downvotes: item.downvotes, viewerVote: 0, comments: (item.comments || []).map(comment => ({ id: comment.id, author: comment.authorDisplayName, body: comment.body, time: new Date(comment.createdAt).toLocaleString() })), createdAt: Date.parse(item.createdAt) || index })
  useEffect(() => {
    const token = session?.idToken
    Promise.all([getBoard(boardId, token), getQuestions(boardId, token)]).then(([board, items]) => { setBoardTitle(board.title); setQuestions(items.map(toQuestion)); setBoardError('') }).catch(reason => setBoardError(reason instanceof Error ? reason.message : 'Could not load this board.'))
  }, [boardId, session?.idToken])

  const visibleQuestions = useMemo(() => questions
    .filter(item => category === 'All' || item.category === category)
    .filter(item => item.body.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'Top' ? (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes) : sort === 'Newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt),
  [questions, category, query, sort])

  const vote = async (id: string, nextVote: -1 | 1) => {
    const currentQuestion = questions.find(item => item.id === id)
    if (!currentQuestion) return
    const voteValue = currentQuestion.viewerVote === nextVote ? 0 : nextVote
    try {
      const saved = await voteQuestion(boardId, id, voteValue, session?.idToken)
      setQuestions(current => current.map(item => item.id === id ? { ...item, upvotes: saved.upvotes, downvotes: saved.downvotes, viewerVote: voteValue } : item))
    } catch (reason) { setBoardError(reason instanceof Error ? reason.message : 'Could not save vote.') }
  }
  const addComment = async (id: string, body: string) => {
    try {
      const saved = await commentOnQuestion(boardId, id, body, session?.idToken)
      setQuestions(current => current.map(item => item.id === id ? { ...item, comments: [...item.comments, { id: saved.id, author: saved.authorDisplayName, body: saved.body, time: 'Just now' }] } : item))
    } catch (reason) { setBoardError(reason instanceof Error ? reason.message : 'Could not save comment.') }
  }

  const submitQuestion = async () => {
    if (!newQuestion.trim()) return
    try {
      const saved = await postQuestion(boardId, newQuestion.trim(), newCategory, session?.idToken)
      setQuestions(current => [toQuestion(saved), ...current]); setNewQuestion(''); setComposerOpen(false)
    } catch (reason) { setBoardError(reason instanceof Error ? reason.message : 'Could not post question.'); setComposerOpen(false) }
  }

  const startPresentation = async (id: string) => {
    const selected = questions.find(item => item.id === id)
    if (!selected) return
    if (!session) { setBoardError('Sign in as a moderator to use presentation mode.'); return }
    try { await presentQuestion(boardId, id, session.idToken); setQuestions(current => current.map(item => ({ ...item, status: item.id === id ? 'Selected' : item.status === 'Selected' ? 'Open' : item.status }))); setPresenting(selected) }
    catch (reason) { setBoardError(reason instanceof Error ? reason.message : 'Could not select the question.') }
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
        <div className="header-actions"><button className="share" onClick={shareBoard}><Share2 size={16} /> Share</button>{session && <button className="settings" onClick={() => navigate(`/boards/${boardId}/settings`)} aria-label="Board settings"><Settings size={18} /></button>}<button className="profile profile-button" title={session?.email ?? 'Guest'} onClick={() => navigate(session ? '/admin' : '/')}>{initials}</button></div>
      </header>

      <main>
        {boardError && <div className="page-error" role="alert">{boardError}</div>}
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

function AccountMenu({ session, navigate, onSignOut }: { session: AuthSession, navigate: (path: string) => void, onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  return <div className="account-menu"><button className="account-trigger" onClick={() => setOpen(!open)}><span className="profile">{session.email.slice(0, 2).toUpperCase()}</span><span>{session.email}</span><ChevronDown size={15} /></button>{open && <div className="account-popover"><button onClick={() => navigate('/settings')}>My settings</button>{session.groups.includes('Admins') && <button onClick={() => navigate('/admin')}><UserCog size={15} /> Admin panel</button>}<button onClick={onSignOut}><LogOut size={15} /> Log out</button></div>}</div>
}

function PublicHeader({ navigate, onLogin, session, onSignOut }: { navigate: (path: string) => void, onLogin: () => void, session: AuthSession | null, onSignOut: () => void }) {
  return <header className="public-header">
    <button className="brand brand-button" onClick={() => navigate('/')}><span><Sparkles size={20} /></span> AMA Board</button>
    <nav aria-label="Main navigation"><button onClick={() => navigate('/about')}>About</button><button onClick={() => navigate('/boards/all-company')}>View demo</button></nav>
    {session ? <AccountMenu session={session} navigate={navigate} onSignOut={onSignOut} /> : <button className="login-button" onClick={onLogin}>Log in <ArrowRight size={16} /></button>}
  </header>
}

function LoginDialog({ onClose, onSignedIn }: { onClose: () => void, onSignedIn: (session: AuthSession) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [challengeSession, setChallengeSession] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const submit = async () => {
    setLoading(true); setError('')
    try { onSignedIn(challengeSession ? await completeNewPassword(email, newPassword, challengeSession) : await signIn(email, password)) }
    catch (reason) {
      if (reason instanceof NewPasswordRequiredError) setChallengeSession(reason.challengeSession)
      setError(reason instanceof Error ? reason.message : 'Sign-in failed.')
    }
    finally { setLoading(false) }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="login-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title" onMouseDown={event => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
      <span className="composer-icon"><LockKeyhole size={22} /></span>
      <h2 id="login-title">Welcome back</h2><p>Sign in with your organisation account to manage boards.</p>
      <label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" /></label>
      <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => event.key === 'Enter' && submit()} placeholder="••••••••••••" /></label>
      {challengeSession && <label>New permanent password<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="At least 12 characters" /></label>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="dialog-primary" disabled={loading || !email || !password || (!!challengeSession && !newPassword)} onClick={submit}>{loading ? 'Signing in…' : challengeSession ? 'Set password and sign in' : 'Continue'} <ArrowRight size={17} /></button>
      <small>Secure authentication is provided by Amazon Cognito.</small>
    </section>
  </div>
}

function LandingPage({ navigate, onSignedIn, session, onSignOut }: { navigate: (path: string) => void, onSignedIn: (session: AuthSession) => void, session: AuthSession | null, onSignOut: () => void }) {
  const [loginOpen, setLoginOpen] = useState(false)
  return <div className="marketing-shell">
    <PublicHeader navigate={navigate} onLogin={() => setLoginOpen(true)} session={session} onSignOut={onSignOut} />
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
    {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} onSignedIn={onSignedIn} />}
  </div>
}

function AboutPage({ navigate, onSignedIn, session, onSignOut }: { navigate: (path: string) => void, onSignedIn: (session: AuthSession) => void, session: AuthSession | null, onSignOut: () => void }) {
  const [loginOpen, setLoginOpen] = useState(false)
  return <div className="marketing-shell"><PublicHeader navigate={navigate} onLogin={() => setLoginOpen(true)} session={session} onSignOut={onSignOut} />
    <main className="simple-page"><div className="marketing-eyebrow">About AMA Board</div><h1>Honest questions make<br />stronger organisations.</h1><p className="page-lead">AMA Board creates an open, organised space for every voice—before, during, and after your AMA.</p>
      <section className="values-grid"><article><Globe2 /><h2>Open by default</h2><p>Public and unlisted boards make it effortless to join while administrators stay in control.</p></article><article><ShieldCheck /><h2>Safe to speak</h2><p>Participants can identify themselves or use a consistent, friendly pseudonym.</p></article><article><Presentation /><h2>Built for the room</h2><p>Present the selected question clearly without losing the live audience conversation.</p></article></section>
      <button className="page-cta" onClick={() => navigate('/boards/all-company')}>See AMA Board in action <ArrowRight size={18} /></button>
    </main>{loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} onSignedIn={onSignedIn} />}</div>
}

function SettingsPage({ boardId, navigate, session }: { boardId: string, navigate: (path: string) => void, session: AuthSession }) {
  const [activeTab, setActiveTab] = useState<'General' | 'Participation' | 'Moderators' | 'Presentation'>('General')
  const [saved, setSaved] = useState(false)
  const [comments, setComments] = useState(true)
  const [anonymous, setAnonymous] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState('UNLISTED')
  const [votingMode, setVotingMode] = useState('UP_DOWN')
  const [postingPolicy, setPostingPolicy] = useState('ANYONE')
  const [showVotes, setShowVotes] = useState(true)
  useEffect(() => {
    getBoard(boardId, session.idToken).then(board => { setTitle(board.title); setDescription(board.description || ''); setVisibility(board.visibility); setVotingMode(board.votingMode); setPostingPolicy(board.postingPolicy); setComments(board.commentsEnabled); setShowVotes(board.visibleVoteTotals); setAnonymous(board.anonymousPosting) })
  }, [boardId, session.idToken])
  const persistBoard = async () => {
    setSaved(false)
    try { await saveBoard({ id: boardId, title, description, visibility, votingMode, postingPolicy, commentsEnabled: comments, visibleVoteTotals: showVotes, anonymousPosting: anonymous }, session.idToken); setSaved(true); window.setTimeout(() => setSaved(false), 2000) }
    catch (reason) { setInviteStatus(reason instanceof Error ? reason.message : 'Could not save board settings.') }
  }
  const sendInvite = async () => {
    setInviteStatus('Sending…')
    try { await inviteUser(boardId, inviteEmail, session.idToken); setInviteStatus(`Invitation sent to ${inviteEmail}`); setInviteEmail('') }
    catch (reason) { setInviteStatus(reason instanceof Error ? reason.message : 'Could not send invitation.') }
  }
  return <div className="settings-shell"><header><button className="brand brand-button" onClick={() => navigate('/')}><span><Sparkles size={20} /></span> AMA Board</button><button className="back-board" onClick={() => navigate(`/boards/${boardId}`)}>← Back to board</button><button className="profile profile-button" title={session.email} onClick={() => navigate('/admin')}>{session.email.slice(0, 2).toUpperCase()}</button></header>
    <main className="settings-page"><div className="settings-title"><div><span>Board administration</span><h1>Board settings</h1><p>Control how people find and participate in this AMA.</p></div><button onClick={persistBoard}>{saved ? <><Check size={17} /> Saved</> : 'Save changes'}</button></div>
      <section className="settings-grid"><aside>{(['General', 'Participation', 'Moderators', 'Presentation'] as const).map(tab => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</aside><div className="settings-panels">
        {activeTab === 'General' && <article><h2>Board details</h2><p>The information participants see at the top of this board.</p><label>Board title<input value={title} onChange={event => setTitle(event.target.value)} /></label><label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} /></label><label>Board URL<input value={`/boards/${boardId}`} readOnly /></label></article>}
        {activeTab === 'Participation' && <article><h2>Access and participation</h2><p>Choose how your organisation can take part.</p><label>Board visibility<select value={visibility} onChange={event => setVisibility(event.target.value)}><option value="PUBLIC">Public</option><option value="UNLISTED">Unlisted — link only</option></select></label><label>Who can post<select value={postingPolicy} onChange={event => setPostingPolicy(event.target.value)}><option value="ANYONE">Anyone</option><option value="AUTHENTICATED">Signed-in users</option><option value="MODERATORS">Moderators only</option><option value="CLOSED">Closed</option></select></label><label>Voting mode<select value={votingMode} onChange={event => setVotingMode(event.target.value)}><option value="UP_DOWN">Upvotes and downvotes</option><option value="UPVOTE">Upvotes only</option><option value="NONE">No voting</option></select></label><div className="setting-row"><div><b>Allow comments</b><span>Participants can comment without pre-moderation.</span></div><button className={`switch ${comments ? 'on' : ''}`} onClick={() => setComments(!comments)} aria-label="Allow comments"><i /></button></div><div className="setting-row"><div><b>Allow pseudonyms</b><span>Assign a friendly identity when no name is provided.</span></div><button className={`switch ${anonymous ? 'on' : ''}`} onClick={() => setAnonymous(!anonymous)} aria-label="Allow pseudonyms"><i /></button></div></article>}
        {activeTab === 'Moderators' && <article><h2>Board moderators</h2><p>Invite colleagues who can organise questions and control presentation mode.</p><div className="member-row"><span className="profile">{session.email.slice(0, 2).toUpperCase()}</span><div><b>{session.email}</b><small>Organisation administrator</small></div><strong>Admin</strong></div><div className="invite-row"><input type="email" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="colleague@company.com" /><button disabled={!inviteEmail} onClick={sendInvite}>Send invitation</button></div>{inviteStatus && <p role="status">{inviteStatus}</p>}</article>}
        {activeTab === 'Presentation' && <article><h2>Presentation preferences</h2><p>Choose what the audience sees when a question is presented.</p><label>Presentation heading<input value={title} onChange={event => setTitle(event.target.value)} /></label><div className="setting-row"><div><b>Show vote totals</b><span>Display the selected question's live score.</span></div><button className={`switch ${showVotes ? 'on' : ''}`} onClick={() => setShowVotes(!showVotes)} aria-label="Show vote totals"><i /></button></div></article>}
      </div></section>
    </main></div>
}

function UserSettingsPage({ navigate, session, onSignOut }: { navigate: (path: string) => void, session: AuthSession, onSignOut: () => void }) {
  const tabs = session.groups.includes('Admins') ? ['Profile', 'Security', 'Administration'] as const : ['Profile', 'Security'] as const
  const [tab, setTab] = useState<'Profile' | 'Security' | 'Administration'>('Profile')
  const [defaultIdentity, setDefaultIdentity] = useState('ASK')
  const [profileStatus, setProfileStatus] = useState('')
  useEffect(() => { getMySettings(session.idToken).then(settings => setDefaultIdentity(settings.defaultIdentity)).catch(reason => setProfileStatus(reason instanceof Error ? reason.message : 'Could not load profile settings.')) }, [session.idToken])
  const persistProfile = async () => {
    setProfileStatus('Saving…')
    try { await saveMySettings(defaultIdentity, session.idToken); setProfileStatus('Profile settings saved.') }
    catch (reason) { setProfileStatus(reason instanceof Error ? reason.message : 'Could not save profile settings.') }
  }
  return <div className="settings-shell"><header><button className="brand brand-button" onClick={() => navigate('/')}><span><Sparkles size={20} /></span> AMA Board</button><button className="back-board" onClick={() => navigate('/')}>← Back home</button><AccountMenu session={session} navigate={navigate} onSignOut={onSignOut} /></header><main className="settings-page"><div className="settings-title"><div><span>Your account</span><h1>Settings</h1><p>Manage your profile and account access.</p></div></div><section className="settings-grid"><aside>{tabs.map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</aside><div className="settings-panels">{tab === 'Profile' && <article><h2>Profile</h2><p>This identity is provided by your organisation account.</p><label>Email<input value={session.email} readOnly /></label><label>Default posting identity<select value={defaultIdentity} onChange={event => setDefaultIdentity(event.target.value)}><option value="ASK">Ask every time</option><option value="NAME">Use my name</option><option value="PSEUDONYM">Use a pseudonym</option></select></label><button className="page-cta" onClick={persistProfile}>Save profile</button>{profileStatus && <p role="status">{profileStatus}</p>}</article>}{tab === 'Security' && <article><h2>Security</h2><p>Your password and authentication are managed securely by Amazon Cognito.</p><button className="danger-button" onClick={onSignOut}>Sign out of AMA Board</button></article>}{tab === 'Administration' && session.groups.includes('Admins') && <article><h2>Administration</h2><p>Manage organisation users, boards, and defaults in the administrator panel.</p><button className="page-cta" onClick={() => navigate('/admin')}>Open admin panel <ArrowRight size={17} /></button></article>}</div></section></main></div>
}

function AdminPage({ navigate, session, onSignOut }: { navigate: (path: string) => void, session: AuthSession, onSignOut: () => void }) {
  const [tab, setTab] = useState<'Overview' | 'Boards' | 'Users' | 'Organisation'>('Overview')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('')
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [boardsStatus, setBoardsStatus] = useState('Loading boards…')
  const [creating, setCreating] = useState(false)
  const [boardTitle, setBoardTitle] = useState('')
  const [boardDescription, setBoardDescription] = useState('')
  const [boardStatus, setBoardStatus] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [defaultVisibility, setDefaultVisibility] = useState('UNLISTED')
  const [defaultVotingMode, setDefaultVotingMode] = useState('UP_DOWN')
  const [membersCanCreateBoards, setMembersCanCreateBoards] = useState(false)
  const [organizationStatus, setOrganizationStatus] = useState('')
  useEffect(() => {
    listBoards(session.idToken).then(items => { setBoards(items); setBoardsStatus(items.length ? '' : 'No boards yet. Create your first board.') }).catch(reason => setBoardsStatus(reason instanceof Error ? reason.message : 'Could not load boards.'))
    getOrganizationSettings(session.idToken).then(settings => { setOrganizationName(String(settings.organizationName)); setDefaultVisibility(String(settings.defaultVisibility)); setDefaultVotingMode(String(settings.defaultVotingMode)); setMembersCanCreateBoards(Boolean(settings.membersCanCreateBoards)) }).catch(reason => setOrganizationStatus(reason instanceof Error ? reason.message : 'Could not load organisation settings.'))
  }, [session.idToken])
  const addUser = async () => {
    setStatus('Sending…')
    try { await inviteUser('all-company', email, session.idToken); setStatus(`Invitation sent to ${email}`); setEmail('') }
    catch (reason) { setStatus(reason instanceof Error ? reason.message : 'Could not invite user.') }
  }
  const addBoard = async () => {
    setBoardStatus('Creating…')
    try {
      const board = await createBoard(boardTitle, boardDescription, session.idToken)
      setBoards(current => [...current, board]); setBoardTitle(''); setBoardDescription(''); setCreating(false); setBoardStatus('')
      navigate(`/boards/${board.id}/settings`)
    } catch (reason) { setBoardStatus(reason instanceof Error ? reason.message : 'Could not create board.') }
  }
  const persistOrganization = async () => {
    setOrganizationStatus('Saving…')
    try { await saveOrganizationSettings({ organizationName, defaultVisibility, defaultVotingMode, membersCanCreateBoards }, session.idToken); setOrganizationStatus('Organisation settings saved.') }
    catch (reason) { setOrganizationStatus(reason instanceof Error ? reason.message : 'Could not save organisation settings.') }
  }
  return <div className="settings-shell"><header><button className="brand brand-button" onClick={() => navigate('/')}><span><Sparkles size={20} /></span> AMA Board</button><span className="admin-label">Site administration</span><button className="logout-button" onClick={onSignOut}><LogOut size={16} /> Log out</button><span className="profile">{session.email.slice(0, 2).toUpperCase()}</span></header>
    <main className="settings-page"><div className="settings-title"><div><span>Organisation console</span><h1>Administration</h1><p>Manage boards, users, and site-wide defaults.</p></div><button onClick={() => { setTab('Boards'); setCreating(true) }}><Plus size={17} /> Create board</button></div>
      <section className="settings-grid"><aside>{(['Overview', 'Boards', 'Users', 'Organisation'] as const).map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</aside><div className="settings-panels">
        {tab === 'Overview' && <><section className="admin-stats"><article><b>{boards.length}</b><span>Boards</span></article><article><b>1</b><span>Administrator</span></article><article><b>—</b><span>Participant analytics not connected</span></article></section><article><h2>Welcome, {session.email}</h2><p>Use this console for organisation-wide administration. Settings for an individual AMA live on that board's settings page.</p>{boardsStatus && <p role="status">{boardsStatus}</p>}</article></>}
        {tab === 'Boards' && <article><h2>Boards</h2><p>Create a board or open an existing board's settings.</p>{creating && <div className="create-board-form"><label>Board title<input autoFocus value={boardTitle} onChange={event => setBoardTitle(event.target.value)} placeholder="e.g. Quarterly leadership AMA" /></label><label>Description<textarea value={boardDescription} onChange={event => setBoardDescription(event.target.value)} placeholder="What should participants know?" /></label><div><button onClick={() => setCreating(false)}>Cancel</button><button disabled={!boardTitle || boardStatus === 'Creating…'} onClick={addBoard}>Create board</button></div>{boardStatus && <p role="status">{boardStatus}</p>}</div>}{boardsStatus && <p role="status">{boardsStatus}</p>}{boards.map(board => <div className="board-admin-row" key={board.id}><div><b>{board.title}</b><span>{board.visibility.toLowerCase()} · accepting questions</span></div><button onClick={() => navigate(`/boards/${board.id}/settings`)}>Manage board</button></div>)}</article>}
        {tab === 'Users' && <article><h2>Users</h2><p>Invite a user through Cognito. They receive a temporary password by email.</p><div className="member-row"><span className="profile">{session.email.slice(0, 2).toUpperCase()}</span><div><b>{session.email}</b><small>Initial administrator</small></div><strong>Admin</strong></div><div className="invite-row"><input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="new.user@company.com" /><button disabled={!email} onClick={addUser}>Invite user</button></div>{status && <p role="status">{status}</p>}</article>}
        {tab === 'Organisation' && <article><h2>Organisation settings</h2><p>Defaults used when administrators create new AMA boards.</p><label>Organisation name<input value={organizationName} onChange={event => setOrganizationName(event.target.value)} /></label><label>Default board visibility<select value={defaultVisibility} onChange={event => setDefaultVisibility(event.target.value)}><option value="UNLISTED">Unlisted — link only</option><option value="PUBLIC">Public</option></select></label><label>Default voting<select value={defaultVotingMode} onChange={event => setDefaultVotingMode(event.target.value)}><option value="UP_DOWN">Upvotes and downvotes</option><option value="UPVOTE">Upvotes only</option><option value="NONE">No voting</option></select></label><div className="setting-row"><div><b>Members can create boards</b><span>Allow non-administrators to create new AMA boards.</span></div><button className={`switch ${membersCanCreateBoards ? 'on' : ''}`} onClick={() => setMembersCanCreateBoards(!membersCanCreateBoards)} aria-label="Members can create boards"><i /></button></div><button className="page-cta" onClick={persistOrganization}>Save organisation settings</button>{organizationStatus && <p role="status">{organizationStatus}</p>}</article>}
      </div></section>
    </main></div>
}

export function App() {
  const [path, setPath] = useState(window.location.pathname)
  const [session, setSession] = useState<AuthSession | null>(() => readSession())
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
  const signedIn = (nextSession: AuthSession) => { setSession(nextSession); navigate(nextSession.groups.includes('Admins') ? '/admin' : '/settings') }
  const signedOut = () => { signOut(); setSession(null); navigate('/') }
  const isAdmin = session?.groups.includes('Admins') ?? false
  const settingsMatch = path.match(/^\/boards\/([^/]+)\/settings\/?$/)
  const boardMatch = path.match(/^\/boards\/([^/]+)\/?$/)
  if (settingsMatch && session) return <SettingsPage boardId={settingsMatch[1]} navigate={navigate} session={session} />
  if (settingsMatch) return <LandingPage navigate={navigate} onSignedIn={signedIn} session={session} onSignOut={signedOut} />
  if (boardMatch) return <BoardPage boardId={boardMatch[1]} navigate={navigate} session={session} />
  if (path === '/admin' && session && isAdmin) return <AdminPage navigate={navigate} session={session} onSignOut={signedOut} />
  if (path === '/settings' && session) return <UserSettingsPage navigate={navigate} session={session} onSignOut={signedOut} />
  if (path === '/admin' || path === '/settings') return <LandingPage navigate={navigate} onSignedIn={signedIn} session={session} onSignOut={signedOut} />
  if (path === '/about') return <AboutPage navigate={navigate} onSignedIn={signedIn} session={session} onSignOut={signedOut} />
  return <LandingPage navigate={navigate} onSignedIn={signedIn} session={session} onSignOut={signedOut} />
}
