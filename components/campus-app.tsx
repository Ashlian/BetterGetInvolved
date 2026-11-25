'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, ArrowUpRight, Bookmark, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Compass, FlaskConical, Heart, House, LoaderCircle, LogIn, Mail, Megaphone, MessagesSquare, Radio, Search, Settings2, ShieldCheck, Shuffle, SlidersHorizontal, Sparkles, Users, UserRound, X} from 'lucide-react';
import {api, post, cleanName, dateFormat, dateKey, eventEnd, eventTime, overlaps, relativeTime, CAMPUSES, REFERENCE_DATE, type Club, type Recommendation, type ForYou, type DiscoverMode, type ClubSearchResult, type SearchUnderstanding, type CampusEvent, type ForumPost, type LiveStatus, type Unread, type User, type Saved} from '@/lib/api';
import {AuthDialog, OnboardingDialog} from './account';
import UserAvatar from './avatar';
import {ProfilePage, StudentProfileDialog, type ProfileTab} from './profile';
import {motion, useMotionValue, useReducedMotion, useTransform, type MotionStyle} from 'motion/react';
import RecommendationCard from './recommendation-card';
import ClubCard from './club-card';
import Dialog from './dialog';
import {ClubDetail, EventDetail} from './detail-dialogs';
import EventCalendar, {EventRow, easternDay} from './event-calendar';
import OfficerPanel from './officer-panel';
import ForumsPanel from './forums-panel';
import InboxPage, {SocialTabs, type InboxTab} from './inbox';
import {CampusMark, ClubArt, campusSlug, categoryIcon, Wordmark} from './visuals';
import HomeExperience from './home-experience';
import {CampusMap} from './campus-map';
import {ThemeMenu} from './theme';

type View = 'home' | 'discover' | 'orbit' | 'events' | 'forums' | 'inbox' | 'profile' | 'officer';
const NO_UNREAD: Unread = {messages: 0, notifications: 0};
const UNREAD_POLL_MS = 60000;
const EMPTY_SAVED: Saved = {club_ids: [], event_ids: [], dismissed_ids: [], maybe_later_ids: [], rsvps: {}};
const NAV = [{id: 'home' as const, title: 'Home', icon: House}, {id: 'discover' as const, title: 'Discover', icon: Compass}, {id: 'orbit' as const, title: 'Orbit', icon: Radio}, {id: 'forums' as const, title: 'Community', icon: MessagesSquare}, {id: 'profile' as const, title: 'Profile', icon: UserRound}];
const viewTitles: Record<View, string> = {home: 'Home', discover: 'Discover', orbit: 'Orbit', events: 'Events', forums: 'Community', inbox: 'Messages', profile: 'Profile', officer: 'Club manager'};
const VIEW_PATHS: Record<View, string> = {home:'/',discover:'/discover',orbit:'/orbit',events:'/events',forums:'/community',inbox:'/inbox',profile:'/profile',officer:'/officer'};
// The site's contact address comes from the environment (set in Vercel and .env), not the code.
// How much a dragged card tilts: one degree per this many pixels.
const DRAG_TILT = 18;
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';
const DISCOVERY_INTENTIONS=[{id:'people',label:'Find my people',terms:/social|community|culture|identity|service|volunteer/i},{id:'career',label:'Build my career',terms:/career|professional|business|technology|research|academic/i},{id:'new',label:'Try something new',terms:/beginner|hobby|outdoor|language|culture|recreation/i},{id:'creative',label:'Get creative',terms:/art|music|design|creative|perform|film/i},{id:'fun',label:'Just have fun',terms:/sport|recreation|game|dance|music|outdoor/i}];

