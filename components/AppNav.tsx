'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { IS_STATIC_BUILD } from '@/lib/build-mode';
import styles from './AppNav.module.css';

const TABS = [
  { href: '/record', label: 'Record', needsServer: false },
  { href: '/notes', label: 'Notes', needsServer: false },
  { href: '/analysis', label: 'Analysis', needsServer: false },
  { href: '/billing', label: 'Credits', needsServer: true },
] as const;

export function AppNav() {
  const pathname = usePathname();

  // The static build has no billing route to link to, so the tab is dropped
  // rather than left pointing at a 404.
  const tabs = IS_STATIC_BUILD ? TABS.filter((tab) => !tab.needsServer) : TABS;

  return (
    <nav className={styles.tabs} aria-label="Sections">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${styles.tab} ${active ? styles.active : ''}`}
            aria-current={active ? 'page' : undefined}
            // Prefetch keeps tab switches instant; these are the only four
            // routes in the app, so the cost is negligible.
            prefetch
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
