import type {ReactNode} from 'react';
import {
  fallbackCodeSamples,
  type HighlightedCodeSample,
  type HighlightedCodeSamples,
} from './code-samples.js';

const githubUrl = 'https://github.com/vilicvane/code3d';

const featureCards = [
  {
    number: '01',
    eyebrow: 'SOURCE ↔ GEOMETRY',
    title: 'Inspect the object you wrote.',
    text: 'Every meaningful expression can be a viewport context. See an input, an intermediate boolean, or an assembled result without adding export ceremony.',
    accent: 'cursor',
  },
  {
    number: '02',
    eyebrow: 'RESTRAINED VISUAL TOOLS',
    title: 'Use the GUI where code gets awkward.',
    text: 'Pick a face, drag a relation, or choose an edge visually. The operation ends as a precise edit to source—not hidden application state.',
    accent: 'gizmo',
  },
  {
    number: '03',
    eyebrow: 'TYPED TOPOLOGY',
    title: 'Name what matters.',
    text: 'Expose type-safe points, edges, faces, and frames from a model. Downstream code relates parts through domain language instead of fragile indices.',
    accent: 'anchor',
  },
  {
    number: '04',
    eyebrow: 'REAL MODULES',
    title: 'Package the model, not a snapshot.',
    text: 'Compose reusable model functions with ordinary TypeScript and publish focused libraries such as standards-based fasteners.',
    accent: 'module',
  },
] as const;

function LogoMark(): ReactNode {
  return (
    <svg aria-hidden="true" className="logo-mark" viewBox="0 0 32 32">
      <path d="M16 2 30 16 16 30 2 16 16 2Z" />
      <path d="m16 8 8 8-8 8-8-8 8-8Z" />
    </svg>
  );
}

function Arrow({external = false}: {external?: boolean}): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      {external ? (
        <>
          <path d="M7 4h9v9" />
          <path d="M16 4 5 15" />
        </>
      ) : (
        <>
          <path d="M3 10h13" />
          <path d="m11 5 5 5-5 5" />
        </>
      )}
    </svg>
  );
}

function Header(): ReactNode {
  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Code3D home">
        <LogoMark />
        <span>Code3D</span>
      </a>
      <nav aria-label="Primary navigation">
        <a href="#principles">Principles</a>
        <a href="#workflow">Workflow</a>
        <a href="#code">Code</a>
      </nav>
      <a className="header-link" href={githubUrl}>
        GitHub
        <Arrow external />
      </a>
    </header>
  );
}

function HighlightedCode({
  sample,
  label,
  className,
}: {
  sample: HighlightedCodeSample;
  label: string;
  className?: string;
}): ReactNode {
  const classes = ['highlighted-code', className].filter(Boolean).join(' ');
  if (sample.html) {
    return (
      <div
        aria-label={label}
        className={classes}
        dangerouslySetInnerHTML={{__html: sample.html}}
      />
    );
  }

  return (
    <div aria-label={label} className={classes}>
      <pre>
        <code>{sample.source}</code>
      </pre>
    </div>
  );
}

function DemoCode({sample}: {sample: HighlightedCodeSample}): ReactNode {
  return (
    <HighlightedCode
      className="demo-code"
      label="TypeScript source for the rendered model"
      sample={sample}
    />
  );
}

function ModelViewport(): ReactNode {
  return (
    <figure className="model-render">
      <img
        alt="A counterbored plate and ISO 4762 socket cap screw rendered by Code3D"
        height="900"
        loading="lazy"
        src="product-fastener.png"
        width="1200"
      />
    </figure>
  );
}

function ProductDemo({samples}: {samples: HighlightedCodeSamples}): ReactNode {
  return (
    <section className="product-section section-shell" id="product">
      <div className="section-heading demo-heading">
        <div>
          <p className="eyebrow">THE WORKING MEDIUM</p>
          <h2>
            Code and geometry,
            <br />
            in the same thought.
          </h2>
        </div>
        <p className="section-intro">
          The viewport follows your source context. The source receives every
          durable edit. Neither side pretends to be the other.
        </p>
      </div>

      <div className="product-window">
        <div className="product-split">
          <DemoCode sample={samples.assembly} />
          <ModelViewport />
        </div>
      </div>
    </section>
  );
}

