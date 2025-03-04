const assert = require('assert');
const cpal = require('../');
const {
  sleep,
  generateSineWave,
  getTestConfig,
  getTestDevice,
  withTestStream,
  getMemoryUsage,
} = require('./utils');

describe('Benchmark Tests', () => {
  let device;
  let config;
  let startTime;

  before(() => {
    device = getTestDevice();
    config = getTestConfig(device);
  });

  beforeEach(() => {
    startTime = process.hrtime.bigint();
  });

  afterEach(() => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e6; // Convert to milliseconds
    console.log(`Test duration: ${duration.toFixed(2)}ms`);
  });

  it('should measure audio latency', async () => {
    const testDuration = 5000; // 5 seconds
    const sampleRate = config.sampleRate;
    const channels = config.channels;
    let totalLatency = 0;
    let measurements = 0;

    await withTestStream(device, false, config, async (stream) => {
      const startTime = Date.now();
      const buffer = generateSineWave(440, sampleRate, channels, 0.1);

      while (Date.now() - startTime < testDuration) {
        const writeStart = process.hrtime.bigint();
        cpal.writeToStream(stream, buffer);
        const writeEnd = process.hrtime.bigint();

        const latency = Number(writeEnd - writeStart) / 1e6; // Convert to milliseconds
        totalLatency += latency;
        measurements++;

        await sleep(100);
      }

      const avgLatency = totalLatency / measurements;
      console.log(`Average write latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`Number of measurements: ${measurements}`);

      assert(avgLatency < 100, 'Average latency should be less than 100ms');
    });
  }).timeout(10000);

  it('should measure stream creation performance', async () => {
    const iterations = 50;
    const timings = [];

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      const stream = cpal.createStream(device, false, config, () => {});
      const end = process.hrtime.bigint();

      timings.push(Number(end - start) / 1e6); // Convert to milliseconds
      cpal.closeStream(stream);
      await sleep(10);
    }

    const avgTime = timings.reduce((a, b) => a + b) / timings.length;
    const minTime = Math.min(...timings);
    const maxTime = Math.max(...timings);

    console.log(`Stream creation performance:
            Average: ${avgTime.toFixed(2)}ms
            Min: ${minTime.toFixed(2)}ms
            Max: ${maxTime.toFixed(2)}ms`);

    assert(
      avgTime < 500,
      'Average stream creation time should be less than 500ms'
    );
  }).timeout(10000);

  it('should measure audio processing throughput', async () => {
    const duration = 5; // 5 seconds
    const bufferSize = config.sampleRate * config.channels * duration; // 5 seconds of audio
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      duration
    );

    assert(
      buffer.length === bufferSize,
      'Buffer size should match expected size'
    );

    const stream = cpal.createStream(device, false, config, () => {});
    const chunkSize = config.sampleRate * config.channels * 0.1; // 100ms chunks
    const chunks = Math.ceil(buffer.length / chunkSize);
    const timings = [];

    try {
      for (let i = 0; i < chunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, buffer.length);
        const chunk = buffer.slice(start, end);

        const writeStart = process.hrtime.bigint();
        cpal.writeToStream(stream, chunk);
        const writeEnd = process.hrtime.bigint();

        timings.push(Number(writeEnd - writeStart) / 1e6);
        await sleep(10);
      }

      const avgTime = timings.reduce((a, b) => a + b) / timings.length;
      const throughputMBps =
        (bufferSize * 4) / (1024 * 1024 * (avgTime / 1000));

      console.log(`Audio processing performance:
                Average chunk write time: ${avgTime.toFixed(2)}ms
                Throughput: ${throughputMBps.toFixed(2)} MB/s`);

      assert(
        throughputMBps > 0.1,
        'Throughput should be greater than 0.1 MB/s'
      );
    } finally {
      cpal.closeStream(stream);
    }
  }).timeout(10000);

  it('should measure memory efficiency during continuous streaming', async () => {
    const duration = 10000; // 10 seconds
    const interval = 100; // Check memory every 100ms
    const memoryReadings = [];
    const stream = cpal.createStream(device, false, config, () => {});
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.1
    );

    try {
      const startTime = Date.now();
      while (Date.now() - startTime < duration) {
        cpal.writeToStream(stream, buffer);
        memoryReadings.push(getMemoryUsage().heapUsed);
        await sleep(interval);
      }

      const memoryGrowth =
        memoryReadings[memoryReadings.length - 1] - memoryReadings[0];
      const memoryGrowthMB = memoryGrowth / (1024 * 1024);

      console.log(`Memory efficiency:
                Initial memory: ${(memoryReadings[0] / (1024 * 1024)).toFixed(
                  2
                )} MB
                Final memory: ${(
                  memoryReadings[memoryReadings.length - 1] /
                  (1024 * 1024)
                ).toFixed(2)} MB
                Growth: ${memoryGrowthMB.toFixed(2)} MB`);

      assert(
        memoryGrowthMB < 50,
        'Memory growth should be less than 50MB during continuous streaming'
      );
    } finally {
      cpal.closeStream(stream);
    }
  }).timeout(15000);

  it('should measure CPU usage during audio processing', async () => {
    const duration = 5000; // 5 seconds
    const interval = 100; // Check CPU usage every 100ms
    const cpuReadings = [];
    const stream = cpal.createStream(device, false, config, () => {});
    const buffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.1
    );

    try {
      const startTime = Date.now();
      const startUsage = process.cpuUsage();

      while (Date.now() - startTime < duration) {
        cpal.writeToStream(stream, buffer);
        const currentUsage = process.cpuUsage(startUsage);
        const totalUsage = (currentUsage.user + currentUsage.system) / 1000; // Convert to ms
        cpuReadings.push(totalUsage);
        await sleep(interval);
      }

      const avgCPUUsage =
        cpuReadings.reduce((a, b) => a + b) / cpuReadings.length;
      console.log(`CPU usage during audio processing:
                Average CPU time: ${avgCPUUsage.toFixed(
                  2
                )}ms per ${interval}ms interval
                CPU utilization: ${((avgCPUUsage / interval) * 100).toFixed(
                  2
                )}%`);

      assert(
        avgCPUUsage < interval,
        'CPU usage should not exceed interval duration'
      );
    } finally {
      cpal.closeStream(stream);
    }
  }).timeout(10000);
});
