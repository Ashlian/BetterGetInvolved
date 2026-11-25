'use client';

import {useRef} from 'react';
import {motion, useReducedMotion, useInView} from 'motion/react';
import {ArrowRight, Bookmark, Compass, Fingerprint, LoaderCircle} from 'lucide-react';
import {dateFormat, type Club} from '@/lib/api';
import DiscoverDeck, {type DeckAction} from './discover-deck';
import type {DailyDiscoveryState} from './use-daily-discovery';
import styles from './signature.module.css';
import {RibbonFaces} from './ribbon-sculpture';

function artworkSeed(identity: string | undefined, day: string) {
  return [...`${identity ?? 'campus'}:${day}`].reduce((value, letter) => (Math.imul(value, 31) + letter.charCodeAt(0)) >>> 0, 0);
}

type Availability = 'guest' | 'loading' | 'error' | 'empty' | 'ready';

const dailyPalettes = [
  ['#f9ead6','#e79bb8','#c5adf7'],
  ['#f6dfa1','#eab4da','#a6dcc8'],
  ['#ffe7bc','#e3c7ff','#74c8b9'],
];

export function DailyArtwork({celebrate = false, seed = 0, shared = false}: {celebrate?: boolean; seed?: number; shared?: boolean}) {
  const reduced = useReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const visible = useInView(frame);
  const palette = dailyPalettes[seed % dailyPalettes.length];
  return <motion.div ref={frame} layoutId={shared && !reduced ? 'daily-ribbon-art' : undefined} className={styles.dailyArtFrame}
    transition={{layout:{type:'spring', stiffness:135, damping:22}}}>
    <svg className={styles.dailyArtwork} viewBox="0 0 490 455" aria-hidden="true">
      <path d="M0 353 490 75V265L161 455H0Z" fill="#650a32"/>
      <circle cx="245" cy="227" r="196" fill="none" stroke="#ebaccf" strokeOpacity=".46" strokeDasharray="2 7"/>
      <motion.g style={{transformOrigin:'50% 50%'}} initial={false}
        animate={reduced || !visible ? {rotate:0,scale:1} : celebrate ? {rotate:[-21,10,0],scale:[.7,1.08,1]} : {rotate:[-4,4,-4],scale:1}}
        transition={celebrate || reduced || !visible ? {duration:reduced || !visible ? 0 : .9} : {duration:15, repeat:Infinity, ease:'easeInOut'}}>
        <RibbonFaces seed={seed} palette={palette} complexity={5}/>
      </motion.g>
    </svg>
  </motion.div>;
}

function DailyProgress({daily}: {daily: DailyDiscoveryState}) {
  const reduced = useReducedMotion();
  const done = daily.total - daily.remaining.length;
  return <div className={styles.progress} role="progressbar" aria-label="Daily Discovery progress"
    aria-valuemin={0} aria-valuemax={daily.total} aria-valuenow={done}>
    <span>{done} / {daily.total} reviewed</span>
    <span className={styles.progressBars} aria-hidden="true">{Array.from({length: daily.total}, (_, index) =>
      <motion.i key={index} initial={false} animate={{opacity:index < done ? 1 : .35, scaleX:index < done ? 1 : .85}}
        transition={reduced ? {duration:0} : {type:'spring', stiffness:280, damping:23}}/>)}</span>
  </div>;
}

