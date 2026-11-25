'use client';

import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent} from 'react';
import {animate, motion, useMotionValue, useReducedMotion, useTransform} from 'motion/react';
import {Bookmark, Check, ExternalLink, Heart, Layers, List, Sparkles, X} from 'lucide-react';
import {cleanName, type Club, type Recommendation} from '@/lib/api';
import {CampusMark, ClubArt} from './visuals';
import {clubPhoto} from './campus-design';
import styles from './discover-deck.module.css';

export type DeckAction = 'pass' | 'save' | 'follow';
type DeckClub = Club & Partial<Pick<Recommendation, 'explanation' | 'reasons' | 'tags' | 'score'>>;
const spring = {type: 'spring', stiffness: 330, damping: 32} as const;
const still = {duration: 0};
const LIST_PAGE_SIZE = 24;
const actions = [
  {id: 'pass', label: 'Pass', icon: X, key: 'ArrowLeft', shortcut: '←'},
  {id: 'save', label: 'Save', icon: Bookmark, key: 'ArrowDown', shortcut: '↓'},
  {id: 'follow', label: 'Follow', icon: Heart, key: 'ArrowRight', shortcut: '→'},
] as const;

type Drag = {
  id: number;
  x: number;
  y: number;
  active: boolean;
  startX: number;
  startY: number;
  samples: {x: number; time: number}[];
};