export default function CampusApp({initialClubId, initialEventId, initialForumPostId, initialView = 'home',initialDaily=false}: {initialClubId?: string; initialEventId?: string; initialForumPostId?: string; initialView?: View;initialDaily?:boolean} = {}) {
  const [view, setView] = useState<View>(initialView); const [directory, setDirectory] = useState(false);const [dailyMode,setDailyMode]=useState(initialDaily);
  const [clubs, setClubs] = useState<Club[]>([]); const [recommendations, setRecommendations] = useState<Recommendation[]>([]); const [method, setMethod] = useState('');
  const [events, setEvents] = useState<CampusEvent[]>([]); const [user, setUser] = useState<User | null>(null); const [saved, setSaved] = useState<Saved>(EMPTY_SAVED);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(''); const [toast, setToast] = useState<{text: string; error?: boolean} | null>(null);
  const [authOpen, setAuthOpen] = useState(false); const [onboarding, setOnboarding] = useState(false); const [aboutOpen, setAboutOpen] = useState(false);
  const [clubDetail, setClubDetail] = useState<Club | null>(null); const [eventDetail, setEventDetail] = useState<CampusEvent | null>(null);
  const [globalSearch, setGlobalSearch] = useState(''); const [query, setQuery] = useState(''); const [campus, setCampus] = useState(''); const [category, setCategory] = useState(''); const [beginner, setBeginner] = useState(false);
  const [discoveryIntention,setDiscoveryIntention]=useState('');
  const [searchClubs, setSearchClubs] = useState<(Club | Recommendation)[]>([]); const [understood, setUnderstood] = useState<SearchUnderstanding | null>(null); const [searching, setSearching] = useState(false); const [searchError, setSearchError] = useState(''); const [discoverIndex, setDiscoverIndex] = useState(0); const [sessionSkipped, setSessionSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [profileTab, setProfileTab] = useState<ProfileTab>('clubs'); const [studentProfile, setStudentProfile] = useState<string | null>(null);
  const [unread, setUnread] = useState<Unread>(NO_UNREAD); const [inboxTab, setInboxTab] = useState<InboxTab>('messages'); const [conversationId, setConversationId] = useState<string | null>(null);
  const [homePicks, setHomePicks] = useState<Recommendation[] | null>(null); const [announcements, setAnnouncements] = useState<ForumPost[] | null>(null); const [suggestedEvents, setSuggestedEvents] = useState<CampusEvent[]>([]); const [eventQuery, setEventQuery] = useState(''); const [eventCampus, setEventCampus] = useState('');
  const [eventResults, setEventResults] = useState<CampusEvent[]>([]); const [eventsSearching, setEventsSearching] = useState(false); const [eventsSearchError, setEventsSearchError] = useState('');
  const [liveEvents, setLiveEvents] = useState<CampusEvent[]>([]); const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null); const [eventSource, setEventSource] = useState<'live' | 'demo'>('live'); const [eventCategory, setEventCategory] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const openedInitial = useRef(false);
  const [discoverMode, setDiscoverModeState] = useState<DiscoverMode>('foryou'); const [forYou, setForYou] = useState<ForYou | null>(null); const [forYouLoading, setForYouLoading] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  // The chosen mode is a per-browser convenience, so it lives in localStorage.
  useEffect(() => {if(initialDaily){setDiscoverModeState('foryou');return;}try {const stored = localStorage.getItem('bgi.discoverMode'); if (stored === 'random' || stored === 'foryou') setDiscoverModeState(stored);} catch {}}, []);
  const setDiscoverMode = useCallback((mode: DiscoverMode) => {setDiscoverModeState(mode); setDiscoverIndex(0); try {localStorage.setItem('bgi.discoverMode', mode);} catch {}}, []);
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
      try {const result = await api<ClubSearchResult>(`/search/clubs?${params}`); if (active) {setSearchClubs(result.clubs); setUnderstood(result.understood);}} catch (e) {if (active) {setSearchError((e as Error).message); setSearchClubs([]); setUnderstood(null);}} finally {if (active) setSearching(false);}
    }, 300);
    return () => {active = false; clearTimeout(timer);};
  }, [view, directory, query, campus, category, beginner, user?.id]);
  const followCount = saved.club_ids.length + (saved.maybe_later_ids?.length ?? 0);
  useEffect(() => {
    if (view !== 'discover' || directory || discoverMode !== 'foryou') return;
    let active = true; setForYouLoading(true);
    const timer = setTimeout(() => {void api<ForYou>('/for-you?limit=60').then(result => {if(!active)return;let clubs=result.clubs;if(dailyMode){try{const key=`bgi.daily.${user?.id??'guest'}`;const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const cached=JSON.parse(localStorage.getItem(key)||'null') as {date?:string;ids?:string[]}|null;if(cached?.date===today&&cached.ids?.length){const byId=new Map(result.clubs.map(club=>[club.id,club]));const restored=cached.ids.map(id=>byId.get(id)).filter((club):club is Recommendation=>!!club);if(restored.length)clubs=restored;}else localStorage.setItem(key,JSON.stringify({date:today,ids:result.clubs.map(club=>club.id)}));}catch{}}setForYou({...result,clubs});}).catch(e => {if (active) notify((e as Error).message, true);}).finally(() => {if (active) setForYouLoading(false);});}, 250);
    return () => {active = false; clearTimeout(timer);};
  }, [view, directory, dailyMode, discoverMode, user?.id, user?.major, user?.interests, followCount, notify]);
  useEffect(() => {
    if (view !== 'home' || !user) {if (!user) {setHomePicks(null); setAnnouncements(null); setSuggestedEvents([]);} return;}
    let active = true;
    void api<ForYou>('/for-you?limit=6').then(result => {if (active) setHomePicks(result.clubs);}).catch(() => {if (active) setHomePicks([]);});
    void api<ForumPost[]>('/announcements?limit=5').then(result => {if (active) setAnnouncements(result);}).catch(() => {if (active) setAnnouncements([]);});
    const interests = user.interests.join(' ');
    if (interests) void api<CampusEvent[]>(`/live/events?q=${encodeURIComponent(interests)}`).then(result => {if (active) setSuggestedEvents(result.filter(e => e.status === 'scheduled' && eventEnd(e) > Date.now()).slice(0, 4));}).catch(() => {if (active) setSuggestedEvents([]);});
    else setSuggestedEvents([]);
    return () => {active = false;};
  }, [view, user, followCount]);
  useEffect(() => {
    if (view !== 'events') return;
    let active = true; setEventsSearching(true); setEventsSearchError('');
    const timer = setTimeout(async () => {
      const params = new URLSearchParams(); if (eventQuery) params.set('q', eventQuery); if (eventCampus) params.set('campus', eventCampus); if (eventSource === 'live' && eventCategory) params.set('category', eventCategory);
      try {const result = await api<CampusEvent[]>(`${eventSource === 'live' ? '/live/events' : '/events'}?${params}`); if (active) setEventResults(result);} catch (e) {if (active) {setEventsSearchError((e as Error).message); setEventResults([]);}} finally {if (active) setEventsSearching(false);}
    }, 300);
    return () => {active = false; clearTimeout(timer);};
  }, [view, eventQuery, eventCampus, eventCategory, eventSource]);

  // Unread counts for the Inbox badge: on sign-in, every minute while the page is visible, and on return to it.
  useEffect(() => {
    setUnread(NO_UNREAD); setConversationId(null);
    if (!user?.id) return;
    let active = true;
    const check = () => {if (document.visibilityState === 'visible') void api<Unread>('/inbox/unread').then(next => {if (active) setUnread(next);}).catch(() => undefined);};
    check();
    const timer = setInterval(check, UNREAD_POLL_MS); document.addEventListener('visibilitychange', check);
    return () => {active = false; clearInterval(timer); document.removeEventListener('visibilitychange', check);};
  }, [user?.id]);
  const updateUnread = useCallback((next: Unread) => setUnread(current => current.messages === next.messages && current.notifications === next.notifications ? current : next), []);
  const navView = view === 'inbox' ? 'forums' : view;
  const unreadTotal = unread.messages + unread.notifications;
  function openPerson(who: string) {if (!user) {setAuthOpen(true); return;} setStudentProfile(who);}
  function openConversation(id: string) {setClubDetail(null); setStudentProfile(null); setInboxTab('messages'); setConversationId(id); go('inbox');}
  function openClubById(id: string) {const club = clubs.find(c => c.id === id); if (club) {setStudentProfile(null); setClubDetail(club);} else notify('That club could not be found.', true);}
  function openEventById(id: string) {void api<CampusEvent>(`/events/${encodeURIComponent(id)}`).then(openEvent).catch(e => notify((e as Error).message, true));}
  function go(next: View, allClubs = false,daily=false) {if(next==='profile'&&!user){setAuthOpen(true);return;}setView(next); if (next === 'discover'){setDirectory(allClubs);setDailyMode(daily);} const path=next==='discover'&&daily?'/discover/daily':VIEW_PATHS[next]; if(path&&window.location.pathname!==path) window.history.pushState({view:next,daily},'',path); window.scrollTo({top: 0, behavior: 'instant'});}
  useEffect(()=>{const restore=()=>{const path=window.location.pathname;const match=(Object.keys(VIEW_PATHS) as View[]).find(key=>VIEW_PATHS[key]===path)|| (path==='/forums'?'forums' as View:undefined); if(match){setView(match);if(match==='discover'){setDirectory(false);setDailyMode(path==='/discover/daily');}}}; window.addEventListener('popstate',restore); return()=>window.removeEventListener('popstate',restore);},[]);
  useEffect(()=>{if(!loading&&view==='profile'&&!user)setAuthOpen(true);},[loading,view,user]);
  function openProfile(tab: ProfileTab) {if (!user) {setAuthOpen(true); return;} setProfileTab(tab); go('profile');}
  async function dismissClub(club: Club) {
    if (!requireUser() || busy) return; setBusy(true);
    try {await post(`/clubs/${club.id}/dismiss`); setSaved(s => ({...s, dismissed_ids: [...s.dismissed_ids.filter(id => id !== club.id), club.id]})); setHomePicks(picks => picks?.filter(c => c.id !== club.id) ?? picks); notify(`Got it, fewer clubs like ${cleanName(club.name)}.`);}
    catch (e) {notify((e as Error).message, true);} finally {setBusy(false);}
  }
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
  const shuffledClubs = useMemo(() => seededShuffle(clubs, shuffleSeed), [clubs, shuffleSeed]);
  // Only the swipe deck is narrowed: search has its own ranking, and the daily set is fixed.
  const chosenIntention=dailyMode?undefined:DISCOVERY_INTENTIONS.find(item=>item.id===discoveryIntention);
  const discoverClubs = (discoverMode === 'foryou' ? forYou?.clubs ?? [] : shuffledClubs).filter(c => (!chosenIntention||chosenIntention.terms.test(`${c.category} ${c.name} ${c.description} ${c.interests.join(' ')} ${('tags' in c ? (c as Recommendation).tags : undefined)?.join(' ') ?? ''}`))&&!saved.club_ids.includes(c.id) && !saved.dismissed_ids.includes(c.id) && !(saved.maybe_later_ids || []).includes(c.id) && !sessionSkipped.includes(c.id));
  const visibleSearchClubs=searchClubs.filter(club=>!chosenIntention||chosenIntention.terms.test(`${club.category} ${club.name} ${club.description} ${club.interests.join(' ')} ${('tags' in club ? (club as Recommendation).tags : undefined)?.join(' ') ?? ''}`));
  const currentDiscover = discoverClubs[discoverIndex % (discoverClubs.length || 1)];
  const discoverCard = useRef<HTMLElement>(null);
  const swipeInProgress = useRef(false);
  const [swiping, setSwiping] = useState(false);
  const reducedMotion = useReducedMotion();
  const stackDrag = useMotionValue(0);
  const cardRotate = useTransform(stackDrag,[-180,0,180],[-9,0,9]);
  const nextCardScale = useTransform(stackDrag,[-180,0,180],[1.04,.965,1.04]);
  const nextCardY = useTransform(stackDrag,[-180,0,180],[0,11,0]);

  /** Pass, follow, or keep for later. `fromX` is where a dragged card was let go, so it flies off from there. */
  async function decide(action: 'interested' | 'dismiss' | 'later', fromX = 0) {
    if (!currentDiscover || busy || swipeInProgress.current) return;
    if (action === 'later') {await bookmark(currentDiscover); return;}

    const card = discoverCard.current;
    let animation: Animation | undefined;
    swipeInProgress.current = true;
    setSwiping(true);
    try {
      if (card?.animate && !reducedMotion) {
        const direction = action === 'dismiss' ? -1 : 1;
        animation = card.animate([
          {transform: `translateX(${fromX}px) rotate(${fromX / DRAG_TILT}deg)`, opacity: 1},
          {transform: `translateX(calc(${direction * 65}% + ${fromX}px)) rotate(${direction * 13}deg)`, opacity: 0},
        ], {duration: reducedMotion ? 0 : 240, easing: 'ease-in', fill: 'forwards'});
        await animation.finished.catch(() => undefined);
        if (discoverCard.current !== card) return;
      }
      if (action === 'interested') {
        await follow(currentDiscover);
      } else if (!user) {
        setSessionSkipped(s => [...s, currentDiscover.id]);
      } else {
        setBusy(true);
        try {
          const result = await post<{dismissed: boolean}>(`/clubs/${currentDiscover.id}/dismiss`);
          setSaved(s => ({...s, dismissed_ids: result.dismissed ? [...s.dismissed_ids, currentDiscover.id] : s.dismissed_ids.filter(id => id !== currentDiscover.id)}));
          notify('Passed. The club stays in the directory.');
        } finally {
          setBusy(false);
        }
      }
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      animation?.cancel();
      // A card that stays (sign-in needed, or an error) returns to the middle.
      if (card) {card.style.transform = ''; card.style.removeProperty('--swipe');}
      swipeInProgress.current = false;
      setSwiping(false);
    }
  }
  // Dragging the card works like the buttons: far enough left passes, far enough right follows.
  const dragThreshold = (card: HTMLElement) => Math.min(120, card.offsetWidth * 0.28);
  async function resetPasses() {
    if (busy || swipeInProgress.current) return; setBusy(true);
    try {for (const id of saved.dismissed_ids) await post(`/clubs/${id}/dismiss`); setSaved(s => ({...s, dismissed_ids: []})); setSessionSkipped([]); setDiscoverIndex(0); notify('Passed clubs are back in Discover.');}
    catch (e) {notify((e as Error).message, true); if (user) void refreshSaved();} finally {setBusy(false);}
  }
  useEffect(() => {
    if (view !== 'discover' || directory || clubDetail || eventDetail || studentProfile || authOpen || onboarding || aboutOpen) return;
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
  const savedEvents = [...events.filter(e => saved.event_ids.includes(e.id)), ...(saved.live_events || []).filter(e => saved.event_ids.includes(e.id))].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  // Events the student saved or RSVP'd to that haven't ended (demo events count from the demo day).
  const myUpcoming = [...events.filter(e => saved.event_ids.includes(e.id) || saved.rsvps?.[e.id]), ...(saved.live_events || []).filter(e => saved.event_ids.includes(e.id))]
    .filter(e => e.status === 'scheduled' && eventEnd(e) > (e.is_demo ? Date.parse(REFERENCE_DATE) : now)).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).slice(0, 4);
  const profileKey = [saved.club_ids.join(), (saved.maybe_later_ids || []).join(), saved.event_ids.join(), JSON.stringify(saved.rsvps || {})].join('|');
  const detailConflicts = eventDetail ? savedEvents.filter(e => e.id !== eventDetail.id && overlaps(e, eventDetail)) : [];
  const recommended = recommendations.length ? recommendations.slice(0, 3) : clubs.filter(c => c.featured).slice(0, 3);

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {const onScroll = () => setScrolled(window.scrollY > 8); onScroll(); window.addEventListener('scroll', onScroll, {passive: true}); return () => window.removeEventListener('scroll', onScroll);}, []);
  const hasLive = liveEvents.length > 0;
  const routeSource = hasLive ? liveEvents.filter(e => e.status === 'scheduled' && eventEnd(e) > now) : upcoming;
  const liveCategories = [...new Set(liveEvents.map(e => e.category))].sort();
  const liveNote = liveStatus?.synced_at ? `Live from Rutgers getINVOLVED and Rutgers Recreation via Scarlet Sync · checked ${relativeTime(liveStatus.synced_at)}` : '';
  const firstName = user?.display_name.split(' ')[0];
  // The club manager appears only for people who own a club (or admins).
  const isOfficer = !!user && (user.role === 'admin' || (user.managed_club_ids?.length ?? 0) > 0);
  const managedClubs = user ? clubs.filter(c => user.managed_club_ids?.includes(c.id)) : [];
  const subtitle: Record<View, string> = {
    home: '',
    orbit: 'Explore Rutgers–New Brunswick events by campus.',
    discover: directory ? `Search all ${clubs.length} clubs by name, interest, or a plain-language request.` : discoverMode === 'foryou' ? 'Clubs picked for you, one at a time. Follow, keep for later, or pass.' : 'Random clubs, one at a time. Follow, keep for later, or pass.',
    events: eventSource === 'live' ? 'Real Rutgers–New Brunswick club, recreation, and game listings.' : 'Sample events from the demo clubs, for trying saves and RSVPs.',
    forums: 'Ask questions, share experiences, and talk about your clubs.',
    inbox: inboxTab === 'messages' ? 'Your direct messages and questions to clubs. Only the people in a conversation can see it.' : 'Replies, announcements, and changes to your events.',
    profile: '',
    officer: 'Update the clubs you own: profile, tags, contacts, questions, and events.',
  };
  const avatar = <UserAvatar name={user?.display_name} url={user?.avatar_url} size={36}/>;

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="sidebar glass" aria-label="Sidebar"><button className="brand plain-button" onClick={() => go('home')} aria-label="ClRUb, Home"><Wordmark/></button><nav aria-label="Main navigation">{NAV.map(item => <button key={item.id} className={`nav-item ${navView === item.id ? 'active' : ''}`} onClick={() => go(item.id)} aria-current={navView === item.id ? 'page' : undefined}><item.icon size={20}/><span>{item.title}</span></button>)}</nav><div className="sidebar-bottom"><button className="nav-item" onClick={() => setAboutOpen(true)}><CircleHelp size={20}/><span>About</span></button></div></aside>
    <div className="workspace">
      <header className={`toolbar ${scrolled ? 'scrolled' : ''}`}><button className="brand plain-button top-brand" onClick={() => go('home')} aria-label="ClRUb Home"><Wordmark/></button><nav className="desktop-primary-nav" aria-label="Primary navigation">{NAV.map(item=><button key={item.id} className={navView===item.id?'active':''} onClick={()=>go(item.id)} aria-current={navView===item.id?'page':undefined}><item.icon size={17}/>{item.title}{item.id === 'forums' && unreadTotal > 0 && <span className="unread-badge">{unreadTotal > 99 ? '99+' : unreadTotal}<span className="sr-only"> unread</span></span>}</button>)}</nav><div className="toolbar-actions"><button className="top-control" onClick={()=>go('events')}><CalendarDays size={17}/><span>Events</span></button><button className="top-control" onClick={()=>{setInboxTab('messages');go('inbox')}} aria-label="Open messages"><Mail size={17}/><span>Messages</span>{unread.messages>0&&<i className="top-unread"/>}</button>{isOfficer&&<button className="top-control" onClick={()=>go('officer')}><Users size={17}/><span>Manage</span></button>}<ThemeMenu/><button className="toolbar-avatar plain-button" onClick={() => user ? go('profile') : setAuthOpen(true)} aria-label={user ? 'Open profile' : 'Sign in'}>{avatar}</button></div></header>
      <main className="main-content" id="main-content">
        <div className={`page-header ${view==='home'?'home-page-header':''}`}><div><h1>{viewTitles[view]}</h1>{subtitle[view] && <p className="header-subtitle">{subtitle[view]}</p>}</div>
        </div>
      {loading ? <div className="page-loading" role="status"><LoaderCircle size={28} className="spin"/><p>Loading clubs and events…</p></div> : loadError ? <div className="surface empty-state"><CircleHelp size={30}/><h2>Unable to load clubs and events</h2><p>{loadError}</p><p className="fine-print">Make sure the local API is running on port 8000, then try again.</p><button className="button button-primary" onClick={() => void load()}>Try again</button></div> : <>
        {view === 'home' && <HomeExperience
          firstName={firstName} user={user} clubs={homePicks?.length ? homePicks : user ? recommendations : recommended}
          events={routeSource} myEvents={myUpcoming} suggestedEvents={suggestedEvents} onMyEvents={() => openProfile('events')} announcements={announcements} saved={saved} busy={busy} swipeRemaining={homePicks?.length ?? recommendations.length}
          onOpenClub={setClubDetail} onSave={club => void bookmark(club)} onDismiss={club => void dismissClub(club)}
          onOpenEvent={openEvent} onSaveEvent={event => void saveEvent(event)}
          onSearch={term => {if (wantsEvents(term)){setEventQuery(term);go('events');}else{setQuery(term);setCampus('');setCategory('');setBeginner(/beginner/i.test(term));go('discover',true);}}}
          onDiscover={() => go('discover')} onDaily={() => {setDiscoverMode('foryou');go('discover',false,true);}}
          onOrbit={() => go('orbit')} onEvents={() => go('events')} onCommunity={() => go('forums')}
        />}
        {view === 'orbit' && <section className="orbit-page" aria-labelledby="orbit-title"><header className="orbit-page-heading"><div><p className="home-kicker">CAMPUS DISCOVERY</p><h1 id="orbit-title">In your <em>orbit.</em></h1><p>See what’s happening around campus.</p></div><span><Radio size={16}/>Campus areas and events</span></header><CampusMap events={routeSource} user={user} onOpenEvent={openEvent}/></section>}
        {view === 'discover' && <><div className="segmented view-switch" role="group" aria-label="Discover mode"><button className={!directory&&!dailyMode?'selected':''} aria-pressed={!directory&&!dailyMode} onClick={() => go('discover')}><Compass size={16}/>Swipe</button><button className={directory?'selected':''} aria-pressed={directory} onClick={() => go('discover',true)}><Users size={16}/>List<span className="count">{clubs.length}</span></button><button className={dailyMode?'selected':''} aria-pressed={dailyMode} onClick={() => {setDiscoverMode('foryou');go('discover',false,true);}}><Sparkles size={16}/>Daily Discovery</button></div>{!directory&&!dailyMode&&<label className="discover-intention"><span>Explore with an intention</span><select aria-label="Temporary discovery intention" value={discoveryIntention} onChange={e=>setDiscoveryIntention(e.target.value)}><option value="">Any direction</option>{DISCOVERY_INTENTIONS.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
          {directory ? <><div className="filter-bar"><div className="search-input"><Search size={18}/><input aria-label="Search clubs and interests" placeholder="Describe what you’re into, like “pickup basketball” or “premed volunteering”" value={query} onChange={e => setQuery(e.target.value)} enterKeyHint="search"/>{query && <button className="icon-button clear-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></button>}</div><label className="select-filter"><span className="sr-only">Campus</span><Compass size={16}/><select value={campus} onChange={e => setCampus(e.target.value)}><option value="">All campuses</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label><label className="select-filter"><span className="sr-only">Interest</span><SlidersHorizontal size={16}/><select value={category} onChange={e => setCategory(e.target.value)}><option value="">All interests</option>{categories.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label><label className={`chip toggle-chip ${beginner ? 'on' : ''}`}><input type="checkbox" checked={beginner} onChange={e => setBeginner(e.target.checked)}/><Check size={16}/>Beginner friendly</label></div>
            <p className="result-count" role="status">{searching ? 'Searching…' : `${visibleSearchClubs.length} ${visibleSearchClubs.length === 1 ? 'club' : 'clubs'}`}{searchClubs.length > 0 && searchClubs.every(c => c.verification === 'demo') && <span> · All are demo organizations</span>}</p>{query.trim() && !searching && understood && <SearchReading understood={understood}/>}{searchError && <p className="form-error" role="alert">{searchError}</p>}
            <div className={`club-grid ${searching ? 'is-loading' : ''}`} aria-busy={searching}>{visibleSearchClubs.map(club => <ClubCard key={club.id} club={club} following={saved.club_ids.includes(club.id)} onOpen={() => setClubDetail(club)} onFollow={() => void follow(club)}/>)}</div>
            {!searching && !visibleSearchClubs.length && !searchError && <div className="surface empty-state"><Search size={28}/><h3>No clubs match</h3><p>Try a broader search, or clear the filters.</p><button className="button button-secondary" onClick={() => {setQuery(''); setCampus(''); setCategory(''); setBeginner(false);}}>Clear filters</button></div>}</>
          : <div className="discovery-layout"><div className="discovery-stage">{!dailyMode&&<ModeSwitch mode={discoverMode} onChange={setDiscoverMode}/ >}{dailyMode&&forYou&&forYou.method!=='cold_start'&&<div className="daily-progress"><span>YOUR DAILY SET</span><strong>{Math.max(0,(forYou?.clubs.length??discoverClubs.length)-discoverClubs.length)} of {forYou?.clubs.length??discoverClubs.length} explored</strong><div><i style={{width:`${(Math.max(0,(forYou?.clubs.length??discoverClubs.length)-discoverClubs.length)/Math.max(1,forYou?.clubs.length??discoverClubs.length))*100}%`}}/></div></div>}{discoverMode === 'foryou' && forYouLoading && !forYou ? <div className="loading-state">Finding clubs for you…</div> : discoverMode === 'foryou' && forYou?.method === 'cold_start' ? <div className="surface empty-state"><Sparkles size={34}/><h2>{user ? 'Tell us what you like' : 'Sign in for picks made for you'}</h2><p>{user ? 'For you starts from your interests, your major, and clubs you follow or save. Add some, or follow a club in Discover mode, and this fills up.' : 'For you uses your interests, major, and the clubs you follow. Meanwhile, Discover mode shows clubs at random.'}</p>{user ? <button className="button button-primary" onClick={() => setOnboarding(true)}><Settings2 size={16}/>Choose interests and major</button> : <button className="button button-primary" onClick={() => setAuthOpen(true)}><LogIn size={16}/>Sign in with ScarletMail</button>}<button className="text-button" onClick={() => setDiscoverMode('random')}><Shuffle size={15}/>Switch to Discover mode</button></div> : currentDiscover ? <>{discoverClubs.find(club=>club.id!==currentDiscover.id)&&<motion.div className="discovery-stack-card" style={{scale:nextCardScale,y:nextCardY}} aria-hidden="true"><ClubArt category={discoverClubs.find(club=>club.id!==currentDiscover.id)!.category} color={discoverClubs.find(club=>club.id!==currentDiscover.id)!.color} logo={discoverClubs.find(club=>club.id!==currentDiscover.id)!.logo_url} size="large"/></motion.div>}<motion.article key={currentDiscover.id} ref={discoverCard} className="discovery-card surface" style={{'--club': currentDiscover.color,rotate:cardRotate} as MotionStyle} drag="x" dragConstraints={{left:0,right:0}} dragElastic={0.78} dragMomentum={false} whileDrag={{scale:1.015}} onDrag={(_,info)=>{stackDrag.set(info.offset.x);const card=discoverCard.current;if(card)card.style.setProperty('--swipe',String(Math.max(-1,Math.min(1,info.offset.x/dragThreshold(card)))));}} onDragEnd={(_,info)=>{stackDrag.set(0);const card=discoverCard.current;if(!card)return;const threshold=dragThreshold(card);const passed=info.offset.x < -threshold || info.velocity.x < -700;const followed=info.offset.x > threshold || info.velocity.x > 700;if(busy||swipeInProgress.current||(!passed&&!followed))card.style.removeProperty('--swipe');if(info.offset.x < -threshold || info.velocity.x < -700) void decide('dismiss',info.offset.x); else if(info.offset.x > threshold || info.velocity.x > 700) void decide('interested',info.offset.x);}}><span className="swipe-stamp stamp-follow" aria-hidden="true"><Heart size={16} fill="currentColor"/>Follow</span><span className="swipe-stamp stamp-pass" aria-hidden="true"><X size={16}/>Pass</span><div className="discovery-cover"><span className="deck-count">{discoverClubs.length} {discoverClubs.length === 1 ? 'club' : 'clubs'} left</span><ClubArt category={currentDiscover.category} color={currentDiscover.color} logo={currentDiscover.logo_url} size="large"/><button className="icon-button discovery-detail" aria-label="View club details" onClick={() => setClubDetail(currentDiscover)}><ArrowUpRight size={20}/></button></div><div className="discovery-copy"><span className="category-label">{currentDiscover.category}</span><h2>{cleanName(currentDiscover.name)}</h2><p>{currentDiscover.description}</p><div className="tag-list"><CampusMark campus={currentDiscover.campus}/>{currentDiscover.beginner_friendly && <span className="meta-note"><Check size={14}/>Beginners welcome</span>}<span className="meta-note">{currentDiscover.membership_fee}</span></div>{'explanation' in currentDiscover && <p className="recommendation-reason"><Sparkles size={14}/><span><strong>Why this club: </strong>{String(currentDiscover.explanation)}</span></p>}</div></motion.article></>
            : <div className="surface empty-state"><CheckCheck size={34}/><h2>{dailyMode?"You’re all caught up for today.":"You’ve seen every suggestion"}</h2><p>{dailyMode?"Your daily set is complete. A fresh set is ready tomorrow.":"Followed and saved clubs are in Saved. The full directory has every club."}</p><button className="button button-primary" onClick={() => setDirectory(true)}>Browse all clubs</button>{discoverMode === 'foryou' && <button className="text-button" onClick={() => setDiscoverMode('random')}><Shuffle size={15}/>Try Discover mode</button>}{(saved.dismissed_ids.length > 0 || sessionSkipped.length > 0) && <button className="text-button" onClick={() => void resetPasses()}>Show passed clubs again</button>}</div>}
            {currentDiscover && <><div className="discovery-actions"><button className="discovery-action action-pass" onClick={() => void decide('dismiss')} disabled={busy || swiping}><span><X size={26}/></span>Pass<kbd aria-hidden="true">←</kbd></button><button className="discovery-action action-later" onClick={() => void decide('later')} disabled={busy || swiping}><span><Bookmark size={23}/></span>Later<kbd aria-hidden="true">↓</kbd></button><button className="discovery-action action-interested" onClick={() => void decide('interested')} disabled={busy || swiping}><span><Heart size={26} fill="currentColor"/></span>Follow<kbd aria-hidden="true">→</kbd></button></div><p className="discovery-count">Swipe left to pass · Swipe right to follow</p></>}
          </div><details className="deck-info"><summary>{discoverMode === 'foryou' ? 'How For you works' : 'How Discover works'}</summary><div className="deck-info-content">{discoverMode === 'foryou' ? <><p>Clubs are linked in a graph by shared tags, categories, and similar descriptions, and by clubs that several people follow together. For you starts at the clubs you follow or save and the topics in your interests and major, then follows those links. Passing a club also lowers similar ones.</p><p className="fine-print">It suggests; it doesn’t predict who you are or where you belong.{forYou?.graph?.edges ? ` The graph has ${forYou.graph.edges.toLocaleString()} links between ${forYou.graph.nodes.toLocaleString()} clubs and topics.` : ''}</p></> : <><p>Clubs appear in random order, so you can stumble onto something you’d never search for. Your interests and follows aren’t used here.</p><button className="text-button" onClick={() => {setShuffleSeed(Math.floor(Math.random() * 2 ** 31)); setDiscoverIndex(0);}}><Shuffle size={15}/>Shuffle again</button></>}<p>Drag the card left to pass or right to follow, or use the arrow keys (↓ keeps it for later).</p><button className="text-button" onClick={() => user ? setOnboarding(true) : setAuthOpen(true)}><Settings2 size={15}/>Change interests</button>{(saved.dismissed_ids.length > 0 || sessionSkipped.length > 0) && <button className="text-button" onClick={() => void resetPasses()}><ArrowLeft size={15}/>Show passed clubs again</button>}</div></details></div>}
        </>}

        {view === 'events' && <>{hasLive && events.length > 0 && <div className="segmented view-switch" role="group" aria-label="Event source"><button className={eventSource === 'live' ? 'selected' : ''} aria-pressed={eventSource === 'live'} onClick={() => {setEventSource('live'); setEventResults(liveEvents);}}><Radio size={16}/>Rutgers events<span className="count">{liveEvents.length}</span></button><button className={eventSource === 'demo' ? 'selected' : ''} aria-pressed={eventSource === 'demo'} onClick={() => {setEventSource('demo'); setEventCategory(''); setEventResults(events);}}><FlaskConical size={16}/>Demo clubs</button></div>}<div className="filter-bar"><div className="search-input"><Search size={18}/><input aria-label="Search events" placeholder="Try “free beginner AI this week”" value={eventQuery} onChange={e => setEventQuery(e.target.value)} enterKeyHint="search"/>{eventQuery && <button className="icon-button clear-button" aria-label="Clear search" onClick={() => setEventQuery('')}><X size={15}/></button>}</div><label className="select-filter"><span className="sr-only">Campus</span><Compass size={16}/><select value={eventCampus} onChange={e => setEventCampus(e.target.value)}><option value="">All campuses</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label>{eventSource === 'live' && <label className="select-filter"><span className="sr-only">Category</span><SlidersHorizontal size={16}/><select value={eventCategory} onChange={e => setEventCategory(e.target.value)}><option value="">All categories</option>{liveCategories.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label>}</div>{eventSource === 'live' && liveNote && <p className="route-source source-line"><Radio size={14}/>{liveNote}. Only New Brunswick club, arts, recreation, and home-game listings are shown.</p>}{eventsSearchError && <p className="form-error" role="alert">{eventsSearchError}</p>}{eventsSearching && <p className="result-count" role="status">Searching…</p>}<div className={eventsSearching ? 'is-loading' : ''} aria-busy={eventsSearching}><EventCalendar key={eventSource} events={eventResults} savedIds={saved.event_ids} onOpen={openEvent} onSave={event => void saveEvent(event)} today={easternDay(eventSource === 'live' ? new Date(now) : REFERENCE_DATE)} footnote={eventSource === 'live' ? 'Times are Eastern Time. Listings change; confirm details on getINVOLVED before you go.' : 'Times are Eastern Time. “Today” for demo events is October 22, 2026.'}/></div></>}

        {(view === 'forums' || view === 'inbox') && <SocialTabs tab={view === 'forums' ? 'discussions' : inboxTab} unread={unread} onTab={tab => {if (tab === 'discussions') go('forums'); else {setInboxTab(tab); go('inbox');}}}/>}
        {view === 'forums' && <div id="social-panel" role="tabpanel" aria-labelledby="social-tab-discussions"><ForumsPanel clubs={clubs} user={user} onSignIn={() => setAuthOpen(true)} initialPostId={initialForumPostId} onOpenProfile={openPerson}/></div>}

        {view === 'inbox' && (user ? <InboxPage key={user.id} tab={inboxTab} conversationId={conversationId} onConversation={setConversationId} unread={unread} onUnread={updateUnread} onOpenProfile={openPerson} onOpenClub={openClubById} onOpenEvent={openEventById}/> : <GuestPrompt onSignIn={() => setAuthOpen(true)} title="Sign in to see your messages and notifications" description="Messages, answers from club managers, and updates from clubs you follow."/>)}

        {view === 'profile' && (user ? <ProfilePage key={user.id} user={user} managedClubs={managedClubs} tab={profileTab} onTab={setProfileTab} refreshKey={profileKey} savedEventIds={saved.event_ids}
            onUser={next => void profileSaved(next)} onOpenClub={setClubDetail} onOpenEvent={openEvent} onFollow={follow} onLater={bookmark} onSaveEvent={saveEvent}
            onManage={() => go('officer')} onLogout={() => void logout()} onExplore={where => go(where)}
            onDeleted={() => {setUser(null); setSaved(EMPTY_SAVED); go('home'); void refreshClubs().catch(e => notify(e.message, true)); void refreshRecommendations().catch(e => notify(e.message, true)); notify('Your account and personal data were deleted.');}}/>
          : <GuestPrompt onSignIn={() => setAuthOpen(true)} title="Sign in to see your profile" description="Your clubs, events, and saved items in one place. Profiles are private unless you choose to share them."/>)}
        {view === 'officer' && (isOfficer ? <OfficerPanel allEvents={events} categories={categories} onView={setClubDetail} onRefresh={() => {void Promise.all([api<Club[]>('/clubs'), api<CampusEvent[]>('/events')]).then(([nextClubs, nextEvents]) => {setClubs(nextClubs); setEvents(nextEvents); setEventResults(nextEvents);}).catch(e => notify(e.message, true));}}/> : (user ? <div className="surface empty-state guest-prompt"><span className="empty-symbol"><Users size={28}/></span><h2>You don’t manage any clubs</h2><p>The club manager appears once you’re listed as an owner of a club. Ask the site admins to add your ScarletMail address.</p></div> : <GuestPrompt onSignIn={() => setAuthOpen(true)} title="For club owners" description="Sign in with your ScarletMail to manage the clubs you own."/>))}
        <footer className="page-footer"><p>ClRUb is an independent student project, not affiliated with Rutgers University. Rutgers events come from getINVOLVED and Rutgers Recreation via Scarlet Sync; clubs come from their public profiles on The Arc.</p><p className="footer-links"><button className="inline-link" onClick={() => setAboutOpen(true)}>About ClRUb</button><a className="inline-link" href="/privacy">Privacy Policy</a>{SUPPORT_EMAIL && <a className="inline-link" href={`mailto:${SUPPORT_EMAIL}`}>Contact</a>}</p></footer>
      </>}
      </main>
    </div>
    <nav className="tab-bar glass" aria-label="Main navigation">{NAV.map(item => <button key={item.id} className={navView === item.id ? 'active' : ''} onClick={() => item.id==='profile'&&!user?setAuthOpen(true):go(item.id)} aria-current={navView === item.id ? 'page' : undefined}><item.icon size={22} strokeWidth={navView === item.id ? 2.3 : 1.9}/><span>{item.title}</span>{item.id === 'forums' && unreadTotal > 0 && <span className="unread-badge">{unreadTotal > 99 ? '99+' : unreadTotal}<span className="sr-only"> unread</span></span>}</button>)}</nav>
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18}/> : <Check size={18}/>}<span>{toast.text}</span><button aria-label="Dismiss" onClick={() => setToast(null)}><X size={15}/></button></div>}
    {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSuccess={(next, isNew) => void authSuccess(next, isNew)}/>}
    {onboarding && user && <OnboardingDialog user={user} onClose={() => setOnboarding(false)} onSave={next => void profileSaved(next)}/>}
    {clubDetail && <ClubDetail key={clubDetail.id} club={clubDetail} events={events.filter(e => e.club_id === clubDetail.id)} following={saved.club_ids.includes(clubDetail.id)} onFollow={() => {if (!user) setClubDetail(null); void follow(clubDetail);}} onClose={() => setClubDetail(null)} onEvent={openEvent} onSignIn={() => {signInFromClub.current = clubDetail.id; setClubDetail(null); setAuthOpen(true);}} signedIn={!!user} onOpenProfile={openPerson} onOpenConversation={openConversation}/>}
    {eventDetail && <EventDetail key={eventDetail.id} event={eventDetail} saved={saved.event_ids.includes(eventDetail.id)} onSave={() => {if (!user) setEventDetail(null); void saveEvent(eventDetail);}} onClose={() => setEventDetail(null)} onRsvp={rsvp} rsvp={saved.rsvps?.[eventDetail.id] || 'none'} conflicts={detailConflicts}/>}
    {studentProfile && <StudentProfileDialog key={studentProfile} who={studentProfile} onClose={() => setStudentProfile(null)} onOpenClub={openClubById} onOpenConversation={openConversation} onOwnProfile={() => {setStudentProfile(null); setClubDetail(null); go('profile');}}/>}
    {aboutOpen && <Dialog title="About ClRUb" wide onClose={() => setAboutOpen(false)}><p className="dialog-description">ClRUb is an independent student-built project for exploring campus communities. It is not affiliated with Rutgers University or an official university service.</p><section className="about-section"><h3>Real Rutgers clubs and events</h3><p>Rutgers events are real listings from Rutgers getINVOLVED and Rutgers Recreation, collected by <a className="inline-link" href="https://scarletsync.app/events" target="_blank" rel="noreferrer">Scarlet Sync</a> and refreshed every few hours. Only New Brunswick club, arts, recreation, and home-game listings are shown. Confirm details and RSVP on getINVOLVED.</p><p>The clubs in Discover come from student organizations’ public profiles on The Arc, Rutgers’ involvement platform. Each club’s description, meeting time, location, and contact details are taken from its own profile. Many clubs don’t list a meeting time there, and profiles can be out of date, so confirm plans with the club. Fraternities, sororities, and inactive organizations are not included.</p><a className="text-button" href="https://sca.rutgers.edu/campus-involvement/student-organizations" target="_blank" rel="noreferrer">Rutgers’ official involvement website<ArrowUpRight size={15}/></a></section><section className="about-section"><h3>How suggestions work</h3><p>Club descriptions are compared with the interests and goals you choose, using local text features and semantic similarity. Change your interests, show passed clubs again, or browse every club at any time. A similarity score is not a probability, a quality ranking, or a prediction of belonging.</p><p className="method-label">Current method: {method || 'Local text similarity with a varied guest selection'}</p><p>No paid language model or external API key is used. Text matching can miss nuance and can favor longer descriptions, so suggestions mix categories and the full directory is always available.</p></section><section className="about-section"><h3>Answers come with sources</h3><p>The club assistant answers only from the selected club’s published profile and FAQs and shows the excerpts it used. When the information is missing, it says so. Report an inaccurate answer from the club or event details.</p></section><section className="about-section"><h3>Your information stays private</h3><p>Choosing interests is optional. Profiles are private unless you choose to share yours with signed-in students, are stored in this app’s database, and can be deleted from Profile. Follows and RSVPs only add to aggregate counts that officers see. Messages are visible only to the people in the conversation; a question to a club is visible to all of its managers. Don’t enter sensitive personal information in questions or forms.</p></section><p className="about-footer"><ShieldCheck size={18}/>Small local models, visible sources, and the whole directory always one tap away.</p><p className="fine-print">Read the <a className="inline-link" href="/privacy">Privacy Policy</a>.{SUPPORT_EMAIL && <> Questions or requests: <a className="inline-link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</>}</p></Dialog>}
  </div>;
}

// Mulberry32: a tiny seeded generator, so the random order stays put while you swipe.
function seededShuffle<T>(items: T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = () => {state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296;};
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]];}
  return out;
}

