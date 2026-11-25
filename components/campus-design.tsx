'use client';

import Link from 'next/link';
import {useRef, useState, type PointerEvent, type CSSProperties} from 'react';
import {cleanName, dateFormat, INTERESTS, type CampusEvent, type Club, type Recommendation, type User} from '@/lib/api';
import {identityFor} from './rutgers-dna';
import './campus-design.css';

export const clubPhoto = '/rutgers-collective.png';

export function DesignNav({view, user, onNavigate}: {view: string; user: User | null; onNavigate: (event: React.MouseEvent<HTMLAnchorElement>) => void}) {
  return <header className="campus-design">
    <div className="site-nav">
      <Link className="mark" href="/" onClick={onNavigate} aria-label="ClRUb home">Cl<span>RU</span>b</Link>
      <nav aria-label="Main navigation">
        <Link href="/discover" data-short-label="Discover" className={view === 'discover' || view === 'daily' ? 'active' : ''} onClick={onNavigate}>Discover</Link>
        <Link href="/universe" data-short-label="Universe" className={view === 'universe' ? 'active' : ''} onClick={onNavigate}>Universe</Link>
        <Link href="/dna" data-short-label="Your DNA" className={view === 'dna' ? 'active' : ''} onClick={onNavigate}>Your DNA</Link>
      </nav>
      <Link className="profile-dot" href="/dna" onClick={onNavigate} aria-label="Open your DNA and account">{initials(user)}</Link>
    </div>
  </header>;
}

function initials(user: User | null) {
  return user?.display_name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'RU';
}

function Sculpture() {
  const ref = useRef<HTMLDivElement>(null)
  const move = (event: PointerEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width - 0.5
    const y = (event.clientY - box.top) / box.height - 0.5
    ref.current?.style.setProperty('--rx', `${-y * 24}deg`)
    ref.current?.style.setProperty('--ry', `${x * 28}deg`)
  }
  return (
    <div className="sculpture-stage" onPointerMove={move}>
      <div className="sculpture-halo" />
      <div className="sculpture" ref={ref} aria-label="Interactive scarlet sculpture">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
        <span className="orb orb-d" />
        <span className="orb orb-e" />
      </div>
      <span className="drag-note">Move your cursor</span>
    </div>
  )
}

export function DesignHome({club, event, firstName, onClub, onEvent, onEvents, onDaily, dailyLabel, dailyNotice, onNavigate}: {
  club?: Club & Partial<Recommendation>; event?: CampusEvent; firstName?: string;
  onClub: (club: Club) => void; onEvent: (event: CampusEvent) => void; onEvents: () => void;
  onDaily: () => void; dailyLabel: string; dailyNotice?: string; onNavigate: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <div className="home">
      <section className="hero">
        <div className="eyebrow">Your campus, remixed</div>
        <h1>
          College is what
          <br />
          you <em>make</em> it.
        </h1>
        <Sculpture />
        {club && <button className="floating-card fc-one" onClick={() => onClub(club)}>
          <span>{firstName ? 'FOR YOU' : 'FROM THE CLUB DIRECTORY'}</span>
          <b>{cleanName(club.name)}</b>
          <small>{club.category}{club.verification === 'demo' ? ' · Demo organization' : ''}</small>
        </button>}
        <button className="floating-card fc-two" onClick={() => event ? onEvent(event) : onEvents()}>
          <span>ON CAMPUS</span>
          <b>{event?.title ?? 'Campus calendar'}</b>
          <small>{event ? `${event.location || event.campus} · ${dateFormat(event.starts_at, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}` : 'Browse events'}</small>
        </button>
        <Link className="scroll-cue" href="/discover" onClick={onNavigate}>
          Start discovering <i>↘</i>
        </Link>
      </section>

      <section className="manifesto">
        <p className="section-index">01 — DISCOVERY, PERSONALIZED</p>
        <h2>
          Find the people
          <br />
          who make Rutgers
          <br />
          feel <span>like yours.</span>
        </h2>
        <p className="manifesto-copy">
          ClRUb learns what lights you up, then connects the dots between your
          interests, your people, and the moments you’ll remember.
        </p>
      </section>

      <section className="daily">
        <div className="daily-art">
          <div className="record">
            <img src={clubPhoto} alt="Students at a creative campus gathering" />
          </div>
          <div className="sound-wave" aria-hidden="true">
            {Array.from({ length: 28 }).map((_, i) => (
              <i key={i} style={{ '--i': i } as React.CSSProperties} />
            ))}
          </div>
        </div>
        <div className="daily-copy">
          {firstName && <span className="pill">Made for {firstName}</span>}
          <p className="section-index">YOUR DAILY DISCOVERY</p>
          <h2>{club ? cleanName(club.name) : 'Find your next club.'}</h2>
          {club && <p>{club.explanation || club.mission || club.description}</p>}
          {club && <div className="match-row">
            {club.score !== undefined && <b>{Math.round(club.score * 100)}% relative score</b>}
            {(club.tags?.length ? club.tags : club.interests).slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}
          </div>}
          {dailyNotice && <p role="status">{dailyNotice}</p>}
          <button className="round-link" onClick={onDaily}>{dailyLabel}</button>
        </div>
      </section>

      <section className="portal">
        <p>Not a directory. A living map of where you could belong.</p>
        <h2>Step into your<br /><i>Rutgers universe.</i></h2>
        <Link href="/universe" onClick={onNavigate}>Enter the universe <span>→</span></Link>
      </section>
    </div>
  )
}

