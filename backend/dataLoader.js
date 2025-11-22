import fs from "fs";
import { parse } from "csv-parse/sync";

export function loadCSV(path) {
  const raw = fs.readFileSync(path, "utf-8");
  return parse(raw, { columns: true, skip_empty_lines: true });
}
