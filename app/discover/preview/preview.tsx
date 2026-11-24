'use client';

import Link from 'next/link';
import {useState} from 'react';
import {FlaskConical, RotateCcw} from 'lucide-react';
import {type Recommendation} from '@/lib/api';
import DiscoverDeck, {type DeckAction} from '@/components/discover-deck';
import styles from '@/components/discover-deck.module.css';

const fixtures = [
  {id: 'moonlight-makers', name: 'Moonlight Makers', category: 'Technology', campus: 'Busch', color: '#7337ba', description: 'Bring a half-formed idea and leave with something that lights up. This imaginary maker group spends its evenings building small, playful electronics.', interest: 'Creative coding'},
  {id: 'after-rain', name: 'After Rain Studio', category: 'Arts & Music', campus: 'College Avenue', color: '#bd4434', description: 'A fictional illustration circle for swapping sketchbooks, trying new materials, and making zines together.', interest: 'Illustration'},
  {id: 'river-trails', name: 'Raritan Trail Collective', category: 'Outdoors', campus: 'Cook', color: '#247552', description: 'An imaginary outdoors group that sketches local walking routes and shares ideas for low-key trips.', interest: 'Local trails'},
  {id: 'orbit-lab', name: 'Orbit Lab', category: 'Science', campus: 'Livingston', color: '#285dc0', description: 'This fictional group builds tabletop experiments and trades questions about the night sky.', interest: 'Astronomy'},
  {id: 'paper-bridges', name: 'Paper Bridges', category: 'Volunteering', campus: 'Douglass', color: '#b7266c', description: 'A fictional volunteer crew that imagines pop-up book swaps, reading circles, and creative ways to share stories.', interest: 'Community reading'},
].map(({interest, ...club}): Recommendation => ({
  ...club,
  short_name: club.name, mission: '', interests: [interest], location: '', meeting_schedule: '',
  beginner_friendly: true, membership_fee: '', eligibility: '', contact_email: '', website: '',
  faqs: [], source_url: '', updated_at: '', verification: 'demo', featured: false, score: 0,
  explanation: `This example shows where an explanation about ${interest.toLowerCase()} would appear.`,
  tags: [interest],
}));

const status = {pass: 'Passed', save: 'Saved', follow: 'Followed'} satisfies Record<DeckAction, string>;

export default function DiscoverPreview() {
  const [clubs, setClubs] = useState(fixtures);
  const [layout, setLayout] = useState<'swipe' | 'list'>('swipe');
  const [feedback, setFeedback] = useState('');
  const [run, setRun] = useState(0);
  function reset() {
    setClubs(fixtures);
    setFeedback('');
    setRun(current => current + 1);
  }

  return <main className={styles.previewPage}>
    <section className={styles.experience} aria-labelledby="preview-title">
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}><FlaskConical size={17} aria-hidden="true"/>Development preview</span>
          <h1 id="preview-title">Test the <em>swipe.</em></h1>
          <p>Five fictional clubs. Follow, pass, and save affect this preview only.</p>
        </div>
        <div className={styles.headerLinks}>
          <button className={styles.profile} type="button" onClick={reset}><RotateCcw size={16} aria-hidden="true"/>Reset preview</button>
          <Link className={styles.profile} href="/">Back to ClRUb</Link>
        </div>
      </header>
      <DiscoverDeck key={run} clubs={clubs} layout={layout} onLayout={setLayout} fictional busy={false} modalOpen={false}
        onAction={async (action, club) => {
          setClubs(current => current.filter(item => item.id !== club.id));
          setFeedback(`${status[action]} ${club.name} in this preview.`);
          return true;
        }}
        empty={<div className={`surface empty-state ${styles.empty}`}>
          <h2>You’ve tried all five cards</h2>
          <button className="button button-primary" type="button" onClick={reset}>Restart preview</button>
        </div>}/>
      <p className={styles.previewStatus} role="status">{feedback}</p>
    </section>
  </main>;
}