function FeatureGlyph({
  kind,
}: {
  kind: (typeof featureCards)[number]['accent'];
}): ReactNode {
  if (kind === 'cursor') {
    return (
      <svg viewBox="0 0 120 100" aria-hidden="true">
        <path d="M20 25h80M20 50h52M20 75h68" />
        <path className="glyph-accent glyph-fill" d="m72 42 22 45 6-18 18-6Z" />
      </svg>
    );
  }

  if (kind === 'gizmo') {
    return (
      <svg viewBox="0 0 120 100" aria-hidden="true">
        <path d="m60 80-36-21 36-21 36 21Z" />
        <path d="M24 59v-20l36-20 36 20v20" />
        <path className="glyph-accent" d="M60 57V8m0 0-7 12m7-12 7 12" />
      </svg>
    );
  }

  if (kind === 'anchor') {
    return (
      <svg viewBox="0 0 120 100" aria-hidden="true">
        <path d="m18 52 42-24 42 24-42 24Z" />
        <ellipse className="glyph-accent" cx="60" cy="52" rx="18" ry="10" />
        <path className="glyph-accent" d="M60 42V12m0 0-7 11m7-11 7 11" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 120 100" aria-hidden="true">
      <path d="M18 23h84v54H18Z" />
      <path d="M18 39h84M34 23v16" />
      <path className="glyph-accent" d="M38 58h44M60 47v22" />
    </svg>
  );
}

function FeatureSection(): ReactNode {
  return (
    <section className="principles-section section-shell" id="principles">
      <div className="section-heading principles-heading">
        <div>
          <p className="eyebrow">DESIGN PRINCIPLES</p>
          <h2>
            A visual CAD tool
            <br />
            that knows its place.
          </h2>
        </div>
        <p className="section-intro">
          During modeling, code leads. The GUI steps in for spatial work and
          carries more weight when information is better seen than read.
        </p>
      </div>
      <div className="feature-grid">
        {featureCards.map(feature => (
          <article className="feature-card" key={feature.number}>
            <div className="feature-meta">
              <span>{feature.number}</span>
              <span>{feature.eyebrow}</span>
            </div>
            <FeatureGlyph kind={feature.accent} />
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function InteractionThesis(): ReactNode {
  return (
    <section className="interaction-thesis section-shell">
      <div className="interaction-copy">
        <p className="eyebrow">BEYOND CODE + PREVIEW</p>
        <h2>
          The link is
          <br />
          the product.
        </h2>
        <p>
          Conventional code CAD compiles a script and shows its result. Code3D
          keeps source locations, runtime objects, topology, constraint context,
          and source edits connected as one navigable system.
        </p>
      </div>
      <div
        className="interaction-map"
        aria-label="Connections between source code and model context"
      >
        <div className="interaction-column source-column">
          <span className="interaction-column-label">SOURCE</span>
          <span>EXPRESSION</span>
          <span>OBJECT VALUE</span>
          <span>NAMED ELEMENT</span>
          <span>PARAMETER</span>
        </div>
        <svg aria-hidden="true" viewBox="0 0 180 360">
          <path d="M8 58h164M8 138h164M8 218h164M8 298h164" />
          <path d="m158 49 14 9-14 9M22 129l-14 9 14 9M158 209l14 9-14 9M22 289l-14 9 14 9" />
          <circle cx="90" cy="58" r="4" />
          <circle cx="90" cy="138" r="4" />
          <circle cx="90" cy="218" r="4" />
          <circle cx="90" cy="298" r="4" />
        </svg>
        <div className="interaction-column model-column">
          <span className="interaction-column-label">MODEL</span>
          <span>VIEW CONTEXT</span>
          <span>GEOMETRY</span>
          <span>TOPOLOGY</span>
          <span>VISUAL TOOL</span>
        </div>
      </div>
    </section>
  );
}

function WorkflowSection(): ReactNode {
  const steps = [
    [
      'WRITE',
      'Use functions, control flow, data, generics, and packages. Construction is ordinary TypeScript.',
    ],
    [
      'INSPECT',
      'Move the cursor through source to see exact objects, operations, elements, and dependencies.',
    ],
    [
      'ADJUST',
      'Reach for a visual tool when a relation or selection is easier to make in space.',
    ],
    [
      'REUSE',
      'Export the resulting object or model function as a typed module for another model or renderer.',
    ],
  ] as const;

  return (
    <section className="workflow-section" id="workflow">
      <div className="section-shell">
        <div className="workflow-lead">
          <p className="eyebrow">A SMALL, COMPLETE LOOP</p>
          <h2>
            <span className="workflow-headline">Freedom in.</span>
            <span className="workflow-headline">Source out.</span>
          </h2>
          <p>
            No feature tree to appease. No shadow document to synchronize. The
            durable state is the program you can read, diff, test, and reuse.
          </p>
        </div>
        <ol className="workflow-list">
          {steps.map(([title, text], index) => (
            <li key={title}>
              <span className="workflow-number">0{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
              <span className="workflow-line" />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function PackageSection({sample}: {sample: HighlightedCodeSample}): ReactNode {
  return (
    <section className="package-section section-shell" id="code">
      <div className="package-copy">
        <p className="eyebrow">NOT ANOTHER CAD DSL</p>
        <h2>Your modeling language already has an ecosystem.</h2>
        <p>
          Code3D keeps JavaScript and TypeScript intact. A model can be a local
          file, an application component, or a package with its own public API.
        </p>
        <ul className="package-points">
          <li>
            <span>01</span> Standard TypeScript modules
          </li>
          <li>
            <span>02</span> Browser and Node execution
          </li>
          <li>
            <span>03</span> OpenCascade B-Rep geometry
          </li>
          <li>
            <span>04</span> Git-native persistent state
          </li>
        </ul>
      </div>
      <div className="package-code-card">
        <div className="package-card-top">
          <span>@code3d/screws</span>
          <span>ISO 4762</span>
        </div>
        <HighlightedCode
          className="package-highlight"
          label="Reusable Code3D package example"
          sample={sample}
        />
        <div className="package-card-bottom">
          <span>TYPE-SAFE MODEL API</span>
          <span className="package-status">
            <i /> READY TO COMPOSE
          </span>
        </div>
      </div>
    </section>
  );
}

function FoundationSection(): ReactNode {
  return (
    <section className="foundation-section section-shell">
      <div className="foundation-title">
        <p className="eyebrow">BUILT ON REAL FOUNDATIONS</p>
        <h2>
          Precise solids.
          <br />
          Familiar language.
        </h2>
      </div>
      <div className="foundation-items">
        <article>
          <span>TS</span>
          <h3>TypeScript</h3>
          <p>Language, type system, tooling, and module boundaries.</p>
        </article>
        <article>
          <span>OC</span>
          <h3>OpenCascade</h3>
          <p>Boundary-representation geometry and production CAD operations.</p>
        </article>
        <article>
          <span>WEB</span>
          <h3>Local-first editor</h3>
          <p>
            Try it in a browser, or open a real folder when the work becomes
            yours.
          </p>
        </article>
      </div>
    </section>
  );
}

function ClosingSection(): ReactNode {
  return (
    <section className="closing-section">
      <div className="closing-grid" aria-hidden="true" />
      <div className="closing-model" aria-hidden="true">
        <span className="closing-cube closing-cube-one" />
        <span className="closing-cube closing-cube-two" />
        <span className="closing-ring" />
      </div>
      <div className="closing-content section-shell">
        <div className="prototype-tag">
          <i /> PROTOTYPE 01 · OPEN SOURCE
        </div>
        <h2>
          Model the object.
          <br />
          Keep the code.
        </h2>
        <p>
          Code3D is an early, working exploration of what solid modeling looks
          like when source is the primary interface—and the GUI is designed to
          make that source more powerful.
        </p>
        <a className="primary-button large-button" href={githubUrl}>
          Follow the prototype
          <Arrow external />
        </a>
      </div>
    </section>
  );
}

function Footer(): ReactNode {
  return (
    <footer className="site-footer section-shell">
      <div className="footer-brand">
        <LogoMark />
        <span>Code3D</span>
      </div>
      <p>Code-first solid modeling in TypeScript.</p>
      <div className="footer-links">
        <a href={githubUrl}>GitHub</a>
        <a href={`${githubUrl}/blob/main/LICENSE`}>MIT License</a>
        <a href="#top">Back to top ↑</a>
      </div>
      <span className="footer-note">DESIGNED IN SOURCE · 2026</span>
    </footer>
  );
}

export function App({
  samples = fallbackCodeSamples,
}: {
  samples?: HighlightedCodeSamples;
} = {}): ReactNode {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="page" id="top">
        <Header />
        <main id="main-content">
          <section className="hero section-shell">
            <div className="hero-grid" aria-hidden="true" />
            <div className="hero-copy">
              <div className="hero-kicker">
                <span className="prototype-pill">PROTOTYPE 01</span>
                <span>CODE-FIRST SOLID MODELING</span>
              </div>
              <h1>
                <span className="hero-headline">The model is code.</span>
                <span className="hero-view-headline">
                  <span>The view is an</span>
                  <span>instrument.</span>
                </span>
              </h1>
              <p>
                Build precise solid geometry in TypeScript. Inspect any
                intermediate object, relate named elements, and use visual tools
                only where space is hard to express.
              </p>
              <div className="hero-actions">
                <a className="primary-button" href="#product">
                  See how it works
                  <Arrow />
                </a>
                <a className="secondary-button" href={githubUrl}>
                  View source
                  <Arrow external />
                </a>
              </div>
            </div>
            <div className="hero-orbit" aria-hidden="true">
              <svg viewBox="0 0 520 520">
                <path
                  className="orbit-line orbit-one"
                  d="M84 210 260 108l176 102-176 102Z"
                />
                <path
                  className="orbit-line orbit-two"
                  d="M84 270 260 168l176 102-176 102Z"
                />
                <path
                  className="orbit-link"
                  d="M84 210v60m352-60v60M260 312v60"
                />
                <path
                  className="orbit-solid"
                  d="M158 212 260 153l102 59-102 59Z"
                />
                <path
                  className="orbit-solid-side"
                  d="m158 212 102 59v58l-102-59Z"
                />
                <path
                  className="orbit-solid-side right"
                  d="m260 271 102-59v58l-102 59Z"
                />
                <ellipse
                  className="orbit-hole"
                  cx="260"
                  cy="212"
                  rx="35"
                  ry="20"
                />
                <path className="orbit-axis" d="M260 40v274" />
                <path className="orbit-arrow" d="m250 56 10-16 10 16" />
                <circle className="orbit-point" cx="260" cy="212" r="5" />
              </svg>
              <span className="orbit-label orbit-label-model">MODEL</span>
              <span className="orbit-label orbit-label-anchor">TOP · FACE</span>
              <span className="orbit-label orbit-label-source">
                SOURCE: 18:7
              </span>
            </div>
            <div className="hero-index" aria-hidden="true">
              C3D / 001
            </div>
          </section>

          <div className="proof-strip" aria-label="Code3D foundations">
            <span>CODE ↔ MODEL CONTEXT</span>
            <span>OPENCASCADE KERNEL</span>
            <span>SOURCE OF TRUTH</span>
            <span>REUSABLE MODULES</span>
          </div>

          <InteractionThesis />
          <ProductDemo samples={samples} />
          <FeatureSection />
          <WorkflowSection />
          <PackageSection sample={samples.package} />
          <FoundationSection />
          <ClosingSection />
        </main>
        <Footer />
      </div>
    </>
  );
}
