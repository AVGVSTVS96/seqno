import { useAtomValue } from "@effect/atom-react"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import Reveal from "reveal.js"
import revealCss from "reveal.js/reveal.css?inline"
import blackCss from "reveal.js/theme/black.css?inline"
import type { Block, Page } from "@seqno/domain"
import { logseq } from "@seqno/dom"
import { pageTreeAtom, StaticBlock } from "@seqno/outliner"
import type { PageTree } from "@seqno/rpc"
import { assetResolver, pageNamed } from "../../atoms.ts"
import { useNavigateTo } from "./navigation.ts"
import slidesCss from "./slides.css?inline"

interface Slide {
  readonly block: Block
  readonly below: readonly Block[]
}

const slidesOf = (tree: PageTree): readonly Slide[] => {
  const children = Map.groupBy(tree.blocks, (block) => block.parentId)

  const below = (block: Block): readonly Block[] =>
    (children.get(block.id) ?? []).flatMap((child) => [child, ...below(child)])

  const top = children.get(null) ?? []

  return (tree.page.journalDay === null ? top : top.slice(1)).map((block) => ({
    block,
    below: below(block),
  }))
}

const dataOf = (block: Block): Record<`data-${string}`, string> =>
  Object.fromEntries(
    Object.entries(block.props).map(([key, value]) => [
      `data-${key}`.replace("data-data-", "data-"),
      value,
    ]),
  )

const Deck = ({ tree }: { readonly tree: PageTree }) => {
  const onNavigate = useNavigateTo()
  const resolveAsset = useAtomValue(assetResolver)
  const slides = slidesOf(tree)

  const shown = (block: Block) => (
    <StaticBlock
      block={block}
      onNavigate={onNavigate}
      resolveAsset={resolveAsset}
      codeStyle="highlight.js"
    />
  )

  return (
    <div
      {...logseq("seqno-slides-deck")}
      key={slides.map(({ block, below }) => [block, ...below].map(({ text }) => text)).join("\n")}
      ref={(element) => {
        if (element === null) {
          return
        }

        const deck = new Reveal(element, {
          embedded: true,
          controls: true,
          history: false,
          center: true,
          transition: "slide",
          keyboardCondition: "focused",
          scrollActivationWidth: 0,
        })

        void deck.initialize()

        return () => {
          deck.destroy()
        }
      }}
    >
      <div {...logseq("seqno-slides-list")}>
        {slides.map(({ block, below }) =>
          below.length === 0 ? (
            <section key={block.id} {...dataOf(block)}>
              {shown(block)}
            </section>
          ) : (
            <section key={block.id} {...dataOf(block)}>
              <section>{shown(block)}</section>
              {below.map((child) => (
                <section key={child.id} {...dataOf(child)}>
                  {shown(child)}
                </section>
              ))}
            </section>
          ),
        )}
      </div>
    </div>
  )
}

const PageSlides = ({ page }: { readonly page: Page }) =>
  AsyncResult.match(useAtomValue(pageTreeAtom(page.id)), {
    onInitial: () => null,
    onFailure: () => <p className="sidebar-item-problem">This page could not be loaded.</p>,
    onSuccess: ({ value }) => <Deck tree={value} />,
  })

export const Slides = ({ name }: { readonly name: string }) => {
  const page = Option.getOrUndefined(
    AsyncResult.getOrElse(useAtomValue(pageNamed(name)), () => Option.none()),
  )

  return (
    <div {...logseq("seqno-slides")}>
      <style href="seqno/slides" precedence="pages">
        {revealCss + blackCss + slidesCss}
      </style>
      <p className="seqno-slides-tip">
        Tip: press <code>f</code> to go fullscreen
      </p>
      {page === undefined ? null : <PageSlides page={page} />}
    </div>
  )
}
