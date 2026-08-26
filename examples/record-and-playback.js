/**
 * record-and-playback.js
 *
 * This example demonstrates how to record audio from the default input device,
 * store it in memory, and then play it back through the speakers.
 */

// Try to load the module from the parent directory (development) or from node_modules (installed)
let cpal;
try {
  cpal = require('../');
} catch (e) {
  cpal = require('node-cpal');
}

// Configuration
const RECORD_DURATION_SECONDS = 10;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function concatenateChunks(chunks, totalSamples) {
  const audioData = new Float32Array(totalSamples);
  let offset = 0;

  for (const chunk of chunks) {
    audioData.set(chunk, offset);
    offset += chunk.length;
  }

  return audioData;
}

function convertChannels(audioData, inputChannels, outputChannels) {
  if (inputChannels === outputChannels) {
    return audioData;
  }

  const frameCount = Math.floor(audioData.length / inputChannels);
  const convertedData = new Float32Array(frameCount * outputChannels);

  for (let frame = 0; frame < frameCount; frame++) {
    if (outputChannels === 1) {
      let sample = 0;
      for (let channel = 0; channel < inputChannels; channel++) {
        sample += audioData[frame * inputChannels + channel];
      }
      convertedData[frame] = sample / inputChannels;
      continue;
    }

    for (let channel = 0; channel < outputChannels; channel++) {
      const inputChannel =
        inputChannels === 1 ? 0 : Math.min(channel, inputChannels - 1);
      convertedData[frame * outputChannels + channel] =
        audioData[frame * inputChannels + inputChannel];
    }
  }

  return convertedData;
}

function resampleAudio(audioData, inputRate, outputRate, channels) {
  if (inputRate === outputRate || audioData.length === 0) {
    return audioData;
  }

  const inputFrameCount = Math.floor(audioData.length / channels);
  const outputFrameCount = Math.round(
    (inputFrameCount * outputRate) / inputRate
  );
  const resampledData = new Float32Array(outputFrameCount * channels);

  for (let outputFrame = 0; outputFrame < outputFrameCount; outputFrame++) {
    const sourcePosition = (outputFrame * inputRate) / outputRate;
    const firstFrame = Math.min(
      Math.floor(sourcePosition),
      inputFrameCount - 1
    );
    const secondFrame = Math.min(firstFrame + 1, inputFrameCount - 1);
    const interpolation = sourcePosition - firstFrame;

    for (let channel = 0; channel < channels; channel++) {
      const firstSample = audioData[firstFrame * channels + channel];
      const secondSample = audioData[secondFrame * channels + channel];
      resampledData[outputFrame * channels + channel] =
        firstSample + (secondSample - firstSample) * interpolation;
    }
  }

  return resampledData;
}

async function writeWithBackpressure(stream, audioData) {
  while (true) {
    try {
      cpal.writeToStream(stream, audioData);
      return;
    } catch (error) {
      if (!/buffer full/i.test(error.message)) {
        throw error;
      }
      await sleep(5);
    }
  }
}

// Main function
async function main() {
  try {
    // Get the default input device
    let inputDevice;
    try {
      inputDevice = cpal.getDefaultInputDevice();
      console.log(`Using input device: ${inputDevice.name}`);
    } catch (error) {
      console.error('No input device available:', error.message);
      return;
    }

    // Get the default output device
    let outputDevice;
    try {
      outputDevice = cpal.getDefaultOutputDevice();
      console.log(`Using output device: ${outputDevice.name}`);
    } catch (error) {
      console.error('No output device available:', error.message);
      return;
    }

    // Get the default input configuration
    const inputConfig = cpal.getDefaultInputConfig(inputDevice.deviceId);
    console.log(
      `Input configuration: ${inputConfig.sampleRate} Hz, ${inputConfig.channels} channels, ${inputConfig.sampleFormat} format`
    );

    // Get the default output configuration
    const outputConfig = cpal.getDefaultOutputConfig(outputDevice.deviceId);
    console.log(
      `Output configuration: ${outputConfig.sampleRate} Hz, ${outputConfig.channels} channels, ${outputConfig.sampleFormat} format`
    );

    // Prepare to collect recorded data
    const recordedChunks = [];
    let totalSamples = 0;
    const expectedSamples =
      inputConfig.sampleRate * inputConfig.channels * RECORD_DURATION_SECONDS;

    console.log(`\nRecording ${RECORD_DURATION_SECONDS} seconds of audio...`);
    console.log('Speak into your microphone...');

    // Create an input stream with a callback to process incoming audio data
    const inputStream = cpal.createStream(
      inputDevice.deviceId,
      true, // true for input stream
      inputConfig,
      (data) => {
        // Store the incoming audio data
        recordedChunks.push(new Float32Array(data));
        totalSamples += data.length;

        // Show recording progress
        const progress = Math.min(
          100,
          Math.round((totalSamples / expectedSamples) * 100)
        );
        process.stdout.write(`\rRecording: ${progress}% complete`);
      }
    );

    // Wait for the recording duration
    await new Promise((resolve) =>
      setTimeout(resolve, RECORD_DURATION_SECONDS * 1000)
    );

    // Close the input stream to stop recording
    console.log('\nStopping recording...');
    cpal.closeStream(inputStream);

    // Calculate total recorded samples
    const totalRecordedSamples = recordedChunks.reduce(
      (acc, chunk) => acc + chunk.length,
      0
    );
    console.log(`\nRecorded ${totalRecordedSamples} samples of audio data`);

    const recordedData = concatenateChunks(
      recordedChunks,
      totalRecordedSamples
    );
    const channelConvertedData = convertChannels(
      recordedData,
      inputConfig.channels,
      outputConfig.channels
    );
    const playbackData = resampleAudio(
      channelConvertedData,
      inputConfig.sampleRate,
      outputConfig.sampleRate,
      outputConfig.channels
    );

    if (
      inputConfig.sampleRate !== outputConfig.sampleRate ||
      inputConfig.channels !== outputConfig.channels
    ) {
      console.log(
        `Converting ${inputConfig.sampleRate} Hz/${inputConfig.channels}ch to ${outputConfig.sampleRate} Hz/${outputConfig.channels}ch`
      );
    }

    console.log('\nPlaying back the recorded audio...');

    const outputStream = cpal.createStream(
      outputDevice.deviceId,
      false,
      outputConfig,
      () => {}
    );

    const playbackDurationMs =
      (playbackData.length /
        outputConfig.channels /
        outputConfig.sampleRate) *
      1000;
    console.log(
      `Expected playback duration: ${(playbackDurationMs / 1000).toFixed(
        1
      )} seconds`
    );

    const chunkFrameCount = 1024;
    const chunkSampleCount = chunkFrameCount * outputConfig.channels;
    const playbackStartedAt = Date.now();

    for (let offset = 0; offset < playbackData.length; offset += chunkSampleCount) {
      const chunk = playbackData.subarray(
        offset,
        Math.min(offset + chunkSampleCount, playbackData.length)
      );
      await writeWithBackpressure(outputStream, chunk);

      const progress = Math.min(
        100,
        Math.round(((offset + chunk.length) / playbackData.length) * 100)
      );
      process.stdout.write(`\rPlayback queued: ${progress}%`);
    }

    console.log('\nFinishing playback...');
    const elapsedPlaybackMs = Date.now() - playbackStartedAt;
    await sleep(Math.max(0, playbackDurationMs - elapsedPlaybackMs) + 500);

    cpal.closeStream(outputStream);
    console.log('Done!');
  } catch (error) {
    console.error('\nError:', error.message);
  }
}

// Run the main function
main();
