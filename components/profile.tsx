'use client';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Bookmark, CalendarDays, Camera, Check, ChevronRight, CircleHelp, Globe2, LoaderCircle, Lock, LogOut, MessageSquare, Pencil, ShieldCheck, Trash2, Users, X} from 'lucide-react';
import {api, put, cleanName, relativeTime, CAMPUSES, INTERESTS, MAJORS, REFERENCE_DATE, type ActivityItem, type CampusEvent, type Club, type ProfileEvent, type ProfileSummary, type StudentProfile, type User} from '@/lib/api';
import {ErrorMessage, SubmitButton} from './account';
import UserAvatar from './avatar';
import Dialog from './dialog';
import {EventRow} from './event-calendar';
import {ClubArt} from './visuals';

export type ProfileTab = 'clubs' | 'events' | 'saved' | 'activity';
const TABS: {id: ProfileTab; label: string}[] = [{id: 'clubs', label: 'My Clubs'}, {id: 'events', label: 'Events'}, {id: 'saved', label: 'Saved'}, {id: 'activity', label: 'Activity'}];
const YEARS = Array.from({length: 15}, (_, i) => 2020 + i);
const USERNAME = /^(?![.])(?!.*[.]$)[a-z0-9_.]{3,30}$/;

/** "Computer Science · Class of 2028 · Busch", skipping whatever isn't filled in. */
export function profileLine(person: Pick<User, 'major' | 'grad_year' | 'campus'>) {
  return [person.major, person.grad_year && `Class of ${person.grad_year}`, person.campus].filter(Boolean).join(' · ');
}

/** Demo events are dated around the demo reference day; everything else around today. */
function isPast(event: CampusEvent) {
  const now = event.is_demo ? Date.parse(REFERENCE_DATE) : Date.now();
  return Date.parse(event.ends_at || event.starts_at) < now;
}

type Props = {
  user: User; managedClubs: Club[]; tab: ProfileTab; onTab: (tab: ProfileTab) => void;
  /** Changes whenever follows or saves change elsewhere, so the summary is refetched. */
  refreshKey: string;
  savedEventIds: string[];
  onUser: (user: User) => void; onOpenClub: (club: Club) => void; onOpenEvent: (event: CampusEvent) => void;
  onFollow: (club: Club) => Promise<void> | void; onLater: (club: Club) => Promise<void> | void; onSaveEvent: (event: CampusEvent) => Promise<void> | void;
  onManage: () => void; onLogout: () => void; onDeleted: () => void; onExplore: (where: 'discover' | 'events' | 'forums') => void;
};

