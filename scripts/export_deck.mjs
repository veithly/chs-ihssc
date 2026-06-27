#!/usr/bin/env node
// Re-export the in-repo 价序 HTML deck viewer (docs/deck/index.html) to a 16:9 PDF + per-slide PNGs.
import { chromium } from "playwright";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DECK = join(ROOT, "docs", "deck", "index.html");
const OUT = join(ROOT, "docs", "deck");
const SLIDES = join(OUT, "slides");
rmSync(SLIDES, { recursive: true, force: true });
mkdirSync(SLIDES, { recursive: true });

const main = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
  });
  await page.goto(pathToFileURL(DECK).href, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "screen" });
  await page.addStyleTag({
    content: `
      .bar { display: none !important; }
      html, body { background: #fff !important; }
      .deck { max-width: none !important; margin: 0 !important; padding: 0 !important; }
      .slide { margin: 0 !important; border: 0 !important; box-shadow: none !important; }
    `,
  });
  await page.waitForTimeout(400);

  // Multi-page 16:9 PDF (one .slide per page via break-after).
  await page.pdf({
    path: join(OUT, "jiaxu-deck.pdf"),
    width: "1280px",
    height: "720px",
    printBackground: true,
    pageRanges: "",
  });
  console.log("  pdf  docs/deck/jiaxu-deck.pdf");

  // Per-slide PNGs at 2x.
  const slides = await page.$$(".slide");
  let i = 0;
  for (const s of slides) {
    i += 1;
    const name = `slide-${String(i).padStart(2, "0")}.png`;
    await s.screenshot({ path: join(SLIDES, name) });
    console.log("  png ", `docs/deck/slides/${name}`);
  }
  await browser.close();

  const python = join(ROOT, ".ppt-build", "venv", "bin", "python");
  if (existsSync(python)) {
    const code = `
from pathlib import Path
from pptx import Presentation
from pptx.util import Inches

slides_dir = Path(r"${SLIDES}")
out = Path(r"${join(OUT, "jiaxu-deck.pptx")}")
prs = Presentation()
prs.slide_width = Inches(13.333333)
prs.slide_height = Inches(7.5)
blank = prs.slide_layouts[6]
for image in sorted(slides_dir.glob("slide-*.png")):
    slide = prs.slides.add_slide(blank)
    slide.shapes.add_picture(str(image), 0, 0, width=prs.slide_width, height=prs.slide_height)
prs.save(out)
print("  pptx docs/deck/jiaxu-deck.pptx")
`;
    execFileSync(python, ["-c", code], { stdio: "inherit" });
  }
  console.log(`[deck] done -> ${i} slides + PDF + PPTX`);
};

main().catch((e) => {
  console.error("[deck] error:", e.message);
  process.exit(1);
});
