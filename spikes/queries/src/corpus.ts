export type Origin = "logseq-simple" | "logseq-advanced" | "dataview"

export interface Entry {
  readonly id: string
  readonly title: string
  readonly covers: string
  readonly origin: Origin
  readonly source: string
  readonly original: string
  readonly fixture?: string
  readonly simple?: string
  readonly dql?: string
  readonly edn?: string
  readonly page?: string
  readonly missing?: string
}

const LOGSEQ_DOCS_SIMPLE = "https://github.com/logseq/docs/blob/master/pages/Queries.md"
const LOGSEQ_DOCS_ADVANCED = "https://github.com/logseq/docs/blob/master/pages/Advanced%20Queries.md"
const DATAVIEW_QUERY_TYPES = "https://github.com/blacksmithgu/obsidian-dataview/blob/master/docs/docs/queries/query-types.md"
const DATAVIEW_COMMANDS = "https://github.com/blacksmithgu/obsidian-dataview/blob/master/docs/docs/queries/data-commands.md"
const OPEN = "todo, doing, now, later, waiting"

export const corpus: ReadonlyArray<Entry> = [
  {
    id: "Q01",
    title: "Tasks by status",
    covers: "tasks by status",
    origin: "logseq-simple",
    source: LOGSEQ_DOCS_SIMPLE,
    original: "{{query (task now later)}}",
    simple: "{{query (task now later)}}",
    dql: "LIST WHERE task.status IN (now, later)",
    edn: "{:where [[:task.status #{:now :later}]]}",
  },
  {
    id: "Q02",
    title: "ACTIVE: NOW/DOING tasks on journals of the last 2 weeks, by priority",
    covers: "tasks + journal date window + sort",
    origin: "logseq-advanced",
    source: LOGSEQ_DOCS_ADVANCED,
    original: `{:title "🟢 ACTIVE"
 :query [:find (pull ?b [*])
         :in $ ?start ?today
         :where
         (task ?b #{"NOW" "DOING"})
         (between ?b ?start ?today)]
 :inputs [:-2w :today]
 :result-transform (fn [result]
                     (sort-by (fn [h]
                                (get h :block/priority "Z")) result))
 :collapsed? false}`,
    simple: "{{query (and (task now doing) (between -2w today) (sort-by priority asc))}}",
    dql: "LIST WHERE task.status IN (now, doing) AND page.day BETWEEN -2w AND today SORT task.priority ASC",
    edn: "{:where [[:task.status #{:now :doing}] [:page.day :between :-2w :today]] :sort-by [[:task.priority :asc]]}",
  },
  {
    id: "Q03",
    title: "Next 7 days' deadline or schedule",
    covers: "scheduled/deadline window + table view",
    origin: "logseq-advanced",
    source: LOGSEQ_DOCS_ADVANCED,
    original: `{:title "next 7 days' deadline or schedule"
 :query [:find (pull ?block [*])
         :in $ ?start ?next
         :where
         (or
           [?block :block/scheduled ?d]
           [?block :block/deadline ?d])
         [(> ?d ?start)]
         [(< ?d ?next)]]
 :inputs [:today :+7d]
 :collapsed? false}`,
    simple:
      "{{query (or (between task.scheduled today +7d) (between task.deadline today +7d)) (view table task.scheduled task.deadline page)}}",
    dql: "TABLE task.scheduled, task.deadline, page WHERE task.scheduled BETWEEN today AND +7d OR task.deadline BETWEEN today AND +7d",
    edn: "{:where [(or [:task.scheduled :between :today :+7d] [:task.deadline :between :today :+7d])] :view [:table :task.scheduled :task.deadline :page]}",
  },
  {
    id: "Q04",
    title: "Open tasks with a tag, as a board",
    covers: "tasks + tag + board view",
    origin: "dataview",
    source: DATAVIEW_QUERY_TYPES,
    original: 'TASK\nWHERE !completed AND contains(tags, "#shopping")',
    fixture: "#shopping -> #database",
    simple: `{{query (and (task ${OPEN.replaceAll(",", "")}) (tag database)) (view board task.status)}}`,
    dql: `BOARD BY task.status WHERE task.status IN (${OPEN}) AND tag = database`,
    edn: "{:where [[:task.status #{:todo :doing :now :later :waiting}] [:tag \"database\"]] :view [:board :task.status]}",
  },
  {
    id: "Q05",
    title: "All open tasks grouped by page",
    covers: "tasks + group by (large result: ~3.6k rows)",
    origin: "dataview",
    source: DATAVIEW_QUERY_TYPES,
    original: "TASK\nWHERE !completed\nGROUP BY file.link",
    simple: `{{query (task ${OPEN.replaceAll(",", "")}) (group-by page)}}`,
    dql: `LIST WHERE task.status IN (${OPEN}) GROUP BY page`,
    edn: "{:where [[:task.status #{:todo :doing :now :later :waiting}]] :group-by :page}",
  },
  {
    id: "Q06",
    title: "Blocks with a property value",
    covers: "property filter",
    origin: "logseq-advanced",
    source: LOGSEQ_DOCS_ADVANCED,
    original: `{:title [:h2 "Programming languages list"]
 :query [:find (pull ?b [*])
         :where
         (property ?b :type "programming_lang")]}`,
    fixture: "programming_lang -> book",
    simple: "{{query (property type book)}}",
    dql: "LIST WHERE property.type = book",
    edn: '{:where [[:property.type "book"]]}',
  },
  {
    id: "Q07",
    title: "Table of pages in a folder/namespace with their properties, sorted",
    covers: "pages + namespace + page properties + table + sort",
    origin: "dataview",
    source: "https://blacksmithgu.github.io/obsidian-dataview/resources/examples/",
    original: 'TABLE time-played AS "Time Played", length AS "Length", rating AS "Rating"\nFROM "games"\nSORT rating DESC',
    fixture: '"games" folder -> project/ namespace; time-played/length -> type',
    simple: "{{query (pages (namespace project) (sort-by page.property.rating desc) (view table page.property.type page.property.rating))}}",
    dql: 'TABLE PAGES page.property.type, page.property.rating FROM "project" SORT page.property.rating DESC',
    edn: '{:find :pages :where [[:page.namespace "project"]] :sort-by [[:page.property.rating :desc]] :view [:table :page.property.type :page.property.rating]}',
  },
  {
    id: "Q08",
    title: "TODO tasks referencing the current page",
    covers: "backlinks + filter (current page)",
    origin: "logseq-advanced",
    source: LOGSEQ_DOCS_ADVANCED,
    original: `{:title "All tasks tagged using current page"
 :query [:find (pull ?b [*])
         :in $ ?current-page
         :where
         [?p :block/name ?current-page]
         [?b :block/refs ?p]
         (task ?b #{"TODO"})]
 :inputs [:current-page]}`,
    page: "database",
    simple: "{{query (and (ref @page) (task todo))}}",
    dql: "LIST WHERE ref = @page AND task.status = todo",
    edn: "{:where [[:ref :current-page] [:task.status :todo]]}",
  },
  {
    id: "Q09",
    title: "Journal blocks of the last 7 days that reference a page",
    covers: "inherited page reference + journal date window",
    origin: "logseq-advanced",
    source: LOGSEQ_DOCS_ADVANCED,
    original: `{:title "Journal blocks in last 7 days with a page reference of datalog"
 :query [:find (pull ?b [*])
         :in $ ?start ?today ?tag
         :where
         (between ?b ?start ?today)
         (page-ref ?b ?tag)]
 :inputs [:-7d :today "datalog"]}`,
    fixture: "datalog -> architecture",
    simple: "{{query (and [[architecture]] (between -7d today))}}",
    dql: "LIST FROM [[architecture]] WHERE page.day BETWEEN -7d AND today",
    edn: '{:where [(page-ref "architecture") [:page.day :between :-7d :today]]}',
  },
  {
    id: "Q10",
    title: "TODOs on every page under a namespace (any depth)",
    covers: "namespace / page hierarchy",
    origin: "logseq-advanced",
    source: "https://discuss.logseq.com/t/advanced-querying-all-todos-from-the-pages-that-contains-parent-namespace-project/9393",
    original: `{:title "FInd By Namespace"
:query [:find (pull ?b [*])
:where
[?p :block/namespace ?ns]
[?ns :block/name ?nsn]
[(contains? #{"projects"} ?nsn)]
[?b :block/page ?p]
(task ?b #{"TODO"})
]
}`,
    fixture: "projects -> project",
    simple: "{{query (and (namespace project) (task todo))}}",
    dql: 'LIST FROM "project" WHERE task.status = todo',
    edn: '{:where [[:page.namespace "project"] [:task.status :todo]]}',
  },
  {
    id: "Q11",
    title: "TODOs nested anywhere under a matching block",
    covers: "recursive descendants",
    origin: "logseq-advanced",
    source: "https://discuss.logseq.com/t/advanced-query-for-showing-all-tasks-on-the-same-level-as-the-query-and-below/18768",
    original: `#+BEGIN_QUERY
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
#+END_QUERY`,
    fixture: '"v23-05" -> "release"; the thread combines posts #2 and #4',
    simple: '{{query (and (task todo) (under "release"))}}',
    dql: 'LIST WHERE task.status = todo AND UNDER (text MATCHES "release")',
    edn: '{:where [[:task.status :todo] (under (text "release"))]}',
  },
  {
    id: "Q12",
    title: "TODOs that are not under a DOING task",
    covers: "recursive ancestors + negation",
    origin: "logseq-advanced",
    source: "https://discuss.logseq.com/t/advanced-query-for-tasks-not-under-doing/26635",
    original: `{:title "Test"
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
}`,
    simple: "{{query (and (task todo) (not (under (task doing))))}}",
    dql: "LIST WHERE task.status = todo AND NOT UNDER (task.status = doing)",
    edn: "{:where [[:task.status :todo] (not (under [:task.status :doing]))]}",
  },
  {
    id: "Q13",
    title: "Blocks containing a word that are not tasks",
    covers: "full-text + filter",
    origin: "logseq-advanced",
    source: LOGSEQ_DOCS_ADVANCED,
    original: `{:title "Blocks containing TODO that are not tasks"
 :query [:find (pull ?b [*])
         :in $ ?query %
         :where
         (block-content ?b ?query)
         (not-task ?b)]
         :inputs ["TODO"
                  [[(not-task ?b)
                    (not [?b :block/marker _])]]]}`,
    fixture: '"TODO" -> "deploy" (the fixture only uses TODO as a marker)',
    simple: '{{query (and "deploy" (not (task.status)))}}',
    dql: 'LIST WHERE text MATCHES "deploy" AND NOT task.status',
    edn: '{:where [(text "deploy") (not [:task.status])]}',
  },
  {
    id: "Q14",
    title: "Pages that have a tag",
    covers: "page tags (pages result)",
    origin: "logseq-advanced",
    source: LOGSEQ_DOCS_ADVANCED,
    original: `{:title "All pages have a *programming* tag"
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
          [:a {:href (str "#/page/" page)} (clojure.string/capitalize page)])])}`,
    fixture: "programming -> Hidden Finance",
    simple: '{{query (page-tags "Hidden Finance")}}',
    dql: 'LIST PAGES WHERE page.tag = "Hidden Finance"',
    edn: '{:find :pages :where [[:page.tag "Hidden Finance"]]}',
  },
  {
    id: "Q15",
    title: "Recently modified",
    covers: "updated time + sort",
    origin: "dataview",
    source: DATAVIEW_COMMANDS,
    original: "LIST WHERE file.mtime >= date(today) - dur(1 day)",
    simple: "{{query (and (updated >= -1d) (sort-by updated desc))}}",
    dql: "LIST WHERE updated >= -1d SORT updated DESC",
    edn: "{:where [[:updated :>= :-1d]] :sort-by [[:updated :desc]]}",
  },
  {
    id: "Q16",
    title: "Blocks referencing any page that has a property (by name or alias)",
    covers: "refs joined to page properties",
    origin: "logseq-advanced",
    source: "https://discuss.logseq.com/t/blocks-that-reference-pages-of-some-property-by-name-or-alias/27490",
    original: `{:query [:find (pull ?b [*])
   :where
     [?p :block/properties ?props]
     [(get ?props :type) ?type]
     [(= ?type "commontype")]
     (or-join [?b ?p]
       [?b :block/refs ?p]
       (and
         [?b :block/refs ?a]
         [?p :block/alias ?a]))]}`,
    missing:
      "The model can't filter on properties of the page a block references (needs a `ref.page.property.type` style field or a RefTo{page filter} node). Aliases themselves are handled.",
  },
  {
    id: "Q17",
    title: "Count blocks on the current page",
    covers: "aggregates",
    origin: "logseq-advanced",
    source: LOGSEQ_DOCS_ADVANCED,
    original: `{:title "Count number of blocks in the current page"
 :query [:find (count ?b)
         :in $ ?current-page
         :where
         [?p :block/name ?current-page]
         [?b :block/page ?p]]
 :inputs [:current-page]}`,
    missing: "No aggregates. Every result view shows its row count, so `(page @page)` gives the number; sums/averages over properties are not covered.",
  },
  {
    id: "Q18",
    title: "Custom rendering with a :view function",
    covers: "user code in views",
    origin: "logseq-advanced",
    source: LOGSEQ_DOCS_ADVANCED,
    original: `{:title "All page tags"
:query [:find ?tag-name
        :where
        [?tag :block/name ?tag-name]]
:view (fn [tags]
      [:div
       (for [tag (flatten tags)]
         [:a.tag.mr-1 {:href (str "#/page/" tag)}
          (str "#" tag)])])}`,
    missing: "By design: views are declared (list/table/board), never user code. Listing every page name is `LIST PAGES`.",
  },
]

export const expressible = corpus.filter((e) => e.missing === undefined)