export default function DiscoverDeck({clubs, campus, layout, onLayout, onOpen, onAction, busy, modalOpen, empty, progress, fictional = false, design}: {
  clubs: DeckClub[];
  campus?: string;
  layout: 'swipe' | 'list';
  onLayout?: (layout: 'swipe' | 'list') => void;
  onOpen?: (club: Club) => void;
  onAction: (action: DeckAction, club: Club) => Promise<boolean>;
  busy: boolean;
  modalOpen: boolean;
  empty: React.ReactNode;
  progress?: React.ReactNode;
  fictional?: boolean;
  design?: {label: string; controls: React.ReactNode};
}) {
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);
  const [pinned, setPinned] = useState<string>();
  const [snapshot, setSnapshot] = useState<DeckClub[] | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [pending, setPending] = useState<DeckAction | null>(null);
  const [dragging, setDragging] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const locked = useRef(false);
  const drag = useRef<Drag | null>(null);
  const positionAnimation = useRef<{stop: () => void} | null>(null);
  const card = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useMotionValue(1);
  const rotation = useTransform(x, [-260, 0, 260], [-14, 0, 14]);
  const layerDrift = useTransform(x, [-180, 0, 180], [-14, 0, 14]);
  const deckProgress = useTransform(x, [-130, 0, 130], [1, 0, 1]);
  const followStamp = useTransform(x, [12, 115], [0, 1]);
  const passStamp = useTransform(x, [-115, -12], [1, 0]);
  const pinnedClub = clubs.find(club => club.id === pinned);
  const queue = pinnedClub ? [pinnedClub, ...clubs.filter(club => club.id !== pinned)] : clubs;
  const [active, ...next] = snapshot ?? queue;
  const activeId = active?.id;

  useLayoutEffect(() => {
    positionAnimation.current?.stop();
    x.jump(0);
    y.jump(0);
    opacity.jump(1);
  }, [activeId, opacity, x, y]);

  useEffect(() => {
    if (!snapshot) setPinned(activeId);
  }, [activeId, snapshot]);

  function springBack() {
    positionAnimation.current?.stop();
    x.stop();
    y.stop();
    opacity.stop();
    positionAnimation.current = animate(x, 0, reduce ? still : spring);
    void animate(y, 0, reduce ? still : spring);
    void animate(opacity, 1, reduce ? still : {duration: .14});
  }

  async function choose(action: DeckAction, club: DeckClub, velocity = 0) {
    if (locked.current || busy || modalOpen || drag.current) return;
    locked.current = true;
    positionAnimation.current?.stop();
    const swiping = layout === 'swipe';
    setPending(action);
    if (swiping) setSnapshot(queue.slice(0, 3));

    // Begin the throw on release. The snapshot keeps the next card non-interactive until
    // the request settles, and a rejected action springs the original card back.
    let exit: Promise<unknown> | undefined;
    if (swiping && !reduce) {
      setAdvancing(true);
      const direction = action === 'pass' ? -1 : 1;
      const distance = window.innerWidth + (card.current?.offsetWidth ?? 0) / 2;
      exit = action === 'save' && !design
        ? Promise.all([animate(y, -78, spring), animate(opacity, 0, {duration: .24})])
        : Promise.all([
          animate(x, direction * distance, {type: 'spring', stiffness: 250, damping: 28, velocity: direction * Math.min(1800, Math.abs(velocity)), restDelta: 35, restSpeed: 240}),
          animate(opacity, 0, {duration: .4, ease: [.65, 0, .9, 1]}),
        ]);
    }
    try {
      const confirmed = await onAction(action, club);
      if (!confirmed) {
        setAdvancing(false);
        springBack();
        return;
      }
      if (swiping) {
        setCelebrate(action === 'follow');
        await exit;
        setPinned(queue[1]?.id);
      }
    } catch {
      setAdvancing(false);
      springBack();
    } finally {
      locked.current = false;
      setSnapshot(null);
      setAdvancing(false);
      setPending(null);
    }
  }

  useEffect(() => {
    if (!celebrate) return;
    const timer = setTimeout(() => setCelebrate(false), 550);
    return () => clearTimeout(timer);
  }, [celebrate]);

  useEffect(() => {
    if (!active || layout !== 'swipe' || modalOpen) return;
    const shortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if (!(event.target instanceof HTMLElement) || event.target.closest('input,textarea,select,[contenteditable],summary,[role="dialog"]')) return;
      const action = actions.find(item => item.key === event.key);
      if (design && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) {
        event.preventDefault(); void choose(event.key === 'ArrowRight' ? 'save' : 'follow', active); return;
      }
      if (action) {event.preventDefault(); void choose(action.id, active);}
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  });

  function startDrag(event: PointerEvent<HTMLElement>) {
    if (locked.current || busy || modalOpen || !event.isPrimary || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('a,button,input,select,textarea')) return;
    positionAnimation.current?.stop();
    y.stop();
    if (event.pointerType === 'mouse') {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    drag.current = {id: event.pointerId, x: event.clientX, y: event.clientY, startX: x.get(), startY: y.get(), active: false,
      samples: [{x: event.clientX, time: event.timeStamp}]};
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    const gesture = drag.current;
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.active) {
      if (Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx)) {drag.current = null; return;}
      if (Math.abs(dx) < 7) return;
      gesture.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    gesture.samples = gesture.samples.filter(sample => event.timeStamp - sample.time <= 90);
    gesture.samples.push({x: event.clientX, time: event.timeStamp});
    x.set(gesture.startX + dx);
    if (!reduce) y.set(Math.max(-52, Math.min(52, gesture.startY + dy * 0.45)));
  }

  function endDrag(event: PointerEvent<HTMLElement>, cancelled = false) {
    const gesture = drag.current;
    if (!gesture || event.pointerId !== gesture.id) return;
    drag.current = null;
    setDragging(false);
    if (!gesture.active) {springBack(); return;}
    const dx = event.clientX - gesture.x;
    const recent = gesture.samples.find(sample => event.timeStamp - sample.time >= 12 && event.timeStamp - sample.time <= 100);
    const velocity = recent ? (event.clientX - recent.x) / (event.timeStamp - recent.time) * 1000 : 0;
    const threshold = Math.min(120, event.currentTarget.offsetWidth * 0.28);
    const projected = dx + velocity * .10;
    const flick = Math.abs(dx) >= 25 && Math.abs(velocity) >= 480 && Math.abs(projected) >= threshold && Math.sign(velocity) === Math.sign(dx);
    if (!cancelled && active && !busy && !modalOpen && (Math.abs(dx) >= threshold || flick)) {
      void choose(dx < 0 ? 'pass' : design ? 'save' : 'follow', active, velocity);
    } else {
      springBack();
    }
  }

  const disabled = busy || pending !== null || dragging;
  if (design && layout === 'swipe') {
    const accents = ['#e95843', '#b99bd7', '#efb59c'];
    const accent = active ? accents[Array.from(active.id).reduce((sum, character) => sum + character.charCodeAt(0), 0) % accents.length] : accents[0];
    return <section className="discover-page" style={{'--deck-accent': accent} as CSSProperties} aria-labelledby="discover-title">
      <div className="discover-intro">
        <p className="section-index">{design.label}</p>
        <h1 id="discover-title">Something tells us<br/><i>you’ll get along.</i></h1>
        {active && <p className="drag-instruction">Drag the card. Trust your instinct.</p>}
        <div className="discover-controls">{design.controls}</div>
      </div>
      {active ? <>
        <div className="deck" aria-busy={pending !== null}>
          {next.length > 1 && <div className="design-club-card card-back back-two" aria-hidden="true"/>}
          {next.length > 0 && <div className="design-club-card card-back back-one" aria-hidden="true"/>}
          <motion.article key={active.id} ref={card} className={`design-club-card active-card ${dragging ? 'dragging' : ''}`}
            style={{x, y, opacity, rotate: reduce ? 0 : rotation}}
            onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={event => endDrag(event)}
            onPointerCancel={event => endDrag(event, true)}
            onLostPointerCapture={event => {if (event.target === event.currentTarget) endDrag(event, true);}}
            onPointerLeave={event => {if (!drag.current?.active) endDrag(event, true);}}>
            <img src={clubPhoto} alt="" draggable={false}/>
            <div className="card-shade"/>
            <div className="card-top">
              {onOpen && <button disabled={disabled} onClick={() => onOpen(active)} aria-label={`Club profile for ${cleanName(active.name)}`}>CLUB PROFILE</button>}
              {active.score !== undefined && <b title="Relative recommendation score">{Math.round(active.score * 100)}% RELATIVE</b>}
            </div>
            <div className="card-content">
              <p>{active.category}{active.verification === 'demo' ? ' · Demo organization' : ''}</p>
              <h2>{cleanName(active.name)}</h2>
              <span>{active.explanation || active.mission || active.description}</span>
            </div>
          </motion.article>
        </div>
        <div className="deck-actions">
          {([
            ['pass', 'Pass', '×', 'ArrowLeft'],
            ['save', 'Save', '＋', 'ArrowRight'],
            ['follow', 'Follow', '↗', 'ArrowDown'],
          ] as const).map(([action, label, symbol, shortcut]) => <button key={action} type="button"
            className={action === 'save' ? 'primary-action' : undefined}
            aria-keyshortcuts={shortcut} aria-disabled={disabled} onClick={() => void choose(action, active)}>
            <span aria-hidden="true">{symbol}</span>{label}
          </button>)}
        </div>
        <p className="swipe-help">Swipe left to pass · right to save</p>
      </> : <div className="discover-empty">{empty}</div>}
      <p className="sr-only" role="status">{pending ? `${pending} in progress` : active && cleanName(active.name)}</p>
    </section>;
  }

  return <div className={styles.deckPanel}>
    {active && <div className={styles.toolbar}>
      {progress ?? <span className={styles.remaining}>{clubs.length} {clubs.length === 1 ? 'club' : 'clubs'} to explore</span>}
      {onLayout && <div className={styles.layoutSwitch} role="group" aria-label="Club layout">
        <button type="button" aria-pressed={layout === 'swipe'} disabled={disabled} onClick={() => onLayout('swipe')}><Layers size={16} aria-hidden="true"/>Swipe</button>
        <button type="button" aria-pressed={layout === 'list'} disabled={disabled} onClick={() => onLayout('list')}><List size={16} aria-hidden="true"/>List</button>
      </div>}
    </div>}
    {active ? layout === 'swipe' ? <div className={styles.swipeArea}>
      <div className={styles.stage} aria-busy={pending !== null}>
        {next.slice(0, 2).map((club, index) => {
          const depth = index + 1 - Number(advancing);
          return <motion.div key={club.id} className={styles.preview} aria-hidden="true" inert
            initial={false} animate={{y: depth * 15, scale: 1 - depth * 0.052, rotate: reduce ? 0 : depth * (index === 0 ? 2 : -1.4), opacity: 1 - depth * 0.16}}
            transition={reduce ? still : spring} style={{zIndex: 2 - index, x: reduce || advancing ? 0 : layerDrift}}>
              <ClubContent club={club} campus={campus} fictional={fictional}/>
            </motion.div>;
        })}
        {!reduce && <motion.div className={styles.dragGlow} style={{opacity: deckProgress}} aria-hidden="true"/>}
        <motion.article key={active.id} ref={card}
          className={styles.card} data-dragging={dragging} data-pending={pending !== null}
          style={{x, y, opacity, rotate: reduce ? 0 : rotation}}
          onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={event => endDrag(event)}
          onPointerCancel={event => endDrag(event, true)}
          onLostPointerCapture={event => {
            // Touch transfers implicit capture from the child under the finger to the card.
            if (event.target === event.currentTarget) endDrag(event, true);
          }}
          onPointerLeave={event => {if (!drag.current?.active) endDrag(event, true);}}>
          <motion.span className={`${styles.stamp} ${styles.followStamp}`} style={{opacity: followStamp}} aria-hidden="true"><Heart size={18}/>Follow</motion.span>
          <motion.span className={`${styles.stamp} ${styles.passStamp}`} style={{opacity: passStamp}} aria-hidden="true"><X size={18}/>Pass</motion.span>
          <ClubContent club={active} campus={campus} onOpen={onOpen} disabled={disabled} fictional={fictional}/>
        </motion.article>
        {celebrate && !reduce && <motion.span className={styles.heart} aria-hidden="true" initial={{opacity: 0, scale: 0.55, y: 14}} animate={{opacity: [0, 1, 1, 0], scale: [0.55, 1.22, 1], y: -26}} transition={{duration: 0.5}}><Heart size={30} fill="currentColor"/></motion.span>}
      </div>
      <DeckActions disabled={disabled} onAction={action => void choose(action, active)}/>
      <p className={styles.hint}><strong>Grab the card</strong> and drag left to pass or right to follow.</p>
    </div> : <>
      <ul className={styles.list}>
      {queue.slice(0, listLimit).map(club => <li key={club.id} className={styles.listCard}>
        <ClubContent club={club} campus={campus} onOpen={onOpen} disabled={disabled} fictional={fictional}/>
        <DeckActions disabled={disabled} onAction={action => void choose(action, club)} compact/>
      </li>)}
      </ul>
      {queue.length > listLimit && <div className={styles.utilities}><button type="button" onClick={() => setListLimit(limit => limit + LIST_PAGE_SIZE)}>Show more clubs</button></div>}
    </> : empty}
    <p className="sr-only" role="status">{pending ? `${actions.find(action => action.id === pending)?.label} in progress` : active && layout === 'swipe' ? cleanName(active.name) : ''}</p>
  </div>;
}

