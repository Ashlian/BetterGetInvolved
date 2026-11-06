import {Code2, Flower2, Globe2, HeartHandshake, Leaf, Lightbulb, Palette, Rocket, Gamepad2, Microscope, type LucideIcon} from 'lucide-react';

export function categoryIcon(category: string): LucideIcon {
  if (/AI|Comput|Tech/i.test(category)) return Code2;
  if (/Volunteer|Service/i.test(category)) return HeartHandshake;
  if (/Art|Music/i.test(category)) return Palette;
  if (/Cultur/i.test(category)) return Globe2;
  if (/Outdoor|Recreation/i.test(category)) return Leaf;
  if (/Entrepreneur/i.test(category)) return Rocket;
  if (/Science/i.test(category)) return Microscope;
  if (/Well/i.test(category)) return Flower2;
  if (/Gam/i.test(category)) return Gamepad2;
  return Lightbulb;
}

// Each campus keeps one route color everywhere it appears. The name is always
// shown beside the color, so the color is never the only cue.
export const campusSlug = (campus: string) => campus.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

export function CampusMark({campus, short = false}: {campus: string; short?: boolean}) {
  if (!campus) return null;
  return<span className={`campus campus-${campusSlug(campus)}`}><i aria-hidden="true"/>{short ? campus.replace('College Avenue', 'College Ave') : campus}</span>;
}

// A club's tile: its own color with the category symbol, like an app icon.
export function ClubArt({category, color, size = 'regular'}: {category: string; color: string; size?: 'small' | 'regular' | 'large'}) {
  const Icon = categoryIcon(category);
  return <span className={`club-tile tile-${size}`} style={{'--club': color || '#326BDA'} as React.CSSProperties} aria-hidden="true"><Icon strokeWidth={1.75}/></span>;
}
