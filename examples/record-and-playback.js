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

    // Now play back the recorded audio
    console.log('\nPlaying back the recorded audio...');

    // Create an output stream
    const outputStream = cpal.createStream(
      outputDevice.deviceId,
      false, // false for output stream
      outputConfig,
      () => {} // Empty callback for output stream
    );

    // Function to adapt mono to stereo if needed
    function adaptChannels(monoData, outputChannels) {
      if (outputChannels === 1 || monoData.length === 0) {
        return monoData; // No adaptation needed
      }

      // Convert mono to stereo by duplicating each sample
      const stereoData = new Float32Array(monoData.length * outputChannels);
      for (let i = 0; i < monoData.length; i++) {
        for (let ch = 0; ch < outputChannels; ch++) {
          stereoData[i * outputChannels + ch] = monoData[i];
        }
      }
      return stereoData;
    }

    // Process and play each chunk with a smaller buffer size and longer delay
    const bufferSize = 512; // Smaller buffer size to prevent overflow
    let currentChunkIndex = 0;
    let offsetInCurrentChunk = 0;
    let samplesWritten = 0;

    // Calculate playback duration based on sample rate
    const playbackDurationMs =
      (totalRecordedSamples / inputConfig.sampleRate) * 1000;
    console.log(
      `Expected playback duration: ${(playbackDurationMs / 1000).toFixed(
        1
      )} seconds`
    );

    // Use a try-catch block for each write operation
    while (
      samplesWritten < totalRecordedSamples &&
      currentChunkIndex < recordedChunks.length
    ) {
      try {
        // Get current chunk
        let currentChunk = recordedChunks[currentChunkIndex];

        if (!currentChunk) {
          console.log(
            `\nReached end of recorded data at chunk ${currentChunkIndex}`
          );
          break;
        }

        // Calculate how many samples we can take from the current chunk
        const samplesAvailableInChunk =
          currentChunk.length - offsetInCurrentChunk;
        const samplesToWrite = Math.min(bufferSize, samplesAvailableInChunk);

        if (samplesToWrite <= 0) {
          // Move to the next chunk
          currentChunkIndex++;
          offsetInCurrentChunk = 0;
          continue;
        }

        // Extract the samples from the current chunk
        const samples = currentChunk.subarray(
          offsetInCurrentChunk,
          offsetInCurrentChunk + samplesToWrite
        );

        // Adapt channels if needed (e.g., mono to stereo)
        const adaptedSamples = adaptChannels(samples, outputConfig.channels);

        // Write to the output stream
        cpal.writeToStream(outputStream, adaptedSamples);

        // Update counters
        offsetInCurrentChunk += samplesToWrite;
        samplesWritten += samplesToWrite;

        // Show progress
        const progress = Math.min(
          100,
          Math.round((samplesWritten / totalRecordedSamples) * 100)
        );
        process.stdout.write(`\rPlayback: ${progress}%`);

        // Longer delay to prevent buffer overflow
        // Calculate delay based on sample rate to maintain real-time playback
        const delayMs = (samplesToWrite / inputConfig.sampleRate) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } catch (error) {
        console.error(`\nError during playback: ${error.message}`);
        console.log('Waiting before trying again...');
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Wait a bit to ensure all audio is played
    console.log('\nFinishing playback...');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Close the output stream
    cpal.closeStream(outputStream);
    console.log('Done!');
  } catch (error) {
    console.error('\nError:', error.message);
  }
}

// Run the main function
main();
