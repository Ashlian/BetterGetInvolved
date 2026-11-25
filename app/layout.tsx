import type { Metadata, Viewport } from 'next';
import './globals.css';
import 'maplibre-gl/dist/maplibre-gl.css';

export const metadata: Metadata = {
  title: 'ClRUb — Find your people at Rutgers',
  description: 'Discover Rutgers–New Brunswick clubs and events, with plain-language search and explained recommendations. An independent student project.',
  // Google Search Console ownership check for clrub.vercel.app (needed for the OAuth consent
  // screen's branding verification). Keep it: removing it un-verifies the site.
  verification: {google: '73vlsf8DGwlB-zVsPxe4eKlYXfUjIdkxOYUu2FykAao'},
};

export const viewport: Viewport = {
  viewportFit: 'cover',
  colorScheme: 'light',
  themeColor: '#ffffff',
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
