import {notFound} from 'next/navigation';

export const metadata = {title: 'Development studio | ClRUb'};

export default async function StudioPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const {default: Studio} = await import('./studio');
  return <Studio/>;
}
