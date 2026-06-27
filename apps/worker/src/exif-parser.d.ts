declare module "exif-parser" {
  export type ExifTagValue = string | number | boolean | number[] | null | undefined;

  export type ExifParserResult = {
    tags: Record<string, ExifTagValue>;
  };

  export function create(buffer: Buffer): {
    parse(): ExifParserResult;
  };
}
