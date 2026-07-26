/**
 * B2B Website — public landing shell (SCAFFOLDED).
 * Public marketing surface: synthetic development content is allowed but must
 * be clearly labeled. Source spec: kitluy-b2b-website-phase1-spec-v1.0.0.md.
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
        <strong>KitLuy · B2B Website</strong>
      </header>
      <h1 lang="km">បង្កើតហាងឌីជីថលរបស់អ្នកនៅកម្ពុជា</h1>
      <p lang="en">Create digitally. Operate physically. Sell everywhere.</p>
      <p>
        <em>
          [DEVELOPMENT PLACEHOLDER] This page is a scaffold. Content, pricing and legal text are
          pending owner decisions and must not be treated as published marketing.
        </em>
      </p>
    </main>
  );
}
