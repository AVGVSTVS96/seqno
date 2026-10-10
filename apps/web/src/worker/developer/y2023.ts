import type { StarterFile } from "../place.ts"
import { ids, on, post, pr, thumb, video, yt } from "./kit.ts"

export const y2023: ReadonlyArray<StarterFile> = [
  on(
    20220528,
    `- ${yt("The Most Horrifying Science Fiction Series of All", "2ye02qGiKKY")} [[Quinn's Ideas]] [[sci-fi]]`,
    "\t- this is how I found the Three-Body books. read them right after",
    "\t- basically the reason I want to live to 1,000",
    `\t  id:: ${ids.thousandYears}`,
    `\t- ${video("2ye02qGiKKY")}`,
  ),
  on(
    20230109,
    "- day one of CS50. first commits in the course codespace [[learning to code]]",
    "- 250 commits there by the end of the month",
  ),
  on(
    20230130,
    `- ${yt("Should you use RUST as your FIRST programming language?", "L576AckqIZg")} [[ThePrimeagen]]`,
    "\t- three weeks into CS50",
  ),
  on(20230131, "- first pull request ever, on GitHub's desktop tutorial repo [[learning to code]]"),
  on(
    20230220,
    `- ${yt("Why I use Vim in 2022", "D4YTJ2W5q4Y")} and the vimtutor speedrun [[ThePrimeagen]] [[terminal]]`,
    "\t- my first vim videos",
  ),
  on(
    20230310,
    "- keyboard rabbit hole [[keyboards]]",
    `\t- ${yt("the COOLEST mechanical keyboard | Mojo 68", "FRMOM_lfgPw")}`,
    `\t- ${yt("I Wish I Had Known This Before I Bought My First Custom Mechanical Keyboard", "9P74eCU19d0")}`,
    "\t- hot-swap boards: you can pull a switch out without soldering",
    '\t- next day: NuPhy Air75, Gazzew U4Tx "half-thock" switches',
  ),
  on(20230315, '- first real project: my site, in Flask. "Flask App V1!" [[projects/portfolio]]'),
  on(
    20230319,
    "- note app rabbit hole, week three. Obsidian or Logseq? [[notes apps]]",
    `  id:: ${ids.logseqHole}`,
    `\t- ${yt("Logseq vs Obsidian", "TW_UpX5Gk3E")}, ${yt("How to use queries and indentation in Logseq", "qQ8DzumRZkM")}`,
    "\t- started on Mar 4 with Obsidian plugins, Zettelkasten and maps of content. ~50 videos later I'm reading about Logseq queries",
    "\t- outliner, every block linkable, plain markdown files underneath",
  ),
  on(
    20230323,
    `- I want to build something but everything is moving so fast. said so on X ${post("1639040642180415488")}`,
    `- ${yt("Astro IS SO GOOD", "Sqp5VSqbQOY")} [[ThePrimeagen]]`,
  ),
  on(
    20230331,
    "- saved: [the steel man technique](https://constantrenewal.com/steel-man). argue against the best version of the other side, not the weakest",
  ),
  on(
    20230407,
    `- ${yt("Forgotten Futures: Understanding the Magic of Mechanical Keyboards", "EYGoXXNhj4U")} [[Ryan Norbauer]] [[keyboards]]`,
    `\t- ${thumb("Forgotten Futures", "EYGoXXNhj4U")}`,
  ),
  on(
    20230421,
    `- LLMs can't plan. they imitate planning. argued it in Yann LeCun's replies ${post("1649297742538080258")}`,
  ),
  on(
    20230519,
    "- FastGPT: my GPT chat app moves from Flask to FastAPI #decision #fastgpt",
    "\t- async requests, so several API calls run at once, and responses stream",
    "\t- type checking and request validation for free",
    `\t- ${pr("AVGVSTVS96/fastgpt", 1)}`,
  ),
  on(
    20230528,
    "- a GitHub Action copies FastGPT's chat.js and interface.js into FlaskGPT #decision #fastgpt",
    "\t- two backends, one frontend. a fix lands once and both apps get it",
    `\t- reviewed my own PR: "This looks like it worked perfectly, I like this Github Action a lot!" ${pr("AVGVSTVS96/flaskgpt", 19)}`,
  ),
  on(
    20230530,
    "- reactGPT: same app, React frontend. Prism highlighting in a `CodeHighlight` component [[projects/fastgpt]]",
    "- autoscroll stops when you scroll up, comes back when you return to the bottom #decision #fastgpt",
    "\t- you can read an old answer while a new one streams in",
    `\t- a \`useAutoScroll\` hook. ${pr("AVGVSTVS96/reactgpt", 6)}`,
  ),
  on(
    20230601,
    "- Historia Civilis week: Caesar's funeral, Philippi, Actium, the Rubicon, Pompey's fall [[Historia Civilis]] [[history]]",
    `\t- ${yt("Caesar Crosses the Rubicon", "SYxN134gb-8")}`,
  ),
  on(
    20230609,
    "- idea: visionOS keeps going until it's an OS on the phone streaming to contact lenses. sensors in earbuds #idea",
    `\t- ${post("1667266779985346563")}`,
  ),
  on(
    20230606,
    "- astrosite: version 3 of my site, Astro and Tailwind, my first multi-page app [[projects/portfolio]]",
  ),
  on(20230710, `- ${yt("Games that Don't Fake the Space", "Q85l1Fenc5w")} [[Jacob Geller]]`),
  on(
    20230718,
    `- ${yt("Neuromancer: The Origin of Cyberpunk", "HGW_7HTXuQo")} [[Quinn's Ideas]] [[sci-fi]]`,
  ),
  on(
    20230720,
    `- ${yt("The Man Who Gave us the Power To Destroy Ourselves", "Xzv84ZdtlE0")}, Veritasium on Oppenheimer, the week the film came out`,
  ),
  on(
    20230723,
    "- exurb1a evening [[exurb1a]]",
    `\t- ${yt("The Moon is a Door to Forever", "K3X2Fv-c3Fc")}`,
    `\t- ${yt("Buddhism is Kinda Out There, Man", "i2wLyhgeYsw")}`,
  ),
  on(
    20230728,
    `- ${yt("Foundation: Are We Predictable?", "xWWnUzV2NmU")}, Oliver Lugg, an hour on psychohistory [[sci-fi]]`,
    "\t- are people predictable? yes, for sure. a huge topic of contention",
    `\t- ${thumb("Foundation: Are We Predictable?", "xWWnUzV2NmU")}`,
  ),
  on(
    20230822,
    `- ${yt("How Will We Know When AI is Conscious?", "VQjPKqE39No")} [[exurb1a]] [[philosophy]]`,
  ),
  on(
    20230909,
    `- ${yt("The world's biggest problem? Powerful psychopaths.", "3eBN_9rMoVI")} [[Brian Klaas]] on Big Think [[systems of power]]`,
  ),
  on(
    20231002,
    "- new Historia Civilis video!! [[Historia Civilis]]",
    `\t- ${yt("Work.", "hvk_XylEmLo")}`,
    "\t- learned a lot about how work started. want to know more about where and when it happened, the details [[history]]",
  ),
  on(
    20231013,
    `- ${yt("Why do the worst people rise to power?", "rlg-MXR5amQ")} [[Brian Klaas]] [[systems of power]]`,
  ),
  on(
    20231022,
    "- Like Stories of Old night [[philosophy]]",
    `\t- ${yt("The Philosophy of Sense8", "NiVwHbtdXns")}`,
    `\t- ${yt("Multiverses, Nihilism, and How it Feels to be Alive Right Now", "Gx6hZ01xYVM")}`,
  ),
  on(
    20231208,
    "- exurb1a metaphysics night [[exurb1a]] [[philosophy]]",
    `\t- ${yt("How Long is Now?", "8HzIlKe--NU")}`,
    `\t- ${yt("The Ants", "Et6itTuJSYY")}`,
    `\t- ${yt("10,000 More Years of the Scientific Method", "qE0UimODxNg")}`,
  ),
  on(
    20231218,
    "- moved the Flask site into Astro as a page of its own [[projects/portfolio]]",
    `\t- ${pr("AVGVSTVS96/astroSite", 3)}`,
    "- table of contents for blog posts next",
  ),
]
