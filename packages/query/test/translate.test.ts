import { Result } from "effect"
import { describe, expect, it } from "vitest"
import { printLogseqQuery, translateAdvancedQuery } from "../src/index.ts"

const Q02 = `{:title "🟢 ACTIVE"
 :query [:find (pull ?b [*])
         :in $ ?start ?today
         :where
         (task ?b #{"NOW" "DOING"})
         (between ?b ?start ?today)]
 :inputs [:-2w :today]
 :result-transform (fn [result]
                     (sort-by (fn [h]
                                (get h :block/priority "Z")) result))
 :collapsed? false}`

const Q03 = `{:title "next 7 days' deadline or schedule"
 :query [:find (pull ?block [*])
         :in $ ?start ?next
         :where
         (or
           [?block :block/scheduled ?d]
           [?block :block/deadline ?d])
         [(> ?d ?start)]
         [(< ?d ?next)]]
 :inputs [:today :+7d]
 :collapsed? false}`

const Q06 = `{:title [:h2 "Programming languages list"]
 :query [:find (pull ?b [*])
         :where
         (property ?b :type "programming_lang")]}`

const Q08 = `{:title "All tasks tagged using current page"
 :query [:find (pull ?b [*])
         :in $ ?current-page
         :where
         [?p :block/name ?current-page]
         [?b :block/refs ?p]
         (task ?b #{"TODO"})]
 :inputs [:current-page]}`

const Q09 = `{:title "Journal blocks in last 7 days with a page reference of datalog"
 :query [:find (pull ?b [*])
         :in $ ?start ?today ?tag
         :where
         (between ?b ?start ?today)
         (page-ref ?b ?tag)]
 :inputs [:-7d :today "datalog"]}`

const Q10 = `{:title "FInd By Namespace"
:query [:find (pull ?b [*])
:where
[?p :block/namespace ?ns]
[?ns :block/name ?nsn]
[(contains? #{"projects"} ?nsn)]
[?b :block/page ?p]
(task ?b #{"TODO"})
]
}`

const Q11 = `#+BEGIN_QUERY
{:title ["Find child blocks"]
 :query [:find (pull ?child [*])
   :in $ %
   :where
     [?parent :block/content ?c]
     [(clojure.string/includes? ?c "v23-05")]
     (get-children ?parent ?child)
     [?child :block/marker "TODO"]
 ]
 :rules [
   [(get-children ?parent ?child)
     [?child :block/parent ?parent]
   ]
   [(get-children ?parent ?child)
     [?t :block/parent ?parent]
     (get-children ?t ?child)
   ]
 ]
}
#+END_QUERY`

const Q12 = `{:title "Test"
:query [
	:find (pull ?h [*])
	:in $ %
	:where
	[?h :block/marker ?marker]
	[(contains? #{"TODO"} ?marker)]
	(not (check-doing ?h) )
]
:rules [
	[(check-doing ?block)
	 [?block :block/parent ?parent]
     [?parent :block/marker ?pm]
     [(contains? #{"DOING"} ?pm)]
	]
	[(check-doing ?block)
	 [?block :block/parent ?parent]
	 (check-doing ?parent)
	]
]
:remove-block-children? false
}`

const Q13 = `{:title "Blocks containing TODO that are not tasks"
 :query [:find (pull ?b [*])
         :in $ ?query %
         :where
         (block-content ?b ?query)
         (not-task ?b)]
         :inputs ["TODO"
                  [[(not-task ?b)
                    (not [?b :block/marker _])]]]}`

const Q14 = `{:title "All pages have a *programming* tag"
 :query [:find ?name
       :in $ ?tag
       :where
       [?t :block/name ?tag]
       [?p :block/tags ?t]
       [?p :block/name ?name]]
 :inputs ["programming"]
 :view (fn [result]
       [:div.flex.flex-col
        (for [page result]
          [:a {:href (str "#/page/" page)} (clojure.string/capitalize page)])])}`

const Q16 = `{:query [:find (pull ?b [*])
   :where
     [?p :block/properties ?props]
     [(get ?props :type) ?type]
     [(= ?type "commontype")]
     (or-join [?b ?p]
       [?b :block/refs ?p]
       (and
         [?b :block/refs ?a]
         [?p :block/alias ?a]))]}`

