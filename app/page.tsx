"use client";

import { useState, useEffect, useRef } from "react";
import { calculateRMS, calculateDominantFrequency, groupFrequencyBars } from "@/lib/audioMath";

export default function AudioVisualizerPage() {
  const [isActive, setIsActive] = useState(false);
  const [sensitivity, setSensitivity] = useState(1.2);
  const [layoutMode, setLayoutMode] = useState<"both" | "waveform" | "spectrum">("both");
  const [dominantFreq, setDominantFreq] = useState(0);
  const [volumeDb, setVolumeDb] = useState(-60);
  const [peakPercent, setPeakPercent] = useState(0);
  const [currentPercent, setCurrentPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const peakHoldRef = useRef<number>(0);
  const peakTimerRef = useRef<number>(0);

  const stopAudio = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsActive(false);
    setDominantFreq(0);
    setVolumeDb(-60);
    setCurrentPercent(0);
    setPeakPercent(0);
    peakHoldRef.current = 0;
  };

  const startAudio = async () => {
    setErrorMessage(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMessage("Microphone audio capture is not supported in this browser.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false },
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      setIsActive(true);
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setErrorMessage("Microphone permission was denied. Please allow microphone access.");
      } else if (e.name === "NotFoundError") {
        setErrorMessage("No microphone audio input device was found.");
      } else {
        setErrorMessage(`Audio error: ${e.message || "Could not access microphone."}`);
      }
      stopAudio();
    }
  };

  const handleToggle = () => {
    if (isActive) stopAudio();
    else startAudio();
  };

  // Rendering loop
  useEffect(() => {
    if (!isActive) return;

    const render = () => {
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      const ctx = audioContextRef.current;

      if (canvas && analyser && ctx) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
          canvas.width = rect.width * dpr;
          canvas.height = rect.height * dpr;
        }

        const c2d = canvas.getContext("2d");
        if (c2d) {
          c2d.save();
          c2d.scale(dpr, dpr);
          const W = rect.width;
          const H = rect.height;

          const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
          c2d.fillStyle = isDark ? "#0f172a" : "#f8fafc";
          c2d.fillRect(0, 0, W, H);

          const timeData = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(timeData);

          const freqData = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(freqData);

          // RMS & Dominant Frequency
          const rmsResult = calculateRMS(timeData);
          setVolumeDb(rmsResult.db);
          setCurrentPercent(rmsResult.percent);

          const now = Date.now();
          if (rmsResult.percent > peakHoldRef.current) {
            peakHoldRef.current = rmsResult.percent;
            peakTimerRef.current = now;
          } else if (now - peakTimerRef.current > 1200) {
            peakHoldRef.current = Math.max(0, peakHoldRef.current - 0.8);
          }
          setPeakPercent(peakHoldRef.current);

          const domHz = calculateDominantFrequency(freqData, ctx.sampleRate, analyser.fftSize);
          setDominantFreq(domHz);

          // Draw Canvas Layouts
          if (layoutMode === "both") {
            const halfH = H / 2;
            drawWaveform(c2d, timeData, 0, 0, W, halfH, isDark, sensitivity);
            drawSpectrum(c2d, freqData, 0, halfH, W, halfH, isDark, sensitivity);
          } else if (layoutMode === "waveform") {
            drawWaveform(c2d, timeData, 0, 0, W, H, isDark, sensitivity);
          } else {
            drawSpectrum(c2d, freqData, 0, 0, W, H, isDark, sensitivity);
          }

          c2d.restore();
        }
      }
      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isActive, layoutMode, sensitivity]);

  const drawWaveform = (
    c2d: CanvasRenderingContext2D,
    data: Uint8Array,
    x: number,
    y: number,
    w: number,
    h: number,
    isDark: boolean,
    sens: number
  ) => {
    c2d.strokeStyle = isDark ? "#334155" : "#e2e8f0";
    c2d.lineWidth = 1;
    c2d.beginPath();
    c2d.moveTo(x, y + h / 2);
    c2d.lineTo(x + w, y + h / 2);
    c2d.stroke();

    c2d.strokeStyle = isDark ? "#38bdf8" : "#0284c7";
    c2d.lineWidth = 2;
    c2d.beginPath();

    const sliceWidth = w / data.length;
    let currX = x;

    for (let i = 0; i < data.length; i++) {
      const v = ((data[i] - 128) / 128) * sens;
      const currY = y + h / 2 + v * (h / 2);
      if (i === 0) c2d.moveTo(currX, currY);
      else c2d.lineTo(currX, currY);
      currX += sliceWidth;
    }
    c2d.stroke();
  };

  const drawSpectrum = (
    c2d: CanvasRenderingContext2D,
    data: Uint8Array,
    x: number,
    y: number,
    w: number,
    h: number,
    isDark: boolean,
    sens: number
  ) => {
    const bars = groupFrequencyBars(data, 64);
    const gap = 2;
    const barWidth = Math.max(1, (w - gap * bars.length) / bars.length);

    for (let i = 0; i < bars.length; i++) {
      const barH = Math.min(h, bars[i] * h * sens);
      const barX = x + i * (barWidth + gap);
      const barY = y + h - barH;

      const grad = c2d.createLinearGradient(0, y + h, 0, y);
      if (isDark) {
        grad.addColorStop(0, "#06b6d4");
        grad.addColorStop(0.7, "#3b82f6");
        grad.addColorStop(1, "#f43f5e");
      } else {
        grad.addColorStop(0, "#0891b2");
        grad.addColorStop(0.7, "#2563eb");
        grad.addColorStop(1, "#e11d48");
      }
      c2d.fillStyle = grad;
      c2d.fillRect(barX, barY, barWidth, barH);
    }
  };

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 py-10 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <header className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-2.5 bg-cyan-100 dark:bg-cyan-900/40 rounded-2xl mb-1 text-cyan-600 dark:text-cyan-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Audio Visualizer
          </h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
            High-refresh Web Audio oscilloscope, logarithmic 64-band frequency spectrum, and peak-hold volume metering.
          </p>
        </header>

        {errorMessage && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-700 dark:text-rose-300">
            {errorMessage}
          </div>
        )}

        {/* Controls Bar Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggle}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-all flex items-center gap-2 ${
                isActive
                  ? "bg-rose-600 hover:bg-rose-500 text-white ring-4 ring-rose-100 dark:ring-rose-950"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white"
              }`}
            >
              {isActive && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
                </span>
              )}
              {isActive ? "Stop Microphone" : "Start Microphone"}
            </button>

            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
              {(["both", "waveform", "spectrum"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setLayoutMode(m)}
                  className={`px-3 py-1.5 rounded-lg capitalize transition-all ${
                    layoutMode === m
                      ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-slate-500">
              Sensitivity: {sensitivity.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={sensitivity}
              onChange={(e) => setSensitivity(parseFloat(e.target.value))}
              className="w-28 accent-cyan-600 cursor-pointer"
            />
          </div>
        </div>

        {/* Live Canvas Visualizer Display */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 p-4 space-y-4">
          <div className="relative w-full h-[320px] rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800/80">
            <canvas ref={canvasRef} className="w-full h-full block" />
            {!isActive && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/20 backdrop-blur-[2px]">
                <div className="text-center p-4 rounded-xl bg-white/90 dark:bg-slate-900/90 shadow-lg border border-slate-200 dark:border-slate-800">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Microphone is Inactive
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Click &ldquo;Start Microphone&rdquo; to begin audio telemetry</p>
                </div>
              </div>
            )}
          </div>

          {/* Real-time Telemetry Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-500 block uppercase font-medium">Dominant Pitch</span>
                <span className="text-2xl font-black text-cyan-600 dark:text-cyan-400">
                  {dominantFreq > 0 ? `${dominantFreq} Hz` : "--"}
                </span>
              </div>
              <span className="text-[11px] text-slate-400">Peak FFT bin frequency</span>
            </div>

            {/* Volume Meter (RMS dB with Peak Hold) */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="uppercase font-medium text-slate-500">Volume Level (RMS)</span>
                <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                  {volumeDb.toFixed(1)} dB
                </span>
              </div>
              <div className="relative h-3 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-linear-to-r from-emerald-500 via-yellow-400 to-rose-500 transition-all duration-75"
                  style={{ width: `${currentPercent}%` }}
                />
                {/* Peak hold marker */}
                <div
                  className="absolute top-0 bottom-0 w-1 bg-slate-900 dark:bg-white shadow-xs"
                  style={{ left: `calc(${peakPercent}% - 2px)` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
