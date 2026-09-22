import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import {
  analyzePage,
  multiply,
  pageCoverage,
  renderScale,
  type DrawOp,
  type Matrix,
} from "../lib/jobs/pdf-page.ts";
import { extractPdf, PdfError } from "../lib/jobs/pdf.ts";

// Fixtures are built here, byte by byte. Nothing in samples/ is read.

type PdfOptions = {
  imageWidth?: number;
  imageHeight?: number;
  pageWidth?: number;
  pageHeight?: number;
  text?: boolean;
  /** Fraction of the page the picture is drawn over. */
  cover?: number;
  pages?: number;
};

function buildPdf(options: PdfOptions = {}): Uint8Array {
  const imageWidth = options.imageWidth ?? 40;
  const imageHeight = options.imageHeight ?? 20;
  const pageWidth = options.pageWidth ?? 400;
  const pageHeight = options.pageHeight ?? 200;
  const cover = options.cover ?? 1;
  const pageCount = options.pages ?? 1;

  const pixels = Buffer.alloc(imageWidth * imageHeight * 3);
  for (let index = 0; index < imageWidth * imageHeight; index += 1) {
    pixels[index * 3] = (index * 37) % 256;
    pixels[index * 3 + 1] = (index * 91) % 256;
    pixels[index * 3 + 2] = (index * 17) % 256;
  }
  const imageStream = deflateSync(pixels);

  const drawing =
    `q ${pageWidth * cover} 0 0 ${pageHeight * cover} 0 0 cm /Im0 Do Q\n` +
    (options.text ? "BT /F1 24 Tf 20 40 Td (Slide text) Tj ET\n" : "");
  const content = Buffer.from(drawing, "latin1");

  const objects: Buffer[] = [];
  const add = (body: Buffer | string): number => {
    objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    return objects.length;
  };

  const pageIds: number[] = [];
  const catalogId = 1;
  const pagesId = 2;
  objects.push(Buffer.alloc(0), Buffer.alloc(0));

  const imageId = add(
    Buffer.concat([
      Buffer.from(
        `<</Type/XObject/Subtype/Image/Width ${imageWidth}/Height ${imageHeight}` +
          `/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/FlateDecode/Length ${imageStream.length}>>\nstream\n`,
        "latin1",
      ),
      imageStream,
      Buffer.from("\nendstream", "latin1"),
    ]),
  );
  const contentId = add(
    Buffer.concat([
      Buffer.from(`<</Length ${content.length}>>\nstream\n`, "latin1"),
      content,
      Buffer.from("\nendstream", "latin1"),
    ]),
  );
  const fontId = add("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>");

  for (let page = 0; page < pageCount; page += 1) {
    pageIds.push(
      add(
        `<</Type/Page/Parent ${pagesId} 0 R/MediaBox[0 0 ${pageWidth} ${pageHeight}]` +
          `/Resources<</XObject<</Im0 ${imageId} 0 R>>/Font<</F1 ${fontId} 0 R>>>>` +
          `/Contents ${contentId} 0 R>>`,
      ),
    );
  }

  objects[catalogId - 1] = Buffer.from(`<</Type/Catalog/Pages ${pagesId} 0 R>>`, "latin1");
  objects[pagesId - 1] = Buffer.from(
    `<</Type/Pages/Kids[${pageIds.map((id) => `${id} 0 R`).join(" ")}]/Count ${pageIds.length}>>`,
    "latin1",
  );

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  let offset = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets[index] = offset;
    const wrapped = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    chunks.push(wrapped);
    offset += wrapped.length;
  });

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const value of offsets) xref += `${String(value).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<</Size ${objects.length + 1}/Root ${catalogId} 0 R>>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));
  return new Uint8Array(Buffer.concat(chunks));
}

const op = (name: string, ...args: unknown[]): DrawOp => ({ name, args });

test("matrices compose the way PDF composes them", () => {
  const scale: Matrix = [2, 0, 0, 3, 0, 0];
  const move: Matrix = [1, 0, 0, 1, 10, 20];
  assert.deepEqual(multiply(scale, move), [2, 0, 0, 3, 10, 20]);
  assert.deepEqual(multiply(move, scale), [2, 0, 0, 3, 20, 60]);
});

test("coverage is measured from the image's placed corners", () => {
  assert.equal(pageCoverage([400, 0, 0, 200, 0, 0], 400, 200), 1);
  assert.equal(pageCoverage([200, 0, 0, 200, 0, 0], 400, 200), 0.5);
  // A flipped image still covers the page.
  assert.equal(pageCoverage([400, 0, 0, -200, 0, 200], 400, 200), 1);
  // Placed entirely outside the page.
  assert.equal(pageCoverage([400, 0, 0, 200, 1000, 0], 400, 200), 0);
});

test("one full-page image and nothing else is taken as-is", () => {
  const shape = analyzePage(
    [
      op("save"),
      op("transform", 400, 0, 0, 200, 0, 0),
      op("paintImageXObject", "img_1"),
      op("restore"),
    ],
    400,
    200,
  );
  assert.equal(shape.imageId, "img_1");
  assert.equal(shape.mixed, false);
  assert.equal(shape.coverage, 1);
});

test("a page with anything besides the picture is rendered instead", () => {
  const image = [op("transform", 400, 0, 0, 200, 0, 0), op("paintImageXObject", "img_1")];
  const cases: Array<[string, DrawOp[]]> = [
    ["text on top", [...image, op("showText", [])]],
    ["a drawn shape", [...image, op("fill")]],
    [
      "a second image",
      [...image, op("transform", 10, 0, 0, 10, 0, 0), op("paintImageXObject", "img_2")],
    ],
    ["a form XObject", [...image, op("paintFormXObjectBegin")]],
    ["a shading", [...image, op("shadingFill")]],
    ["no image at all", [op("fill")]],
    [
      "an image covering only part of the page",
      [op("transform", 200, 0, 0, 200, 0, 0), op("paintImageXObject", "img_1")],
    ],
    [
      "an image mask rather than a picture",
      [op("transform", 400, 0, 0, 200, 0, 0), op("paintImageMaskXObject", "img_1")],
    ],
  ];
  for (const [label, ops] of cases) {
    const shape = analyzePage(ops, 400, 200);
    assert.equal(shape.imageId, null, label);
    assert.equal(shape.mixed, true, label);
  }
});

test("save and restore put the matrix back, so coverage is not inherited", () => {
  const shape = analyzePage(
    [
      op("save"),
      op("transform", 10, 0, 0, 10, 0, 0),
      op("restore"),
      op("transform", 400, 0, 0, 200, 0, 0),
      op("paintImageXObject", "img_1"),
    ],
    400,
    200,
  );
  assert.equal(shape.imageId, "img_1");
});

test("render scale is at least 1600 px wide and at least 144 dpi, with a ceiling", () => {
  // A 400 pt page needs scale 4 to reach 1600 px.
  assert.equal(renderScale(400), 4);
  // A wide page is already past 1600 px at 144 dpi, so it stays at 144 dpi.
  assert.equal(renderScale(1200), 2);
  assert.equal(renderScale(1200) * 1200, 2400);
  // Never beyond the output ceiling.
  assert.ok(renderScale(4000) * 4000 <= 6000);
  assert.equal(renderScale(0), 2);
});

test("a page that is one full-page picture keeps the original pixels", async () => {
  const pages = await extractPdf(buildPdf({ imageWidth: 40, imageHeight: 20 }), { maxPages: 40 });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].origin, "pdf-image");
  assert.equal(pages[0].mixed, false);
  // Native resolution of the embedded picture, not the rendered page size.
  assert.equal(pages[0].image.width, 40);
  assert.equal(pages[0].image.height, 20);
});

test("a page with text next to the picture is rendered at print size", async () => {
  const pages = await extractPdf(buildPdf({ text: true, pageWidth: 400 }), { maxPages: 40 });
  assert.equal(pages[0].origin, "pdf-render");
  assert.equal(pages[0].mixed, true);
  assert.equal(pages[0].image.width, 1600);
});

test("a picture that does not cover the page is rendered, not lifted", async () => {
  const pages = await extractPdf(buildPdf({ cover: 0.5 }), { maxPages: 40 });
  assert.equal(pages[0].origin, "pdf-render");
  assert.equal(pages[0].mixed, true);
  assert.ok(pages[0].image.width >= 1600);
});

test("pages come out in order and progress is reported once per page", async () => {
  const seen: number[] = [];
  const pages = await extractPdf(buildPdf({ pages: 3 }), {
    maxPages: 40,
    onPage: (index, total) => {
      assert.equal(total, 3);
      seen.push(index);
    },
  });
  assert.deepEqual(
    pages.map((page) => page.index),
    [1, 2, 3],
  );
  assert.deepEqual(seen, [1, 2, 3]);
});

test("too many pages is refused before any page is rendered", async () => {
  await assert.rejects(() => extractPdf(buildPdf({ pages: 5 }), { maxPages: 4 }), PdfError);
  await assert.rejects(() => extractPdf(buildPdf({ pages: 5 }), { maxPages: 4 }), /too-many-pages/);
});

test("something that is not a PDF is refused", async () => {
  await assert.rejects(
    () => extractPdf(new Uint8Array([1, 2, 3, 4]), { maxPages: 40 }),
    /pdf rejected/,
  );
});

test("cancelling stops the extraction", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => extractPdf(buildPdf({ pages: 3 }), { maxPages: 40, signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});
