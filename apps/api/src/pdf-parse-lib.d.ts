declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseOptions {
    pagerender?: (pageData: unknown) => Promise<string> | string;
    max?: number;
  }
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(buffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdfParse;
}