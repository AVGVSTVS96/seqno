title:: Title Property Wins
tags:: book, [[Reading List]]
type:: book

- the page name comes from title:: and not from the file name
- collapsed parent
  collapsed:: true
	- hidden child
- block with a code fence
  ```ts
  const a = "- not a block"
  ```
- block with a table
  | a | b |
  | 1 | 2 |
- block with a quote
  > quoted line
- inline formatting **bold** _italic_ ~~strike~~ ^^highlight^^ `code` $$e=mc^2$$
- links [label](https://example.com) <https://example.com/auto> [[page ref]] #tag #[[multi word tag]]
- macros {{video https://example.com/v.mp4}} {{renderer :todomaster}}