type Connection = {id: string; label: string; type: string; club?: Club};
const positions = [
  [22, 22, '#e95843'], [72, 18, '#f0b39e'], [82, 52, '#b99bd7'],
  [68, 82, '#e95843'], [25, 80, '#b99bd7'], [12, 51, '#f0b39e'],
] as const;

export function DesignUniverse({user, ranked, followed, onClub, onInterest, onProfile}: {
  user: User | null; ranked: Recommendation[]; followed: Club[];
  onClub: (club: Club) => void; onInterest: (interest: string) => void; onProfile: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const center: Connection = {id: 'you', label: user?.display_name || 'You', type: 'Your campus'};
  const tags = [...new Set([...ranked.flatMap(club => club.tags ?? []), ...(user?.interests ?? [])])].slice(0, 3);
  const picks = [...new Map([...ranked, ...followed].map(club => [club.id, club])).values()].slice(0, 3);
  const nodes = positions.map(([x, y, color], index) => {
    const tag = tags[index / 2];
    const club = picks[(index - 1) / 2];
    const data: Connection | undefined = tag ? {id: `tag:${tag}`, label: tag, type: 'Interest'}
      : club ? {id: `club:${club.id}`, label: cleanName(club.name), type: 'Club', club} : undefined;
    return data && {...data, x, y, color};
  }).filter(node => node !== undefined);
  const selected = selectedId === center.id ? center : nodes.find(node => node.id === selectedId) ?? nodes.find(node => node.club) ?? nodes[0] ?? center;

  return <section className="universe-page">
    <div className="universe-heading">
      <p className="section-index">YOUR RUTGERS UNIVERSE</p>
      <h1>Every interest<br/>leads <i>somewhere.</i></h1>
      <p>Explore the connections shaping your campus.</p>
    </div>
    <div className="graph" aria-label="Interactive graph of your clubs and interests">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {nodes.map(node => <line key={node.id} x1="50" y1="50" x2={node.x} y2={node.y} className={node.club ? 'hot' : ''}/>)}
      </svg>
      <button className="center-node" aria-pressed={selected.id === center.id} onClick={() => setSelectedId(center.id)}>
        <span>{initials(user)}</span><b>You</b>
      </button>
      {nodes.map(node => <button key={node.id} className={`graph-node ${selected.id === node.id ? 'selected' : ''}`}
        style={{left: `${node.x}%`, top: `${node.y}%`, '--node': node.color} as CSSProperties}
        aria-pressed={selected.id === node.id} onClick={() => setSelectedId(node.id)}>
        <i/><b>{node.label}</b><span>{node.type}</span>
      </button>)}
    </div>
    <aside className="node-inspector" aria-live="polite">
      <span>SELECTED CONNECTION</span>
      <h2>{selected.label}</h2>
      <p>{selected.type}</p>
      <button onClick={() => selected.club ? onClub(selected.club) : selected.id === center.id ? onProfile() : onInterest(selected.label)}>
        {selected.id === center.id ? user ? 'Open profile' : 'Sign in to see your connections' : 'Explore connection'} →
      </button>
    </aside>
    <p className="graph-tip">Click any node to follow the connection</p>
  </section>;
}

export function DesignDNA({user, onSave, onProfile, onEdit, onShare, onRelated, busy}: {
  user: User | null; onSave: (interests: string[]) => void; onProfile: () => void;
  onEdit: () => void; onShare: () => void; onRelated: () => void; busy: boolean;
}) {
  const [energy, setEnergy] = useState(58);
  const chosen = user?.interests ?? [];
  const interests = [...new Set([...INTERESTS, ...chosen])];
  const {title, inspiration, seed} = identityFor(chosen);
  const titleWords = title.split(' ');
  const lastWord = titleWords.pop();
  return <section className="dna-page" style={{'--energy': `${energy / 3 + (chosen.length ? seed % 29 : 0)}deg`, '--scale': .8 + energy / 250} as CSSProperties}>
    <div className="dna-copy">
      <p className="section-index">YOUR RUTGERS DNA · LIVE</p>
      <h1>{chosen.length ? <>{titleWords.join(' ')}<br/><i>{lastWord}.</i></> : <>Your Rutgers<br/><i>DNA.</i></>}</h1>
      <p>{user ? inspiration || 'Your interests shape your sculpture and help ClRUb find clubs for you.' : 'Sign in to shape your Rutgers DNA with the things you’re curious about.'}</p>
      <div className="dna-interests" aria-label="Select interests">
        {interests.map(item => <button key={item} disabled={busy} className={chosen.includes(item) ? 'chosen' : ''}
          aria-pressed={chosen.includes(item)} onClick={() => user ? onSave(chosen.includes(item) ? chosen.filter(interest => interest !== item) : [...chosen, item]) : onProfile()}>{item}</button>)}
      </div>
      <label className="energy-slider">
        <span>Social energy</span><b>{energy}%</b>
        <input type="range" min="10" max="100" value={energy} onChange={event => setEnergy(Number(event.target.value))}/>
      </label>
      {user && <button className="share-button" onClick={onShare}>Share your DNA <span>↗</span></button>}
      <div className="discover-controls">
        <button onClick={onProfile}>{user ? 'Open profile' : 'Sign in'}</button>
        {user && <><button onClick={onEdit}>Edit profile interests</button><button onClick={onRelated}>Discover related clubs</button></>}
      </div>
    </div>
    <div className="dna-art" aria-label="Your interactive Rutgers DNA sculpture">
      <div className="dna-glow"/>
      {Array.from({length: 9}, (_, i) => <span className="dna-loop" key={i} style={{'--i': i} as CSSProperties}/>)}
      <div className="dna-core"><span>{initials(user)}</span></div>
      <p>Move through your interests<br/>to transform the sculpture</p>
    </div>
  </section>;
}
