'use client';

import {LayoutGroup} from 'motion/react';

import Link from 'next/link';
import {useState} from 'react';
import {dateKey, INTERESTS, type Club, type Saved, type User} from '@/lib/api';
import DiscoverDeck, {type DeckAction} from '@/components/discover-deck';
import {DailyCover, DailyDeck} from '@/components/daily-discovery';
import HomeFeed, {HomeHero} from '@/components/home-feed';
import RutgersDNA, {IdentityArtwork} from '@/components/rutgers-dna';
import Dialog from '@/components/dialog';
import {fixtures} from '../preview/preview';

const studioClubs = [...fixtures,
  {...fixtures[0], id:'micro-museum', name:'The Micro Museum', category:'Arts & Music', color:'#be547a', description:'A fictional group imagining tiny exhibitions in unexpected places.', tags:['Illustration'], explanation:'Sample explanation for an illustration and exhibition club.'},
  {...fixtures[4], id:'repair-hour', name:'Repair Hour', category:'Volunteering', color:'#a67329', description:'An imaginary student group that hosts repair cafés for everyday objects.', tags:['Volunteering'], explanation:'Sample explanation for a student-led repair community.'},
];

const profiles = [
  {id:'studio-avery', display_name:'Avery', campus:'Busch', interests:['Technology','Science'], order:[0,3,2,6,1]},
  {id:'studio-jules', display_name:'Jules', campus:'Cook', interests:['Arts & Music','Volunteering','Outdoors'], order:[5,4,1,2,6]},
];
type Choice = {action: DeckAction; daily: boolean};
type View = 'home' | 'daily' | 'deck' | 'dna';

