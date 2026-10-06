import { Fragment, type ReactNode } from "react"
import { normalizePageName, type Page } from "@seqno/domain"
import { analyzeBlock } from "@seqno/syntax"
import { listValues, visibleProps } from "./model.ts"
import { PageLink } from "./PageLink.tsx"

const listKeys = new Set(["alias", "tags"])

const refTo = (name: string, children: ReactNode) => (
  <PageLink page={{ name: normalizePageName(name), title: name }} className="seqno-ref">
    {children}
  </PageLink>
)

const InlineValue = ({ value }: { readonly value: string }) => {
  const parts: Array<ReactNode> = []
  let at = 0
  for (const ref of analyzeBlock(value).refs) {
    if (ref._tag === "BlockRef") continue
    parts.push(value.slice(at, ref.span.from))
    parts.push(
      ref._tag === "PageRef" ? (
        <span key={ref.span.from}>
          <span className="seqno-ref-bracket">[[</span>
          {refTo(ref.name, ref.name)}
          <span className="seqno-ref-bracket">]]</span>
        </span>
      ) : (
        <Fragment key={ref.span.from}>{refTo(ref.name, `#${ref.name}`)}</Fragment>
      ),
    )
    at = ref.span.to
  }
  parts.push(value.slice(at))
  return <>{parts}</>
}

const ListValue = ({ value }: { readonly value: string }) => (
  <>
    {listValues(value).map((name, index) => (
      <Fragment key={name}>
        {index > 0 ? ", " : null}
        {refTo(name, name)}
      </Fragment>
    ))}
  </>
)

export const PageProperties = ({ page }: { readonly page: Page }) => {
  const props = visibleProps(page.props)
  if (props.length === 0) return null
  return (
    <div className="seqno-page-properties">
      <div className="seqno-page-properties-control" aria-hidden>
        <span className="seqno-page-properties-bullet" />
      </div>
      <dl className="seqno-properties" aria-label="Page properties">
        {props.map(([key, value]) => (
          <div key={key} className="seqno-property">
            <dt>
              <PageLink
                page={{ name: normalizePageName(key), title: key }}
                className="seqno-property-key"
              />
            </dt>
            <dd>
              {listKeys.has(key.toLowerCase()) ? (
                <ListValue value={value} />
              ) : (
                <InlineValue value={value} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
