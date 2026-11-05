import type { ReactNode } from "react"
import { Actions } from "./Actions.tsx"
import { Folder } from "./Folder.tsx"
import { repo } from "./github.ts"
import { Hero } from "./hero/Hero.tsx"
import { live } from "./live.ts"
import { Loop, Picture } from "./Media.tsx"
import { reveal } from "./reveal.ts"

const bassim = "https://github.com/AVGVSTVS96"
const half = "(min-width: 960px) 600px, calc(100vw - 48px)"

interface Feature {
  readonly title: string
  readonly text: ReactNode
  readonly next?: string
  readonly media: ReactNode
}

const features: ReadonlyArray<Feature> = [
  {
    title: "Every page is an outline.",
    text: "Indent, drag, fold or zoom into any block, and start each day on a fresh journal page.",
    media: (
      <Loop
        name="outline"
        alt="Blocks being indented, moved and folded on a seqno page"
        width={1200}
        height={840}
        sizes={half}
      />
    ),
  },
  {
    title: "Links go both ways.",
    text: (
      <>
        Type <code>[[</code> to link any page, and that page shows every block that links back, even
        the ones that only mention it.
      </>
    ),
    media: (
      <div
        className="pair"
        role="img"
        aria-label="Linking a page while typing, and the page's references in the sidebar"
      >
        <Picture className="frame" name="typing" alt="" width={1200} height={408} sizes={half} />
        <Picture
          className="frame"
          name="references"
          alt=""
          width={1128}
          height={808}
          sizes={half}
        />
      </div>
    ),
  },
  {
    title: "Queries stay live.",
    text: "Logseq's simple queries run unchanged, and their results update as you type.",
    media: (
      <Loop
        name="queries"
        alt="A query block listing tasks, updating as one changes"
        width={1200}
        height={840}
        sizes={half}
      />
    ),
  },
  {
    title: "Your notes stay on your device.",
    text: "There's no seqno server, and every edit goes into a log built to merge across devices without conflicts.",
    next: "Two Macs, one graph, through iCloud Drive.",
    media: <Folder />,
  },
]

const stack = [
  ["TypeScript 7", "https://www.typescriptlang.org"],
  ["Effect 4", "https://effect.website"],
  ["Loro", "https://loro.dev"],
  ["SQLite", "https://sqlite.org/wasm"],
  ["React 19", "https://react.dev"],
  ["CodeMirror 6", "https://codemirror.net"],
  ["Vite 8", "https://vite.dev"],
] as const

const roadmap = [
  ["now", "The web app, in Chrome and Edge."],
  ["next", "Safe for big, real graphs, with edits written back to Logseq markdown."],
  ["later", "iOS with iCloud Drive, and a desktop app."],
] as const

function Intro() {
  return (
    <section className="intro">
      <ul className="tagline outline">
        <li ref={reveal}>
          A local-first outliner, rebuilt to be minimal, solid and clean.
          <ul>
            <li ref={reveal}>It's early, so keep your real notes where they are for now.</li>
          </ul>
        </li>
      </ul>
      <div className="actions" ref={reveal}>
        <Actions />
        <p className="browser">
          <span data-for="chromium">
            Runs in Chrome and Edge. Your notes never leave your device.
          </span>
          <span data-for="other">
            seqno runs in Chrome and Edge for now. Open this page in one of them to try it.
          </span>
          <span data-for="ios">
            Try it on a computer for now, in Chrome or Edge. The iOS app comes later.
          </span>
        </p>
      </div>
    </section>
  )
}

function Showcase() {
  return (
    <figure className="showcase" ref={live}>
      <div className="slot">
        <div className="window">
          <div className="chrome">
            <button className="zoom" type="button" aria-expanded="false">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6" />
              </svg>
              <span>Full screen</span>
            </button>
          </div>
          <div className="screen">
            <Picture
              name="showcase"
              alt="A seqno page with properties, headings, links, tags and nested blocks"
              width={1440}
              height={888}
              sizes="(min-width: 1176px) 1128px, calc(100vw - 48px)"
            />
            <button className="shield" type="button" aria-label="Try seqno right here">
              <span>Click to try it</span>
            </button>
          </div>
        </div>
      </div>
      <figcaption ref={reveal}>
        Looks and feels like Logseq, and opens your Logseq graphs.
      </figcaption>
    </figure>
  )
}

function Note() {
  return (
    <section className="note" aria-label="A note from bassim">
      <ul className="outline">
        <li ref={reveal}>
          A couple of years ago I watched my favorite note-taking app get worse and worse, so I
          decided to rebuild it on a stack of really nice technologies. The goal is to keep it as
          minimal as possible while making it as solid and clean as I can.
          <ul>
            <li ref={reveal}>
              <a href={bassim}>bassim</a>
            </li>
          </ul>
        </li>
      </ul>
    </section>
  )
}

function Features() {
  return (
    <div className="features">
      {features.map(({ title, text, next, media }) => (
        <section className="feature" key={title}>
          <ul className="outline words">
            <li ref={reveal}>
              <h2>{title}</h2>
              <ul>
                <li ref={reveal}>{text}</li>
                {next && (
                  <li ref={reveal} className="later">
                    <span className="tag">next</span> {next}
                  </li>
                )}
              </ul>
            </li>
          </ul>
          <div className="media">{media}</div>
        </section>
      ))}
    </div>
  )
}

function BuiltWith() {
  return (
    <p className="built" ref={reveal}>
      Built with{" "}
      {stack.map(([name, href], i) => (
        <span key={name}>
          <a href={href}>{name}</a>
          {i < stack.length - 2 ? ", " : i === stack.length - 2 ? " and " : "."}
        </span>
      ))}
    </p>
  )
}

function Roadmap() {
  return (
    <section className="roadmap" aria-labelledby="roadmap">
      <ul className="outline">
        <li ref={reveal}>
          <h2 className="label" id="roadmap">
            Roadmap
          </h2>
          <ul className="stages">
            {roadmap.map(([when, what]) => (
              <li key={when} ref={reveal} className={when}>
                <span className="when">{when}</span>
                <span>{what}</span>
              </li>
            ))}
          </ul>
        </li>
      </ul>
      <div className="close" ref={reveal}>
        <p>Trying it with a Logseq graph? Use a copy for now.</p>
        <a className="more" href={`${repo}/blob/main/docs/roadmap.md`}>
          Read the roadmap, known gaps and all{" "}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17 7 7 17M8 7h9v9" />
          </svg>
        </a>
        <Actions />
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <span>
        <b>seqno</b> · MIT
      </span>
      <a href={repo}>github.com/AVGVSTVS96/seqno</a>
      <span>
        by <a href={bassim}>bassim</a>
      </span>
      <span>
        Hero inspired by <a href="https://buzz.xyz">Buzz</a>
      </span>
      <span>Not affiliated with Logseq.</span>
    </footer>
  )
}

export function App() {
  return (
    <>
      <Hero />
      <main className="page">
        <Intro />
        <Showcase />
        <Note />
        <Features />
        <BuiltWith />
        <Roadmap />
      </main>
      <Footer />
    </>
  )
}
