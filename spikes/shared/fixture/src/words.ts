export const words = `the of and to in is that for it as with was on be at by this had not are but from or have
an they which one you were all we her she there been if more when will would who so no about up out them some
could into than then its time only new now also see may way like over think back after use two how our work first
well even want because any these give day most us idea note plan draft review meeting call follow fix ship test read
write build design check update team project goal week today tomorrow later progress blocked done open question
answer reason result detail summary context decision tradeoff option risk issue bug feature release version change
data model query index sync file page block link graph outline journal task habit book article paper quote thought
learn study research experiment measure compare improve simplify refactor deploy monitor budget schedule deadline
customer user feedback interview survey metric growth retention launch roadmap milestone sprint backlog priority
health sleep run walk gym recipe coffee travel flight hotel trip family friend birthday gift movie music podcast
garden house rent car repair invoice tax bank savings account password server laptop phone keyboard editor
remember consider explore prototype sketch outline organize capture archive tag filter sort search share export
import publish draft polish edit rewrite clarify scope estimate assign track finish start pause resume cancel`
  .split(/\s+/)
  .filter(Boolean)

export const adjectives = `quick deep daily weekly monthly personal shared open private core local remote async
simple modern classic raw rough final early late main side quiet loud dark bright small large tiny huge
red blue green golden silver hidden public secret old new future past next last first second third
fast slow smart lazy careful bold calm wild clear fuzzy sharp soft hard light heavy`
  .split(/\s+/)
  .filter(Boolean)

export const nouns = `notes ideas reading list books papers projects goals habits recipes travel trips meetings
people contacts tools apps systems design architecture database queries sync engine editor outliner
garden journal inbox backlog roadmap research learning writing music movies podcasts fitness health
finance budget taxes home car work career hiring team process review retro planning strategy vision
product launch release marketing sales support docs api cli server client mobile desktop web cloud
storage cache index search graph network security privacy keys backups photos videos art sketches`
  .split(/\s+/)
  .filter(Boolean)

export const namespaces = ["area", "project", "person", "topic", "ref", "meeting"]

export const propertyKeys = ["type", "status", "tags", "alias", "source", "author", "rating", "priority", "url", "created"]

export const propertyValues = ["active", "paused", "done", "idea", "book", "article", "person", "project", "high", "low", "medium", "5", "4", "3"]

export const markers = ["TODO", "DOING", "DONE", "LATER", "NOW", "WAITING", "CANCELED"]

export const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
