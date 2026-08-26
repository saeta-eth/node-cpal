const assert = require('assert');
const cpal = require('../..');
const {
  sleep,
  generateSineWave,
  getTestConfig,
  getTestDevice,
  withTestStream,
  getMemoryUsage,
} = require('../helpers/hardware');
const { summarizeDurations } = require('../helpers/audio');

function reportDurations(label, timings) {
  const summary = summarizeDurations(timings);
  Object.values(summary).forEach((value) => {
    assert(Number.isFinite(value));
    assert(value >= 0);
  });
  console.log(`${label}:`, {
    samples: timings.length,
    minMs: summary.min.toFixed(3),
    medianMs: summary.median.toFixed(3),
    p95Ms: summary.p95.toFixed(3),
    maxMs: summary.max.toFixed(3),
  });
  return summary;
}

describe('Audio Benchmarks', () => {
  let device;
  let config;

  before(function () {
    device = getTestDevice(false);
    if (!device) {
      this.skip();
    }

    config = getTestConfig(device, false);
    if (!config) {
      this.skip();
    }
  });

  it('reports write enqueue duration', async () => {
    const measurementDurationMs = 3000;
    const chunkDuration = 0.1;
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      chunkDuration
    );
    const timings = [];

    await withTestStream(device, false, config, async (stream) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < measurementDurationMs) {
        const writeStartedAt = process.hrtime.bigint();
        cpal.writeToStream(stream, buffer);
        timings.push(
          Number(process.hrtime.bigint() - writeStartedAt) / 1_000_000
        );
        await sleep(chunkDuration * 1000);
      }
    });

    assert(timings.length > 0);
    reportDurations('Write enqueue duration', timings);
  }).timeout(10000);

  it('reports stream creation duration', () => {
    const iterations = 20;
    const timings = [];

    for (let i = 0; i < iterations; i++) {
      let stream;
      try {
        const startedAt = process.hrtime.bigint();
        stream = cpal.createStream(
          device.deviceId,
          false,
          config,
          () => {}
        );
        timings.push(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
      } finally {
        if (stream) {
          cpal.closeStream(stream);
        }
      }
    }

    assert.strictEqual(timings.length, iterations);
    reportDurations('Stream creation duration', timings);
  }).timeout(10000);

  it('reports buffer enqueue throughput', async () => {
    const duration = 3;
    const chunkDuration = 0.1;
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      duration
    );
    const chunkSize = Math.floor(
      config.sampleRate * config.channels * chunkDuration
    );
    let totalBytes = 0;
    let totalWriteTimeMs = 0;

    await withTestStream(device, false, config, async (stream) => {
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(
          offset,
          Math.min(offset + chunkSize, buffer.length)
        );
        const startedAt = process.hrtime.bigint();
        cpal.writeToStream(stream, chunk);
        totalWriteTimeMs +=
          Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        totalBytes += chunk.byteLength;
        await sleep(
          (chunk.length / config.channels / config.sampleRate) * 1000
        );
      }
    });

    const throughputMiBps =
      totalBytes / (1024 * 1024) / (totalWriteTimeMs / 1000);
    assert.strictEqual(totalBytes, buffer.byteLength);
    assert(Number.isFinite(throughputMiBps));
    assert(throughputMiBps > 0);
    console.log('Buffer enqueue throughput:', {
      bytes: totalBytes,
      nativeCallTimeMs: totalWriteTimeMs.toFixed(3),
      throughputMiBps: throughputMiBps.toFixed(2),
    });
  }).timeout(10000);

  it('reports memory deltas during sustained streaming', async () => {
    const measurementDurationMs = 3000;
    const chunkDuration = 0.1;
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      chunkDuration
    );
    const startMemory = getMemoryUsage();

    await withTestStream(device, false, config, async (stream) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < measurementDurationMs) {
        cpal.writeToStream(stream, buffer);
        await sleep(chunkDuration * 1000);
      }
    });

    const endMemory = getMemoryUsage();
    const deltas = {
      heapUsed: endMemory.heapUsed - startMemory.heapUsed,
      external: endMemory.external - startMemory.external,
      rss: endMemory.rss - startMemory.rss,
    };
    Object.values(deltas).forEach((value) => assert(Number.isFinite(value)));
    console.log('Sustained-stream memory delta (bytes):', deltas);
  }).timeout(10000);

  it('reports process CPU usage during sustained streaming', async () => {
    const measurementDurationMs = 3000;
    const chunkDuration = 0.1;
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      chunkDuration
    );
    const startedAt = process.hrtime.bigint();
    const startUsage = process.cpuUsage();

    await withTestStream(device, false, config, async (stream) => {
      while (
        Number(process.hrtime.bigint() - startedAt) / 1_000_000 <
        measurementDurationMs
      ) {
        cpal.writeToStream(stream, buffer);
        await sleep(chunkDuration * 1000);
      }
    });

    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const usage = process.cpuUsage(startUsage);
    const cpuTimeMs = (usage.user + usage.system) / 1000;
    const cpuPercent = (cpuTimeMs / elapsedMs) * 100;
    assert(Number.isFinite(cpuPercent));
    assert(cpuPercent >= 0);
    console.log('Sustained-stream process CPU:', {
      elapsedMs: elapsedMs.toFixed(2),
      cpuTimeMs: cpuTimeMs.toFixed(2),
      cpuPercent: cpuPercent.toFixed(2),
    });
  }).timeout(10000);
});
