// Never print scanner matches, secret values, commit messages or raw errors.
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const tool = process.env.GITLEAKS_BINARY || 'gitleaks';
const common = ['--config', path.join(root, '.gitleaks.toml'), '--redact=100', '--no-banner',
  '--log-level', 'error', '--report-format', 'json', '--report-path', '-'];
function run(args, input, ranges) {
  const result = spawnSync(tool, [...args, ...common], {
    cwd: root, input, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024
  });
  if (![0, 1].includes(result.status)) throw new Error('Secret scanner failed; raw output suppressed');
  const findings = JSON.parse(result.stdout || '[]');
  for (const finding of findings) {
    const range = ranges?.find(row => finding.StartLine >= row.start && finding.StartLine <= row.end);
    console.log(JSON.stringify({
      file: range?.file || finding.File,
      line: range ? finding.StartLine - range.start + 1 : finding.StartLine,
      type: finding.RuleID,
      ...(finding.Commit ? { commit: finding.Commit } : {})
    }));
  }
  console.log(`Secret scan complete: ${findings.length} findings`);
  return findings.length;
}
try {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const ranges = [];
  let input = '', line = 1;
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const content = fs.readFileSync(absolute, 'utf8');
    const count = content.split('\n').length;
    ranges.push({ file, start: line, end: line + count - 1 });
    input += content + '\n';
    line += count;
  }
  let findings = run(['stdin'], input, ranges);
  const base = process.env.SECRET_SCAN_BASE_SHA;
  if (base) {
    if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Invalid scan base SHA');
    findings += run(['git', root, `--log-opts=${base}..HEAD`]);
  }
  process.exitCode = findings ? 1 : 0;
} catch {
  console.error('Secret scan failed; no credential values emitted');
  process.exitCode = 2;
}
