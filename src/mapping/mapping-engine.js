export function createMappingEngine(mappings) {
  return {
    process(signals, settings) {
      const outputs = {};

      for (const mapping of mappings) {
        const value = signals[mapping.input] ?? 0;
        const threshold = mapping.binaryThresholdSetting
          ? settings[mapping.binaryThresholdSetting]
          : mapping.binaryThreshold ?? 0;

        outputs[mapping.output] = settings.binaryAudio
          ? value > threshold ? 1 : 0
          : value * (mapping.scale ?? 1);
      }

      return outputs;
    },
  };
}
