'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  MessageCircle,
  MessageSquare,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  api,
  post,
  cleanName,
  dateFormat,
  type Club,
  type ForumComment,
  type ForumPost,
  type ForumThread,
  type User,
} from '@/lib/api';
import Dialog from './dialog';
import {ErrorMessage} from './account';
import {ReportForm} from './detail-dialogs';
import '@/app/forums.css';

type ForumsPanelProps = {
  clubs: Club[];
  user: User | null;
  onSignIn: () => void;
  initialPostId?: string;
};

type DeleteTarget = {kind: 'post'; id: string} | {kind: 'comment'; id: string};

const PRIVACY_NOTE = 'Posts and comments are public and show your display name.';

function postedAt(value: string) {
  return `${dateFormat(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })} ET`;
}

export default function ForumsPanel({
  clubs,
  user,
  onSignIn,
  initialPostId,
}: ForumsPanelProps) {
  const [query, setQuery] = useState('');
  const [clubId, setClubId] = useState('');
  const [sort, setSort] = useState<'newest' | 'active'>('newest');
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState('');
  const [selectedId, setSelectedId] = useState(initialPostId || '');
  const [thread, setThread] = useState<ForumThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [notice, setNotice] = useState('');
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [draftClubId, setDraftClubId] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [postError, setPostError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentError, setCommentError] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const feedRequest = useRef(0);
  const threadRequest = useRef(0);
  const selectedIdRef = useRef(selectedId);
  const threadHeading = useRef<HTMLHeadingElement>(null);
  selectedIdRef.current = selectedId;

  const loadFeed = useCallback(async () => {
    const requestId = ++feedRequest.current;
    setFeedLoading(true);
    setFeedError('');
    const params = new URLSearchParams({sort});
    if (query.trim()) params.set('q', query.trim());
    if (clubId) params.set('club_id', clubId);
    try {
      const result = await api<ForumPost[]>(`/forums?${params}`);
      if (requestId === feedRequest.current) setPosts(result);
    } catch (error) {
      if (requestId === feedRequest.current) setFeedError((error as Error).message);
    } finally {
      if (requestId === feedRequest.current) setFeedLoading(false);
    }
  }, [query, clubId, sort]);

  useEffect(() => {
    // Invalidate an older response as soon as a filter changes, including
    // during the debounce interval.
    feedRequest.current += 1;
    setFeedLoading(true);
    const timer = setTimeout(() => void loadFeed(), 250);
    return () => {
      clearTimeout(timer);
      feedRequest.current += 1;
    };
  }, [loadFeed, user?.id]);

  const loadThread = useCallback(async (id: string) => {
    // A mutation may finish after the reader has opened another discussion.
    // Its refresh must not cancel the new discussion's request.
    if (selectedIdRef.current !== id) return;
    const requestId = ++threadRequest.current;
    setThreadLoading(true);
    setThreadError('');
    try {
      const result = await api<ForumThread>(`/forums/${encodeURIComponent(id)}`);
      if (requestId === threadRequest.current && selectedIdRef.current === id) {
        setThread(result);
      }
    } catch (error) {
      if (requestId === threadRequest.current && selectedIdRef.current === id) {
        setThreadError((error as Error).message);
      }
    } finally {
      if (requestId === threadRequest.current) setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialPostId) setSelectedId(initialPostId);
  }, [initialPostId]);

  useEffect(() => {
    setThread(null);
    setThreadError('');
    setDeleteTarget(null);
    setDeleteError('');
    setCommentError('');
    if (!selectedId) return;
    void loadThread(selectedId);
    return () => {
      threadRequest.current += 1;
    };
  }, [selectedId, user?.id, loadThread]);

  useEffect(() => {
    if (!thread) return;
    threadHeading.current?.focus({preventScroll: true});
  }, [thread?.id]);

  function openThread(id: string) {
    if (id !== selectedId) setCommentDraft('');
    setSelectedId(id);
    setNotice('');
  }

  function startPost() {
    if (!user) {
      onSignIn();
      return;
    }
    if (!draftClubId && clubId) setDraftClubId(clubId);
    setPostError('');
    setNewPostOpen(true);
  }

  async function publishPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      setNewPostOpen(false);
      onSignIn();
      return;
    }
    if (!draftClubId || draftTitle.trim().length < 3 || !draftBody.trim()) {
      setPostError('Choose a club, add a title of at least 3 characters, and write your post.');
      return;
    }
    setPublishing(true);
    setPostError('');
    try {
      const created = await post<ForumPost>('/forums', {
        club_id: draftClubId,
        title: draftTitle.trim(),
        body: draftBody.trim(),
      });
      setNewPostOpen(false);
      setDraftTitle('');
      setDraftBody('');
      setCommentDraft('');
      setSelectedId(created.id);
      setNotice('Your post is published.');
      await loadFeed();
    } catch (error) {
      setPostError((error as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function publishComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return onSignIn();
    if (!thread || !commentDraft.trim()) return;
    const id = thread.id;
    setCommenting(true);
    setCommentError('');
    try {
      const created = await post<ForumComment>(`/forums/${encodeURIComponent(id)}/comments`, {
        body: commentDraft.trim(),
      });
      if (selectedIdRef.current === id) {
        setCommentDraft('');
        setNotice('Your comment is published.');
        setThread(current => current?.id === id
          ? current.comments.some(item => item.id === created.id) ? current : {...current, comments: [...current.comments, created], comment_count: current.comment_count + 1}
          : current);
      }
      await Promise.all([loadThread(id), loadFeed()]);
    } catch (error) {
      setCommentError((error as Error).message);
    } finally {
      setCommenting(false);
    }
  }

  async function deleteContent() {
    if (!deleteTarget || !thread) return;
    const id = thread.id;
    setDeleting(true);
    setDeleteError('');
    try {
      const endpoint = deleteTarget.kind === 'post'
        ? `/forums/${encodeURIComponent(id)}`
        : `/forums/${encodeURIComponent(id)}/comments/${encodeURIComponent(deleteTarget.id)}`;
      await api<{ok: boolean}>(endpoint, {method: 'DELETE'});
      if (deleteTarget.kind === 'post') {
        if (selectedIdRef.current === id) {
          setSelectedId('');
          setThread(null);
        }
        setNotice('Post and its comments deleted.');
        await loadFeed();
      } else {
        if (selectedIdRef.current === id) setNotice('Comment deleted.');
        const commentId = deleteTarget.id;
        setThread(current => current?.id === id
          ? {...current, comments: current.comments.filter(item => item.id !== commentId), comment_count: Math.max(0, current.comment_count - (current.comments.some(item => item.id === commentId) ? 1 : 0))}
          : current);
        await Promise.all([loadThread(id), loadFeed()]);
      }
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  function confirmDelete(target: DeleteTarget) {
    setDeleteTarget(target);
    setDeleteError('');
  }

  function deleteConfirmation(target: DeleteTarget) {
    if (deleteTarget?.kind !== target.kind || deleteTarget.id !== target.id) return null;
    return (
      <div className="forum-delete-confirm">
        <p>{target.kind === 'post'
          ? 'Delete this post and all its comments? This cannot be undone.'
          : 'Delete this comment? This cannot be undone.'}</p>
        <ErrorMessage message={deleteError}/>
        <div className="forum-inline-actions">
          <button className="button button-danger" onClick={() => void deleteContent()} disabled={deleting}>
            {deleting ? <LoaderCircle size={16} className="spin"/> : <Trash2 size={16}/>}
            {deleting ? 'Deleting…' : 'Delete permanently'}
          </button>
          <button className="text-button muted" onClick={() => setDeleteTarget(null)} disabled={deleting}>Keep it</button>
        </div>
      </div>
    );
  }

  const selectedClub = clubs.find(club => club.id === (thread?.club_id || clubId));
  const sortedClubs = [...clubs].sort((a, b) => cleanName(a.name).localeCompare(cleanName(b.name)));
  const comments = [...(thread?.comments || [])].sort((a, b) =>
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id),
  );

  return (
    <div className="forums-panel">
      <div className="forum-intro">
        <div>
          <p className="forum-intro-copy">Ask a question. Share an idea. Get a conversation started with your club community.</p>
          <p className="forum-privacy"><Users size={15}/>{PRIVACY_NOTE}</p>
        </div>
        <button className="button button-primary" onClick={startPost} disabled={!clubs.length}>
          <Plus size={18}/>New post
        </button>
      </div>

      {notice && <p className="forum-notice" role="status"><Check size={17}/>{notice}</p>}

      <div className="forum-layout">
        <div className="forum-main">
          {selectedId ? (
            <>
              <div className="forum-thread-toolbar">
                <button className="text-button" onClick={() => {setSelectedId(''); setNotice('');}}>
                  <ArrowLeft size={17}/>All discussions
                </button>
                <a className="text-button" href={`/forums/${encodeURIComponent(selectedId)}`}>
                  Shareable page<ArrowUpRight size={16}/>
                </a>
              </div>

              {threadLoading && !thread && <Loading message="Opening the conversation…"/>}
              {threadError && (
                <div className="forum-fetch-error" role="alert">
                  <CircleAlert size={19}/>
                  <div><p>{threadError}</p><button className="text-button" onClick={() => void loadThread(selectedId)}>Try loading the discussion again</button></div>
                </div>
              )}

              {thread && (
                <article className="surface forum-thread" aria-busy={threadLoading}>
                  <div className="forum-post-meta">
                    <button className="forum-club-badge" onClick={() => {setClubId(thread.club_id); setSelectedId('');}}>
                      <MessageSquare size={14}/>{cleanName(thread.club_name)}
                    </button>
                    <time dateTime={thread.created_at}>{postedAt(thread.created_at)}</time>
                  </div>
                  <h2 className="forum-thread-title" ref={threadHeading} tabIndex={-1}>{thread.title}</h2>
                  <Author name={thread.author_name}/>
                  <div className="forum-body">{thread.body}</div>
                  <div className="forum-thread-actions">
                    <span className="forum-comment-count"><MessageCircle size={17}/>{thread.comment_count} {thread.comment_count === 1 ? 'comment' : 'comments'}</span>
                    {thread.can_delete && <button className="text-button forum-delete-action" onClick={() => confirmDelete({kind: 'post', id: thread.id})} disabled={deleting}><Trash2 size={15}/>Delete post</button>}
                  </div>
                  {deleteConfirmation({kind: 'post', id: thread.id})}
                  <ReportForm kind="forum_post" id={thread.id}/>

                  <section className="forum-comments" aria-label="Comments">
                    <div className="forum-comments-heading"><h3>The conversation</h3><span>Oldest first</span></div>
                    {!comments.length && <p className="forum-first-comment">No comments yet. A good conversation starts with one hello.</p>}
                    {comments.map(comment => (
                      <article className="forum-comment" key={comment.id}>
                        <div className="forum-comment-heading"><Author name={comment.author_name}/><time dateTime={comment.created_at}>{postedAt(comment.created_at)}</time></div>
                        <p className="forum-body">{comment.body}</p>
                        {comment.can_delete && <button className="text-button forum-delete-action" onClick={() => confirmDelete({kind: 'comment', id: comment.id})} disabled={deleting}><Trash2 size={14}/>Delete comment</button>}
                        {deleteConfirmation({kind: 'comment', id: comment.id})}
                        <ReportForm kind="forum_comment" id={comment.id}/>
                      </article>
                    ))}
                  </section>

                  {thread.comment_count >= 1000 ? (
                    <p className="forum-comment-limit">This discussion has reached its 1,000-comment limit. You can start a new club discussion to continue the conversation.</p>
                  ) : user ? (
                    <form className="form-stack forum-comment-form" onSubmit={publishComment}>
                      <label htmlFor="forum-comment-draft">Join the conversation<textarea id="forum-comment-draft" value={commentDraft} onChange={event => setCommentDraft(event.target.value)} placeholder="Add something helpful or say hello…" rows={4} required maxLength={3000} disabled={commenting}/></label>
                      <div className="forum-composer-note"><span>{PRIVACY_NOTE}</span><span>{commentDraft.length.toLocaleString()}/3,000</span></div>
                      <ErrorMessage message={commentError}/>
                      <button className="button button-primary" type="submit" disabled={commenting || !commentDraft.trim()}>
                        {commenting ? <LoaderCircle size={17} className="spin"/> : <Send size={17}/>}
                        {commenting ? 'Posting…' : 'Post comment'}
                      </button>
                    </form>
                  ) : (
                    <div className="forum-sign-in"><MessageCircle size={24}/><div><h3>Your voice belongs here, too.</h3><p>Sign in to write a comment or start your own discussion.</p></div><button className="button button-secondary" onClick={onSignIn}>Sign in</button></div>
                  )}
                </article>
              )}
            </>
          ) : (
            <>
              <div className="forum-filter-bar">
                <div className="search-input"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} maxLength={500} placeholder="Search posts and club conversations" aria-label="Search forum posts"/>{query && <button className="icon-button clear-button" onClick={() => setQuery('')} aria-label="Clear forum search"><X size={16}/></button>}</div>
                <label className="select-filter"><span className="sr-only">Filter discussions by club</span><select value={clubId} onChange={event => setClubId(event.target.value)}><option value="">All clubs</option>{sortedClubs.map(club => <option key={club.id} value={club.id}>{cleanName(club.name)}</option>)}</select><ChevronDown size={15}/></label>
              </div>
              <div className="forum-feed-heading">
                <h2>{clubId ? 'Club discussions' : 'Campus conversations'}</h2>
                <label className="forum-sort">Sort by<select value={sort} onChange={event => setSort(event.target.value as 'newest' | 'active')} aria-label="Sort discussions"><option value="newest">Newest</option><option value="active">Recently active</option></select><ChevronDown size={13}/></label>
              </div>
              <p className="forum-feed-limit">Up to 100 matching discussions appear here. Search or choose a club to find a specific conversation.</p>

              {feedError && <div className="forum-fetch-error" role="alert"><CircleAlert size={19}/><div><p>{feedError}</p><button className="text-button" onClick={() => void loadFeed()}>Try loading discussions again</button></div></div>}
              {feedLoading && !posts.length && <Loading message="Finding the conversations…"/>}
              {feedLoading && posts.length > 0 && <p className="forum-refreshing" role="status"><LoaderCircle size={15} className="spin"/>Updating discussions…</p>}
              <div className="forum-feed" aria-busy={feedLoading}>
                {!feedError && posts.map(item => (
                  <article className="surface forum-post-card" key={item.id}>
                    <div className="forum-post-meta"><button className="forum-club-badge" onClick={() => setClubId(item.club_id)}><MessageSquare size={14}/>{cleanName(item.club_name)}</button><time dateTime={item.created_at}>{postedAt(item.created_at)}</time></div>
                    <h3><a className="forum-post-link" href={`/forums/${encodeURIComponent(item.id)}`} onClick={event => {if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {event.preventDefault(); openThread(item.id);}}}>{item.title}</a></h3>
                    <p className="forum-post-preview">{item.body}</p>
                    <div className="forum-card-footer"><Author name={item.author_name}/><button className="forum-comment-link" onClick={() => openThread(item.id)} aria-label={`${item.comment_count} ${item.comment_count === 1 ? 'comment' : 'comments'} on ${item.title}`}><MessageCircle size={17}/>{item.comment_count} {item.comment_count === 1 ? 'comment' : 'comments'}</button></div>
                  </article>
                ))}
              </div>
              {!feedLoading && !feedError && !posts.length && <div className="surface empty-state forum-empty"><MessageSquare size={33}/><h2>{query.trim() || clubId ? 'No discussions match yet.' : 'The conversation starts here.'}</h2><p>{query.trim() || clubId ? 'Try another search or club, or start a conversation of your own.' : 'Ask about a club, share an event idea, or find someone to join you. Be the first to post.'}</p>{(query.trim() || clubId) && <button className="text-button" onClick={() => {setQuery(''); setClubId('');}}>Clear filters</button>}<button className="button button-primary" onClick={startPost} disabled={!clubs.length}><Plus size={17}/>Start a discussion</button></div>}
            </>
          )}
        </div>

        <aside className="forum-aside">
          {selectedClub && <section className="surface forum-community"><span className="forum-community-mark"><MessageSquare size={24}/></span><span className="category-label">THE COMMUNITY</span><h2>{cleanName(selectedClub.name)}</h2><p>{selectedClub.description}</p><a className="text-button" href={`/clubs/${encodeURIComponent(selectedClub.id)}`}>Get to know the club<ArrowUpRight size={16}/></a></section>}
          <section className="surface forum-guidelines"><ShieldCheck size={25}/><h2>A little kindness goes a long way.</h2><p>A space for club questions, shared ideas, and finding your people.</p><ul><li>Keep discussions connected to the club.</li><li>Be welcoming. Different experiences belong here.</li><li>Protect your privacy and other people’s. Leave contact details and sensitive information out.</li></ul><p className="forum-guideline-note">{PRIVACY_NOTE} Community posts are user contributions, not official club announcements.</p></section>
        </aside>
      </div>

      {newPostOpen && <Dialog title="Start a conversation" wide onClose={() => {if (!publishing) setNewPostOpen(false);}}>
        <p className="dialog-description">A question, a plan, or an idea worth sharing. Choose a club to give it a home.</p>
        <form className="form-stack forum-new-post-form" onSubmit={publishPost}>
          <label htmlFor="forum-post-club">Club<select id="forum-post-club" value={draftClubId} onChange={event => setDraftClubId(event.target.value)} required disabled={publishing}><option value="">Choose a club</option>{sortedClubs.map(club => <option key={club.id} value={club.id}>{cleanName(club.name)}</option>)}</select></label>
          <label htmlFor="forum-post-title">Title<input id="forum-post-title" value={draftTitle} onChange={event => setDraftTitle(event.target.value)} required minLength={3} maxLength={160} disabled={publishing} placeholder="What’s on your mind?"/></label>
          <label htmlFor="forum-post-body">Your post<textarea id="forum-post-body" value={draftBody} onChange={event => setDraftBody(event.target.value)} required maxLength={10000} disabled={publishing} rows={8} placeholder="Add a little context and give the conversation somewhere to start."/></label>
          <div className="forum-composer-note"><span>{PRIVACY_NOTE}</span><span>{draftBody.length.toLocaleString()}/10,000</span></div>
          <ErrorMessage message={postError}/>
          <div className="forum-new-post-actions"><button type="button" className="button button-secondary" disabled={publishing} onClick={() => setNewPostOpen(false)}>Keep draft for later</button><button type="submit" className="button button-primary" disabled={publishing || !draftClubId || draftTitle.trim().length < 3 || !draftBody.trim()}>{publishing ? <LoaderCircle size={17} className="spin"/> : <Send size={17}/>} {publishing ? 'Publishing…' : 'Publish post'}</button></div>
        </form>
      </Dialog>}
    </div>
  );
}

function Author({name}: {name: string}) {
  return <span className="forum-author"><span className="forum-author-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span><span>{name}</span></span>;
}

function Loading({message}: {message: string}) {
  return <div className="forum-loading" role="status"><LoaderCircle size={24} className="spin"/><p>{message}</p></div>;
}
