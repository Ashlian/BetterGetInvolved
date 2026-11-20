import {UserRound} from 'lucide-react';

/** A student's photo, or their first initial when they haven't added one. */
export default function UserAvatar({name, url, size = 36, className = ''}: {name?: string | null; url?: string | null; size?: number; className?: string}) {
  const style = {width: size, height: size, fontSize: Math.round(size * 0.42)};
  if (url) return <img className={`user-avatar ${className}`} src={url} alt="" width={size} height={size} style={style}/>;
  if (!name) return <span className={`user-avatar user-avatar-empty ${className}`} style={style} aria-hidden="true"><UserRound size={Math.round(size * 0.5)}/></span>;
  return <span className={`user-avatar ${className}`} style={style} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase()}</span>;
}
