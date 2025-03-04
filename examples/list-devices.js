/**
 * list-devices.js
 *
 * This example demonstrates how to enumerate audio hosts and devices
 * using node-cpal, and display their capabilities.
 */

const cpal = require('../');

// Helper function to format sample rates nicely
function formatSampleRates(minRate, maxRate) {
  if (minRate === maxRate) {
    return `${minRate} Hz`;
  }
  return `${minRate} - ${maxRate} Hz`;
}

// Helper function to format device capabilities
function formatDeviceCapabilities(device) {
  const result = [];

  // Input capabilities
  if (device.supportedInputConfigs && device.supportedInputConfigs.length > 0) {
    result.push('Input Capabilities:');
    device.supportedInputConfigs.forEach((config, index) => {
      result.push(
        `  Config #${index + 1}: ${formatSampleRates(
          config.minSampleRate,
          config.maxSampleRate
        )}, ${config.channels} channels, ${config.sampleFormat} format`
      );
    });
  } else {
    result.push('Input Capabilities: None');
  }

  // Output capabilities
  if (
    device.supportedOutputConfigs &&
    device.supportedOutputConfigs.length > 0
  ) {
    result.push('Output Capabilities:');
    device.supportedOutputConfigs.forEach((config, index) => {
      result.push(
        `  Config #${index + 1}: ${formatSampleRates(
          config.minSampleRate,
          config.maxSampleRate
        )}, ${config.channels} channels, ${config.sampleFormat} format`
      );
    });
  } else {
    result.push('Output Capabilities: None');
  }

  return result.join('\n');
}

// Main function
async function main() {
  try {
    console.log('=== Audio Hosts ===');
    const hosts = cpal.getHosts();
    hosts.forEach((host) => {
      console.log(`Host: ${host.name} (ID: ${host.id})`);
    });
    console.log('');

    console.log('=== Audio Devices ===');
    try {
      // Get devices from the default host
      const devices = cpal.getDevices();
      console.log(`Found ${devices.length} audio devices\n`);

      // Display all devices with their capabilities
      devices.forEach((device, index) => {
        console.log(`Device #${index + 1}: ${device.name}`);
        console.log(`  ID: ${device.deviceId}`);
        console.log(`  Host: ${device.hostId}`);
        console.log(`  Default Input: ${device.isDefaultInput ? 'Yes' : 'No'}`);
        console.log(
          `  Default Output: ${device.isDefaultOutput ? 'Yes' : 'No'}`
        );
        console.log(`  ${formatDeviceCapabilities(device)}`);
        console.log('');
      });
    } catch (error) {
      console.error('Error getting devices:', error.message);
    }

    // Display default devices
    try {
      const defaultInput = cpal.getDefaultInputDevice();
      console.log(
        `Default Input Device: ${defaultInput.name} (ID: ${defaultInput.deviceId})`
      );
    } catch (error) {
      console.log('No default input device available');
    }

    try {
      const defaultOutput = cpal.getDefaultOutputDevice();
      console.log(
        `Default Output Device: ${defaultOutput.name} (ID: ${defaultOutput.deviceId})`
      );
    } catch (error) {
      console.log('No default output device available');
    }
    console.log('');

    // Display detailed configuration for default devices
    try {
      const defaultOutput = cpal.getDefaultOutputDevice();
      const defaultConfig = cpal.getDefaultOutputConfig(defaultOutput.deviceId);
      console.log('=== Default Output Configuration ===');
      console.log(`Device: ${defaultOutput.name}`);
      console.log(`Sample Rate: ${defaultConfig.sampleRate} Hz`);
      console.log(`Channels: ${defaultConfig.channels}`);
      console.log(`Format: ${defaultConfig.sampleFormat}`);
      console.log('');
    } catch (error) {
      console.log('Could not get default output configuration:', error.message);
    }

    try {
      const defaultInput = cpal.getDefaultInputDevice();
      const defaultConfig = cpal.getDefaultInputConfig(defaultInput.deviceId);
      console.log('=== Default Input Configuration ===');
      console.log(`Device: ${defaultInput.name}`);
      console.log(`Sample Rate: ${defaultConfig.sampleRate} Hz`);
      console.log(`Channels: ${defaultConfig.channels}`);
      console.log(`Format: ${defaultConfig.sampleFormat}`);
    } catch (error) {
      console.log('Could not get default input configuration:', error.message);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run the main function
main();
