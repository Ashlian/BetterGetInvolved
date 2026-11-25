'use client';

import {LayoutGroup} from 'motion/react';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowUpRight, Bookmark, GraduationCap, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, Compass, FlaskConical, House, LoaderCircle, LogIn, MessagesSquare, Radio, Search, Settings2, ShieldCheck, Shuffle, SlidersHorizontal, Sparkles, Users, UserRound, X} from 'lucide-react';
import {api, post, cleanName, dateKey, eventEnd, overlaps, relativeTime, CAMPUSES, REFERENCE_DATE, type Club, type Recommendation, type ForYou, type DiscoverMode, type ClubSearchResult, type SearchUnderstanding, type CampusEvent, type ForumPost, type LiveStatus, type Unread, type User, type Saved} from '@/lib/api';
import {AuthDialog, OnboardingDialog} from './account';
import UserAvatar from './avatar';
import {ProfilePage, StudentProfileDialog, type ProfileTab} from './profile';
import HomeFeed, {HomeHero} from './home-feed';
import {DailyCover, DailyDeck} from './daily-discovery';
import signatureStyles from './signature.module.css';
import RutgersDNA from './rutgers-dna';
import {useDailyDiscovery} from './use-daily-discovery';
import ClubCard from './club-card';
import Dialog from './dialog';
import {ClubDetail, EventDetail} from './detail-dialogs';
import EventCalendar, {easternDay} from './event-calendar';
import OfficerPanel from './officer-panel';
import ForumsPanel from './forums-panel';
import InboxPage, {SocialTabs, type InboxTab} from './inbox';
import DiscoverDeck, {type DeckAction} from './discover-deck';
import discoverStyles from './discover-deck.module.css';

type View = 'home' | 'daily' | 'dna' | 'discover' | 'events' | 'forums' | 'inbox' | 'profile' | 'officer';
const NO_UNREAD: Unread = {messages: 0, notifications: 0};
const UNREAD_POLL_MS = 60000;
const EMPTY_SAVED: Saved = {club_ids: [], event_ids: [], dismissed_ids: [], maybe_later_ids: [], rsvps: {}};
const NAV = [{id: 'home' as const, title: 'Home', icon: House}, {id: 'discover' as const, title: 'Discover', icon: Compass}, {id: 'events' as const, title: 'Events', icon: CalendarDays}, {id: 'forums' as const, title: 'Social', icon: MessagesSquare}];
const viewTitles: Record<View, string> = {home: 'Home', daily: 'Daily Discovery', dna: 'Rutgers DNA', discover: 'Discover', events: 'Events', forums: 'Social', inbox: 'Social', profile: 'Profile', officer: 'Club manager'};
// The site's contact address comes from the environment (set in Vercel and .env), not the code.
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';

