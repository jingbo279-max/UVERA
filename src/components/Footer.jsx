import React from 'react';
import { Link } from 'react-router-dom';

/**
 * App footer with legal doc links. Visible on the main app and the
 * legal pages themselves. Not rendered on admin or auth screens.
 */
export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-zinc-200/60 dark:border-zinc-800/60 px-6 py-5 text-xs text-zinc-500 dark:text-zinc-400">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row gap-3 sm:gap-6 justify-between items-center">
        <span>© {year} longVV Ltd</span>
        <nav className="flex gap-5 sm:gap-6">
          <Link to="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
            Privacy
          </Link>
          <Link to="/content-license" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
            Content License
          </Link>
        </nav>
      </div>
    </footer>
  );
}
