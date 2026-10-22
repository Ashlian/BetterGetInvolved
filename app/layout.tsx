import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BetterGetInvolved — Find your people',
  description: 'A student-built demo for discovering campus clubs and events, with transparent interest-based recommendations.',
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