export default function CampusApp({initialClubId, initialEventId, initialForumPostId, initialView = 'home'}: {initialClubId?: string; initialEventId?: string; initialForumPostId?: string; initialView?: View} = {}) {
  const [view, setView] = useState<View>(initialView); const [directory, setDirectory] = useState(false);
  const [clubs, setClubs] = useState<Club[]>([]); const [recommendations, setRecommendations] = useState<Recommendation[]>([]); const [method, setMethod] = useState('');
  const [events, setEvents] = useState<CampusEvent[]>([]); const [user, setUser] = useState<User | null>(null); const [saved, setSaved] = useState<Saved>(EMPTY_SAVED);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(''); const [toast, setToast] = useState<{text: string; error?: boolean} | null>(null);
  const [authOpen, setAuthOpen] = useState(false); const [onboarding, setOnboarding] = useState(false); const [aboutOpen, setAboutOpen] = useState(false);
  const [clubDetail, setClubDetail] = useState<Club | null>(null); const [eventDetail, setEventDetail] = useState<CampusEvent | null>(null);
  const [query, setQuery] = useState(''); const [campus, setCampus] = useState(''); const [category, setCategory] = useState(''); const [beginner, setBeginner] = useState(false);
  const [searchClubs, setSearchClubs] = useState<(Club | Recommendation)[]>([]); const [understood, setUnderstood] = useState<SearchUnderstanding | null>(null); const [searching, setSearching] = useState(false); const [searchError, setSearchError] = useState(''); const [sessionSkipped, setSessionSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [profileTab, setProfileTab] = useState<ProfileTab>('clubs'); const [studentProfile, setStudentProfile] = useState<string | null>(null);
  const [unread, setUnread] = useState<Unread>(NO_UNREAD); const [inboxTab, setInboxTab] = useState<InboxTab>('messages'); const [conversationId, setConversationId] = useState<string | null>(null);
  const [homePicks, setHomePicks] = useState<{account: string; day: string; clubs: Recommendation[]} | null>(null);
  const [homePicksError, setHomePicksError] = useState<{account: string; message: string} | null>(null);
  const [homePicksRetry, setHomePicksRetry] = useState(0); const [announcements, setAnnouncements] = useState<ForumPost[] | null>(null); const [suggestedEvents, setSuggestedEvents] = useState<CampusEvent[]>([]); const [eventQuery, setEventQuery] = useState(''); const [eventCampus, setEventCampus] = useState('');
  const [eventResults, setEventResults] = useState<CampusEvent[]>([]); const [eventsSearching, setEventsSearching] = useState(false); const [eventsSearchError, setEventsSearchError] = useState('');
  const [liveEvents, setLiveEvents] = useState<CampusEvent[]>([]); const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null); const [eventSource, setEventSource] = useState<'live' | 'demo'>('live'); const [eventCategory, setEventCategory] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const dailyDate = dateKey(new Date(now).toISOString());
  const rankedHome = homePicks && homePicks.account === user?.id ? homePicks.clubs : undefined;
  const rankedHomeError = homePicksError && homePicksError.account === user?.id ? homePicksError.message : '';
  const daily = useDailyDiscovery(user?.id, now, homePicks?.day === dailyDate ? rankedHome : undefined, clubs, saved, !loading && !loadError);
  const openedInitial = useRef(false);
  const [discoverMode, setDiscoverModeState] = useState<DiscoverMode>('random');
  const [forYou, setForYou] = useState<{account: string; result: ForYou} | null>(null);
  const [forYouError, setForYouError] = useState<{account: string; message: string} | null>(null);
  const [forYouRetry, setForYouRetry] = useState(0);
  const [deckLayout, setDeckLayout] = useState<'swipe' | 'list'>('swipe');
  const deckRequest = useRef(false);
  const uncertainDeckWrites = useRef(new Set<string>());
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  function setDiscoverMode(mode: DiscoverMode) {
    setDiscoverModeState(mode);
    setDeckLayout('swipe');
  }
  const notify = useCallback((text: string, error = false) => setToast({text, error}), []);
  const refreshRecommendations = useCallback(async () => {
    const result = await api<{clubs: Recommendation[]; method: string}>('/recommendations?limit=24'); setRecommendations(result.clubs); setMethod(result.method);
  }, []);
  const refreshSaved = useCallback(async () => {
    const current = await api<Saved>('/saved');
    setSaved(current);
    return current;
  }, []);
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
  const personalized = user && forYou?.account === user.id ? forYou.result : null;
  const personalizationError = user && forYouError?.account === user.id ? forYouError.message : '';
  useEffect(() => {
    if (view !== 'discover' || directory || discoverMode !== 'foryou' || !user) return;
    let active = true;
    setForYouError(null);
    void api<ForYou>('/for-you?limit=60').then(result => {
      if (active) setForYou({account: user.id, result});
    }).catch(error => {
      if (active) setForYouError({account: user.id, message: (error as Error).message});
    });
    return () => {active = false;};
  }, [view, directory, discoverMode, user, saved.club_ids, saved.maybe_later_ids, saved.dismissed_ids, forYouRetry]);
  useEffect(() => {
    if ((view !== 'home' && view !== 'daily') || !user || loading || loadError) return;
    let active = true;
    setHomePicksError(null);
    void api<ForYou>('/for-you?limit=6').then(result => {
      if (active) setHomePicks({account: user.id, day: dailyDate, clubs: result.clubs});
    }).catch(error => {
      if (active) setHomePicksError({account: user.id, message: (error as Error).message});
    });
    return () => {active = false;};
  }, [view, user, loading, loadError, saved.club_ids, saved.maybe_later_ids, saved.dismissed_ids, homePicksRetry, dailyDate]);

  useEffect(() => {
    if (view !== 'home' || !user) {if (!user) {setHomePicks(null); setHomePicksError(null); setAnnouncements(null); setSuggestedEvents([]);} return;}
    let active = true;
    void api<ForumPost[]>('/announcements?limit=5').then(result => {if (active) setAnnouncements(result);}).catch(() => {if (active) setAnnouncements([]);});
    const interests = user.interests.join(' ');
    if (interests) void api<CampusEvent[]>(`/live/events?q=${encodeURIComponent(interests)}`).then(result => {if (active) setSuggestedEvents(result.filter(e => e.status === 'scheduled' && eventEnd(e) > Date.now()).slice(0, 4));}).catch(() => {if (active) setSuggestedEvents([]);});
    else setSuggestedEvents([]);
    return () => {active = false;};
  }, [view, user, saved.club_ids]);
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
  const navView = view === 'inbox' ? 'forums' : view === 'daily' || view === 'dna' ? 'home' : view;
  const unreadTotal = unread.messages + unread.notifications;
  function openPerson(who: string) {if (!user) {setAuthOpen(true); return;} setStudentProfile(who);}
  function openConversation(id: string) {setClubDetail(null); setStudentProfile(null); setInboxTab('messages'); setConversationId(id); go('inbox');}
  function openClubById(id: string) {const club = clubs.find(c => c.id === id); if (club) {setStudentProfile(null); setClubDetail(club);} else notify('That club could not be found.', true);}
  function openEventById(id: string) {void api<CampusEvent>(`/events/${encodeURIComponent(id)}`).then(openEvent).catch(e => notify((e as Error).message, true));}
  function go(next: View, allClubs = false) {setView(next); if (next === 'discover') {setDirectory(allClubs); if (!allClubs) setDeckLayout('swipe');} window.scrollTo({top: 0, behavior: 'instant'});}
  function searchDirectory(term: string) {
    setQuery(term); setCampus(''); setCategory(''); setBeginner(false); go('discover', true);
  }
  function openDiscover(mode: DiscoverMode) {
    setDiscoverMode(mode);
    go('discover');
  }
  function navigatePrimary(next: View) {
    if (next === 'discover') openDiscover('random');
    else go(next);
  }
  function openHomeDeck() {
    openDiscover(user ? 'foryou' : 'random');
  }
  function openProfile(tab: ProfileTab) {if (!user) {setAuthOpen(true); return;} setProfileTab(tab); go('profile');}
  async function dismissClub(club: Club) {
    if (!requireUser() || busy) return; setBusy(true);
    try {await post(`/clubs/${club.id}/dismiss`); setSaved(s => ({...s, dismissed_ids: [...s.dismissed_ids.filter(id => id !== club.id), club.id]})); notify(`Got it, fewer clubs like ${cleanName(club.name)}.`);}
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
    try {const result = await post<{bookmarked: boolean}>(`/clubs/${club.id}/bookmark`); setSaved(s => ({...s, maybe_later_ids: result.bookmarked ? [...(s.maybe_later_ids || []).filter(id => id !== club.id), club.id] : (s.maybe_later_ids || []).filter(id => id !== club.id)})); notify(result.bookmarked ? 'Saved to Later.' : 'Removed from Later.');}
    catch (e) {notify((e as Error).message, true);} finally {setBusy(false);}
  }
  const shuffledClubs = useMemo(() => seededShuffle(clubs, shuffleSeed), [clubs, shuffleSeed]);
  const discoverClubs = useMemo(() => {
    const excluded = new Set([...saved.club_ids, ...saved.dismissed_ids, ...(saved.maybe_later_ids ?? []), ...(!user ? sessionSkipped : [])]);
    return (discoverMode === 'foryou' ? personalized?.clubs ?? [] : shuffledClubs).filter(club => !excluded.has(club.id));
  }, [discoverMode, personalized, shuffledClubs, saved, sessionSkipped, user]);

  async function actOnDeck(action: DeckAction, club: Club) {
    if (busy || deckRequest.current) return false;
    if (!user) {
      if (action !== 'pass') {setAuthOpen(true); return false;}
      setSessionSkipped(current => [...current, club.id]);
      notify(`Passed on ${cleanName(club.name)}.`);
      return true;
    }

    const operation = action === 'pass' ? {endpoint: 'dismiss', result: 'dismissed', list: 'dismissed_ids'} as const
      : action === 'save' ? {endpoint: 'bookmark', result: 'bookmarked', list: 'maybe_later_ids'} as const
        : {endpoint: 'follow', result: 'following', list: 'club_ids'} as const;
    deckRequest.current = true;
    setBusy(true);
    const writeKey = JSON.stringify([user.id, club.id, action]);
    try {
      if (uncertainDeckWrites.current.has(writeKey)) {
        const current = await refreshSaved();
        uncertainDeckWrites.current.delete(writeKey);
        if (current[operation.list]?.includes(club.id)) return true;
      }
      uncertainDeckWrites.current.add(writeKey);
      const result = await post<Record<string, boolean>>(`/clubs/${encodeURIComponent(club.id)}/${operation.endpoint}`);
      uncertainDeckWrites.current.delete(writeKey);
      const selected = result[operation.result];
      setSaved(current => {
        const ids = (current[operation.list] ?? []).filter(id => id !== club.id);
        return {...current, [operation.list]: selected ? [...ids, club.id] : ids};
      });
      if (!selected) {
        notify('Your choice changed in another session. The club is still in your queue.');
        return false;
      }
      const name = cleanName(club.name);
      notify(action === 'pass' ? `Passed on ${name}.` : action === 'save' ? `Saved ${name} for later.` : `Following ${name}.`);
      if (action === 'follow') void refreshRecommendations().catch(error => notify(error.message, true));
      return true;
    } catch (error) {
      notify((error as Error).message, true);
      // A lost response may have committed the toggle. Read the current state before another action.
      try {
        const current = await refreshSaved();
        uncertainDeckWrites.current.delete(writeKey);
        return current[operation.list]?.includes(club.id) ?? false;
      } catch {}
      return false;
    } finally {
      deckRequest.current = false;
      setBusy(false);
    }
  }

  async function resetPasses() {
    if (busy || deckRequest.current) return;
    deckRequest.current = true;
    setBusy(true);
    try {
      for (const id of saved.dismissed_ids) await post(`/clubs/${encodeURIComponent(id)}/dismiss`);
      setSaved(current => ({...current, dismissed_ids: []}));
      setSessionSkipped([]);
      notify('Passed clubs are back in Discover.');
    } catch (error) {
      notify((error as Error).message, true);
      if (user) await refreshSaved().catch(() => undefined);
    } finally {
      deckRequest.current = false;
      setBusy(false);
    }
  }

  async function authSuccess(next: User, isNew: boolean) {
    setUser(next); setAuthOpen(false);
    const nextClubs = await refreshClubs().catch(e => {notify(e.message, true); return null;});
    await refreshSaved().catch(e => notify(e.message, true)); await refreshRecommendations().catch(e => notify(e.message, true));
    // Reopen the club the student was viewing when they chose to sign in, now with contacts.
    const reopen = signInFromClub.current && nextClubs?.find(c => c.id === signInFromClub.current); signInFromClub.current = null;
    if (isNew) setOnboarding(true); else {if (reopen) setClubDetail(reopen); notify(`Welcome back, ${next.display_name.split(' ')[0]}.`);}
  }
  async function logout() {try {await post('/auth/logout'); setUser(null); setSaved(EMPTY_SAVED); setView('home'); void refreshClubs().catch(e => notify(e.message, true)); void refreshRecommendations().catch(e => notify(e.message, true)); notify('Signed out.');} catch (e) {notify((e as Error).message, true);}}
  async function profileSaved(next: User) {setHomePicks(null); setHomePicksError(null); setUser(next); setOnboarding(false); await refreshRecommendations().catch(e => notify(e.message, true));}
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
  const excludedHomeClubs = new Set([...saved.club_ids, ...saved.dismissed_ids, ...(saved.maybe_later_ids ?? [])]);
  const homeRecommendations = homePicks?.account === user?.id ? (homePicks?.clubs ?? []).filter(club => !excludedHomeClubs.has(club.id)) : [];
  const browseClubs = (recommendations.length ? recommendations : clubs).filter(club => !excludedHomeClubs.has(club.id)).slice(0, 6);
  const hasLive = liveEvents.length > 0;
  const upcomingLive = liveEvents.filter(event => event.status === 'scheduled' && eventEnd(event) > now);
  const campusLive = user?.campus ? upcomingLive.filter(event => event.campus === user.campus) : [];
  const campusEvents = (campusLive.length ? campusLive : hasLive ? upcomingLive : upcoming).slice(0, 4);
  const liveCategories = [...new Set(liveEvents.map(e => e.category))].sort();
  const liveNote = liveStatus?.synced_at ? `Live from Rutgers getINVOLVED and Rutgers Recreation via Scarlet Sync · checked ${relativeTime(liveStatus.synced_at)}` : '';
  const firstName = user?.display_name.split(' ')[0];
  const followedClubs = user ? clubs.filter(club => saved.club_ids.includes(club.id)) : [];
  const dailyAvailability = !user ? 'guest' : daily.total ? 'ready' : rankedHomeError ? 'error' : !daily.loaded || !rankedHome || homePicks?.day !== dailyDate ? 'loading' : 'empty';
  const modalOpen = !!(clubDetail || eventDetail || studentProfile || authOpen || onboarding || aboutOpen);
  const retryHomePicks = () => {setHomePicksError(null); setHomePicksRetry(value => value + 1);};
  // The club manager appears only for people who own a club (or admins).
  const isOfficer = !!user && (user.role === 'admin' || (user.managed_club_ids?.length ?? 0) > 0);
  const managedClubs = user ? clubs.filter(c => user.managed_club_ids?.includes(c.id)) : [];
  const subtitle: Record<View, string> = {
    home: '', daily: '', dna: '',
    discover: directory ? `Search all ${clubs.length} clubs by name, interest, or a plain-language request.` : '',
    events: eventSource === 'live' ? 'Real Rutgers–New Brunswick club, recreation, and game listings.' : 'Sample events from the demo clubs, for trying saves and RSVPs.',
    forums: 'Ask questions, share experiences, and talk about your clubs.',
    inbox: inboxTab === 'messages' ? 'Your direct messages and questions to clubs. Only the people in a conversation can see it.' : 'Replies, announcements, and changes to your events.',
    profile: '',
    officer: 'Update the clubs you own: profile, tags, contacts, questions, and events.',
  };
  const avatar = <UserAvatar name={user?.display_name} url={user?.avatar_url} size={36}/>;

  return <LayoutGroup><div className={view === 'daily' ? `app-shell ${signatureStyles.focusedShell}` : 'app-shell editorial-shell'} data-home={view === 'home'}>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header className="site-header">
      <div className="site-header-inner">
        <button className="brand plain-button" onClick={() => go('home')} aria-label="ClRUb, Home">
          <span className="brand-mark"><GraduationCap size={22} aria-hidden="true"/></span>
          <span className="brand-type">ClRUb<small>Rutgers–New Brunswick</small></span>
        </button>
        <nav className="desktop-nav" aria-label="Main navigation">
          {NAV.map(item => <button key={item.id} data-discover={item.id === 'discover'} className={`nav-item ${navView === item.id ? 'active' : ''}`} onClick={() => navigatePrimary(item.id)} aria-current={navView === item.id ? 'page' : undefined}><item.icon size={17}/><span>{item.title}</span>{item.id === 'forums' && unreadTotal > 0 && <span className="unread-badge">{unreadTotal > 99 ? '99+' : unreadTotal}<span className="sr-only"> unread</span></span>}</button>)}
        </nav>
        <div className="site-header-actions">
          {isOfficer && <button className={`icon-button ${view === 'officer' ? 'is-saved' : ''}`} onClick={() => go('officer')} aria-current={view === 'officer' ? 'page' : undefined} aria-label="Club manager" title="Club manager"><Users size={20}/></button>}
          <button className="icon-button about-link" onClick={() => setAboutOpen(true)} aria-label="About ClRUb" title="About ClRUb"><CircleHelp size={20}/></button>
          {user ? <button className="icon-button" onClick={() => openProfile('clubs')} aria-current={view === 'profile' ? 'page' : undefined} aria-label="Open profile">{avatar}</button> : <button className="button button-primary" onClick={() => setAuthOpen(true)}>Sign in</button>}
        </div>
      </div>
    </header>
    <div className="workspace">
      <main className="main-content" id="main-content">
        {view === 'home' ? <HomeHero name={firstName} signedIn={!!user} onDiscover={openHomeDeck} onSearch={searchDirectory} clubs={homeRecommendations.length ? homeRecommendations : browseClubs} onClub={setClubDetail}
          onDaily={() => document.getElementById('daily-cover-title')?.focus()}/>
          : ((view !== 'discover' && view !== 'daily' && view !== 'dna') || directory && view === 'discover' || loading || loadError) && <div className="page-header"><div><h1>{viewTitles[view]}</h1>{subtitle[view] && <p className="header-subtitle">{subtitle[view]}</p>}</div></div>}
      {loading ? <div className="page-loading" role="status"><LoaderCircle size={28} className="spin"/><p>Loading clubs and events…</p></div> : loadError ? <div className="surface empty-state"><CircleHelp size={30}/><h2>Unable to load clubs and events</h2><p>{loadError}</p><p className="fine-print">Make sure the local API is running on port 8000, then try again.</p><button className="button button-primary" onClick={() => void load()}>Try again</button></div> : <>
        {view === 'home' && <HomeFeed
          user={user} clubs={clubs} browseClubs={browseClubs} saved={saved} busy={busy}
          dailyCover={<DailyCover name={firstName} now={now} identity={user?.id} daily={daily} availability={dailyAvailability}
            onStart={() => go('daily')} onSignIn={() => setAuthOpen(true)} onInterests={() => setOnboarding(true)} onRetry={retryHomePicks}/>}
          dnaCard={user ? <RutgersDNA user={user} followed={followedClubs} preview onOpen={() => go('dna')}
            onEdit={() => setOnboarding(true)} onRelated={searchDirectory} onClub={setClubDetail}/>
            : <RutgersDNA user={{interests:[]}} followed={[]} preview guest onEdit={() => setAuthOpen(true)} onRelated={searchDirectory} onClub={setClubDetail}/>}
          picks={rankedHomeError ? {status: 'error', message: rankedHomeError}
            : rankedHome ? {status: 'ready', clubs: homeRecommendations} : {status: 'loading'}}
          upcoming={myUpcoming} campusEvents={campusEvents} suggestedEvents={suggestedEvents} announcements={announcements}
          onDiscover={openHomeDeck} onBrowse={searchDirectory} onInterests={() => setOnboarding(true)}
          onRetry={retryHomePicks}
          onOpen={setClubDetail} onBookmark={club => void bookmark(club)} onFollow={club => void follow(club)} onDismiss={club => void dismissClub(club)}
          onProfile={openProfile} onEvents={() => go('events')} onSocial={() => go('forums')}
          onOpenEvent={openEvent} onSaveEvent={event => void saveEvent(event)}
        />}

        {view === 'daily' && user && <DailyDeck daily={daily} now={now} name={firstName} identity={user.id} campus={user.campus} busy={busy} modalOpen={modalOpen}
          onAction={async (action, club) => {
            if (!daily.remaining.some(item => item.id === club.id)) return false;
            const confirmed = await actOnDeck(action, club);
            if (confirmed) daily.recordAction(club.id, action);
            return confirmed;
          }}
          onOpen={setClubDetail} onHome={() => {
            go('home');
            requestAnimationFrame(() => document.getElementById('daily-cover-title')?.focus());
          }} onExplore={openHomeDeck} onSaved={() => openProfile('clubs')} onDNA={() => go('dna')}
        />}
        {view === 'dna' && user && <RutgersDNA user={user} followed={followedClubs}
          onHome={() => go('home')} onEdit={() => setOnboarding(true)} onRelated={interest => interest ? searchDirectory(interest) : openHomeDeck()} onClub={setClubDetail}/>}

        {view === 'discover' && <>
          {directory ? <><button className="button button-secondary view-switch" onClick={() => setDirectory(false)}><Compass size={16}/>Back to club deck</button><div className="filter-bar"><div className="search-input"><Search size={18}/><input aria-label="Search clubs and interests" placeholder="Describe what you’re into, like “pickup basketball” or “premed volunteering”" value={query} onChange={e => setQuery(e.target.value)} enterKeyHint="search"/>{query && <button className="icon-button clear-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></button>}</div><label className="select-filter"><span className="sr-only">Campus</span><Compass size={16}/><select value={campus} onChange={e => setCampus(e.target.value)}><option value="">All campuses</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label><label className="select-filter"><span className="sr-only">Interest</span><SlidersHorizontal size={16}/><select value={category} onChange={e => setCategory(e.target.value)}><option value="">All interests</option>{categories.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label><label className={`chip toggle-chip ${beginner ? 'on' : ''}`}><input type="checkbox" checked={beginner} onChange={e => setBeginner(e.target.checked)}/><Check size={16}/>Beginner friendly</label></div>
            <p className="result-count" role="status">{searching ? 'Searching…' : `${searchClubs.length} ${searchClubs.length === 1 ? 'club' : 'clubs'}`}{searchClubs.length > 0 && searchClubs.every(c => c.verification === 'demo') && <span> · All are demo organizations</span>}</p>{query.trim() && !searching && understood && <SearchReading understood={understood}/>}{searchError && <p className="form-error" role="alert">{searchError}</p>}
            <div className={`club-grid ${searching ? 'is-loading' : ''}`} aria-busy={searching}>{searchClubs.map(club => <ClubCard key={club.id} club={club} following={saved.club_ids.includes(club.id)} onOpen={() => setClubDetail(club)} onFollow={() => void follow(club)}/>)}</div>
            {!searching && !searchClubs.length && !searchError && <div className="surface empty-state"><Search size={28}/><h3>No clubs match</h3><p>Try a broader search, or clear the filters.</p><button className="button button-secondary" onClick={() => {setQuery(''); setCampus(''); setCategory(''); setBeginner(false);}}>Clear filters</button></div>}</>
          : <section className={discoverStyles.experience} aria-labelledby="discover-title">
            <header className={discoverStyles.header}>
              <div className={discoverStyles.heading}>
                <span className={discoverStyles.eyebrow}><Compass size={17} aria-hidden="true"/>Rutgers club discovery</span>
                <h1 id="discover-title">{discoverMode === 'random' ? <>Meet your<br/><em>next club.</em></> : <>Your interests.<br/><em>Your Rutgers.</em></>}</h1>
                <p>{discoverMode === 'random' ? 'Take a chance on something new, one club at a time.' : firstName ? `${firstName}, explore picks shaped by your interests, major, and clubs you follow or save.` : 'See clubs picked around your interests and the communities you follow.'}</p>
              </div>
              <div className={discoverStyles.headerControls}>
                <div className={discoverStyles.modes} role="group" aria-label="Recommendation mode">
                  <button type="button" aria-pressed={discoverMode === 'random'} disabled={busy} onClick={() => setDiscoverMode('random')}><Shuffle size={16} aria-hidden="true"/>Discover</button>
                  <button type="button" aria-pressed={discoverMode === 'foryou'} disabled={busy} onClick={() => setDiscoverMode('foryou')}><Sparkles size={16} aria-hidden="true"/>For You</button>
                </div>
                <div className={discoverStyles.headerLinks}>
                  <button className={discoverStyles.profile} type="button" disabled={busy} onClick={() => setDirectory(true)}><Search size={15} aria-hidden="true"/>Search all clubs</button>
                  {discoverMode === 'foryou' && user && <button className={discoverStyles.profile} type="button" disabled={busy} onClick={() => setOnboarding(true)}><Settings2 size={15} aria-hidden="true"/>Edit interests</button>}
                </div>
              </div>
            </header>
            <DiscoverDeck key={`${user?.id ?? 'guest'}:${discoverMode}`}
              clubs={discoverClubs} campus={discoverMode === 'foryou' ? user?.campus : undefined}
              layout={deckLayout} onLayout={setDeckLayout} onOpen={setClubDetail}
              onAction={actOnDeck} busy={busy}
              modalOpen={modalOpen}
              empty={<div className={`surface empty-state ${discoverStyles.empty}`}>
                {discoverMode === 'foryou' && !user ? <>
                  <Sparkles size={30} aria-hidden="true"/><h2>Make these picks yours</h2>
                  <p>Sign in to get suggestions shaped by what you like. You can explore random clubs as a guest.</p>
                  <button className="button button-primary" onClick={() => setAuthOpen(true)}>Sign in</button>
                  <button className="text-button" onClick={() => setDiscoverMode('random')}>Explore random clubs</button>
                </> : discoverMode === 'foryou' && personalizationError ? <>
                  <h2>We couldn’t load your picks</h2><p role="alert">{personalizationError}</p>
                  <button className="button button-primary" onClick={() => {setForYouError(null); setForYouRetry(value => value + 1);}}>Try again</button>
                </> : discoverMode === 'foryou' && !personalized ? <div className="loading-state" role="status"><LoaderCircle className="spin" size={18}/>Finding clubs for you…</div>
                : discoverMode === 'foryou' && personalized?.method === 'cold_start' ? <>
                  <Sparkles size={30} aria-hidden="true"/><h2>What are you into?</h2>
                  <p>Add an interest or your major, or follow a few clubs in Discover to get personal picks.</p>
                  <button className="button button-primary" onClick={() => setOnboarding(true)}>Choose interests</button>
                  <button className="text-button" onClick={() => setDiscoverMode('random')}>Explore random clubs</button>
                </> : <>
                  <Check size={30} aria-hidden="true"/><h2>{clubs.length ? 'You’re all caught up' : 'No clubs available yet'}</h2>
                  <p>{clubs.length ? 'Find your follows and bookmarks in your profile, or see every club in the directory.' : 'Check the directory again when more clubs are available.'}</p>
                  <button className="button button-primary" onClick={() => setDirectory(true)}>Browse all clubs</button>
                  {discoverMode === 'foryou' && <button className="text-button" onClick={() => setDiscoverMode('random')}>Explore random clubs</button>}
                </>}
              </div>}/>
            {discoverMode === 'foryou' && personalizationError && discoverClubs.length > 0 && <p className="fine-print" role="status">Showing your last picks. <button className="inline-link" onClick={() => setForYouRetry(value => value + 1)}>Refresh recommendations</button></p>}
            <div className={discoverStyles.utilities}>
              {discoverMode === 'random' && discoverClubs.length > 1 && <button type="button" disabled={busy} onClick={() => setShuffleSeed(Math.floor(Math.random() * 2 ** 31))}><Shuffle size={15} aria-hidden="true"/>Shuffle the queue</button>}
              {(saved.dismissed_ids.length > 0 || (!user && sessionSkipped.length > 0)) && <button type="button" disabled={busy} onClick={() => void resetPasses()}>Show passed clubs again</button>}
            </div>
          </section>}

        </>}

        {view === 'events' && <>{hasLive && events.length > 0 && <div className="segmented view-switch" role="group" aria-label="Event source"><button className={eventSource === 'live' ? 'selected' : ''} aria-pressed={eventSource === 'live'} onClick={() => {setEventSource('live'); setEventResults(liveEvents);}}><Radio size={16}/>Rutgers events<span className="count">{liveEvents.length}</span></button><button className={eventSource === 'demo' ? 'selected' : ''} aria-pressed={eventSource === 'demo'} onClick={() => {setEventSource('demo'); setEventCategory(''); setEventResults(events);}}><FlaskConical size={16}/>Demo clubs</button></div>}<div className="filter-bar"><div className="search-input"><Search size={18}/><input aria-label="Search events" placeholder="Try “free beginner AI this week”" value={eventQuery} onChange={e => setEventQuery(e.target.value)} enterKeyHint="search"/>{eventQuery && <button className="icon-button clear-button" aria-label="Clear search" onClick={() => setEventQuery('')}><X size={15}/></button>}</div><label className="select-filter"><span className="sr-only">Campus</span><Compass size={16}/><select value={eventCampus} onChange={e => setEventCampus(e.target.value)}><option value="">All campuses</option>{CAMPUSES.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label>{eventSource === 'live' && <label className="select-filter"><span className="sr-only">Category</span><SlidersHorizontal size={16}/><select value={eventCategory} onChange={e => setEventCategory(e.target.value)}><option value="">All categories</option>{liveCategories.map(c => <option key={c}>{c}</option>)}</select><ChevronDown size={14}/></label>}</div>{eventSource === 'live' && liveNote && <p className="route-source source-line"><Radio size={14}/>{liveNote}. Only New Brunswick club, arts, recreation, and home-game listings are shown.</p>}{eventsSearchError && <p className="form-error" role="alert">{eventsSearchError}</p>}{eventsSearching && <p className="result-count" role="status">Searching…</p>}<div className={eventsSearching ? 'is-loading' : ''} aria-busy={eventsSearching}><EventCalendar key={eventSource} events={eventResults} savedIds={saved.event_ids} onOpen={openEvent} onSave={event => void saveEvent(event)} today={easternDay(eventSource === 'live' ? new Date(now) : REFERENCE_DATE)} footnote={eventSource === 'live' ? 'Times are Eastern Time. Listings change; confirm details on getINVOLVED before you go.' : 'Times are Eastern Time. “Today” for demo events is October 22, 2026.'}/></div></>}

        {(view === 'forums' || view === 'inbox') && <SocialTabs tab={view === 'forums' ? 'discussions' : inboxTab} unread={unread} onTab={tab => {if (tab === 'discussions') go('forums'); else {setInboxTab(tab); go('inbox');}}}/>}
        {view === 'forums' && <div id="social-panel" role="tabpanel" aria-labelledby="social-tab-discussions"><ForumsPanel clubs={clubs} user={user} onSignIn={() => setAuthOpen(true)} initialPostId={initialForumPostId} onOpenProfile={openPerson}/></div>}

        {view === 'inbox' && (user ? <InboxPage key={user.id} tab={inboxTab} conversationId={conversationId} onConversation={setConversationId} unread={unread} onUnread={updateUnread} onOpenProfile={openPerson} onOpenClub={openClubById} onOpenEvent={openEventById}/> : <GuestPrompt onSignIn={() => setAuthOpen(true)} title="Sign in to see your messages and notifications" description="Messages, answers from club managers, and updates from clubs you follow."/>)}

        {view === 'profile' && user && <button className="button button-secondary view-switch" onClick={() => go('dna')}>Explore your Rutgers DNA</button>}
        {view === 'profile' && (user ? <ProfilePage key={user.id} user={user} managedClubs={managedClubs} tab={profileTab} onTab={setProfileTab} refreshKey={profileKey} savedEventIds={saved.event_ids}
            onUser={next => void profileSaved(next)} onOpenClub={setClubDetail} onOpenEvent={openEvent} onFollow={follow} onLater={bookmark} onSaveEvent={saveEvent}
            onManage={() => go('officer')} onLogout={() => void logout()} onExplore={where => go(where)}
            onDeleted={() => {setUser(null); setSaved(EMPTY_SAVED); go('home'); void refreshClubs().catch(e => notify(e.message, true)); void refreshRecommendations().catch(e => notify(e.message, true)); notify('Your account and personal data were deleted.');}}/>
          : <GuestPrompt onSignIn={() => setAuthOpen(true)} title="Sign in to see your profile" description="Your clubs, events, and saved items in one place. Profiles are private unless you choose to share them."/>)}
        {view === 'officer' && (isOfficer ? <OfficerPanel allEvents={events} categories={categories} onView={setClubDetail} onRefresh={() => {void Promise.all([api<Club[]>('/clubs'), api<CampusEvent[]>('/events')]).then(([nextClubs, nextEvents]) => {setClubs(nextClubs); setEvents(nextEvents); setEventResults(nextEvents);}).catch(e => notify(e.message, true));}}/> : (user ? <div className="surface empty-state guest-prompt"><span className="empty-symbol"><Users size={28}/></span><h2>You don’t manage any clubs</h2><p>The club manager appears once you’re listed as an owner of a club. Ask the site admins to add your ScarletMail address.</p></div> : <GuestPrompt onSignIn={() => setAuthOpen(true)} title="For club owners" description="Sign in with your ScarletMail to manage the clubs you own."/>))}
        <footer className="page-footer"><p>ClRUb is an independent student project, not affiliated with Rutgers University. Rutgers events come from getINVOLVED and Rutgers Recreation via Scarlet Sync; clubs come from their public profiles on The Arc.</p><p className="footer-links"><button className="inline-link" onClick={() => setAboutOpen(true)}>About ClRUb</button><a className="inline-link" href="/privacy">Privacy Policy</a>{SUPPORT_EMAIL && <a className="inline-link" href={`mailto:${SUPPORT_EMAIL}`}>Contact</a>}</p>{view === 'home' && <p className="photo-credit">Old Queens photo by <a className="inline-link" href="https://commons.wikimedia.org/wiki/File:Old_Queens_-_Rutgers_University_(55142886116).jpg">Ajay Suresh</a>, <a className="inline-link" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, resized and cropped.</p>}</footer>
      </>}
      </main>
    </div>
    <nav className="tab-bar" aria-label="Main navigation">{NAV.map(item => <button key={item.id} data-discover={item.id === 'discover'} className={navView === item.id ? 'active' : ''} onClick={() => navigatePrimary(item.id)} aria-current={navView === item.id ? 'page' : undefined}><item.icon size={22} strokeWidth={navView === item.id ? 2.3 : 1.9}/><span>{item.title}</span>{item.id === 'forums' && unreadTotal > 0 && <span className="unread-badge">{unreadTotal > 99 ? '99+' : unreadTotal}<span className="sr-only"> unread</span></span>}</button>)}<button className={view === 'profile' || view === 'officer' ? 'active' : ''} onClick={() => user ? go('profile') : setAuthOpen(true)} aria-current={view === 'profile' ? 'page' : undefined}><UserRound size={22} strokeWidth={view === 'profile' ? 2.3 : 1.9}/><span>{user ? 'Profile' : 'Sign in'}</span></button></nav>
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18}/> : <Check size={18}/>}<span>{toast.text}</span><button aria-label="Dismiss" onClick={() => setToast(null)}><X size={15}/></button></div>}
    {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSuccess={(next, isNew) => void authSuccess(next, isNew)}/>}
    {onboarding && user && <OnboardingDialog user={user} onClose={() => setOnboarding(false)} onSave={next => void profileSaved(next)}/>}
    {clubDetail && <ClubDetail key={clubDetail.id} club={clubDetail} events={events.filter(e => e.club_id === clubDetail.id)} following={saved.club_ids.includes(clubDetail.id)} onFollow={() => {if (!user) setClubDetail(null); void follow(clubDetail);}} onClose={() => setClubDetail(null)} onEvent={openEvent} onSignIn={() => {signInFromClub.current = clubDetail.id; setClubDetail(null); setAuthOpen(true);}} signedIn={!!user} onOpenProfile={openPerson} onOpenConversation={openConversation}/>}
    {eventDetail && <EventDetail key={eventDetail.id} event={eventDetail} saved={saved.event_ids.includes(eventDetail.id)} onSave={() => {if (!user) setEventDetail(null); void saveEvent(eventDetail);}} onClose={() => setEventDetail(null)} onRsvp={rsvp} rsvp={saved.rsvps?.[eventDetail.id] || 'none'} conflicts={detailConflicts}/>}
    {studentProfile && <StudentProfileDialog key={studentProfile} who={studentProfile} onClose={() => setStudentProfile(null)} onOpenClub={openClubById} onOpenConversation={openConversation} onOwnProfile={() => {setStudentProfile(null); setClubDetail(null); go('profile');}}/>}
    {aboutOpen && <Dialog title="About ClRUb" wide onClose={() => setAboutOpen(false)}><p className="dialog-description">ClRUb is an independent student-built project for exploring campus communities. It is not affiliated with Rutgers University or an official university service.</p><section className="about-section"><h3>Real Rutgers clubs and events</h3><p>Rutgers events are real listings from Rutgers getINVOLVED and Rutgers Recreation, collected by <a className="inline-link" href="https://scarletsync.app/events" target="_blank" rel="noreferrer">Scarlet Sync</a> and refreshed every few hours. Only New Brunswick club, arts, recreation, and home-game listings are shown. Confirm details and RSVP on getINVOLVED.</p><p>The clubs in Discover come from student organizations’ public profiles on The Arc, Rutgers’ involvement platform. Each club’s description, meeting time, location, and contact details are taken from its own profile. Many clubs don’t list a meeting time there, and profiles can be out of date, so confirm plans with the club. Fraternities, sororities, and inactive organizations are not included.</p><a className="text-button" href="https://sca.rutgers.edu/campus-involvement/student-organizations" target="_blank" rel="noreferrer">Rutgers’ official involvement website<ArrowUpRight size={15}/></a></section><section className="about-section"><h3>How suggestions work</h3><p>Club descriptions are compared with the interests and goals you choose, using local text features and semantic similarity. Change your interests, show passed clubs again, or browse every club at any time. A similarity score is not a probability, a quality ranking, or a prediction of belonging.</p><p className="method-label">Current method: {method || 'Local text similarity with a varied guest selection'}</p><p>No paid language model or external API key is used. Text matching can miss nuance and can favor longer descriptions, so suggestions mix categories and the full directory is always available.</p></section><section className="about-section"><h3>Answers come with sources</h3><p>The club assistant answers only from the selected club’s published profile and FAQs and shows the excerpts it used. When the information is missing, it says so. Report an inaccurate answer from the club or event details.</p></section><section className="about-section"><h3>Your information stays private</h3><p>Choosing interests is optional. Profiles are private unless you choose to share yours with signed-in students, are stored in this app’s database, and can be deleted from Profile. Follows and RSVPs only add to aggregate counts that officers see. Messages are visible only to the people in the conversation; a question to a club is visible to all of its managers. Don’t enter sensitive personal information in questions or forms.</p></section><p className="about-footer"><ShieldCheck size={18}/>Small local models, visible sources, and the whole directory always one tap away.</p><p className="fine-print">Read the <a className="inline-link" href="/privacy">Privacy Policy</a>.{SUPPORT_EMAIL && <> Questions or requests: <a className="inline-link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</>}</p></Dialog>}
  </div></LayoutGroup>;
}

// Mulberry32: a tiny seeded generator, so the random order stays put while you swipe.
function seededShuffle<T>(items: T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = () => {state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296;};
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]];}
  return out;
}


function SearchReading({understood}: {understood: SearchUnderstanding}) {
  const filters = [understood.campus && `on ${understood.campus}`, understood.free && 'free', understood.beginner && 'beginner friendly'].filter(Boolean) as string[];
  if (!understood.topics.length && !filters.length) return null;
  return <p className="search-reading"><Sparkles size={14}/><span className="sr-only">Searching for </span>{understood.topics.map(topic => <span key={topic} className="reading-chip">{topic}</span>)}{filters.map(filter => <span key={filter} className="reading-chip reading-filter">{filter}</span>)}</p>;
}

function GuestPrompt({onSignIn, title, description}: {onSignIn: () => void; title: string; description: string}) {return <div className="surface empty-state guest-prompt"><span className="empty-symbol"><UserRound size={28}/></span><h2>{title}</h2><p>{description}</p><button className="button button-primary" onClick={onSignIn}><LogIn size={17}/>Sign in</button><span className="fine-print">Browsing clubs and events never requires an account.</span></div>;}
