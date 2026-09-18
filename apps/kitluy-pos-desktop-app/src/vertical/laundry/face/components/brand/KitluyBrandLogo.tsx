/** KitLuy wordmark icon — matches Café Savor top bar */
export const KitluyBrandLogo = ({ className = "kl-brand-logo" }: { className?: string }) => (
  <div className={className} aria-hidden>
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <circle cx="5" cy="12" r="2.4" fill="currentColor" />
      <line x1="7.4" y1="12" x2="12" y2="12" />
      <circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" />
      <line x1="14.4" y1="12" x2="19" y2="12" />
      <circle cx="19" cy="12" r="2.4" fill="currentColor" />
    </svg>
  </div>
);
