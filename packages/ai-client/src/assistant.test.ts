import { describe, it, expect } from "vitest";
import { extractCitedExcerpts } from "./assistant.js";

describe("extractCitedExcerpts (AI citation relevance)", () => {
  it("parses a normal CITED_EXCERPTS line and strips it from the displayed content", () => {
    const raw = "The vendor has a current SOC 2 report on file.\n\nCITED_EXCERPTS: [1, 3]";
    const { displayContent, citedNumbers } = extractCitedExcerpts(raw);
    expect(displayContent).toBe("The vendor has a current SOC 2 report on file.");
    expect(citedNumbers).toEqual([1, 3]);
  });

  it("returns an empty citedNumbers array when the model reports none", () => {
    const raw = "I don't have enough information to answer that.\n\nCITED_EXCERPTS: []";
    const { displayContent, citedNumbers } = extractCitedExcerpts(raw);
    expect(displayContent).toBe("I don't have enough information to answer that.");
    expect(citedNumbers).toEqual([]);
  });

  it("does not treat every excerpt present in context as automatically cited - only the ones the model actually names", () => {
    const raw = "Only excerpt 2 was relevant to this specific question.\n\nCITED_EXCERPTS: [2]";
    const { citedNumbers } = extractCitedExcerpts(raw);
    expect(citedNumbers).toEqual([2]);
    expect(citedNumbers).not.toContain(1);
    expect(citedNumbers).not.toContain(3);
  });

  it("falls back safely to no citations and the full original text when the line is missing entirely", () => {
    const raw = "A normal answer with no citation line at all.";
    const { displayContent, citedNumbers } = extractCitedExcerpts(raw);
    expect(displayContent).toBe(raw);
    expect(citedNumbers).toEqual([]);
  });

  it("falls back safely when the line is malformed", () => {
    const raw = "An answer.\n\nCITED_EXCERPTS: not-a-list";
    const { displayContent, citedNumbers } = extractCitedExcerpts(raw);
    expect(displayContent).toBe(raw);
    expect(citedNumbers).toEqual([]);
  });

  it("ignores non-numeric or invalid entries inside the list rather than crashing", () => {
    const raw = "An answer.\n\nCITED_EXCERPTS: [1, abc, 2, -5, 0]";
    const { citedNumbers } = extractCitedExcerpts(raw);
    expect(citedNumbers).toEqual([1, 2]);
  });

  it("only matches the citation line when it is the final line of the response", () => {
    const raw = "CITED_EXCERPTS: [1] is not actually the citation line here since more text follows.\n\nCITED_EXCERPTS: [2]";
    const { citedNumbers } = extractCitedExcerpts(raw);
    expect(citedNumbers).toEqual([2]);
  });
});