export function calculateRMS(timeDomainData: Uint8Array): { rms: number; db: number; percent: number } {
  let sumSquares = 0;
  for (let i = 0; i < timeDomainData.length; i++) {
    const val = (timeDomainData[i] - 128) / 128;
    sumSquares += val * val;
  }
  const rms = Math.sqrt(sumSquares / timeDomainData.length);
  // dB relative to 1.0 full scale, clamped to -60 dB
  const db = rms > 0.0001 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
  const percent = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  return { rms, db: Math.round(db * 10) / 10, percent };
}

export function calculateDominantFrequency(
  frequencyData: Uint8Array,
  sampleRate: number,
  fftSize: number
): number {
  let maxVal = -1;
  let maxIdx = 0;
  // Ignore DC offset (bin 0)
  for (let i = 1; i < frequencyData.length; i++) {
    if (frequencyData[i] > maxVal) {
      maxVal = frequencyData[i];
      maxIdx = i;
    }
  }
  if (maxVal < 10) return 0; // noise floor
  const freq = (maxIdx * sampleRate) / fftSize;
  return Math.round(freq);
}

export function groupFrequencyBars(frequencyData: Uint8Array, numBars: number = 64): number[] {
  const bars: number[] = new Array(numBars).fill(0);
  const totalBins = frequencyData.length;

  for (let b = 0; b < numBars; b++) {
    // Logarithmic scale mapping
    const startRatio = Math.pow(b / numBars, 2);
    const endRatio = Math.pow((b + 1) / numBars, 2);

    const startBin = Math.max(1, Math.floor(startRatio * (totalBins - 1)));
    const endBin = Math.min(totalBins, Math.ceil(endRatio * (totalBins - 1)) + 1);

    let sum = 0;
    let count = 0;
    for (let i = startBin; i < endBin; i++) {
      sum += frequencyData[i];
      count++;
    }
    const avg = count > 0 ? sum / count : 0;
    bars[b] = avg / 255;
  }
  return bars;
}
