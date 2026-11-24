import {notFound} from 'next/navigation';

export const metadata = {title: 'Swipe preview | ClRUb'};

export default async function DiscoverPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const {default: DiscoverPreview} = await import('./preview');
  return <DiscoverPreview/>;
}
