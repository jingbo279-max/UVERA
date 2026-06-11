import React, { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import Footer from '../components/Footer.jsx';

/**
 * Renders one of the markdown legal docs from /public/legal/.
 *
 * Routed at /terms /privacy /content-license — slug param maps to the
 * corresponding .md filename. Source files live in docs/ (committed) and
 * are mirrored to public/legal/ for serving.
 */

const SLUG_TO_FILE = {
  terms: 'terms.md',
  privacy: 'privacy.md',
  'content-license': 'content-license.md',
};

const TITLE = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  'content-license': 'Content License',
};

const md = {
  h1: (props) => <h1 className="text-3xl font-semibold mt-10 mb-5 text-zinc-900 dark:text-zinc-100" {...props} />,
  h2: (props) => <h2 className="text-2xl font-semibold mt-8 mb-3 text-zinc-900 dark:text-zinc-100" {...props} />,
  h3: (props) => <h3 className="text-lg font-semibold mt-6 mb-2 text-zinc-900 dark:text-zinc-100" {...props} />,
  p: (props) => <p className="my-3 leading-relaxed" {...props} />,
  ul: (props) => <ul className="list-disc pl-6 my-3 space-y-1" {...props} />,
  ol: (props) => <ol className="list-decimal pl-6 my-3 space-y-1" {...props} />,
  li: (props) => <li {...props} />,
  a: (props) => <a className="text-indigo-600 dark:text-indigo-400 hover:underline" {...props} />,
  code: (props) => <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-sm font-mono" {...props} />,
  blockquote: (props) => (
    <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-700 pl-4 my-4 italic text-zinc-600 dark:text-zinc-400" {...props} />
  ),
  table: (props) => <table className="border-collapse my-4 w-full text-sm" {...props} />,
  th: (props) => <th className="border border-zinc-300 dark:border-zinc-700 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 font-semibold text-left" {...props} />,
  td: (props) => <td className="border border-zinc-300 dark:border-zinc-700 px-3 py-2 align-top" {...props} />,
  hr: (props) => <hr className="my-8 border-zinc-200 dark:border-zinc-800" {...props} />,
};

export default function LegalPage() {
  const location = useLocation();
  const slug = location.pathname.replace(/^\//, '').replace(/\/$/, '');
  const file = SLUG_TO_FILE[slug];
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!file) {
      setError('Document not found');
      return;
    }
    let cancelled = false;
    fetch(`/legal/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => { cancelled = true; };
  }, [file]);

  return (
    <div className="min-h-dvh flex flex-col bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200">
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link to="/" className="text-lg font-semibold tracking-wide">UVERA</Link>
          <span className="text-sm text-zinc-500">{TITLE[slug] || 'Legal'}</span>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-red-700 dark:text-red-300">
              Failed to load document: {error}
            </div>
          )}
          {!error && !content && (
            <div className="text-zinc-500">Loading…</div>
          )}
          {content && (
            <ReactMarkdown components={md}>{content}</ReactMarkdown>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
