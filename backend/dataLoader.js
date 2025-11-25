import fs from "fs";
import { parse } from "csv-parse";
import { Readable } from "stream";
import { Storage } from "@google-cloud/storage";

const storage = new Storage();
const isGcsPath = path => path.startsWith("gs://");
const splitGcsPath = path => {
  const withoutScheme = path.replace("gs://", "");
  const [bucket, ...rest] = withoutScheme.split("/");
  return { bucket, key: rest.join("/") };
};

const streamRows = (stream, { rowLimit } = {}) =>
  new Promise((resolve, reject) => {
    const rows = [];
    let resolved = false;
    const parser = stream.pipe(
      parse({
        columns: true,
        skip_empty_lines: true
      })
    );

    parser.on("data", row => {
      rows.push(row);
      if (rowLimit && rows.length >= rowLimit) {
        resolved = true;
        parser.destroy();
        resolve(rows);
      }
    });

    parser.on("end", () => {
      if (!resolved) resolve(rows);
    });

    parser.on("error", err => {
      if (!resolved) reject(err);
    });
  });

/**
 * Stream a CSV file (local or GCS) to avoid loading huge files into memory.
 * Optional rowLimit (number) lets you cap rows for large datasets.
 */
export async function loadCSV(path, { rowLimit } = {}) {
  if (isGcsPath(path)) {
    const { bucket, key } = splitGcsPath(path);
    const [buffer] = await storage.bucket(bucket).file(key).download();
    const readable = Readable.from(buffer.toString("utf-8"));
    return streamRows(readable, { rowLimit });
  }
  const fileStream = fs.createReadStream(path);
  return streamRows(fileStream, { rowLimit });
}

export async function saveToGCS(bucket, destination, buffer, contentType = "text/csv") {
  await storage.bucket(bucket).file(destination).save(buffer, {
    contentType,
    resumable: false
  });
  return `gs://${bucket}/${destination}`;
}
