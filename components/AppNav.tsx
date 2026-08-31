'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import styles from './AppNav.module.css';

const TABS = [
  { href: '/record', label: 'Record' },
  { href: '/notes', label: 'Notes' },
  { href: '/analysis', label: 'Analysis' },
  { href: '/billing', label: 'Credits' },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.tabs} aria-label="Sections">
      {TABS.map((tab) => {
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
