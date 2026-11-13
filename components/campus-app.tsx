'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowUpRight, Bookmark, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Compass, FlaskConical, Heart, LoaderCircle, LogIn, MessageSquare, Radio, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Sun, Users, UserRound, X} from 'lucide-react';
import {api, post, cleanName, dateFormat, dateKey, eventEnd, eventTime, overlaps, relativeTime, CAMPUSES, REFERENCE_DATE, type Club, type Recommendation, type CampusEvent, type LiveStatus, type User, type Saved} from '@/lib/api';
import {AuthDialog, OnboardingDialog, ProfilePanel} from './account';
import ClubCard from './club-card';
import Dialog from './dialog';
import {ClubDetail, EventDetail} from './detail-dialogs';
import EventCalendar, {EventRow, easternDay} from './event-calendar';
import OfficerPanel from './officer-panel';
import ForumsPanel from './forums-panel';
import {CampusMark, ClubArt, campusSlug, categoryIcon} from './visuals';

type View = 'home' | 'discover' | 'events' | 'forums' | 'saved' | 'profile' | 'officer';
const EMPTY_SAVED: Saved = {club_ids: [], event_ids: [], dismissed_ids: [], maybe_later_ids: [], rsvps: {}};
const NAV = [{id: 'home' as const, title: 'Today', icon: Sun}, {id: 'discover' as const, title: 'Discover', icon: Compass}, {id: 'events' as const, title: 'Events', icon: CalendarDays}, {id: 'forums' as const, title: 'Forums', icon: MessageSquare}, {id: 'saved' as const, title: 'Saved', icon: Bookmark}];
const viewTitles: Record<View, string> = {home: 'Today', discover: 'Discover', events: 'Events', forums: 'Forums', saved: 'Saved', profile: 'Profile', officer: 'Manage'};
const INTEREST_SHORTCUTS = ['Technology', 'Arts & Music', 'Volunteering', 'Outdoors', 'Culture', 'Science'];

