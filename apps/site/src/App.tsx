import type { ReactNode } from "react"
import { Actions } from "./Actions.tsx"
import { Folder } from "./Folder.tsx"
import { repo } from "./github.ts"
import { Hero } from "./hero/Hero.tsx"
import { live } from "./live.ts"
import { Loop, Picture } from "./Media.tsx"
import { reveal } from "./reveal.ts"

const bassim = "https://github.com/AVGVSTVS96"

const plate =
  "(min-width: 1200px) 600px, (min-width: 760px) calc(100vw - 376px), calc(100vw - 48px)"

interface Note {
  readonly text: string
  readonly at?: readonly [x: number, y: number]
}

interface Plate {
  readonly media: ReactNode
  readonly notes: readonly Note[]
}

interface Feature {
  readonly title: string
  readonly text: ReactNode
  readonly next?: string
  readonly plates: readonly Plate[]
}

const features: readonly Feature[] = [
  {
    title: "Every page is an outline.",
    text: "Indent, drag, fold or zoom into any block, and start each day on a fresh journal page.",
    plates: [
      {
        media: (
          <Loop
            name="outline"
            alt="Blocks being indented, moved and folded on a seqno page"
            width={1200}
            height={840}
            sizes={plate}
          />
        ),
        notes: [
          { at: [8.5, 56], text: "Tab and Shift-Tab move a block in and out." },
          { at: [5, 79], text: "A folded block keeps its children under the ring." },
          { at: [73, 73.5], text: "Five levels deep, each with its own guide line." },
        ],
      },
    ],
  },
  {
    title: "Links go both ways.",
    text: (
      <>
        Type <code>[[</code> to link any page, and that page shows every block that links back, even
        the ones that only mention it.
      </>
    ),
    plates: [
      {
        media: (
          <Picture
            name="typing"
            alt="Linking a page while typing"
            width={1200}
            height={408}
            sizes={plate}
          />
        ),
        notes: [
          { at: [88, 55], text: "Typing [[ opens a search over every page." },
          { at: [72.5, 10], text: "A link shows the page name, its brackets dimmed." },
        ],
      },
      {
        media: (
          <Picture
            name="references"
            alt="The page's references in the sidebar"
            width={1128}
            height={808}
            sizes={plate}
          />
        ),
        notes: [
          { at: [34, 5], text: "Every block that links here, under the page it's on." },
          { at: [34, 95.5], text: "And the blocks that only mention it, folded away." },
        ],
      },
    ],
  },
  {
    title: "Queries stay live.",
    text: "Logseq's simple queries run unchanged, and their results update as you type.",
    plates: [
      {
        media: (
          <Loop
            name="queries"
            alt="A query block listing tasks, updating as one changes"
            width={1200}
            height={840}
            sizes={plate}
          />
        ),
        notes: [
          { at: [4.5, 38], text: "A Logseq query, run as written." },
          { at: [81.5, 38], text: "The results update as you type." },
        ],
      },
    ],
  },
  {
    title: "Your notes stay on your device.",
    text: "There's no seqno server, and every edit goes into a log built to merge across devices without conflicts.",
    next: "Two Macs, one graph, through iCloud Drive.",
    plates: [
      {
        media: <Folder />,
        notes: [
          {
            text: "Each file is named by the number of the first edit in it. That number is the name: seqno, sequence number.",
          },
        ],
      },
    ],
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

function Margin({ no, title, id }: { no: string; title: string; id?: string }) {
  return (
    <div className="margin" ref={reveal}>
      <span className="no">nº {no}</span>
      <h2 className="sect" id={id}>
        {title}
      </h2>
    </div>
  )
}

function Intro() {
  return (
    <section className="row">
      <Margin no="01" title="The app" />
      <div className="body">
        <p className="lede" ref={reveal}>
          A local-first outliner, rebuilt to be minimal, solid and clean.{" "}
          <span>It&apos;s early, so keep your real notes where they are for now.</span>
        </p>
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
    <section className="row note" aria-label="A note from bassim">
      <div className="margin" ref={reveal}>
        <span className="dash" aria-hidden="true">
          —{" "}
        </span>
        <a className="sign" href={bassim}>
          bassim
        </a>
      </div>
      <p className="body" ref={reveal}>
        A couple of years ago I watched my favorite note-taking app get worse and worse, so I
        decided to rebuild it on a stack of really nice technologies. The goal is to keep it as
        minimal as possible while making it as solid and clean as I can.
      </p>
    </section>
  )
}

function Mark({ n, at }: { n: number; at?: Note["at"] }) {
  return (
    <span
      className="mark"
      aria-hidden="true"
      style={at && { left: `${String(at[0])}%`, top: `${String(at[1])}%` }}
    >
      {n}
    </span>
  )
}

function Figure({ plates }: { plates: readonly Plate[] }) {
  const numbered = plates.map((p, i) => ({
    ...p,
    from: plates.slice(0, i).reduce((sum, q) => sum + q.notes.length, 1),
  }))

  return (
    <div className="fig">
      <div className="plates">
        {numbered.map(({ media, notes, from }) => (
          <div className="plate" key={from}>
            {media}
            {notes.map(({ at, text }, i) => at && <Mark key={text} n={from + i} at={at} />)}
          </div>
        ))}
      </div>
      <ol className="notes" ref={reveal}>
        {numbered.flatMap(({ notes, from }) =>
          notes.map(({ text }, i) => (
            <li key={text}>
              <Mark n={from + i} />
              {text}
            </li>
          )),
        )}
      </ol>
    </div>
  )
}

function Features() {
  return (
    <>
      <section className="row head" aria-labelledby="does">
        <Margin no="02" title="What it does" id="does" />
      </section>
      {features.map(({ title, text, next, plates }, i) => (
        <section className="row item" key={title}>
          <div className="margin" ref={reveal}>
            <span className="no">02.{i + 1}</span>
            <h3>{title}</h3>
            <p>{text}</p>
            {next !== undefined && (
              <p className="later">
                <span className="tag">next</span> {next}
              </p>
            )}
          </div>
          <div className="body">
            <Figure plates={plates} />
          </div>
        </section>
      ))}
    </>
  )
}

function BuiltWith() {
  return (
    <section className="row built" aria-labelledby="built">
      <Margin no="03" title="Built with" id="built" />
      <p className="body" ref={reveal}>
        {stack.map(([name, href], i) => (
          <span key={name}>
            <a href={href}>{name}</a>
            {i < stack.length - 2 ? ", " : i === stack.length - 2 ? " and " : "."}
          </span>
        ))}
      </p>
    </section>
  )
}

function Roadmap() {
  return (
    <section className="row roadmap" aria-labelledby="roadmap">
      <Margin no="04" title="Roadmap" id="roadmap" />
      <div className="body">
        <ul className="stages">
          {roadmap.map(([when, what]) => (
            <li key={when} ref={reveal} className={when}>
              <span className="when">{when}</span>
              <span>{what}</span>
            </li>
          ))}
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
