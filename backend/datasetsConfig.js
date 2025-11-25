// Default datasets registry. Leave empty if you intend to upload CSVs at runtime
// (they will be stored in GCS) or configure static entries pointing to gs://
// locations, e.g.:
// {
//   VIR_R1: {
//     label: "VIR Race 1",
//     telemetry: "gs://your-bucket/datasets/VIR_R1/telemetry.csv",
//     laps: "gs://your-bucket/datasets/VIR_R1/laps.csv"
//   }
// }
export const DATASETS = {};
