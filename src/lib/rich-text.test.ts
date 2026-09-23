import assert from "node:assert/strict";
import test from "node:test";
import {
  imageMarker,
  nextPastedName,
  plainText,
  richSegments,
} from "./rich-text.ts";

test("image markers split text into segments and keep surrounding text", () => {
  const text = `Steps:\n${imageMarker("pasted-image-1.png")}\nThen ![the crash](attachment:crash.png) appears.`;
  assert.deepEqual(richSegments(text), [
    { type: "text", text: "Steps:\n" },
    {
      type: "image",
      alt: "pasted-image-1.png",
      name: "pasted-image-1.png",
      marker: "![pasted-image-1.png](attachment:pasted-image-1.png)",
    },
    { type: "text", text: "\nThen " },
    {
      type: "image",
      alt: "the crash",
      name: "crash.png",
      marker: "![the crash](attachment:crash.png)",
    },
    { type: "text", text: " appears." },
  ]);
  assert.deepEqual(richSegments(""), []);
  assert.deepEqual(richSegments("plain"), [{ type: "text", text: "plain" }]);
});

test("markers ignore ordinary links and unfinished syntax", () => {
  for (const text of [
    "![alt](https://example.test/a.png)",
    "![alt](attachment:",
    "[alt](attachment:a.png)",
    "![alt\n](attachment:a.png)",
  ])
    assert.deepEqual(richSegments(text), [{ type: "text", text }]);
});

test("plain text drops markers and collapses the gaps they leave", () => {
  assert.equal(
    plainText(`First\n\n${imageMarker("a.png")}\n\nSecond`),
    "First\n\nSecond",
  );
  assert.equal(plainText(imageMarker("only.png")), "");
});

test("pasted names count up past staged and saved attachments", () => {
  assert.equal(nextPastedName([], "image/png"), "pasted-image-1.png");
  assert.equal(
    nextPastedName(["pasted-image-1.png", "other.png"], "image/png"),
    "pasted-image-2.png",
  );
  assert.equal(
    nextPastedName(["pasted-image-1.jpg"], "image/jpeg"),
    "pasted-image-2.jpg",
  );
  assert.equal(nextPastedName([], "image/x-unknown"), "pasted-image-1.png");
});