export function DailyCover({name, now, daily, identity, availability, onStart, onSignIn, onInterests, onRetry}: {
  name?: string; identity?: string; now: number; daily: DailyDiscoveryState; availability: Availability;
  onStart: () => void; onSignIn: () => void; onInterests: () => void; onRetry: () => void;
}) {
  return <section className={styles.dailyCover} aria-labelledby="daily-cover-title">
    <div className={styles.coverCopy}>
      <p className={styles.overline}>{dateFormat(new Date(now), {weekday:'long', month:'long', day:'numeric'})}</p>
      <h2 id="daily-cover-title" tabIndex={-1}>Your Daily<br/><em>Discovery.</em></h2>
      <p>{name ? `${name}, discover something new. Discover a little more you.` : 'Discover something new. Discover a little more you.'}</p>
      {daily.total > 0 && <DailyProgress daily={daily}/>}
      {availability === 'ready' ? <button className={styles.lightButton} onClick={onStart}>
        {daily.remaining.length ? daily.explored ? 'Continue discovering' : 'Start discovering' : 'See what you discovered'}<ArrowRight size={17} aria-hidden="true"/>
      </button> : availability === 'guest' ? <button className={styles.lightButton} onClick={onSignIn}>Sign in for your daily picks<ArrowRight size={17} aria-hidden="true"/></button>
        : availability === 'loading' ? <p className={styles.dailyStatus} role="status"><LoaderCircle size={17} className="spin" aria-hidden="true"/>Arranging today’s picks…</p>
          : availability === 'error' ? <><p role="alert">Today’s picks couldn’t load.</p><button className={styles.lightButton} onClick={onRetry}>Try again</button></>
            : <><p>No personal picks are available yet.</p><button className={styles.lightButton} onClick={onInterests}>Edit your interests</button></>}
    </div>
    <DailyArtwork seed={artworkSeed(identity, daily.day)} shared/>
  </section>;
}

export function DailyDeck({daily, identity, campus, busy, modalOpen, onAction, onOpen, onHome, onExplore, onSaved, onDNA}: {
  daily: DailyDiscoveryState; identity?: string; campus?: string; busy: boolean; modalOpen: boolean;
  onAction: (action: DeckAction, club: Club) => Promise<boolean>; onOpen: (club: Club) => void;
  onHome: () => void; onExplore: () => void; onSaved: () => void; onDNA: () => void;
}) {
  const reduced = useReducedMotion();
  const reveal = reduced ? {duration:0} : {duration:.4, ease:[.22,1,.36,1] as const};
  const reviewed = daily.total - daily.remaining.length;
  return <DiscoverDeck key={daily.day} clubs={daily.remaining} campus={campus}
    busy={busy} modalOpen={modalOpen} layout="swipe" onOpen={onOpen} onAction={onAction}
    design={{
      label: daily.total ? `Daily Discovery · ${Math.min(reviewed + 1, daily.total)}/${daily.total}` : 'Daily Discovery',
      controls: <><button onClick={onHome}>Back to home</button><button onClick={onExplore}>Explore more</button></>,
    }}
    empty={daily.total > 0 ? <motion.div className={styles.completion}
            initial={reduced ? false : {opacity:0, y:18}} animate={{opacity:1, y:0}} transition={reveal}>
            <DailyArtwork celebrate seed={artworkSeed(identity, daily.day)}/>
            <div className={styles.completionCopy}>
              <p className={styles.overline}>Daily Discovery complete</p>
              <motion.h2 initial={reduced ? false : {opacity:0, y:14}} animate={{opacity:1, y:0}} transition={reveal}>A little more <em>you.</em></motion.h2>
              <dl className={styles.results}>
                {([['Explored', daily.explored], ['Followed', daily.followed], ['Saved', daily.bookmarked]] as const).map(([label, total], index) =>
                  <motion.div key={label} initial={reduced ? false : {opacity:0, y:10}} animate={{opacity:1,y:0}}
                    transition={reduced ? {duration:0} : {duration:.35,delay:.15 + index * .11}}><dt>{label}</dt><dd>{total}</dd></motion.div>)}
              </dl>
              {daily.categories.length > 0 && <p>Categories you explored · {daily.categories.join(', ')}</p>}
              {daily.unavailable > 0 && <p>{daily.unavailable} {daily.unavailable === 1 ? 'pick was' : 'picks were'} already handled elsewhere or unavailable.</p>}
              <div className={styles.completionActions}>
                <button onClick={onSaved}><Bookmark size={16} aria-hidden="true"/>Saved clubs</button>
                <button onClick={onExplore}><Compass size={16} aria-hidden="true"/>Explore more</button>
                <button onClick={onDNA}><Fingerprint size={16} aria-hidden="true"/>Your Rutgers DNA</button>
              </div>
            </div>
          </motion.div> : <p className={styles.emptyDaily} role="status">Today’s picks aren’t available here yet. Return home to check your recommendations.</p>}/>;
}
