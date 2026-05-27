export const DEFAULT_MAPPINGS = [
  {
    id: "mouth-volume",
    input: "face.mouthOpen",
    output: "mouthVolume",
    binaryThreshold: 0,
    scale: 1,
  },
  {
    id: "eye-volume",
    input: "face.eyeClosed",
    output: "eyeVolume",
    binaryThreshold: 0,
    scale: 1,
  },
  {
    id: "red-volume",
    input: "pixel.redCorner",
    output: "redVolume",
    binaryThresholdSetting: "redDecision",
    scale: 1,
  },
];
