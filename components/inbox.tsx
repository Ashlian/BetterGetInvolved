'use client';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {ArrowLeft, Ban, Bell, CalendarDays, CalendarX2, CheckCheck, Inbox as InboxIcon, LoaderCircle, Megaphone, MessageCircle, MessageSquare, MessagesSquare, Send} from 'lucide-react';
import {api, post, cleanName, dateFormat, relativeTime, type Conversation, type ConversationThread, type Inbox, type Notification, type Unread} from '@/lib/api';
import {ErrorMessage} from './account';
import UserAvatar from './avatar';
import {ReportForm} from './detail-dialogs';
import {ClubArt} from './visuals';
import '@/app/inbox.css';

export type InboxTab = 'messages' | 'notifications';
const MESSAGE_MAX = 2000;
const THREAD_POLL_MS = 10000;

/** A message box that clears only once the message was accepted. */
export function MessageComposer({label, placeholder, button = 'Send', onSend, autoFocus = false}: {label: string; placeholder: string; button?: string; onSend: (body: string) => Promise<void>; autoFocus?: boolean}) {
  const [draft, setDraft] = useState(''); const [sending, setSending] = useState(false); const [error, setError] = useState('');
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim(); if (!body || sending) return;
    setSending(true); setError('');
    try {await onSend(body); setDraft('');} catch (e) {setError((e as Error).message);} finally {setSending(false);}
  }
  return <form className="message-composer" onSubmit={event => void submit(event)}>
    <textarea aria-label={label} placeholder={placeholder} value={draft} onChange={e => setDraft(e.target.value)} rows={2} maxLength={MESSAGE_MAX} autoFocus={autoFocus} onKeyDown={e => {if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();}}/>
    <ErrorMessage message={error}/>
    <div className="composer-row">{draft.length > MESSAGE_MAX - 300 && <span className="char-count tabular">{draft.length}/{MESSAGE_MAX}</span>}<button className="button button-primary button-small" disabled={sending || !draft.trim()}>{sending ? <LoaderCircle size={15} className="spin"/> : <Send size={15}/>}{sending ? 'Sending…' : button}</button></div>
  </form>;
}

type Props = {
  tab: InboxTab; onTab: (tab: InboxTab) => void;
  conversationId: string | null; onConversation: (id: string | null) => void;
  unread: Unread; onUnread: (unread: Unread) => void;
  onOpenProfile: (id: string) => void; onOpenClub: (id: string) => void; onOpenEvent: (id: string) => void;
};

export default function InboxPage({tab, onTab, conversationId, onConversation, unread, onUnread, onOpenProfile, onOpenClub, onOpenEvent}: Props) {
  const [inbox, setInbox] = useState<Inbox | null>(null); const [error, setError] = useState('');
  const request = useRef(0);
  const load = useCallback(async () => {
    const call = ++request.current;
    try {const next = await api<Inbox>('/inbox'); if (call === request.current) {setInbox(next); setError(''); onUnread(next.unread);}}
    catch (e) {if (call === request.current) setError((e as Error).message);}
  }, [onUnread]);
  // Reload when the unread totals change (the app polls them) so the list keeps up.
  useEffect(() => {void load();}, [load, unread.messages, unread.notifications]);

  async function markRead(id?: string) {
    try {
      const next = await post<Unread>('/notifications/read', id ? {id} : {});
      request.current++; // An older list must not bring the unread dots back.
      setInbox(current => current && {...current, unread: next, notifications: current.notifications.map(n => !id || n.id === id ? {...n, read: true} : n)});
      onUnread(next);
    } catch (e) {setError((e as Error).message);}
  }
  function openNotification(item: Notification) {
    if (!item.read) void markRead(item.id);
    if (item.event_id) onOpenEvent(item.event_id);
  }

  return <div className="inbox-page">
    <div className="segmented view-switch" role="tablist" aria-label="Inbox sections">
      <button id="inbox-tab-messages" role="tab" aria-selected={tab === 'messages'} aria-controls="inbox-panel" className={tab === 'messages' ? 'selected' : ''} onClick={() => onTab('messages')}><MessageCircle size={16}/>Messages{unread.messages > 0 && <span className="count">{unread.messages}</span>}</button>
      <button id="inbox-tab-notifications" role="tab" aria-selected={tab === 'notifications'} aria-controls="inbox-panel" className={tab === 'notifications' ? 'selected' : ''} onClick={() => onTab('notifications')}><Bell size={16}/>Notifications{unread.notifications > 0 && <span className="count">{unread.notifications}</span>}</button>
    </div>
    <div id="inbox-panel" role="tabpanel" aria-labelledby={`inbox-tab-${tab}`}>
      {error && <div className="inbox-error"><ErrorMessage message={error}/><button className="text-button" onClick={() => void load()}>Try again</button></div>}
      {!inbox ? !error && <div className="loading-state" role="status"><LoaderCircle className="spin" size={22}/>Loading your inbox…</div>
      : tab === 'messages' ? <div className={`inbox-layout ${conversationId ? 'has-thread' : ''}`}>
          <section className="conversation-list surface" aria-label="Conversations">
            {inbox.conversations.length ? <ul>{inbox.conversations.map(item => <li key={item.id}><ConversationRow item={item} selected={item.id === conversationId} onOpen={() => onConversation(item.id)}/></li>)}</ul>
              : <div className="empty-state compact-empty"><span className="empty-symbol"><MessagesSquare size={24}/></span><h3>No messages yet</h3><p>Open a student’s profile to message them, or use “Ask about this club” on any club page.</p></div>}
          </section>
          {conversationId ? <Thread key={conversationId} id={conversationId} onBack={() => onConversation(null)} onChanged={load} onUnread={onUnread} onOpenProfile={onOpenProfile} onOpenClub={onOpenClub}/>
            : inbox.conversations.length > 0 && <div className="thread-placeholder surface"><InboxIcon size={28}/><p>Choose a conversation.</p></div>}
        </div>
      : inbox.notifications.length ? <>
          <div className="notification-bar"><button className="text-button" disabled={!unread.notifications} onClick={() => void markRead()}><CheckCheck size={16}/>Mark all as read</button></div>
          <ul className="notification-list surface">{inbox.notifications.map(item => <li key={item.id}><NotificationRow item={item} onOpen={() => openNotification(item)}/></li>)}</ul>
        </>
      : <div className="surface empty-state compact-empty"><span className="empty-symbol"><Bell size={24}/></span><h3>No notifications yet</h3><p>Replies to your posts, announcements from clubs you follow, and changes to your events show up here.</p></div>}
    </div>
  </div>;
}

