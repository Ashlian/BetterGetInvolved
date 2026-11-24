'use client';

import {useState, type CSSProperties, type ReactNode} from 'react';
import {ArrowRight, Bookmark, Compass, Heart, LoaderCircle, Search, Settings2, X} from 'lucide-react';
import {cleanName, relativeTime, type CampusEvent, type Club, type ForumPost, type Recommendation, type Saved, type User} from '@/lib/api';
import {CampusMark, ClubArt, categoryIcon} from './visuals';
import {EventRow} from './event-calendar';
import styles from './home-feed.module.css';

const topics = ['Technology', 'Arts & Music', 'Volunteering', 'Outdoors', 'Culture', 'Science'];
type Picks = {status: 'loading'} | {status: 'error'; message: string} | {status: 'ready'; clubs: Recommendation[]};

export function HomeHero({name, onDiscover, onSearch, signedIn}: {
  name?: string; signedIn: boolean; onDiscover: () => void; onSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState('');
  return <section className={styles.hero} aria-labelledby="home-title">
    <div className={styles.heroCopy}>
      <p className={styles.heroGreeting}>{name ? `Hey, ${name}.` : 'Rutgers–New Brunswick'}</p>
      <h1 id="home-title">Your Rutgers.<br/><em>Your people.</em></h1>
      <p>Find a community on campus, one club at a time.</p>
      <button className={styles.heroButton} type="button" onClick={onDiscover}><Compass size={19} aria-hidden="true"/>{signedIn ? 'Open your swipe deck' : 'Explore the swipe deck'}</button>
      <form className={styles.search} role="search" onSubmit={event => {event.preventDefault(); onSearch(query.trim());}}>
        <Search size={18} aria-hidden="true"/>
        <input aria-label="Search clubs and interests" placeholder="Try “beginner-friendly dance clubs”" value={query} onChange={event => setQuery(event.target.value)} enterKeyHint="search"/>
        <button type="submit">Search</button>
      </form>
    </div>
    <figure className={styles.photo}><figcaption>Old Queens <span>College Avenue</span></figcaption></figure>
  </section>;
}

export default function HomeFeed({user, picks, browseClubs, clubs, saved, busy, upcoming, campusEvents, suggestedEvents, announcements, onDiscover, onBrowse, onInterests, onRetry, onOpen, onBookmark, onFollow, onDismiss, onProfile, onEvents, onSocial, onOpenEvent, onSaveEvent}: {
  user: User | null; picks: Picks; browseClubs: Club[]; clubs: Club[]; saved: Saved; busy: boolean;
  upcoming: CampusEvent[]; campusEvents: CampusEvent[]; suggestedEvents: CampusEvent[]; announcements: ForumPost[] | null;
  onDiscover: () => void; onBrowse: (query: string) => void; onInterests: () => void; onRetry: () => void;
  onOpen: (club: Club) => void; onBookmark: (club: Club) => void; onFollow: (club: Club) => void; onDismiss: (club: Club) => void;
  onProfile: (tab: 'clubs' | 'events') => void; onEvents: () => void; onSocial: () => void;
  onOpenEvent: (event: CampusEvent) => void; onSaveEvent: (event: CampusEvent) => void;
}) {
  const savedIds = new Set(saved.maybe_later_ids ?? []);
  const followedIds = new Set(saved.club_ids);
  const communities = clubs.filter(club => followedIds.has(club.id) || savedIds.has(club.id));
  const personalized = user && picks.status === 'ready' && picks.clubs.length > 0;
  const collection: (Club | Recommendation)[] = personalized ? picks.clubs : browseClubs;
  const [lead, ...supporting] = collection;
  const matchesCampus = !!user?.campus && campusEvents.some(event => event.campus === user.campus);
  const interestTiles = user?.interests.length ? user.interests : topics;

  function renderClub(club: Club | Recommendation, featured = false) {
    return <article key={club.id} className={styles.club} data-featured={featured} style={{'--club-ink': club.color || '#cc0033'} as CSSProperties}>
      <button className={styles.clubOpen} type="button" onClick={() => onOpen(club)}>
        <span className={styles.clubArt}><ClubArt category={club.category} color={club.color} logo={club.logo_url} size="large"/></span>
        <span className={styles.clubCopy}>
          <span className={styles.clubCategory}>{club.category}{club.verification === 'demo' && ' · Demo'}</span>
          <strong>{cleanName(club.name)}</strong>
          <CampusMark campus={club.campus}/>
          {featured && <span className={styles.description}>{club.description}</span>}
        </span>
      </button>
      {personalized && 'explanation' in club && club.explanation && <p className={styles.why}><strong>Why this pick</strong><span>{club.explanation}</span></p>}
      <div className={styles.cardActions}>
        {personalized ? <button className="icon-button" type="button" disabled={busy} aria-label={`Pass on ${cleanName(club.name)}`} onClick={() => onDismiss(club)}><X size={16}/></button>
          : <button className="icon-button" type="button" disabled={busy} aria-pressed={followedIds.has(club.id)} aria-label={`${followedIds.has(club.id) ? 'Unfollow' : 'Follow'} ${cleanName(club.name)}`} onClick={() => onFollow(club)}><Heart size={18} fill={followedIds.has(club.id) ? 'currentColor' : 'none'}/></button>}
        <button className="icon-button" type="button" disabled={busy} aria-pressed={savedIds.has(club.id)} aria-label={`${savedIds.has(club.id) ? 'Remove bookmark:' : 'Save for later:'} ${cleanName(club.name)}`} onClick={() => onBookmark(club)}><Bookmark size={18} fill={savedIds.has(club.id) ? 'currentColor' : 'none'}/></button>
      </div>
    </article>;
  }

  function renderEvents(events: CampusEvent[]) {
    return <div className={styles.eventList}>{events.map(event => <EventRow key={event.id} event={event} saved={saved.event_ids.includes(event.id)} onOpen={() => onOpenEvent(event)} onSave={() => onSaveEvent(event)}/>)}</div>;
  }

  return <div className={styles.feed}>
    <section aria-labelledby="home-picks">
      <SectionHeader id="home-picks" title={personalized || (user && picks.status === 'loading') ? 'Made for you' : 'Something new to try'} action={personalized ? 'Open swipe deck' : 'Browse all clubs'} onAction={personalized ? onDiscover : () => onBrowse('')}/>
      {user && picks.status === 'loading' ? <div className={styles.collectionStatus} role="status"><LoaderCircle size={20} className="spin"/>Finding your next campus connection…</div> : <>
        {user && picks.status === 'error' && <div className={styles.collectionStatus}><p role="alert">We couldn’t load your personal picks. {picks.message}</p><button className="text-button" type="button" onClick={onRetry}>Try again</button></div>}
        {user && picks.status === 'ready' && !personalized && <p className={styles.collectionStatus}>No new personal picks right now. <button className="inline-link" type="button" onClick={onInterests}>Update your interests</button></p>}
        {lead ? <div className={styles.selection} data-solo={supporting.length === 0}>
          {renderClub(lead, true)}
          {supporting.length > 0 && <div className={styles.rail} aria-label="More clubs">{supporting.map(club => renderClub(club))}</div>}
        </div> : <p className={styles.collectionStatus}>No clubs are available right now.</p>}
      </>}
    </section>

    <section className={styles.interests} aria-labelledby="home-interests">
      <div>
        <h2 id="home-interests">{user ? 'Your Rutgers DNA' : 'Follow your curiosity'}</h2>
        <p>{user?.interests.length ? 'The interests you chose. Pick one to explore related clubs.' : user ? 'Choose the interests you want ClRUb to use when finding clubs for you.' : 'Pick an interest to explore the club directory.'}</p>
        {user && <button className={styles.edit} type="button" onClick={onInterests}><Settings2 size={16} aria-hidden="true"/>Edit interests</button>}
      </div>
      <div className={styles.interestTiles}>{interestTiles.map(interest => {
        const Icon = categoryIcon(interest);
        return <button key={interest} type="button" onClick={() => onBrowse(interest)}><Icon size={19} aria-hidden="true"/><span>{interest}</span></button>;
      })}</div>
    </section>

    {user && <section aria-labelledby="home-saved">
      <SectionHeader id="home-saved" title="Your communities" action="Open profile" onAction={() => onProfile('clubs')}/>
      {communities.length > 0 ? <ul className={styles.communities}>{communities.slice(0, 8).map(club => <li key={club.id}><button type="button" onClick={() => onOpen(club)}><ClubArt category={club.category} color={club.color} logo={club.logo_url}/><span><strong>{cleanName(club.name)}</strong><small>{followedIds.has(club.id) ? 'Following' : 'Saved for later'}</small></span></button></li>)}</ul> : <p className={styles.collectionStatus}>Follow or save a club to keep it here.</p>}
    </section>}

    <div className={styles.campus}>
      <section aria-labelledby="home-events">
        <SectionHeader id="home-events" title={matchesCampus ? `Happening on ${user?.campus}` : 'Around campus'} action="All events" onAction={onEvents}/>
        {campusEvents.length ? renderEvents(campusEvents) : <p className={styles.collectionStatus}>No upcoming events to show right now.</p>}
      </section>
      {user && <section aria-labelledby="home-upcoming">
        <SectionHeader id="home-upcoming" title="Your plans" action="Saved events" onAction={() => onProfile('events')}/>
        {upcoming.length ? renderEvents(upcoming) : <p className={styles.collectionStatus}>Events you save or RSVP to will appear here.</p>}
      </section>}
    </div>
    {user && suggestedEvents.length > 0 && <section aria-labelledby="home-suggested-events">
      <SectionHeader id="home-suggested-events" title="Events for your interests" action="All events" onAction={onEvents}/>
      {renderEvents(suggestedEvents)}
    </section>}
    {user && <section aria-labelledby="home-announcements">
      <SectionHeader id="home-announcements" title="From clubs you follow" action="Open Social" onAction={onSocial}/>
      {announcements === null ? <p className={styles.collectionStatus} role="status">Checking for club updates…</p> : announcements.length ? <ul className={styles.announcements}>{announcements.map(item => <li key={item.id}><a href={`/forums/${encodeURIComponent(item.id)}`}><small>{cleanName(item.club_name)} · {relativeTime(item.created_at)}</small><strong>{item.title}</strong><span>{item.body}</span></a></li>)}</ul> : <p className={styles.collectionStatus}>New announcements from clubs you follow will appear here.</p>}
    </section>}
  </div>;
}

function SectionHeader({id, title, action, onAction}: {id: string; title: ReactNode; action: string; onAction: () => void}) {
  return <header className={styles.sectionHeader}><h2 id={id}>{title}</h2><button type="button" onClick={onAction}>{action}<ArrowRight size={16} aria-hidden="true"/></button></header>;
}
