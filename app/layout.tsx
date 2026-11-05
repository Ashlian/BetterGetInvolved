import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BetterGetInvolved — Find your people',
  description: 'A student-built demo for discovering campus clubs and events, with transparent interest-based recommendations.',
};

export const viewport: Viewport = {
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [{media: '(prefers-color-scheme: light)', color: '#f2f2f7'}, {media: '(prefers-color-scheme: dark)', color: '#000000'}],
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
