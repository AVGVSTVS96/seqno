import { repo } from "./github.ts"

export const app = "/app/"

export function Actions() {
  return (
    <nav className="pills" aria-label="Try seqno">
      <a className="pill" href={app}>
        Try it in your browser
      </a>
      <a className="pill ghost" href={repo}>
        GitHub
      </a>
    </nav>
  )
}