function DeckActions({disabled, onAction, compact = false}: {disabled: boolean; onAction: (action: DeckAction) => void; compact?: boolean}) {
  return <div className={styles.actions} data-compact={compact}>
    {actions.map(({id, label, icon: Icon, key, shortcut}) => <button key={id} type="button" data-action={id}
      aria-keyshortcuts={compact ? undefined : key} aria-disabled={disabled} onClick={() => {if (!disabled) onAction(id);}}>
      <span className={styles.actionIcon}><Icon size={compact ? 18 : 22} aria-hidden="true"/></span>
      <span>{label}</span>
      {!compact && <kbd aria-hidden="true">{shortcut}</kbd>}
    </button>)}
  </div>;
}

function ClubContent({club, campus, onOpen, disabled, fictional}: {club: DeckClub; campus?: string; onOpen?: (club: Club) => void; disabled?: boolean; fictional: boolean}) {
  const reasons = [...new Set(club.reasons?.length ? club.reasons : club.explanation ? [club.explanation] : [])];
  const tags = club.tags ?? [];
  return <>
    <div className={styles.media} style={{'--deck-club-color': club.color || '#cc0033'} as CSSProperties}>
      <div className={styles.emblem}><ClubArt category={club.category} color={club.color} logo={club.logo_url} size="large"/></div>
      {(fictional || club.verification === 'demo') && <span className={styles.demo}>{fictional ? 'Fictional club' : 'Demo organization'}</span>}
      {onOpen && <button className={styles.details} type="button" disabled={disabled} onClick={() => onOpen(club)}>
        <ExternalLink size={15} aria-hidden="true"/>Club profile<span className="sr-only"> for {cleanName(club.name)}</span>
      </button>}
      <div className={styles.cardTitle}>
        <p className={styles.category}>{club.category}</p>
        <h2>{cleanName(club.name)}</h2>
      </div>
    </div>
    <div className={styles.copy}>
      <div className={styles.metadata}>
        <CampusMark campus={club.campus}/>
        {campus && club.campus === campus && <span className="meta-note">Your campus</span>}
        {club.beginner_friendly && <span className="meta-note"><Check size={14} aria-hidden="true"/>Beginners welcome</span>}
        {club.membership_fee && <span className="meta-note">{club.membership_fee}</span>}
      </div>
      <p className={styles.description}>{club.description}</p>
      {reasons.length > 0 && <div className={styles.why}>
        <Sparkles size={17} aria-hidden="true"/>
        <div><h3>{fictional ? 'Sample recommendation explanation' : 'Why we picked this for you'}</h3>
          <ul className={styles.reasons}>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
          {tags.length > 0 && <ul className={styles.tags}>
            {tags.map(tag => <li key={tag}>{tag}</li>)}
          </ul>}
        </div>
      </div>}
    </div>
  </>;
}
