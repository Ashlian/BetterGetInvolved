'use client';

import {useMemo, type PointerEvent} from 'react';
import {motion, useMotionValue, useReducedMotion, useSpring, useTransform} from 'motion/react';
import {ArrowLeft, ArrowRight, Fingerprint, Settings2} from 'lucide-react';
import {cleanName, type Club, type User} from '@/lib/api';
import styles from './signature.module.css';
import {RibbonFaces} from './ribbon-sculpture';

const colors = ['#f6a9b5', '#cbb0f5', '#f7bd97', '#efcc76', '#8fd0bf', '#ff8074', '#f2e1ce'];
const rules = [
  {match: /volunteer|service|community|culture/i, title: 'The Community Builder'},
  {match: /art|music|writ|story/i, title: 'The Curious Creator'},
  {match: /outdoor|recreation|travel/i, title: 'The Bold Explorer'},
  {match: /science|research|astronomy/i, title: 'The Cosmic Thinker'},
  {match: /tech|comput|engineer|gaming/i, title: 'The Problem Solver'},
  {match: /entrepreneur|professional|business/i, title: 'The Innovator'},
  {match: /wellbeing|health|wellness/i, title: 'The Grounded Explorer'},
];

function hash(text: string) {
  let value = 2166136261;
  for (const letter of text) value = Math.imul(value ^ letter.codePointAt(0)!, 16777619);
  return value >>> 0;
}

export function identityFor(interests: string[]) {
  const normalized = [...new Set(interests.map(value => value.trim().toLowerCase()).filter(Boolean))].sort();
  const seed = hash(JSON.stringify(normalized));
  const groups = rules.map(rule => ({title:rule.title, hits:normalized.filter(interest => rule.match.test(interest))}));
  const matched = groups.reduce((best, item) => item.hits.length > best.hits.length ? item : best);
  const palette = normalized.length ? [colors[seed % colors.length], ...normalized.map(interest => colors[hash(interest) % colors.length]), '#fae8d8'] : ['#d6b4be','#e4d1c1'];
  return {
    seed, count:normalized.length, palette:[...new Set(palette)],
    title:normalized.length ? matched.hits.length ? matched.title : 'The Campus Curator' : 'Your canvas awaits.',
    inspiration:matched.hits.length ? `Your selected interests in ${matched.hits.join(', ')} inspired this title.` : '',
  };
}

export default function RutgersDNA({user, followed, preview = false, guest = false, onOpen, onEdit, onRelated, onClub, onHome}: {
  user: Pick<User, 'interests'>; followed: Club[]; preview?: boolean; guest?: boolean; onOpen?: () => void; onEdit: () => void;
  onRelated: (interest: string) => void; onClub: (club: Club) => void; onHome?: () => void;
}) {
  const {count, title, inspiration} = identityFor(user.interests);
  const Title = preview ? 'h2' : 'h1';
  return <section className={styles.dna} aria-labelledby="rutgers-dna-title">
    {!preview && <button className={styles.back} type="button" onClick={onHome}><ArrowLeft size={17} aria-hidden="true"/>Back to home</button>}
    <div className={styles.dnaCard}>
      <div className={styles.dnaCopy}>
        <p className={styles.overline}><Fingerprint size={16} aria-hidden="true"/>ClRUb / Rutgers DNA</p>
        <Title id="rutgers-dna-title">{title}</Title>
        <p>{count ? 'A creative label for the interests you picked. Those interests shape the palette, twists, and depth of your artwork.' : 'Choose a few interests to create a pattern of your own.'}</p>
        {!preview && inspiration && <p>{inspiration}</p>}
        {!!count && <ul className={styles.dnaTags} aria-label="Selected interests">{user.interests.map(interest =>
          <li key={interest}><button type="button" onClick={() => onRelated(interest)}>{interest}</button></li>)}</ul>}
        <div className={styles.dnaActions}>
          <button className={styles.lightButton} type="button" onClick={onEdit}><Settings2 size={16} aria-hidden="true"/>{guest ? 'Sign in to make yours' : 'Edit your interests'}</button>
          {preview ? !guest && <button className={styles.outline} type="button" onClick={onOpen}>Explore your DNA<ArrowRight size={16} aria-hidden="true"/></button>
            : <button className={styles.outline} type="button" onClick={() => onRelated('')}>Discover related clubs<ArrowRight size={16} aria-hidden="true"/></button>}
        </div>
      </div>
      <IdentityArtwork interests={user.interests}/>
    </div>
    {!preview && <div className={styles.connected}>
      <h2>Communities you follow</h2>
      {followed.length > 0 ? <ul>{followed.map(club => <li key={club.id}>
        <button type="button" onClick={() => onClub(club)}>{cleanName(club.name)}<ArrowRight size={15} aria-hidden="true"/></button>
      </li>)}</ul> : <p>Your followed clubs will appear here.</p>}
    </div>}
  </section>;
}

export function IdentityArtwork({interests}: {interests: string[]}) {
  const reduced = useReducedMotion();
  const {seed, count, palette} = useMemo(() => identityFor(interests), [interests]);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const glideX = useSpring(pointerX, {stiffness:105, damping:19});
  const glideY = useSpring(pointerY, {stiffness:105, damping:19});
  const range = 5 + seed % 6;
  const lean = useTransform(glideX, [-1, 1], [-range, range]);
  const driftX = useTransform(glideX, [-1, 1], [-22, 22]);
  const driftY = useTransform(glideY, [-1, 1], [-21, 21]);
  const lightX = useTransform(glideX, [-1, 1], [40, -40]);
  const lightY = useTransform(glideY, [-1, 1], [28, -28]);

  function exploreField(event: PointerEvent<HTMLDivElement>) {
    if (reduced) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerX.set(Math.min(1, Math.max(-1, 2 * (event.clientX - bounds.left) / bounds.width - 1)));
    pointerY.set(Math.min(1, Math.max(-1, 2 * (event.clientY - bounds.top) / bounds.height - 1)));
  }

  function settleField() {
    pointerX.set(0);
    pointerY.set(0);
  }

  return <div className={styles.dnaField} onPointerDown={exploreField} onPointerMove={exploreField}
        onPointerUp={event => {if (event.pointerType !== 'mouse') settleField();}}
        onPointerLeave={settleField} onPointerCancel={settleField}>
        <svg className={styles.dnaArtwork} viewBox="-12 -22 514 492" role="img" aria-label={count ? 'Ribbon sculpture based on your selected interests' : 'Neutral ribbon sculpture preview'}>
          <motion.g className={styles.fieldHalo} style={reduced ? undefined : {x:lightX, y:lightY}} aria-hidden="true">
            <motion.circle cx="218" cy="206" r="182" fill="none" stroke={palette[0]} initial={false} animate={{stroke:palette[0]}}/>
            <motion.circle cx="218" cy="206" r="154" fill="none" stroke={palette[1]} initial={false} animate={{stroke:palette[1]}}/>
          </motion.g>
          <motion.g className={styles.dnaContours} style={reduced ? undefined : {x:driftX, y:driftY, rotate:lean}}>
            <RibbonFaces seed={seed} palette={palette} complexity={count} morph/>
          </motion.g>
        </svg>
      </div>;
}
