import {Bookmark, Sparkles, X} from 'lucide-react';
import {cleanName, type Club, type Recommendation} from '@/lib/api';
import {CampusMark, ClubArt} from './visuals';

/**
 * A suggested club with the reason it was suggested. The reason and tags come from the
 * recommendation API (paths through the club graph); there is deliberately no match
 * percentage, because graph scores are relative rankings, not probabilities.
 */
export default function RecommendationCard({club, saved, busy, onOpen, onSave, onDismiss}: {
  club: Club | Recommendation; saved: boolean; busy?: boolean;
  onOpen: () => void; onSave: () => void; onDismiss: () => void;
}) {
  const reason = 'explanation' in club ? club.explanation : '';
  const tags = 'tags' in club ? club.tags ?? [] : [];
  const name = cleanName(club.name);
  return <article className="recommendation-card surface" style={{'--club': club.color} as React.CSSProperties}>
    <button className="recommendation-main plain-button" onClick={onOpen}>
      <span className="club-card-head"><ClubArt category={club.category} color={club.color} logo={club.logo_url} size="large"/></span>
      <span className="recommendation-copy">
        <span className="category-label">{club.category}</span>
        <strong className="club-card-title">{name}</strong>
        <span className="recommendation-description">{club.description}</span>
      </span>
    </button>
    {reason && <p className="recommendation-why"><Sparkles size={14} aria-hidden="true"/><span><span className="sr-only">Why suggested: </span>{reason}</span></p>}
    {tags.length > 0 && <ul className="recommendation-tags" aria-label="Your interests it matches">{tags.map(tag => <li key={tag}>{tag}</li>)}</ul>}
    <div className="recommendation-actions">
      <CampusMark campus={club.campus} short/>
      <span className="spacer"/>
      <button className="icon-button" onClick={onDismiss} disabled={busy} aria-label={`Not interested in ${name}`} title="Not interested"><X size={17}/></button>
      <button className={`button ${saved ? 'button-secondary' : 'button-outline'} button-small`} onClick={onSave} disabled={busy} aria-pressed={saved}><Bookmark size={15} fill={saved ? 'currentColor' : 'none'}/>{saved ? 'Saved' : 'Save'}</button>
    </div>
  </article>;
}
