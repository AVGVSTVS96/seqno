export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const PROPERTY = /^([^\s:]+)::(?:[ \t]+(.*?))?[ \t]*$/
export const MARKER =
  /^(TODO|DOING|DONE|LATER|NOW|WAITING|WAIT|CANCELED|CANCELLED|IN-PROGRESS|STARTED)(?=[ \t]|$)/
export const PRIORITY = /\[#([ABC])\]/
export const HEADING = /^(#{1,6})[ \t]/
export const PLANNING_LINE = /^[ \t]*(?:(?:SCHEDULED|DEADLINE): <[^>\n]*>[ \t]*)+$/
export const MACRO = /\{\{([^\s{}]+)(?:[ \t]+((?:(?!\}\})[^\n])*))?\}\}/g
export const BLOCK_REF = /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/gi
export const TAG = /(?<=^|[\s,(])#(?!\[\[)([^\s#,;!?"'()[\]{}+][^\s,;!?"'()[\]{}]*)/g
export const TAG_TRAILER = /[.:]+$/
export const INLINE_CODE = /`[^`\n]*`/g
export const LIST_KEYS = new Set(["tags", "alias"])