function ConversationRow({item, selected, onOpen}: {item: Conversation; selected: boolean; onOpen: () => void}) {
  const clubName = item.club ? cleanName(item.club.name) : '';
  return <button className={`conversation-row plain-button ${selected ? 'selected' : ''} ${item.unread ? 'unread' : ''}`} onClick={onOpen} aria-current={selected ? 'true' : undefined}>
    {item.kind === 'club' && item.side === 'student' && item.club ? <ClubArt category={item.club.category} color={item.club.color} logo={item.club.logo_url} size="small"/> : <UserAvatar name={item.title} url={item.person?.avatar_url} size={42}/>}
    <span className="conversation-copy">
      <span className="conversation-top"><strong>{cleanName(item.title)}</strong><time dateTime={item.last_message_at}>{relativeTime(item.last_message_at)}</time></span>
      {item.side === 'club' && <span className="conversation-context">Question for {clubName}</span>}
      <span className="conversation-preview">{item.last_is_mine && 'You: '}{item.last_message}</span>
      {(item.request || item.needs_reply) && <span className="conversation-flag">{item.request ? 'Message request' : 'Needs a reply'}</span>}
    </span>
    {item.unread > 0 && <span className="unread-badge"><span className="sr-only">Unread: </span>{item.unread}</span>}
  </button>;
}

