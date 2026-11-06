// 雙平台放料校正模型的自我驗證：node tests/calib3d.js
require('../tools/calib3d/core.js');
require('../tools/calib3d/selftest.js');
const r = globalThis.selfTest(globalThis.CAL);
r.forEach(t => console.log(t.pass ? 'PASS' : 'FAIL', t.name, '|', t.detail));
const fail = r.filter(t => !t.pass).length;
console.log(`${r.length - fail}/${r.length} passed`);
process.exit(fail ? 1 : 0);
