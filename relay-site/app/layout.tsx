import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Tempo Human Approval',
  description:
    'Review and approve exact GitHub changes with your enrolled iPhone.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Approval', statusBarStyle: 'default' },
  referrer: 'no-referrer',
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#102435',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
