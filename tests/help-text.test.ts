import { describe, it, expect } from 'vitest';
import { HELP_TEXT } from '../src/help-text.js';

describe('HELP_TEXT — pointing a note at an evidence file', () => {
  it("names the transcript's project: directory as where a note's file path starts", () => {
    expect(HELP_TEXT).toMatch(/under the transcript's `?project:`? directory/);
  });
});
