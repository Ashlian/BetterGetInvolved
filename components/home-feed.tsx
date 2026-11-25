'use client';

import Link from 'next/link';
import {motion, useReducedMotion, useMotionValue, useSpring, useScroll, useTransform, useInView} from 'motion/react';
import {useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {ArrowRight, Bookmark, Compass, Heart, LoaderCircle, Search, X} from 'lucide-react';
import {cleanName, relativeTime, type CampusEvent, type Club, type ForumPost, type Recommendation, type Saved, type User} from '@/lib/api';
import {CampusMark, ClubArt, categoryIcon} from './visuals';
import {EventRow} from './event-calendar';
import styles from './home-feed.module.css';
import {RibbonFaces} from './ribbon-sculpture';

const topics = ['Technology', 'Arts & Music', 'Volunteering', 'Outdoors', 'Culture', 'Science'];
type Picks = {status: 'loading'} | {status: 'error'; message: string} | {status: 'ready'; clubs: Recommendation[]};

export function HomeHero({name, onDiscover, onSearch, signedIn, onDaily, clubs, onClub}: {
  name?: string; signedIn: boolean; onDiscover: () => void; onSearch: (query: string) => void; onDaily: () => void; clubs?: Club[]; onClub?: (club: Club) => void;
}) {
  const [query, setQuery] = useState('');
  const reduced = useReducedMotion();
  const offsetX = useMotionValue(0);
  const offsetY = useMotionValue(0);
  const x = useSpring(offsetX, {stiffness:95, damping:19});
  const y = useSpring(offsetY, {stiffness:95, damping:19});
  const story = useRef<HTMLElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const visible = useInView(field);
  const {scrollYProgress} = useScroll({target:story, offset:['start start','end 40%']});
  const rotation = useTransform(scrollYProgress, [0, 1], [-8, 32]);
  const scale = useTransform(scrollYProgress, [0, 1], [.94, 1.14]);
  const drift = useTransform(scrollYProgress, [0, 1], [0, -38]);
  return <section ref={story} className={styles.hero} aria-labelledby="home-title">
    <div className={styles.heroCopy}>
      <p className={styles.heroGreeting}>{name ? `Hey, ${name}.` : 'Rutgers–New Brunswick'}</p>
      <h1 id="home-title">{['College is', 'what you', 'make it.'].map((line, index) =>
        <span className={styles.line} key={line}><span style={{animationDelay:`${index * 95}ms`}}>{index === 2 ? <em>{line}</em> : line}</span></span>)}</h1>
      <p>Find your people. Make Rutgers yours.</p>
      <div className={styles.heroActions}>
        <button className={styles.heroButton} type="button" onClick={onDiscover}><Compass size={19} aria-hidden="true"/>{signedIn ? 'Open your swipe deck' : 'Explore the swipe deck'}</button>
        <button className={styles.dailyLink} type="button" onClick={onDaily}>Today’s discovery <ArrowRight size={16} aria-hidden="true"/></button>
      </div>
      <form className={styles.search} role="search" onSubmit={event => {event.preventDefault(); onSearch(query.trim());}}>
        <Search size={18} aria-hidden="true"/>
        <input aria-label="Search clubs and interests" placeholder="Try “beginner-friendly dance clubs”" value={query} onChange={event => setQuery(event.target.value)} enterKeyHint="search"/>
        <button type="submit">Search</button>
      </form>
      {process.env.NODE_ENV === 'development' && <Link className={styles.labLink} href="/discover/studio">Development studio</Link>}
    </div>
    <div ref={field} className={styles.heroField} data-visible={visible} onPointerMove={event => {
      if (reduced || event.pointerType === 'touch') return;
      const box = event.currentTarget.getBoundingClientRect();
      offsetX.set(((event.clientX - box.left) / box.width - .5) * 27);
      offsetY.set(((event.clientY - box.top) / box.height - .5) * 27);
    }} onPointerLeave={() => {offsetX.set(0); offsetY.set(0);}}>
      <div className={styles.orbitBackdrop} aria-hidden="true"/>
      <motion.div className={styles.sculptureScroll} style={reduced ? undefined : {rotate:rotation, scale, y:drift}}>
        <motion.div className={styles.sculpturePointer} style={reduced ? undefined : {x,y}}>
          <svg viewBox="0 0 490 455" className={styles.heroOrbit} role="img" aria-label="Interwoven scarlet, peach and lavender ribbons">
            <RibbonFaces seed={12903}/>
          </svg>
        </motion.div>
      </motion.div>
      <motion.figure className={styles.photo} style={reduced ? undefined : {x,y}}>
        <div role="img" aria-label="Old Queens at Rutgers University" className={styles.photoWindow}/>
        <figcaption>Old Queens <span>College Avenue</span></figcaption>
      </motion.figure>
      {onClub && clubs?.slice(0,2).map((club,index) => <motion.button type="button" key={club.id} className={styles.orbitCard}
        data-position={index} style={reduced ? undefined : {y:drift}} onClick={() => onClub(club)}>
        <ClubArt category={club.category} color={club.color} logo={club.logo_url} size="small"/>
        <span><small>{club.verification === 'demo' ? 'Demo club' : club.category}</small><strong>{cleanName(club.name)}</strong></span>
      </motion.button>)}
    </div>
    <div className={styles.storyBeat}>
      <motion.div initial={reduced ? false : {opacity:0,y:24}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:.25}} transition={{duration:.55}}>
        <span className={styles.heroGreeting}>Daily Discovery</span>
        <h2>Make room for <em>something new.</em></h2>
        <p>Explore a few clubs at a time. When you sign in, your interests and the clubs you follow help shape your daily picks.</p>
        <button type="button" className={styles.dailyLink} onClick={onDaily}>See today’s discovery <ArrowRight size={16} aria-hidden="true"/></button>
      </motion.div>
    </div>
  </section>;
}