const Q17 = `{:title "Count number of blocks in the current page"
 :query [:find (count ?b)
         :in $ ?current-page
         :where
         [?p :block/name ?current-page]
         [?b :block/page ?p]]
 :inputs [:current-page]}`

const NAMESPACE_WARNING = "namespace matches every depth (Logseq's :block/namespace only matched direct children)"
const VIEW_WARNING = "custom :view dropped (views are declared, never code); showing the default list"

const translated: ReadonlyArray<readonly [name: string, source: string, printed: string, warnings: ReadonlyArray<string>]> = [
  ["docs: all tasks", '{:title "All tasks" :query [:find (pull ?b [*]) :where [?b :block/marker _]]}', "{{query (task.status)}}", []],
  ["docs: tag project", '{:query [:find (pull ?b [*]) :where [?p :block/name "project"] [?b :block/refs ?p]]}', "{{query (ref project)}}", []],
  [
    "docs: simple query inside advanced",
    '{:title "DOING tasks with priority A" :query (and (todo DOING) (priority A)) :collapsed? true}',
    "{{query (and (task doing) (priority a))}}",
    [],
  ],
  [
    "docs: children of the query block",
    "{:inputs [:current-block] :query [:find (pull ?b [*]) :in $ ?current-block :where [?b :block/parent ?current-block]]}",
    "{{query (child-of (id @block))}}",
    [],
  ],
  ["docs: plain string query", '{:title "Search" :query "release notes"}', '{{query "release notes"}}', []],
  ["Q02 inputs, rules and result-transform sort", Q02, "{{query (and (task now doing) (between -2w today)) (sort-by task.priority asc)}}", []],
  [
    "Q03 or over scheduled and deadline",
    Q03,
    "{{query (or (and (task.scheduled > today) (task.scheduled < +7d)) (and (task.deadline > today) (task.deadline < +7d)))}}",
    [],
  ],
  ["Q06 property rule", Q06, "{{query (property type programming_lang)}}", []],
  ["Q08 current page", Q08, "{{query (and (ref @page) (task todo))}}", []],
  ["Q09 page-ref and between", Q09, "{{query (and (between -7d today) [[datalog]])}}", []],
  ["Q10 namespace", Q10, "{{query (and (namespace projects) (task todo))}}", [NAMESPACE_WARNING]],
  ["Q11 recursive get-children rule", Q11, '{{query (and (under "v23-05") (task todo))}}', ['substring match "v23-05" became a word search']],
  ["Q12 recursive check-doing rule", Q12, "{{query (and (task todo) (not (under (task doing))))}}", []],
  ["Q13 rules passed as an input", Q13, '{{query (and "TODO" (not (task.status)))}}', ['substring match "TODO" became a word search']],
  ["Q14 pages with a tag", Q14, "{{query (pages (page.tag programming))}}", [VIEW_WARNING]],
]

describe("Logseq advanced queries that translate", () => {
  it.each(translated)("%s", (_, source, printed, warnings) => {
    const t = translateAdvancedQuery(source)
    expect(t._tag === "Translated" ? [printLogseqQuery(t.query), t.warnings] : t.reason).toEqual([Result.succeed(printed), warnings])
  })
})

const convertMe: ReadonlyArray<readonly [name: string, source: string, reason: string]> = [
  ["Q16 or-join", Q16, "or-join is not translated"],
  ["Q17 aggregate", Q17, ":find (count ?b) (aggregates and tuples are not supported)"],
  [
    "docs: clojure function inside a rule",
    '{:query [:find (pull ?b [*]) :in $ % :where (starts-with ?b "https://")] :rules [[(starts-with ?b ?substr) [?b :block/content ?content] [(clojure.string/starts-with? ?content ?substr)]]]}',
    'content test [(clojure.string/starts-with? ?content "https://")]',
  ],
  ["unknown attribute", "{:query [:find (pull ?b [*]) :where [?b :block/collapsed? true]]}", "attribute :block/collapsed?"],
  ["not a query map", "[:find ?b]", "not a query map"],
  ["unbalanced", "{:query [:find (pull ?b [*])", "missing ]"],
]

describe("queries that become 'convert me' blocks keep the original text and say why", () => {
  it.each(convertMe)("%s", (_, source, reason) => {
    expect(translateAdvancedQuery(source)).toEqual({ _tag: "ConvertMe", original: source, reason })
  })
})
