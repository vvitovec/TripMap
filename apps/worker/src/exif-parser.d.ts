declare module "exif-parser" {
  export type ExifParserResult = {
    tags: Record<string, any>;
  };

  export function create(buffer: Buffer): {
    parse(): ExifParserResult;
  };
}
