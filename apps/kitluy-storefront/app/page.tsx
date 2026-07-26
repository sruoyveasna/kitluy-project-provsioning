/**
 * Storefront — public landing shell (SCAFFOLDED).
 * Public marketing surface: synthetic development content is allowed but must
 * be clearly labeled. Source spec: kitluy-storefront-phase1-spec-v1.1.0.md.
 */
export default function HomePage() {
  return (
    <main
      style={{
        fontFamily: "'Noto Sans Khmer', 'Kantumruy Pro', system-ui, -apple-system, sans-serif",
        maxWidth: 720,
        margin: "0 auto",
        padding: 24,
      }}
    >
      <header
        style={{ background: "#1f6feb", color: "#fff", padding: "16px 24px", borderRadius: 8 }}
      >
        <strong>KitLuy · Storefront</strong>
      </header>
      <h1 lang="km">ស្កេន រៀបចំ និងចូលជួរ</h1>
      <p lang="en">Scan, Prepare & Queue — Laundry pre-intake for customers.</p>
      <p>
        <em>
          [DEVELOPMENT PLACEHOLDER] This page is a scaffold. Content, pricing and legal text are
          pending owner decisions and must not be treated as published marketing.
        </em>
      </p>
    </main>
  );
}