function Thread({id, onBack, onChanged, onUnread, onOpenProfile, onOpenClub}: {id: string; onBack: () => void; onChanged: () => Promise<void>; onUnread: (unread: Unread) => void; onOpenProfile: (id: string) => void; onOpenClub: (id: string) => void}) {
  const [thread, setThread] = useState<ConversationThread | null>(null); const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null); const request = useRef(0); const changed = useRef(onChanged); changed.current = onChanged;
  const load = useCallback(async () => {
    const call = ++request.current;
    try {
      const next = await api<ConversationThread>(`/conversations/${encodeURIComponent(id)}`);
      if (call !== request.current) return;
      setThread(next); setError('');
      if (next.unread) {onUnread(await post<Unread>(`/conversations/${encodeURIComponent(id)}/read`)); void changed.current();}
    } catch (e) {if (call === request.current) setError((e as Error).message);}
  }, [id, onUnread]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {if (document.visibilityState === 'visible') void load();}, THREAD_POLL_MS);
    return () => {clearInterval(timer); request.current++;};
  }, [load]);
  const newest = thread?.messages[thread.messages.length - 1]?.id;
  useEffect(() => {if (newest) end.current?.scrollTo({top: end.current.scrollHeight});}, [newest]);

  async function send(body: string) {
    const next = await post<ConversationThread>(`/conversations/${encodeURIComponent(id)}/messages`, {body});
    request.current++; setThread(next); void changed.current();
  }
  async function unblock() {
    if (!thread?.person) return;
    try {await api(`/users/${encodeURIComponent(thread.person.id)}/block`, {method: 'DELETE'}); await load();} catch (e) {setError((e as Error).message);}
  }
  if (!thread) return <section className="thread surface"><button className="text-button thread-back" onClick={onBack}><ArrowLeft size={16}/>All messages</button>{error ? <ErrorMessage message={error}/> : <div className="loading-state" role="status"><LoaderCircle className="spin" size={22}/>Loading…</div>}</section>;
  const clubName = thread.club ? cleanName(thread.club.name) : '';
  return <section className="thread surface" aria-label={`Conversation with ${cleanName(thread.title)}`}>
    <header className="thread-header">
      <button className="icon-button thread-back" onClick={onBack} aria-label="All messages"><ArrowLeft size={18}/></button>
      <button className="thread-person plain-button" onClick={() => thread.person ? onOpenProfile(thread.person.id) : thread.club && onOpenClub(thread.club.id)} aria-label={thread.person ? `View ${thread.title}’s profile` : `View ${clubName}`}>
        {thread.person ? <UserAvatar name={thread.title} url={thread.person.avatar_url} size={38}/> : thread.club && <ClubArt category={thread.club.category} color={thread.club.color} logo={thread.club.logo_url} size="small"/>}
        <span><strong>{cleanName(thread.title)}</strong><small>{thread.side === 'club' ? `Asking ${clubName} · any manager can reply` : thread.kind === 'club' ? 'Every manager of this club can read and reply' : 'Direct message'}</small></span>
      </button>
    </header>
    {thread.request && <p className="thread-note">This is their first message to you. They can’t send another until you reply.</p>}
    <div className="thread-messages" ref={end} role="log" aria-live="polite" tabIndex={0} aria-label="Messages">
      {thread.messages.map((message, index) => {
        const own = message.mine; const sameSide = thread.side === 'club' ? message.as_club : own;
        const newDay = index === 0 || dayOf(message.created_at) !== dayOf(thread.messages[index - 1].created_at);
        return <div key={message.id}>
          {newDay && <p className="thread-day">{dayOf(message.created_at)}</p>}
          <div className={`bubble-row ${sameSide ? 'mine' : ''}`}><div className="bubble"><span className="sr-only">{own ? 'You' : message.author_name}: </span>{thread.kind === 'club' && !own && <span className="bubble-author">{message.author_name}{message.as_club && ' · Club manager'}</span>}<p>{message.body}</p><time dateTime={message.created_at}>{dateFormat(message.created_at, {hour: 'numeric', minute: '2-digit'})}</time></div></div>
        </div>;
      })}
    </div>
    <ErrorMessage message={error}/>
    {thread.can_reply ? <MessageComposer label="Write a message" placeholder={thread.side === 'club' ? `Reply for ${clubName}` : 'Write a message'} onSend={send}/> : <p className="thread-note"><Ban size={14}/>{thread.reply_note}{thread.blocked_by_me && <button className="inline-link" onClick={() => void unblock()}>Unblock</button>}</p>}
    <ReportForm kind="conversation" id={thread.id}/>
  </section>;
}

const dayOf = (iso: string) => dateFormat(iso, {weekday: 'short', month: 'short', day: 'numeric'});

const NOTICE: Record<Notification['kind'], {icon: typeof Bell; text: (n: Notification) => string}> = {
  comment: {icon: MessageSquare, text: n => `${n.actor_name ?? 'Someone'} commented on your post`},
  reply: {icon: MessagesSquare, text: n => `${n.actor_name ?? 'Someone'} replied in a discussion you joined`},
  announcement: {icon: Megaphone, text: n => `${cleanName(n.club_name)} posted an announcement`},
  event_new: {icon: CalendarDays, text: n => `${cleanName(n.club_name)} added an event`},
  event_changed: {icon: CalendarDays, text: () => 'The time or place changed for an event on your list'},
  event_cancelled: {icon: CalendarX2, text: () => 'An event on your list was cancelled'},
  event_back: {icon: CalendarDays, text: () => 'A cancelled event on your list is back on'},
};

function NotificationRow({item, onOpen}: {item: Notification; onOpen: () => void}) {
  const {icon: Icon, text} = NOTICE[item.kind] ?? {icon: Bell, text: () => 'Update'};
  const content = <><span className="activity-icon" aria-hidden="true"><Icon size={16}/></span><span className="activity-copy"><span className="activity-kind">{!item.read && <span className="sr-only">Unread. </span>}{text(item)}</span><strong>{item.title}</strong>{item.excerpt && <span className="activity-excerpt">“{item.excerpt}”</span>}</span><time dateTime={item.created_at}>{relativeTime(item.created_at)}</time></>;
  const className = `activity-row notification-row ${item.read ? '' : 'unread'}`;
  // Posts have their own page. keepalive lets the read request finish while the page changes.
  if (item.post_id) return <a className={className} href={`/forums/${encodeURIComponent(item.post_id)}`} onClick={() => {if (!item.read) void fetch('/api/notifications/read', {method: 'POST', credentials: 'include', keepalive: true, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: item.id})}).catch(() => undefined);}}>{content}</a>;
  return <button className={`${className} plain-button`} onClick={onOpen}>{content}</button>;
}
