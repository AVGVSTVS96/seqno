- {{query (task TODO DOING)}}
- {{query (and [[project/Alpha]] (task NOW LATER))}}
- {{query (and (page-property type book) (property status active))}}
- {{query (between -7d today)}}
- {{query "full text search"}}
- #+BEGIN_QUERY
  {:title "Advanced query"
   :query [:find (pull ?b [*])
           :where [?b :block/marker "TODO"]]}
  #+END_QUERY
- ```dataview
  TABLE status FROM #book WHERE status = "active"
  ```
