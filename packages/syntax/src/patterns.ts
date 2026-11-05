export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
export const PROPERTY = /^([^\s:]+)::(?:[ \t]+(.*?))?[ \t]*$/u

export const MARKER =
  /^(TODO|DOING|DONE|LATER|NOW|WAITING|WAIT|CANCELED|CANCELLED|IN-PROGRESS|STARTED)(?=[ \t]|$)/u

export const PRIORITY = /\[#([ABC])\]/u
export const HEADING = /^(#{1,6})[ \t]/u
export const PLANNING_LINE = /^[ \t]*(?:(?:SCHEDULED|DEADLINE): <[^>\n]*>[ \t]*)+$/u
export const MACRO = /\{\{([^\s{}]+)(?:[ \t]+((?:(?!\}\})[^\n])*))?\}\}/gu
export const BLOCK_REF = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/giu
export const TAG = /(?<=^|[\s,(])#(?!\[\[)([^\s#,;!?"'()[\]{}+][^\s,;!?"'()[\]{}]*)/gu
export const TAG_TRAILER = /[.:]+$/u
export const INLINE_CODE = /`[^`\n]*`/gu
export const LIST_KEYS = new Set(["tags", "alias"])
