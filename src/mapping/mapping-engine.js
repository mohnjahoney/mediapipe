export function createMappingEngine(mappings) {
  return {
    process(signals, settings) {
      const outputs = {};

      for (const mapping of mappings) {
        const value = signals[mapping.input] ?? 0;
        const threshold = mapping.binaryThresholdSetting
          ? settings[mapping.binaryThresholdSetting]
          : mapping.binaryThreshold ?? 0;

        if (settings.binaryAudio && mapping.outputRange) {
          const [min, max] = mapping.outputRange;
          outputs[mapping.output] = value > threshold ? max : min;
          continue;
        }

        if (settings.binaryAudio) {
          outputs[mapping.output] = value > threshold ? 1 : 0;
          continue;
        }

        if (mapping.outputRange) {
          const [min, max] = mapping.outputRange;
          outputs[mapping.output] = min + value * (max - min);
          continue;
        }

        outputs[mapping.output] = value * (mapping.scale ?? 1);
      }

      return outputs;
    },
  };
}
