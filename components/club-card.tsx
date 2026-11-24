import {Bookmark, Check, Heart, Sparkles} from 'lucide-react';
import {cleanName, type Club, type Recommendation} from '@/lib/api';
import {CampusMark, ClubArt} from './visuals';

export default function ClubCard({club, following, showReason = true, onOpen, onFollow, bookmark}: {
  club: Club | Recommendation;
  index?: number;
  following: boolean;
  showReason?: boolean;
  onOpen: () => void;
  onFollow: () => void;
  bookmark?: {saved: boolean; busy: boolean; onToggle: () => void};
}) {
  const name = cleanName(club.name);
  const reason = showReason && 'explanation' in club && club.explanation;

  return <article className="club-card" style={{'--club': club.color} as React.CSSProperties}>
    <div className="club-card-head">
      <ClubArt category={club.category} color={club.color} logo={club.logo_url} size="large"/>
      <div className="club-card-tools">
        <button className={`card-save icon-button ${following ? 'is-saved' : ''}`} onClick={onFollow} aria-label={`${following ? 'Unfollow' : 'Follow'} ${name}`} aria-pressed={following}><Heart size={18} fill={following ? 'currentColor' : 'none'}/></button>
        {bookmark && <button className={`card-save icon-button ${bookmark.saved ? 'is-saved' : ''}`} onClick={bookmark.onToggle} disabled={bookmark.busy} aria-label={`${bookmark.saved ? 'Remove from Later:' : 'Save for later:'} ${name}`} aria-pressed={bookmark.saved}><Bookmark size={18} fill={bookmark.saved ? 'currentColor' : 'none'}/></button>}
      </div>
    </div>
    <button className="club-card-body plain-button" onClick={onOpen}>
      <span className="category-label">{club.category}</span>
      <strong className="club-card-title">{name}</strong>
      <span className="club-description">{club.description}</span>
    </button>
    <div className="club-card-meta"><CampusMark campus={club.campus}/>{club.beginner_friendly && <span className="meta-note"><Check size={14}/>Beginners welcome</span>}</div>
    {reason && <p className="recommendation-reason"><Sparkles size={14} aria-hidden="true"/><span>{reason}</span></p>}
  </article>;
}