export default function CampusApp({initialClubId, initialEventId, initialForumPostId, initialView = 'home'}: {initialClubId?: string; initialEventId?: string; initialForumPostId?: string; initialView?: View} = {}) {
  const [view, setView] = useState<View>(initialView); const [directory, setDirectory] = useState(false);
  const [clubs, setClubs] = useState<Club[]>([]); const [recommendations, setRecommendations] = useState<Recommendation[]>([]); const [method, setMethod] = useState('');
  const [events, setEvents] = useState<CampusEvent[]>([]); const [user, setUser] = useState<User | null>(null); const [saved, setSaved] = useState<Saved>(EMPTY_SAVED);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(''); const [toast, setToast] = useState<{text: string; error?: boolean} | null>(null);
  const [authOpen, setAuthOpen] = useState(false); const [onboarding, setOnboarding] = useState(false); const [aboutOpen, setAboutOpen] = useState(false);
  const [clubDetail, setClubDetail] = useState<Club | null>(null); const [eventDetail, setEventDetail] = useState<CampusEvent | null>(null);
  const [globalSearch, setGlobalSearch] = useState(''); const [query, setQuery] = useState(''); const [campus, setCampus] = useState(''); const [category, setCategory] = useState(''); const [beginner, setBeginner] = useState(false);
  const [searchClubs, setSearchClubs] = useState<Club[]>([]); const [searching, setSearching] = useState(false); const [searchError, setSearchError] = useState(''); const [discoverIndex, setDiscoverIndex] = useState(0); const [sessionSkipped, setSessionSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [savedTab, setSavedTab] = useState<'clubs' | 'events' | 'later'>('clubs'); const [eventQuery, setEventQuery] = useState(''); const [eventCampus, setEventCampus] = useState('');
  const [eventResults, setEventResults] = useState<CampusEvent[]>([]); const [eventsSearching, setEventsSearching] = useState(false); const [eventsSearchError, setEventsSearchError] = useState('');
  const [liveEvents, setLiveEvents] = useState<CampusEvent[]>([]); const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null); const [eventSource, setEventSource] = useState<'live' | 'demo'>('live'); const [eventCategory, setEventCategory] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const openedInitial = useRef(false);
  const notify = useCallback((text: string, error = false) => setToast({text, error}), []);
  const refreshRecommendations = useCallback(async () => {
    const result = await api<{clubs: Recommendation[]; method: string}>('/recommendations?limit=24'); setRecommendations(result.clubs); setMethod(result.method);
  }, []);
  const refreshSaved = useCallback(async () => {setSaved(await api<Saved>('/saved'));}, []);
  // Club contacts depend on being signed in, so the catalog is re-fetched whenever that changes.
  const refreshClubs = useCallback(async () => {const next = await api<Club[]>('/clubs'); setClubs(next); setClubDetail(current => current ? next.find(c => c.id === current.id) ?? current : current); return next;}, []);
  const signInFromClub = useRef<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const results = await Promise.all([api<Club[]>('/clubs'), api<CampusEvent[]>('/events'), api<{clubs: Recommendation[]; method: string}>('/recommendations?limit=24'), api<User>('/auth/me').catch(() => null), api<CampusEvent[]>('/live/events').catch(() => []), api<LiveStatus>('/live/status').catch(() => null)]);
      setClubs(results[0]); setSearchClubs(results[0]); setEvents(results[1]); setRecommendations(results[2].clubs); setMethod(results[2].method); setUser(results[3]);
      // Live events are optional: if the feed is empty or unreachable, the demo calendar still works.
      setLiveEvents(results[4]); setLiveStatus(results[5]); setEventSource(results[4].length ? 'live' : 'demo'); setEventResults(results[4].length ? results[4] : results[1]);
      if (results[3]) setSaved(await api<Saved>('/saved')); else setSaved(EMPTY_SAVED);
    } catch (e) {setLoadError((e as Error).message);} finally {setLoading(false);}
  }, []);
  useEffect(() => {void load();}, [load]);
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer);}, []);
  useEffect(() => {if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 7000 : 4000); return () => clearTimeout(timer);}, [toast]);
  useEffect(() => {
    if (loading || loadError || openedInitial.current) return;
    if (initialClubId) {const club = clubs.find(c => c.id === initialClubId); if (club) setClubDetail(club); else notify('That club could not be found in the current demo data.', true);}
    if (initialEventId) {const event = [...events, ...liveEvents].find(e => e.id === initialEventId); if (event) setEventDetail(event); else void api<CampusEvent>(`/events/${encodeURIComponent(initialEventId)}`).then(setEventDetail).catch(() => notify('That event could not be found.', true));}
    openedInitial.current = true;
  }, [clubs, events, liveEvents, initialClubId, initialEventId, loading, loadError, notify]);
  useEffect(() => {
    if (view !== 'discover' || !directory) return;
    let active = true; setSearching(true); setSearchError('');
    const timer = setTimeout(async () => {
      const params = new URLSearchParams(); if (query) params.set('q', query); if (campus) params.set('campus', campus); if (category) params.set('category', category); if (beginner) params.set('beginner', 'true');
      try {const result = await api<Club[]>(`/clubs?${params}`); if (active) setSearchClubs(result);} catch (e) {if (active) {setSearchError((e as Error).message); setSearchClubs([]);}} finally {if (active) setSearching(false);}
    }, 300);
    return () => {active = false; clearTimeout(timer);};
  }, [view, directory, query, campus, category, beginner, user?.id]);
  useEffect(() => {
    if (view !== 'events') return;
    let active = true; setEventsSearching(true); setEventsSearchError('');
    const timer = setTimeout(async () => {
      const params = new URLSearchParams(); if (eventQuery) params.set('q', eventQuery); if (eventCampus) params.set('campus', eventCampus); if (eventSource === 'live' && eventCategory) params.set('category', eventCategory);
      try {const result = await api<CampusEvent[]>(`${eventSource === 'live' ? '/live/events' : '/events'}?${params}`); if (active) setEventResults(result);} catch (e) {if (active) {setEventsSearchError((e as Error).message); setEventResults([]);}} finally {if (active) setEventsSearching(false);}
    }, 300);
    return () => {active = false; clearTimeout(timer);};
  }, [view, eventQuery, eventCampus, eventCategory, eventSource]);

  function go(next: View, allClubs = false) {setView(next); if (next === 'discover') setDirectory(allClubs); window.scrollTo({top: 0, behavior: 'instant'});}
  function requireUser() {if (user) return true; setAuthOpen(true); return false;}
  async function follow(club: Club) {
    if (!requireUser() || busy) return; setBusy(true);
    try {const result = await post<{following: boolean}>(`/clubs/${club.id}/follow`); setSaved(s => ({...s, club_ids: result.following ? [...s.club_ids.filter(id => id !== club.id), club.id] : s.club_ids.filter(id => id !== club.id)})); notify(result.following ? `Following ${cleanName(club.name)}.` : `Unfollowed ${cleanName(club.name)}.`); void refreshRecommendations().catch(e => notify(e.message, true));}
    catch (e) {notify((e as Error).message, true);} finally {setBusy(false);}
  }
  async function saveEvent(event: CampusEvent) {
    if (!requireUser() || busy) return; setBusy(true);
    try {const result = await post<{saved: boolean}>(`/events/${event.id}/save`); setSaved(s => ({...s, event_ids: result.saved ? [...s.event_ids.filter(id => id !== event.id), event.id] : s.event_ids.filter(id => id !== event.id), live_events: event.live ? [...(s.live_events || []).filter(e => e.id !== event.id), ...(result.saved ? [event] : [])] : s.live_events})); notify(result.saved ? 'Event saved.' : 'Event removed from Saved.');}
    catch (e) {notify((e as Error).message, true);} finally {setBusy(false);}
  }
  async function bookmark(club: Club) {
    if (!requireUser() || busy) return; setBusy(true);
    try {const result = await post<{bookmarked: boolean}>(`/clubs/${club.id}/bookmark`); setSaved(s => ({...s, maybe_later_ids: result.bookmarked ? [...(s.maybe_later_ids || []).filter(id => id !== club.id), club.id] : (s.maybe_later_ids || []).filter(id => id !== club.id)})); notify(result.bookmarked ? 'Saved to Later.' : 'Removed from Later.'); if (result.bookmarked) setSessionSkipped(s => [...s, club.id]);}
    catch (e) {notify((e as Error).message, true);} finally {setBusy(false);}
  }
  const discoverClubs = (recommendations.length ? recommendations : clubs).filter(c => !saved.club_ids.includes(c.id) && !saved.dismissed_ids.includes(c.id) && !(saved.maybe_later_ids || []).includes(c.id) && !sessionSkipped.includes(c.id));
  const currentDiscover = discoverClubs[discoverIndex % (discoverClubs.length || 1)];
  async function decide(action: 'interested' | 'dismiss' | 'later') {
    if (!currentDiscover || busy) return;
    if (action === 'interested') {if (!requireUser()) return; await follow(currentDiscover); return;}
    if (action === 'later') {await bookmark(currentDiscover); return;}
    if (!user) {setSessionSkipped(s => [...s, currentDiscover.id]); return;}
    setBusy(true);
    try {const result = await post<{dismissed: boolean}>(`/clubs/${currentDiscover.id}/dismiss`); setSaved(s => ({...s, dismissed_ids: result.dismissed ? [...s.dismissed_ids, currentDiscover.id] : s.dismissed_ids.filter(id => id !== currentDiscover.id)})); notify('Passed. The club stays in the directory.');}
    catch (e) {notify((e as Error).message, true);} finally {setBusy(false);}
  }
  async function resetPasses() {
    if (busy) return; setBusy(true);
    try {for (const id of saved.dismissed_ids) await post(`/clubs/${id}/dismiss`); setSaved(s => ({...s, dismissed_ids: []})); setSessionSkipped([]); setDiscoverIndex(0); notify('Passed clubs are back in Discover.');}
    catch (e) {notify((e as Error).message, true); if (user) void refreshSaved();} finally {setBusy(false);}
  }
  useEffect(() => {
    if (view !== 'discover' || directory || clubDetail || eventDetail || authOpen || onboarding || aboutOpen) return;
    const key = (e: KeyboardEvent) => {if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return; if (e.key === 'ArrowLeft') {e.preventDefault(); void decide('dismiss');} if (e.key === 'ArrowRight') {e.preventDefault(); void decide('interested');} if (e.key === 'ArrowDown') {e.preventDefault(); void decide('later');}};
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  });
  async function authSuccess(next: User, isNew: boolean) {
    setUser(next); setAuthOpen(false);
    const nextClubs = await refreshClubs().catch(e => {notify(e.message, true); return null;});
    await refreshSaved().catch(e => notify(e.message, true)); await refreshRecommendations().catch(e => notify(e.message, true));
    // Reopen the club the student was viewing when they chose to sign in, now with contacts.
    const reopen = signInFromClub.current && nextClubs?.find(c => c.id === signInFromClub.current); signInFromClub.current = null;
    if (isNew) setOnboarding(true); else {if (reopen) setClubDetail(reopen); notify(`Welcome back, ${next.display_name.split(' ')[0]}.`);}
  }
  async function logout() {try {await post('/auth/logout'); setUser(null); setSaved(EMPTY_SAVED); setView('home'); void refreshClubs().catch(e => notify(e.message, true)); void refreshRecommendations().catch(e => notify(e.message, true)); notify('Signed out.');} catch (e) {notify((e as Error).message, true);}}
  async function profileSaved(next: User) {setUser(next); setOnboarding(false); await refreshRecommendations().catch(e => notify(e.message, true));}
  async function rsvp(status: 'going' | 'interested' | 'none') {if (!eventDetail) return; if (!user) {setEventDetail(null); setAuthOpen(true); return;} const result = await post<{status: string}>(`/events/${eventDetail.id}/rsvp`, {status}); setSaved(s => {const rsvps = {...s.rsvps}; if (result.status === 'none') delete rsvps[eventDetail.id]; else rsvps[eventDetail.id] = result.status as 'going' | 'interested'; return {...s, rsvps};}); notify(status === 'none' ? 'RSVP cleared.' : status === 'going' ? 'Marked as going.' : 'Marked as interested.');}
  function openEvent(event: CampusEvent) {setClubDetail(null); setEventDetail(event);}
  const upcoming = events.filter(e => e.status === 'scheduled' && new Date(e.starts_at) >= new Date(REFERENCE_DATE)).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const categories = [...new Set(clubs.map(c => c.category))].sort();
  const followedClubs = clubs.filter(c => saved.club_ids.includes(c.id));
  const laterClubs = clubs.filter(c => (saved.maybe_later_ids || []).includes(c.id));
  const savedEvents = [...events.filter(e => saved.event_ids.includes(e.id)), ...(saved.live_events || []).filter(e => saved.event_ids.includes(e.id))].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const conflicts = savedEvents.flatMap((event, index) => savedEvents.slice(index + 1).filter(other => overlaps(event, other)).map(other => ({event, other})));
  const detailConflicts = eventDetail ? savedEvents.filter(e => e.id !== eventDetail.id && overlaps(e, eventDetail)) : [];
  const recommended = recommendations.length ? recommendations.slice(0, 3) : clubs.filter(c => c.featured).slice(0, 3);

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {const onScroll = () => setScrolled(window.scrollY > 8); onScroll(); window.addEventListener('scroll', onScroll, {passive: true}); return () => window.removeEventListener('scroll', onScroll);}, []);
  const hasLive = liveEvents.length > 0;
  const todayIso = hasLive ? new Date(now).toISOString() : REFERENCE_DATE;
  const today = dateKey(todayIso);
  const routeSource = hasLive ? liveEvents.filter(e => e.status === 'scheduled' && eventEnd(e) > now) : upcoming;
  const tonight = routeSource.filter(e => dateKey(e.starts_at) === today);
  const stops = (tonight.length ? tonight : routeSource).slice(0, 4);
  const moreToday = Math.max(0, tonight.length - stops.length);
  const liveCategories = [...new Set(liveEvents.map(e => e.category))].sort();
  const liveNote = liveStatus?.synced_at ? `Live from Rutgers getINVOLVED and Rutgers Recreation via Scarlet Sync · checked ${relativeTime(liveStatus.synced_at)}` : '';
  const stopCampuses = new Set(stops.map(e => e.campus)).size;
  const steps = [{done: !!user?.interests.length, label: 'Choose your interests', action: () => user ? setOnboarding(true) : setAuthOpen(true)}, {done: saved.club_ids.length > 0, label: 'Follow a club', action: () => go('discover')}, {done: saved.event_ids.length > 0, label: 'Save an event', action: () => go('events')}];
  const firstName = user?.display_name.split(' ')[0];
  const isOfficer = !!user && user.role !== 'student';
  const subtitle: Record<View, string> = {
    home: '',
    discover: directory ? `Search all ${clubs.length} clubs by name, interest, or a plain-language request.` : 'Clubs introduced one at a time. Follow, keep for later, or pass.',
    events: eventSource === 'live' ? 'Real Rutgers–New Brunswick club, recreation, and game listings.' : 'Sample events from the demo clubs, for trying saves and RSVPs.',
    forums: 'Ask questions, share experiences, and talk about your clubs.',
    saved: 'Clubs you follow, events you saved, and clubs to revisit.',
    profile: 'Your interests, home campus, and privacy.',
    officer: 'Edit the clubs and events you manage.',
  };
  const avatar = user ? <span className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</span> : <span className="avatar avatar-empty"><UserRound size={18}/></span>;

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="sidebar glass" aria-label="Sidebar">
      <button className="brand plain-button" onClick={() => go('home')} aria-label="BetterGetInvolved, Today"><span className="brand-mark" aria-hidden="true">b</span><span className="brand-type">BetterGetInvolved<small>Rutgers–New Brunswick</small></span></button>
      <nav aria-label="Main navigation">{NAV.map(item => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => go(item.id)} aria-current={view === item.id ? 'page' : undefined}><item.icon size={20} strokeWidth={2}/><span>{item.title}</span></button>)}
        {isOfficer && <><p className="nav-label">Organizer</p><button className={`nav-item ${view === 'officer' ? 'active' : ''}`} onClick={() => go('officer')} aria-current={view === 'officer' ? 'page' : undefined}><Users size={20} strokeWidth={2}/><span>Manage</span></button></>}
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setAboutOpen(true)}><CircleHelp size={20} strokeWidth={2}/><span>About</span></button><button className={`account-row plain-button ${view === 'profile' ? 'active' : ''}`} onClick={() => user ? go('profile') : setAuthOpen(true)}>{avatar}<span><strong>{user?.display_name || 'Sign in'}</strong><small>{user ? 'Profile and interests' : 'Follow clubs, save events'}</small></span><ChevronRight size={16}/></button></div>
    </aside>
    <div className="workspace">
      <header className={`toolbar ${scrolled ? 'scrolled' : ''}`}><span className="toolbar-brand brand-mark" aria-hidden="true">b</span><span className="toolbar-title" aria-hidden={!scrolled}>{viewTitles[view]}</span><div className="toolbar-actions"><button className="demo-pill" onClick={() => setAboutOpen(true)}><span aria-hidden="true"/>Prototype</button><button className="toolbar-avatar plain-button" onClick={() => user ? go('profile') : setAuthOpen(true)} aria-label={user ? 'Open profile' : 'Sign in'}>{avatar}</button></div></header>
      <main className="main-content" id="main-content">
        <div className="page-header"><div>{view === 'home' && <p className="header-date">{dateFormat(todayIso, {weekday: 'long', month: 'long', day: 'numeric'})}</p>}<h1>{viewTitles[view]}</h1>{subtitle[view] && <p className="header-subtitle">{subtitle[view]}</p>}</div>
          {view === 'home' && <form className="search-input header-search" role="search" onSubmit={e => {e.preventDefault(); setQuery(globalSearch); go('discover', true);}}><Search size={18}/><input aria-label="Search all clubs" placeholder="Search clubs and interests" value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} enterKeyHint="search"/></form>}
        </div>
      {loading ? <div className="page-loading" role="status"><LoaderCircle size={28} className="spin"/><p>Loading clubs and events…</p></div> : loadError ? <div className="surface empty-state"><CircleHelp size={30}/><h2>Unable to load clubs and events</h2><p>{loadError}</p><p className="fine-print">Make sure the local API is running on port 8000, then try again.</p><button className="button button-primary" onClick={() => void load()}>Try again</button></div> : <>
        {view === 'home' && <div className="today-layout">
          <div className="today-main">
            <section className="route-card surface" aria-labelledby="route-heading">
              <div className="section-heading"><div><h2 id="route-heading">{tonight.length ? 'Today on campus' : 'Coming up'}</h2><p>{tonight.length || stops.length} {(tonight.length || stops.length) === 1 ? 'event' : 'events'}{stopCampuses > 0 && ` across ${stopCampuses} ${stopCampuses === 1 ? 'campus' : 'campuses'}`}</p></div><button className="text-button" onClick={() => go('events')}>All events<ChevronRight size={16}/></button></div>
              {stops.length ? <ol className="route">{stops.map(event => <li key={event.id} className={`stop ${event.campus ? `campus-${campusSlug(event.campus)}` : 'campus-none'}`}><button className="plain-button" onClick={() => openEvent(event)}><time className="stop-time tabular" dateTime={event.starts_at}>{eventTime(event.starts_at)}</time><span className="stop-body"><strong>{event.title}</strong><span>{cleanName(event.club_name)}</span></span><span className="stop-place">{event.campus ? <CampusMark campus={event.campus} short/> : <span className="campus">{event.location}</span>}{saved.event_ids.includes(event.id) && <span className="saved-flag"><Bookmark size={13} fill="currentColor"/>Saved</span>}</span></button></li>)}</ol> : <p className="empty-line">No upcoming events right now.</p>}{moreToday > 0 && <button className="text-button" onClick={() => go('events')}>{moreToday} more today<ChevronRight size={16}/></button>}<p className="route-source">{hasLive ? <><Radio size={14}/>{liveNote}</> : <><FlaskConical size={14}/>Demo events · the live feed is unavailable right now</>}</p>
            </section>
            <section aria-labelledby="interest-heading"><div className="section-heading"><h2 id="interest-heading">Browse by interest</h2></div>
              <div className="chip-row">{INTEREST_SHORTCUTS.map(name => {const Icon = categoryIcon(name); return <button key={name} className="chip" onClick={() => {setQuery(name); setCategory(''); setBeginner(false); go('discover', true);}}><Icon size={16}/>{name}</button>;})}<button className="chip" onClick={() => {setQuery(''); setBeginner(true); go('discover', true);}}><Check size={16}/>Beginner friendly</button></div>
            </section>
            <section aria-labelledby="for-you-heading"><div className="section-heading"><div><h2 id="for-you-heading">{user?.interests.length ? 'For you' : 'Good places to start'}</h2><p>{user?.interests.length ? 'Matched to the interests you chose.' : 'A mix of categories. Choose interests for personal suggestions.'}</p></div><button className="text-button" onClick={() => go('discover', true)}>All clubs<ChevronRight size={16}/></button></div>
              <div className="club-grid">{recommended.map(club => <ClubCard key={club.id} club={club} showReason={!!user?.interests.length} following={saved.club_ids.includes(club.id)} onOpen={() => setClubDetail(club)} onFollow={() => void follow(club)}/>)}</div>
              <p className="fine-print">Suggestions compare club descriptions with your interests. They don’t measure fit or belonging. <button className="inline-link" onClick={() => setAboutOpen(true)}>How suggestions work</button></p>
            </section>
          </div>
          <aside className="today-aside">
            <section className="surface steps-card" aria-labelledby="steps-heading"><h2 id="steps-heading">Getting started</h2><p>{steps.filter(s => s.done).length} of 3 done</p><div className="progress" aria-hidden="true"><span style={{width: `${steps.filter(s => s.done).length / 3 * 100}%`}}/></div>
              <ul>{steps.map(step => <li key={step.label}><button className="plain-button" onClick={step.action}><span className={`step-check ${step.done ? 'done' : ''}`}>{step.done && <Check size={13} strokeWidth={3}/>}</span><span>{step.label}{step.done && <span className="sr-only"> (done)</span>}</span><ChevronRight size={16}/></button></li>)}</ul>
              {!user && <button className="button button-primary full-width" onClick={() => setAuthOpen(true)}><LogIn size={17}/>Sign in</button>}
            </section>
            <section className="surface legend-card" aria-labelledby="legend-heading"><h2 id="legend-heading">Five campuses</h2><p>Each campus keeps one color wherever it appears.</p><ul>{CAMPUSES.map(c => <li key={c}><CampusMark campus={c}/></li>)}</ul></section>
          </aside>
        </div>}

        {view === 'discover' && <><div className="segmented view-switch" role="group" aria-label="Discover mode"><button className={!directory ? 'selected' : ''} aria-pressed={!directory} onClick={() => setDirectory(false)}><Sparkles size={16}/>For you</button><button className={directory ? 'selected' : ''} aria-pressed={directory} onClick={() => setDirectory(true)}><Users size={16}/>All clubs<span className="count">{clubs.length}</span></button></div>
          {directory ? <><div className="filter-bar"><div className="search-input"><Search size={18}/><input aria-label="Search clubs and interests" placeholder="Try “free beginner coding on Busch”" value={query} onChange={e => setQuery(e.target.value)} enterKeyHint="search"/>{query && <button className="icon-button clear-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></button>}</div><label className="select-filter"><span className="sr-only">Campus</span><Compass size={16}/><select value={campus} onChange={e => setCampus(e.target.value)}><option value="">All campuses</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label><label className="select-filter"><span className="sr-only">Interest</span><SlidersHorizontal size={16}/><select value={category} onChange={e => setCategory(e.target.value)}><option value="">All interests</option>{categories.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label><label className={`chip toggle-chip ${beginner ? 'on' : ''}`}><input type="checkbox" checked={beginner} onChange={e => setBeginner(e.target.checked)}/><Check size={16}/>Beginner friendly</label></div>
            <p className="result-count" role="status">{searching ? 'Searching…' : `${searchClubs.length} ${searchClubs.length === 1 ? 'club' : 'clubs'}`}{searchClubs.length > 0 && searchClubs.every(c => c.verification === 'demo') && <span> · All are demo organizations</span>}</p>{searchError && <p className="form-error" role="alert">{searchError}</p>}
            <div className={`club-grid ${searching ? 'is-loading' : ''}`} aria-busy={searching}>{searchClubs.map(club => <ClubCard key={club.id} club={club} following={saved.club_ids.includes(club.id)} onOpen={() => setClubDetail(club)} onFollow={() => void follow(club)}/>)}</div>
            {!searching && !searchClubs.length && !searchError && <div className="surface empty-state"><Search size={28}/><h3>No clubs match</h3><p>Try a broader search, or clear the filters.</p><button className="button button-secondary" onClick={() => {setQuery(''); setCampus(''); setCategory(''); setBeginner(false);}}>Clear filters</button></div>}</>
          : <div className="discovery-layout"><div className="discovery-stage">{currentDiscover ? <article className="discovery-card surface" style={{'--club': currentDiscover.color} as React.CSSProperties}><div className="discovery-cover"><ClubArt category={currentDiscover.category} color={currentDiscover.color} size="large"/><button className="icon-button discovery-detail" aria-label="View club details" onClick={() => setClubDetail(currentDiscover)}><ArrowUpRight size={20}/></button></div><div className="discovery-copy"><span className="category-label">{currentDiscover.category}</span><h2>{cleanName(currentDiscover.name)}</h2><p>{currentDiscover.description}</p><div className="tag-list"><CampusMark campus={currentDiscover.campus}/>{currentDiscover.beginner_friendly && <span className="meta-note"><Check size={14}/>Beginners welcome</span>}<span className="meta-note">{currentDiscover.membership_fee}</span></div>{'explanation' in currentDiscover && <p className="recommendation-reason"><Sparkles size={14}/><span><strong>Why this club: </strong>{String(currentDiscover.explanation)}</span></p>}</div></article>
            : <div className="surface empty-state"><CheckCheck size={34}/><h2>You’ve seen every suggestion</h2><p>Followed and saved clubs are in Saved. The full directory has every club.</p><button className="button button-primary" onClick={() => setDirectory(true)}>Browse all clubs</button>{(saved.dismissed_ids.length > 0 || sessionSkipped.length > 0) && <button className="text-button" onClick={() => void resetPasses()}>Show passed clubs again</button>}</div>}
            {currentDiscover && <><div className="discovery-actions"><button className="discovery-action action-pass" onClick={() => void decide('dismiss')} disabled={busy}><span><X size={26}/></span>Pass<kbd aria-hidden="true">←</kbd></button><button className="discovery-action action-later" onClick={() => void decide('later')} disabled={busy}><span><Bookmark size={23}/></span>Later<kbd aria-hidden="true">↓</kbd></button><button className="discovery-action action-interested" onClick={() => void decide('interested')} disabled={busy}><span><Heart size={26} fill="currentColor"/></span>Follow<kbd aria-hidden="true">→</kbd></button></div><p className="discovery-count">{discoverClubs.length} clubs left · Passing never hides a club from the directory</p></>}
          </div><aside className="discovery-aside surface"><h3>How suggestions work</h3><p>Suggestions compare club descriptions with the interests you choose. They don’t predict who you are or where you belong.</p><p>Use the arrow keys to pass, keep for later, or follow.</p><button className="text-button" onClick={() => user ? setOnboarding(true) : setAuthOpen(true)}><Settings2 size={15}/>Change interests</button>{(saved.dismissed_ids.length > 0 || sessionSkipped.length > 0) && <button className="text-button" onClick={() => void resetPasses()}><ArrowLeft size={15}/>Show passed clubs again</button>}</aside></div>}
        </>}

        {view === 'events' && <>{hasLive && events.length > 0 && <div className="segmented view-switch" role="group" aria-label="Event source"><button className={eventSource === 'live' ? 'selected' : ''} aria-pressed={eventSource === 'live'} onClick={() => {setEventSource('live'); setEventResults(liveEvents);}}><Radio size={16}/>Rutgers events<span className="count">{liveEvents.length}</span></button><button className={eventSource === 'demo' ? 'selected' : ''} aria-pressed={eventSource === 'demo'} onClick={() => {setEventSource('demo'); setEventCategory(''); setEventResults(events);}}><FlaskConical size={16}/>Demo clubs</button></div>}<div className="filter-bar"><div className="search-input"><Search size={18}/><input aria-label="Search events" placeholder="Try “free beginner AI this week”" value={eventQuery} onChange={e => setEventQuery(e.target.value)} enterKeyHint="search"/>{eventQuery && <button className="icon-button clear-button" aria-label="Clear search" onClick={() => setEventQuery('')}><X size={15}/></button>}</div><label className="select-filter"><span className="sr-only">Campus</span><Compass size={16}/><select value={eventCampus} onChange={e => setEventCampus(e.target.value)}><option value="">All campuses</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label>{eventSource === 'live' && <label className="select-filter"><span className="sr-only">Category</span><SlidersHorizontal size={16}/><select value={eventCategory} onChange={e => setEventCategory(e.target.value)}><option value="">All categories</option>{liveCategories.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label>}</div>{eventSource === 'live' && liveNote && <p className="route-source source-line"><Radio size={14}/>{liveNote}. Only New Brunswick club, arts, recreation, and home-game listings are shown.</p>}{eventsSearchError && <p className="form-error" role="alert">{eventsSearchError}</p>}{eventsSearching && <p className="result-count" role="status">Searching…</p>}<div className={eventsSearching ? 'is-loading' : ''} aria-busy={eventsSearching}><EventCalendar key={eventSource} events={eventResults} savedIds={saved.event_ids} onOpen={openEvent} onSave={event => void saveEvent(event)} today={easternDay(eventSource === 'live' ? new Date(now) : REFERENCE_DATE)} footnote={eventSource === 'live' ? 'Times are Eastern Time. Listings change; confirm details on getINVOLVED before you go.' : 'Times are Eastern Time. “Today” for demo events is October 22, 2026.'}/></div></>}

        {view === 'forums' && <ForumsPanel clubs={clubs} user={user} onSignIn={() => setAuthOpen(true)} initialPostId={initialForumPostId}/>}

        {view === 'saved' && (!user ? <GuestPrompt onSignIn={() => setAuthOpen(true)} title="Sign in to keep track" description="Follow clubs, keep a list of clubs to revisit, and save the events you plan to attend."/> : <><div className="segmented view-switch" role="tablist" aria-label="Saved items">{[{id: 'clubs' as const, label: 'Clubs', count: followedClubs.length}, {id: 'events' as const, label: 'Events', count: savedEvents.length}, {id: 'later' as const, label: 'Later', count: laterClubs.length}].map(tab => <button key={tab.id} role="tab" aria-selected={savedTab === tab.id} className={savedTab === tab.id ? 'selected' : ''} onClick={() => setSavedTab(tab.id)}>{tab.label}<span className="count">{tab.count}</span></button>)}</div>
            {savedTab === 'clubs' && (followedClubs.length ? <div className="club-grid">{followedClubs.map(club => <ClubCard key={club.id} club={club} following onOpen={() => setClubDetail(club)} onFollow={() => void follow(club)}/>)}</div> : <EmptySaved icon="club" onExplore={() => go('discover')}/>)}
            {savedTab === 'later' && (laterClubs.length ? <div className="club-grid">{laterClubs.map(club => <div key={club.id} className="later-card"><ClubCard club={club} following={saved.club_ids.includes(club.id)} onOpen={() => setClubDetail(club)} onFollow={() => void follow(club)}/><button className="text-button" onClick={() => void bookmark(club)}><X size={14}/>Remove from Later</button></div>)}</div> : <EmptySaved icon="later" onExplore={() => go('discover')}/>)}
            {savedTab === 'events' && <>{conflicts.length > 0 && <div className="notice notice-warning" role="note"><CalendarDays size={18}/><div><strong>Time conflict</strong>{conflicts.map(({event, other}) => <p key={`${event.id}-${other.id}`}>{event.title} overlaps {other.title} on {dateFormat(event.starts_at, {month: 'short', day: 'numeric'})}.</p>)}</div></div>}{savedEvents.length ? <div className="event-list surface">{savedEvents.map(event => <EventRow key={event.id} event={event} saved onOpen={() => openEvent(event)} onSave={() => void saveEvent(event)}/>)}</div> : <EmptySaved icon="event" onExplore={() => go('events')}/>}</>}
          </>)}

        {view === 'profile' && (user ? <ProfilePanel key={user.id} user={user} onSave={next => void profileSaved(next)} onLogout={() => void logout()} onDelete={() => {setUser(null); setSaved(EMPTY_SAVED); go('home'); void refreshClubs().catch(e => notify(e.message, true)); void refreshRecommendations().catch(e => notify(e.message, true)); notify('Your account and personal data were deleted.');}}/> : <GuestPrompt onSignIn={() => setAuthOpen(true)} title="Sign in to set up a profile" description="Choose interests for better suggestions. Your profile stays private."/>)}
        {view === 'officer' && (isOfficer ? <OfficerPanel allEvents={events} onRefresh={() => {void Promise.all([api<Club[]>('/clubs'), api<CampusEvent[]>('/events')]).then(([nextClubs, nextEvents]) => {setClubs(nextClubs); setEvents(nextEvents); setEventResults(nextEvents);}).catch(e => notify(e.message, true));}}/> : <GuestPrompt onSignIn={() => setAuthOpen(true)} title="For club officers" description="Sign in with an assigned officer account to manage a club’s profile and events."/>)}
        <footer className="page-footer"><p>BetterGetInvolved is an independent student project, not affiliated with Rutgers University. Rutgers events come from getINVOLVED and Rutgers Recreation via Scarlet Sync; clubs come from their public profiles on The Arc.</p><button className="inline-link" onClick={() => setAboutOpen(true)}>About this demo</button></footer>
      </>}
      </main>
    </div>
    <nav className="tab-bar glass" aria-label="Main navigation">{NAV.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => go(item.id)} aria-current={view === item.id ? 'page' : undefined}><item.icon size={22} strokeWidth={view === item.id ? 2.3 : 1.9}/><span>{item.title}</span></button>)}<button className={view === 'profile' || view === 'officer' ? 'active' : ''} onClick={() => user ? go('profile') : setAuthOpen(true)} aria-current={view === 'profile' ? 'page' : undefined}><UserRound size={22} strokeWidth={view === 'profile' ? 2.3 : 1.9}/><span>{firstName ? 'Profile' : 'Sign in'}</span></button></nav>
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18}/> : <Check size={18}/>}<span>{toast.text}</span><button aria-label="Dismiss" onClick={() => setToast(null)}><X size={15}/></button></div>}
    {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSuccess={(next, isNew) => void authSuccess(next, isNew)}/>}
    {onboarding && user && <OnboardingDialog user={user} onClose={() => setOnboarding(false)} onSave={next => void profileSaved(next)}/>}
    {clubDetail && <ClubDetail key={clubDetail.id} club={clubDetail} events={events.filter(e => e.club_id === clubDetail.id)} following={saved.club_ids.includes(clubDetail.id)} onFollow={() => {if (!user) setClubDetail(null); void follow(clubDetail);}} onClose={() => setClubDetail(null)} onEvent={openEvent} onSignIn={() => {signInFromClub.current = clubDetail.id; setClubDetail(null); setAuthOpen(true);}}/>}
    {eventDetail && <EventDetail key={eventDetail.id} event={eventDetail} saved={saved.event_ids.includes(eventDetail.id)} onSave={() => {if (!user) setEventDetail(null); void saveEvent(eventDetail);}} onClose={() => setEventDetail(null)} onRsvp={rsvp} rsvp={saved.rsvps?.[eventDetail.id] || 'none'} conflicts={detailConflicts}/>}
    {aboutOpen && <Dialog title="About BetterGetInvolved" wide onClose={() => setAboutOpen(false)}><p className="dialog-description">BetterGetInvolved is an independent student-built prototype for exploring campus communities. It is not affiliated with Rutgers University or an official university service.</p><section className="about-section"><h3>Real Rutgers clubs and events</h3><p>Rutgers events are real listings from Rutgers getINVOLVED and Rutgers Recreation, collected by <a className="inline-link" href="https://scarletsync.app/events" target="_blank" rel="noreferrer">Scarlet Sync</a> and refreshed every few hours. Only New Brunswick club, arts, recreation, and home-game listings are shown. Confirm details and RSVP on getINVOLVED.</p><p>The clubs in Discover come from student organizations’ public profiles on The Arc, Rutgers’ involvement platform. Each club’s description, meeting time, location, and contact details are taken from its own profile. Many clubs don’t list a meeting time there, and profiles can be out of date, so confirm plans with the club. Fraternities, sororities, and inactive organizations are not included.</p><a className="text-button" href="https://sca.rutgers.edu/campus-involvement/student-organizations" target="_blank" rel="noreferrer">Rutgers’ official involvement website<ArrowUpRight size={15}/></a></section><section className="about-section"><h3>How suggestions work</h3><p>Club descriptions are compared with the interests and goals you choose, using local text features and semantic similarity. Change your interests, show passed clubs again, or browse every club at any time. A similarity score is not a probability, a quality ranking, or a prediction of belonging.</p><p className="method-label">Current method: {method || 'Local text similarity with a varied guest selection'}</p><p>No paid language model or external API key is used. Text matching can miss nuance and can favor longer descriptions, so suggestions mix categories and the full directory is always available.</p></section><section className="about-section"><h3>Answers come with sources</h3><p>The club assistant answers only from the selected club’s published profile and FAQs and shows the excerpts it used. When the information is missing, it says so. Report an inaccurate answer from the club or event details.</p></section><section className="about-section"><h3>Your information stays private</h3><p>Choosing interests is optional. Profiles are private, stored in this app’s database, and can be deleted from Profile. Follows and RSVPs only add to aggregate counts that officers see. Don’t enter sensitive personal information in questions or forms.</p></section><p className="about-footer"><ShieldCheck size={18}/>Small local models, visible sources, and the whole directory always one tap away.</p></Dialog>}
  </div>;
}

function GuestPrompt({onSignIn, title, description}: {onSignIn: () => void; title: string; description: string}) {return <div className="surface empty-state guest-prompt"><span className="empty-symbol"><UserRound size={28}/></span><h2>{title}</h2><p>{description}</p><button className="button button-primary" onClick={onSignIn}><LogIn size={17}/>Sign in</button><span className="fine-print">Browsing clubs and events never requires an account.</span></div>;}
function EmptySaved({icon, onExplore}: {icon: 'club' | 'event' | 'later'; onExplore: () => void}) {const Icon = icon === 'event' ? CalendarDays : icon === 'later' ? Bookmark : Users; return <div className="surface empty-state"><span className="empty-symbol"><Icon size={28}/></span><h3>{icon === 'event' ? 'No saved events' : icon === 'later' ? 'Nothing saved for later' : 'No followed clubs'}</h3><p>{icon === 'event' ? 'Save an event and it appears here, with a warning if two overlap.' : icon === 'later' ? 'Choose Later in Discover to keep a club on your list.' : 'Follow a club to keep it here. Unfollow anytime.'}</p><button className="button button-secondary" onClick={onExplore}>{icon === 'event' ? 'Browse events' : 'Go to Discover'}</button></div>;}