export default function Studio() {
  const [profileIndex, setProfileIndex] = useState(0);
  const [view, setView] = useState<View>('home');
  const [choices, setChoices] = useState<Record<string, Partial<Record<string, Choice>>>>({});
  const [interests, setInterests] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState(false);
  const [detail, setDetail] = useState<Club | null>(null);
  const [layout, setLayout] = useState<'swipe' | 'list'>('swipe');
  const [query, setQuery] = useState('');
  const [now] = useState(() => Date.now());
  const profile = profiles[profileIndex];
  const user: User = {id:profile.id, display_name:profile.display_name, campus:profile.campus, interests:interests[profile.id] ?? profile.interests,
    email:'', role:'student', major:'', goals:'', onboarded:true, username:null, grad_year:null, bio:'', profile_visibility:'private', message_access:'none', avatar_url:null};
  const deck = profile.order.map(index => studioClubs[index]);
  const existing = choices[profile.id] ?? {};
  const entries = Object.entries(existing).filter((entry): entry is [string, Choice] => !!entry[1]);
  const dailyEntries = entries.filter(([,value]) => value.daily);
  const remaining = deck.filter(club => !existing[club.id]);
  const saved: Saved = {club_ids:entries.filter(([,value]) => value.action === 'follow').map(([id]) => id),
    maybe_later_ids:entries.filter(([,value]) => value.action === 'save').map(([id]) => id),
    dismissed_ids:entries.filter(([,value]) => value.action === 'pass').map(([id]) => id), event_ids:[], rsvps:{}};
  const followed = studioClubs.filter(club => saved.club_ids.includes(club.id));
  const daily = {day:dateKey(new Date(now).toISOString()), loaded:true, recordAction:() => undefined, remaining, total:deck.length,
    explored:dailyEntries.length, followed:dailyEntries.filter(([,value]) => value.action === 'follow').length,
    bookmarked:dailyEntries.filter(([,value]) => value.action === 'save').length, unavailable:entries.length - dailyEntries.length,
    categories:[...new Set(deck.filter(club => existing[club.id]?.daily).map(club => club.category))]};
  const go = (next: View) => {setView(next); window.scrollTo(0,0);};
  const browse = (term: string) => {setQuery(term); setLayout(term ? 'list' : 'swipe'); go('deck');};
  const showSaved = () => {go('home'); requestAnimationFrame(() => document.getElementById('home-saved')?.scrollIntoView());};
  async function choose(action: DeckAction, club: Club, inDaily = false) {
    if (existing[club.id]) return false;
    setChoices(current => ({...current,[profile.id]:{...current[profile.id],[club.id]:{action, daily:inDaily}}}));
    return true;
  }

  return <LayoutGroup><div className="app-shell editorial-shell" data-home={view === 'home'}>
    <main className="main-content">
      <header className="studio-controls">
        <div><strong>Development studio</strong><p>Fictional profiles and clubs. Actions stay in this demo.</p></div>
        <label>Fictional student <select value={profileIndex} onChange={event => {setProfileIndex(Number(event.target.value)); go('home');}}>
          {profiles.map((student,index) => <option value={index} key={student.id}>{student.display_name}</option>)}
        </select></label>
        <button className="text-button" onClick={() => {setChoices(current => ({...current,[profile.id]:{}}));go('home');}}>Reset this student</button>
        <Link className="text-button" href="/">Back to ClRUb</Link>
      </header>
      {view === 'home' && <>
        <HomeHero name={profile.display_name} signedIn onDiscover={() => browse('')} onSearch={browse} clubs={remaining} onClub={setDetail} onDaily={() => document.getElementById('daily-cover-title')?.focus()}/>
        <HomeFeed user={user} clubs={studioClubs} saved={saved} busy={false} picks={{status:'ready',clubs:remaining}} browseClubs={remaining}
          dailyCover={<DailyCover name={user.display_name} now={now} identity={user.id} daily={daily} availability="ready"
            onStart={() => go('daily')} onSignIn={() => go('home')} onInterests={() => setEditing(true)} onRetry={() => go('home')}/>}
          dnaCard={<RutgersDNA user={user} followed={followed} preview onOpen={() => go('dna')} onEdit={() => setEditing(true)} onRelated={browse} onClub={setDetail}/>}
          upcoming={[]} campusEvents={[]} suggestedEvents={[]} announcements={[]}
          onDiscover={() => browse('')} onBrowse={browse} onInterests={() => setEditing(true)} onRetry={() => go('home')}
          onOpen={setDetail} onBookmark={club => void choose('save',club)} onFollow={club => void choose('follow',club)} onDismiss={club => void choose('pass',club)}
          onProfile={showSaved} onEvents={() => go('home')} onSocial={() => go('home')} onOpenEvent={() => undefined} onSaveEvent={() => undefined}/>
      </>}
      {view === 'daily' && <DailyDeck daily={daily} now={now} name={user.display_name} identity={user.id} campus={user.campus}
        busy={false} modalOpen={!!detail} onAction={(action,club) => choose(action,club,true)} onOpen={setDetail}
        onHome={() => go('home')} onExplore={() => browse('')} onSaved={showSaved} onDNA={() => go('dna')}/>}
      {view === 'dna' && <RutgersDNA user={user} followed={followed} onEdit={() => setEditing(true)} onRelated={browse} onClub={setDetail} onHome={() => go('home')}/>}
      {view === 'deck' && <>
        <button className="text-button" onClick={() => go('home')}>Back to the demo homepage</button>
        <DiscoverDeck clubs={query ? remaining.filter(club => [club.name,club.category,...(club.tags ?? [])].join(' ').toLowerCase().includes(query.toLowerCase())) : remaining}
          layout={layout} onLayout={setLayout} fictional busy={false} modalOpen={!!detail} onAction={choose} onOpen={setDetail}
          empty={<p>No fictional clubs match this view.</p>}/>
      </>}
      {detail && <Dialog title={detail.name} onClose={() => setDetail(null)}><p className="dialog-description">Fictional studio club</p><p>{detail.description}</p></Dialog>}
      {editing && <Dialog title="Edit fictional interests" onClose={() => setEditing(false)}>
        <div className="identity-editor-preview"><IdentityArtwork interests={user.interests}/></div>
        <div className="interest-picker editorial-interest-picker">{INTERESTS.map(interest => <button key={interest} type="button"
          className={`interest-option ${user.interests.includes(interest) ? 'chosen' : ''}`} aria-pressed={user.interests.includes(interest)}
          onClick={() => setInterests(current => ({...current,[profile.id]:user.interests.includes(interest) ? user.interests.filter(item => item !== interest) : [...user.interests,interest]}))}>{interest}</button>)}</div>
        <button className="button button-primary" onClick={() => setEditing(false)}>Done</button>
      </Dialog>}
    </main>
  </div></LayoutGroup>;
}