export default function HomeFeed({user, dailyCover, dnaCard, picks, browseClubs, clubs, saved, busy, upcoming, campusEvents, suggestedEvents, announcements, onDiscover, onBrowse, onInterests, onRetry, onOpen, onBookmark, onFollow, onDismiss, onProfile, onEvents, onSocial, onOpenEvent, onSaveEvent}: {
  user: User | null; dailyCover: ReactNode; dnaCard: ReactNode; picks: Picks; browseClubs: Club[]; clubs: Club[]; saved: Saved; busy: boolean;
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
    {dailyCover}
    {dnaCard}
    {!user && <section className={styles.interests} aria-labelledby="home-interests">
      <div>
        <h2 id="home-interests">Follow your curiosity</h2>
        <p>Pick an interest to explore the club directory.</p>
      </div>
      <div className={styles.interestTiles}>{topics.map(interest => {
        const Icon = categoryIcon(interest);
        return <button key={interest} type="button" onClick={() => onBrowse(interest)}><Icon size={19} aria-hidden="true"/><span>{interest}</span></button>;
      })}</div>
    </section>}
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



    {(campusEvents.length > 0 || (user && upcoming.length > 0)) && <div className={styles.campus}>
      {campusEvents.length > 0 && <section aria-labelledby="home-events">
        <SectionHeader id="home-events" title={matchesCampus ? `Happening on ${user?.campus}` : 'Around campus'} action="All events" onAction={onEvents}/>
        {renderEvents(campusEvents)}
      </section>}
      {user && upcoming.length > 0 && <section aria-labelledby="home-upcoming">
        <SectionHeader id="home-upcoming" title="Your plans" action="Saved events" onAction={() => onProfile('events')}/>
        {renderEvents(upcoming)}
      </section>}
    </div>}
    {user && communities.length > 0 && <section aria-labelledby="home-saved">
      <SectionHeader id="home-saved" title="Your communities" action="Open profile" onAction={() => onProfile('clubs')}/>
      {communities.length > 0 ? <ul className={styles.communities}>{communities.slice(0, 8).map(club => <li key={club.id}><button type="button" onClick={() => onOpen(club)}><ClubArt category={club.category} color={club.color} logo={club.logo_url}/><span><strong>{cleanName(club.name)}</strong><small>{followedIds.has(club.id) ? 'Following' : 'Saved for later'}</small></span></button></li>)}</ul> : <p className={styles.collectionStatus}>Follow or save a club to keep it here.</p>}
    </section>}

    {user && suggestedEvents.length > 0 && <section aria-labelledby="home-suggested-events">
      <SectionHeader id="home-suggested-events" title="Events for your interests" action="All events" onAction={onEvents}/>
      {renderEvents(suggestedEvents)}
    </section>}
    {user && !!announcements?.length && <section aria-labelledby="home-announcements">
      <SectionHeader id="home-announcements" title="From clubs you follow" action="Open Social" onAction={onSocial}/>
      {announcements === null ? <p className={styles.collectionStatus} role="status">Checking for club updates…</p> : announcements.length ? <ul className={styles.announcements}>{announcements.map(item => <li key={item.id}><a href={`/forums/${encodeURIComponent(item.id)}`}><small>{cleanName(item.club_name)} · {relativeTime(item.created_at)}</small><strong>{item.title}</strong><span>{item.body}</span></a></li>)}</ul> : <p className={styles.collectionStatus}>New announcements from clubs you follow will appear here.</p>}
    </section>}
  </div>;
}

function SectionHeader({id, title, action, onAction}: {id: string; title: ReactNode; action: string; onAction: () => void}) {
  return <header className={styles.sectionHeader}><h2 id={id}>{title}</h2><button type="button" onClick={onAction}>{action}<ArrowRight size={16} aria-hidden="true"/></button></header>;
}