export function ProfilePage({user, managedClubs, tab, onTab, refreshKey, savedEventIds, onUser, onOpenClub, onOpenEvent, onFollow, onLater, onSaveEvent, onManage, onLogout, onDeleted, onExplore}: Props) {
  const [summary, setSummary] = useState<ProfileSummary | null>(null); const [error, setError] = useState(''); const [editing, setEditing] = useState(false);
  const [eventFilter, setEventFilter] = useState<'upcoming' | 'past'>('upcoming');
  const load = useRef(0);
  useEffect(() => {
    const call = ++load.current; setError('');
    api<ProfileSummary>('/profile/summary').then(result => {if (call === load.current) setSummary(result);}).catch(e => {if (call === load.current) setError((e as Error).message);});
  }, [refreshKey, user.id]);
  const handle = user.username ? `@${user.username}` : null;
  const line = profileLine(user);
  const stats = summary?.stats;
  const upcoming = summary?.events.filter(e => !isPast(e)) ?? [];
  const past = (summary?.events.filter(isPast) ?? []).reverse();
  const shownEvents = eventFilter === 'upcoming' ? upcoming : past;
  const savedEvents = summary?.events.filter(e => savedEventIds.includes(e.id) && !isPast(e)) ?? [];

  return <div className="profile-page">
    <section className="profile-hero surface" aria-labelledby="profile-name">
      <div className="profile-identity">
        <button className="profile-photo plain-button" onClick={() => setEditing(true)} aria-label="Change profile photo"><UserAvatar name={user.display_name} url={user.avatar_url} size={88}/><span className="profile-photo-badge" aria-hidden="true"><Camera size={14}/></span></button>
        <div className="profile-names">
          <h2 id="profile-name">{user.display_name}</h2>
          <p className="profile-handle">{handle ?? <button className="inline-link" onClick={() => setEditing(true)}>Choose a username</button>}<span className={`visibility-badge ${user.profile_visibility}`}>{user.profile_visibility === 'students' ? <><Globe2 size={12}/>Visible to students</> : <><Lock size={12}/>Private</>}</span></p>
          {line && <p className="profile-line">{line}</p>}
        </div>
      </div>
      {user.bio ? <p className="profile-bio">{user.bio}</p> : <p className="profile-bio muted">No bio yet. <button className="inline-link" onClick={() => setEditing(true)}>Add one</button></p>}
      {user.interests.length > 0 && <ul className="profile-tags" aria-label="Interests">{user.interests.map(i => <li key={i}>{i}</li>)}</ul>}
      <ul className="profile-stats" aria-label="Your activity" aria-busy={!stats}>
        {[{key: 'clubs', label: 'Clubs', value: stats?.clubs, tab: 'clubs' as const}, {key: 'events', label: 'Events going', value: stats?.events_going, tab: 'events' as const}, {key: 'saved', label: 'Saved', value: stats?.saved, tab: 'saved' as const}, {key: 'posts', label: 'Posts', value: stats?.posts, tab: 'activity' as const}].map(s =>
          <li key={s.key}><button className="profile-stat plain-button" onClick={() => onTab(s.tab)}><strong className="tabular">{s.value ?? '–'}</strong><span>{s.label}</span></button></li>)}
      </ul>
      <button className="button button-secondary full-width" onClick={() => setEditing(true)}><Pencil size={16}/>Edit profile</button>
    </section>

    <div className="profile-tabs segmented" role="tablist" aria-label="Profile sections">{TABS.map(t => <button key={t.id} id={`profile-tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls="profile-tabpanel" className={tab === t.id ? 'selected' : ''} onClick={() => onTab(t.id)}>{t.label}</button>)}</div>

    <section id="profile-tabpanel" role="tabpanel" aria-labelledby={`profile-tab-${tab}`} className="profile-panel">
      {error ? <div className="surface empty-state"><CircleHelp size={28}/><h3>Couldn’t load your profile</h3><p>{error}</p><button className="button button-secondary" onClick={() => {load.current++; setSummary(null); api<ProfileSummary>('/profile/summary').then(setSummary).catch(e => setError((e as Error).message));}}>Try again</button></div>
      : !summary ? <div className="loading-state" role="status"><LoaderCircle className="spin" size={22}/>Loading your profile…</div>
      : tab === 'clubs' ? <>
          {managedClubs.length > 0 && <div className="profile-group"><h3>Clubs you manage</h3><div className="club-rows">{managedClubs.map(club => <ClubRow key={club.id} club={club} note="Owner" onOpen={() => onOpenClub(club)}/>)}</div><button className="text-button" onClick={onManage}>Open club manager<ChevronRight size={16}/></button></div>}
          <div className="profile-group"><h3>Following</h3>{summary.clubs.length ? <div className="club-rows">{summary.clubs.map(club => <ClubRow key={club.id} club={club} note={club.category} onOpen={() => onOpenClub(club)} action={<button className="text-button" onClick={() => void onFollow(club)}>Unfollow</button>}/>)}</div> : <Empty icon={Users} title="You’re not following any clubs yet" text="Follow a club to keep it here and shape your suggestions." action="Find clubs" onAction={() => onExplore('discover')}/>}</div>
        </>
      : tab === 'events' ? <>
          <div className="segmented small-segmented" role="group" aria-label="Which events">{(['upcoming', 'past'] as const).map(f => <button key={f} aria-pressed={eventFilter === f} className={eventFilter === f ? 'selected' : ''} onClick={() => setEventFilter(f)}>{f === 'upcoming' ? 'Upcoming' : 'Past'}<span className="count">{(f === 'upcoming' ? upcoming : past).length}</span></button>)}</div>
          {shownEvents.length ? <div className="event-list surface">{shownEvents.map(event => <ProfileEventRow key={event.id} event={event} saved={savedEventIds.includes(event.id)} onOpen={() => onOpenEvent(event)} onSave={() => void onSaveEvent(event)}/>)}</div>
            : <Empty icon={CalendarDays} title={eventFilter === 'upcoming' ? 'No upcoming events' : 'No past events'} text={eventFilter === 'upcoming' ? 'Events you RSVP to or save show up here.' : 'Events you went to or saved will collect here after they happen.'} action="Browse events" onAction={() => onExplore('events')}/>}
          <p className="fine-print">“Going” means you RSVP’d; the app doesn’t track check-ins, so past events aren’t confirmed attendance.</p>
        </>
      : tab === 'saved' ? <>
          <div className="profile-group"><h3>Clubs to revisit</h3>{summary.later.length ? <div className="club-rows">{summary.later.map(club => <ClubRow key={club.id} club={club} note={club.category} onOpen={() => onOpenClub(club)} action={<button className="text-button" onClick={() => void onLater(club)}><X size={14}/>Remove</button>}/>)}</div> : <Empty icon={Bookmark} title="Nothing saved for later" text="Choose Later or Save on a club to keep it on this list." action="Go to Discover" onAction={() => onExplore('discover')}/>}</div>
          <div className="profile-group"><h3>Saved events</h3>{savedEvents.length ? <div className="event-list surface">{savedEvents.map(event => <EventRow key={event.id} event={event} saved onOpen={() => onOpenEvent(event)} onSave={() => void onSaveEvent(event)}/>)}</div> : <Empty icon={CalendarDays} title="No saved events" text="Save an event and it appears here." action="Browse events" onAction={() => onExplore('events')}/>}</div>
        </>
      : summary.activity.length ? <ul className="activity-list surface">{summary.activity.map(item => <ActivityRow key={`${item.kind}-${item.id}`} item={item}/>)}</ul>
        : <Empty icon={MessageSquare} title="No activity yet" text="Your forum posts and comments show up here." action="Open Social" onAction={() => onExplore('forums')}/>}
    </section>

    <AccountSettings user={user} onLogout={onLogout} onDeleted={onDeleted}/>
    {editing && <EditProfileDialog user={user} onClose={() => setEditing(false)} onSaved={next => {onUser(next); setEditing(false);}} onPhoto={onUser}/>}
  </div>;
}

function ClubRow({club, note, onOpen, action}: {club: Club; note: string; onOpen: () => void; action?: React.ReactNode}) {
  return <div className="club-row"><button className="club-row-main plain-button" onClick={onOpen}><ClubArt category={club.category} color={club.color} logo={club.logo_url}/><span><strong>{cleanName(club.name)}</strong><small>{note}</small></span><ChevronRight size={18} aria-hidden="true"/></button>{action}</div>;
}

function ProfileEventRow({event, saved, onOpen, onSave}: {event: ProfileEvent; saved: boolean; onOpen: () => void; onSave: () => void}) {
  return <div className="profile-event">{event.rsvp && <span className={`rsvp-badge ${event.rsvp}`}>{event.rsvp === 'going' ? <><Check size={12}/>Going</> : 'Interested'}</span>}<EventRow event={event} saved={saved} onOpen={onOpen} onSave={onSave}/></div>;
}

function ActivityRow({item}: {item: ActivityItem}) {
  return <li><a className="activity-row" href={`/forums/${encodeURIComponent(item.post_id)}`}><span className="activity-icon" aria-hidden="true"><MessageSquare size={16}/></span><span className="activity-copy"><span className="activity-kind">{item.kind === 'post' ? 'You posted in' : 'You commented in'} {cleanName(item.club_name)}</span><strong>{item.title}</strong>{item.excerpt && <span className="activity-excerpt">“{item.excerpt}”</span>}</span><time dateTime={item.created_at}>{relativeTime(item.created_at)}</time></a></li>;
}

function Empty({icon: Icon, title, text, action, onAction}: {icon: typeof Users; title: string; text: string; action: string; onAction: () => void}) {
  return <div className="surface empty-state compact-empty"><span className="empty-symbol"><Icon size={24}/></span><h3>{title}</h3><p>{text}</p><button className="button button-secondary" onClick={onAction}>{action}</button></div>;
}

function AccountSettings({user, onLogout, onDeleted}: {user: User; onLogout: () => void; onDeleted: () => void}) {
  const [deleting, setDeleting] = useState(false); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function deleteAccount() {setLoading(true); setError(''); try {await api('/auth/me', {method: 'DELETE'}); onDeleted();} catch (e) {setError((e as Error).message); setLoading(false);}}
  return <section className="surface account-settings" aria-labelledby="account-heading">
    <h3 id="account-heading"><ShieldCheck size={18}/>Privacy and account</h3>
    <p>{user.profile_visibility === 'students' ? 'Signed-in Rutgers students can open your profile from the forums. They see your name, username, photo, major, class year, campus, bio, and interests, never your email, goals, follows, or RSVPs.' : 'Your profile is private: only you can see it. Change this in Edit profile.'}</p>
    <p className="fine-print">Signed in as {user.email}. Your interests, major, goals, and follows shape suggestions. BetterGetInvolved is a student project, not an official Rutgers service.</p>
    <div className="account-actions"><button className="button button-outline" onClick={onLogout}><LogOut size={16}/>Sign out</button><button className="delete-button" onClick={() => setDeleting(true)}><Trash2 size={15}/>Delete my account and data</button></div>
    {deleting && <Dialog title="Delete your account?" onClose={() => setDeleting(false)}><p className="dialog-description">This permanently removes your profile, photo, preferences, follows, saved events, session, and forum posts and comments. Removing your posts also deletes other people’s replies to those posts. Type DELETE to confirm.</p><label className="form-stack">Confirmation<input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="DELETE"/></label><ErrorMessage message={error}/><button className="button button-danger full-width" disabled={confirm !== 'DELETE' || loading} onClick={deleteAccount}>Permanently delete account</button></Dialog>}
  </section>;
}

export function EditProfileDialog({user, onClose, onSaved, onPhoto}: {user: User; onClose: () => void; onSaved: (user: User) => void; onPhoto: (user: User) => void}) {
  const [name, setName] = useState(user.display_name); const [username, setUsername] = useState(user.username ?? ''); const [bio, setBio] = useState(user.bio);
  const [major, setMajor] = useState(user.major); const [year, setYear] = useState(user.grad_year ? String(user.grad_year) : ''); const [campus, setCampus] = useState(user.campus);
  const [interests, setInterests] = useState(user.interests); const [goals, setGoals] = useState(user.goals); const [visibility, setVisibility] = useState(user.profile_visibility);
  const [photo, setPhoto] = useState(user.avatar_url); const [photoBusy, setPhotoBusy] = useState(false); const [photoError, setPhotoError] = useState('');
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const handle = username.trim().toLowerCase().replace(/^@/, '');
  const usernameError = handle && !USERNAME.test(handle) ? 'Use 3 to 30 letters, numbers, underscores, or periods (not at the start or end).' : '';
  const nameError = name.trim().length < 2 ? 'Enter at least 2 characters.' : '';

  async function uploadPhoto(file: File) {
    setPhotoError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {setPhotoError('Choose a PNG, JPEG, or WebP image.'); return;}
    if (file.size > 1024 * 1024) {setPhotoError('Photos can be at most 1 MB. Try a smaller image.'); return;}
    setPhotoBusy(true);
    try {
      // The raw image is sent; the server checks its bytes, not the file name.
      const response = await fetch('/api/profile/avatar', {method: 'PUT', credentials: 'include', headers: {'Content-Type': file.type}, body: file});
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `Upload failed (${response.status}). Please try again.`);
      setPhoto((body as User).avatar_url); onPhoto(body as User);
    } catch (e) {setPhotoError((e as Error).message);} finally {setPhotoBusy(false);}
  }
  async function removePhoto() {
    setPhotoBusy(true); setPhotoError('');
    try {const next = await api<User>('/profile/avatar', {method: 'DELETE'}); setPhoto(null); onPhoto(next);} catch (e) {setPhotoError((e as Error).message);} finally {setPhotoBusy(false);}
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (usernameError || nameError) return;
    setLoading(true);
    try {
      onSaved(await put<User>('/profile', {display_name: name.trim(), username: handle, bio: bio.trim(), major: major.trim(), grad_year: year ? Number(year) : 0, campus, interests, goals, profile_visibility: visibility, onboarded: true}));
    } catch (e) {setError((e as Error).message);} finally {setLoading(false);}
  }

  return <Dialog title="Edit profile" wide onClose={onClose}>
    <div className="photo-editor">
      <UserAvatar name={name || user.display_name} url={photo} size={72}/>
      <div><label className="button button-outline button-small file-button"><Camera size={15}/>{photo ? 'Change photo' : 'Add photo'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={photoBusy} onChange={e => {const file = e.target.files?.[0]; e.target.value = ''; if (file) void uploadPhoto(file);}}/></label>{photo && <button className="text-button" type="button" onClick={() => void removePhoto()} disabled={photoBusy}>Remove</button>}
        <p className="fine-print">{photoBusy ? 'Saving photo…' : 'PNG, JPEG, or WebP up to 1 MB. Photos save right away.'}</p><ErrorMessage message={photoError}/></div>
    </div>
    <form className="form-stack" onSubmit={submit} noValidate>
      <div className="form-columns">
        <label>Name<input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={80} aria-invalid={!!nameError} aria-describedby={nameError ? 'name-error' : undefined}/>{nameError && <span className="field-error" id="name-error">{nameError}</span>}</label>
        <label>Username<span className="prefixed-input"><span aria-hidden="true">@</span><input value={username} onChange={e => setUsername(e.target.value)} maxLength={31} autoCapitalize="none" autoComplete="username" spellCheck={false} placeholder="optional" aria-invalid={!!usernameError} aria-describedby={usernameError ? 'username-error' : undefined}/></span>{usernameError && <span className="field-error" id="username-error">{usernameError}</span>}</label>
      </div>
      <label>Bio<textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} maxLength={300} placeholder="A line or two about you"/><span className="char-count tabular" aria-live="polite">{bio.length}/300</span></label>
      <div className="form-columns three">
        <label>Major<input list="profile-majors" value={major} onChange={e => setMajor(e.target.value)} maxLength={100} placeholder="e.g. Computer Science"/><datalist id="profile-majors">{MAJORS.map(m => <option key={m} value={m}/>)}</datalist></label>
        <label>Class year<select value={year} onChange={e => setYear(e.target.value)}><option value="">Not shown</option>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
        <label>Home campus<select value={campus} onChange={e => setCampus(e.target.value)}><option value="">Not shown</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select></label>
      </div>
      <fieldset><legend>Interests</legend><div className="interest-picker">{INTERESTS.map(interest => <button key={interest} type="button" className={`interest-option ${interests.includes(interest) ? 'chosen' : ''}`} aria-pressed={interests.includes(interest)} onClick={() => setInterests(interests.includes(interest) ? interests.filter(i => i !== interest) : [...interests, interest])}>{interest}{interests.includes(interest) && <Check size={13}/>}</button>)}</div></fieldset>
      <label>Campus goals <span className="label-note">(private, used only for suggestions)</span><textarea value={goals} onChange={e => setGoals(e.target.value)} rows={2} maxLength={1000} placeholder="What are you hoping to find?"/></label>
      <fieldset className="visibility-choice"><legend>Who can see your profile</legend>
        <label className={`choice ${visibility === 'private' ? 'chosen' : ''}`}><input type="radio" name="visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')}/><Lock size={16}/><span><strong>Only me</strong><small>Nobody else can open your profile.</small></span></label>
        <label className={`choice ${visibility === 'students' ? 'chosen' : ''}`}><input type="radio" name="visibility" checked={visibility === 'students'} onChange={() => setVisibility('students')}/><Globe2 size={16}/><span><strong>Signed-in Rutgers students</strong><small>From your forum posts. Never your email, goals, follows, or RSVPs.</small></span></label>
      </fieldset>
      <ErrorMessage message={error}/>
      <div className="form-actions dialog-actions"><button className="button button-outline" type="button" onClick={onClose}>Cancel</button><SubmitButton loading={loading}>Save profile</SubmitButton></div>
    </form>
  </Dialog>;
}

/** Another student's profile, opened from a forum post. */
export function StudentProfileDialog({username, onClose}: {username: string; onClose: () => void}) {
  const [person, setPerson] = useState<StudentProfile | null>(null); const [error, setError] = useState('');
  useEffect(() => {api<StudentProfile>(`/users/${encodeURIComponent(username)}`).then(setPerson).catch(e => setError((e as Error).message));}, [username]);
  return <Dialog title={person ? person.display_name : 'Student profile'} onClose={onClose}>
    {error ? <p className="form-error" role="alert">{error}</p> : !person ? <div className="loading-state" role="status"><LoaderCircle className="spin" size={22}/>Loading…</div> : <div className="student-profile">
      <UserAvatar name={person.display_name} url={person.avatar_url} size={72}/>
      <p className="profile-handle">@{person.username}</p>
      {profileLine(person) && <p className="profile-line">{profileLine(person)}</p>}
      {person.bio && <p className="profile-bio">{person.bio}</p>}
      {person.interests.length > 0 && <ul className="profile-tags" aria-label="Interests">{person.interests.map(i => <li key={i}>{i}</li>)}</ul>}
      <p className="fine-print">{person.display_name.split(' ')[0]} shares this profile with signed-in Rutgers students.</p>
    </div>}
  </Dialog>;
}
