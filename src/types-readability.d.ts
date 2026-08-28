declare module "@mozilla/readability" {
  export class Readability {
    constructor(doc: Document, options?: Record<string, unknown>);
    parse(): {
      title: string;
      textContent: string;
      content: string;
    } | null;
  }
}
