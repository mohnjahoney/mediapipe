export const DEFAULT_MAPPINGS = [
  {
    id: "mouth-pitch",
    input: "face.mouthOpen",
    output: "mouthFrequency",
    binaryThreshold: 0,
    outputRange: [20, 2000],
  },
  {
    id: "eye-to-square-volume",
    input: "face.eyeOpen",
    output: "mouthVolume",
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
