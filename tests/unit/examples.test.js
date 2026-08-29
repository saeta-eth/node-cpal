const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXAMPLES = path.resolve(__dirname, '../..', 'examples');
const packageJson = require('../../examples/package.json');

describe('Examples', () => {
  const javascriptFiles = fs
    .readdirSync(EXAMPLES)
    .filter((file) => file.endsWith('.js'));

  it('keeps every npm command backed by a runnable file', () => {
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      const match = /^node ([^ ]+\.js)$/.exec(command);
      assert(match, `${name} must run one JavaScript example`);
      assert(
        fs.existsSync(path.join(EXAMPLES, match[1])),
        `${name} points to missing file ${match[1]}`
      );
    }
  });

  it('parses every JavaScript example', () => {
    for (const file of javascriptFiles) {
      const source = fs.readFileSync(path.join(EXAMPLES, file), 'utf8');
      assert.doesNotThrow(
        () => new vm.Script(source, { filename: file }),
        `${file} must contain valid JavaScript`
      );
    }
  });

  it('uses canonical CPAL rather than queued top-level calls', () => {
    const queuedCall = /\bcpal\.(?:getHosts|getDevices|getDeviceById|getDefaultInputDevice|getDefaultOutputDevice|getSupportedInputConfigs|getSupportedOutputConfigs|getDefaultInputConfig|getDefaultOutputConfig|createInputStream|createOutputStream|createLoopbackStream)\b/;

    for (const file of javascriptFiles) {
      const source = fs.readFileSync(path.join(EXAMPLES, file), 'utf8');
      assert(!source.includes('.convenience'), `${file} uses cpal.convenience`);
      assert(!queuedCall.test(source), `${file} uses a queued API as top-level CPAL`);
    }
  });
});