function ModeSwitch({mode, onChange}: {mode: DiscoverMode; onChange: (mode: DiscoverMode) => void}) {
  const forYou = mode === 'foryou';
  return <div className="mode-switch-block">
    <div className="mode-switch-row">
      <button type="button" className={`mode-label ${!forYou ? 'on' : ''}`} onClick={() => onChange('random')}><Shuffle size={15}/>Discover</button>
      <button type="button" role="switch" aria-checked={forYou} aria-label="For you mode" className={`mode-switch ${forYou ? 'is-on' : ''}`} onClick={() => onChange(forYou ? 'random' : 'foryou')}><span className="mode-switch-thumb"/></button>
      <button type="button" className={`mode-label ${forYou ? 'on' : ''}`} onClick={() => onChange('foryou')}><Sparkles size={15}/>For you</button>
    </div>
    <p className="mode-explainer" aria-live="polite">{forYou ? <><strong>For you:</strong> clubs tailored to you, using your interests, major, and the clubs you follow or save. Each card says why it was picked.</> : <><strong>Discover:</strong> random clubs from across campus, to find something new. Your interests aren’t used.</>}</p>
  </div>;
}

// Shows how the search box read the query, so a surprising result has a visible cause.
function SearchReading({understood}: {understood: SearchUnderstanding}) {
  const filters = [understood.campus && `on ${understood.campus}`, understood.free && 'free', understood.beginner && 'beginner friendly'].filter(Boolean) as string[];
  if (!understood.topics.length && !filters.length) return null;
  return <p className="search-reading"><Sparkles size={14}/><span className="sr-only">Searching for </span>{understood.topics.map(topic => <span key={topic} className="reading-chip">{topic}</span>)}{filters.map(filter => <span key={filter} className="reading-chip reading-filter">{filter}</span>)}</p>;
}

/** Home search goes to Events for "what's on tonight", but "event planning club" is a club search. */
function wantsEvents(term: string) {
  if (/\b(clubs?|orgs?|organi[sz]ations?|societ(y|ies)|teams?|event (planning|management))\b/i.test(term)) return false;
  return /\b(tonight|today|tomorrow|this week(end)?|happening|events?)\b/i.test(term);
}

function GuestPrompt({onSignIn, title, description}: {onSignIn: () => void; title: string; description: string}) {return <div className="surface empty-state guest-prompt"><span className="empty-symbol"><UserRound size={28}/></span><h2>{title}</h2><p>{description}</p><button className="button button-primary" onClick={onSignIn}><LogIn size={17}/>Sign in</button><span className="fine-print">Browsing clubs and events never requires an account.</span></div>;}
