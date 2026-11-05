# seqno site

The homepage, live at [seqno.vercel.app](https://seqno.vercel.app). `pnpm build` at the root builds it into `apps/site/dist` and the app into `apps/site/dist/app`, so the page and the app share an origin and the live demo on the page shares its storage with the app.

- `brand/`: the logo, palette, type and how they're used ([BRAND.md](../../brand/BRAND.md)), and in `brand/copy/` the words on the page and the launch post
- `tools/e2e/design/site/`: the scripts that capture the page's loops and stills from the real app

## Credits

The hero is directly inspired by the opening screen of [Buzz](https://buzz.xyz), Block's open-source app: one bold field color, an oversized grainy wordmark, a faint dot grid and little creatures that fly around and flee the cursor. The cursor-shy bees are Wes Billman's ([@wesbillman](https://github.com/wesbillman)), from Buzz's landing screen in [block/buzz#1982](https://github.com/block/buzz/pull/1982). seqno's version swaps the bees for outline bullets that settle into outlines. Everything else it borrows is listed in [brand/references.md](../../brand/references.md).
