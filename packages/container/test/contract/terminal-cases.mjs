import { createContainer } from '../../dist/container.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { attachTerminal } from '../../dist/terminal/index.js';
export const terminalCases = ['utf8', 'input-eof', 'blocked-input', 'blocked-output', 'terminate', 'render-error', 'exit-results'];
const expect = (ok, message) => { if (!ok) throw new Error(message); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export async function runTerminalCase(name, bytes, workerFactory) {
  const adapter = createLiveWasiAdapter({ workerFactory, pipeBytes: 17 });
  const container = createContainer({ adapters: [adapter], commands: { ui: { adapter: adapter.id, bytes } } });
  let binding, process; const frames = [];
  const text = channel => frames.filter(frame => frame.channel === channel).map(frame => frame.text).join('');
  const ready = deferred(), render = frame => { frames.push(frame); if (text('stdout').includes('ready')) ready.resolve(); };
  const unlocked = () => expect(!process.stdin.locked && !process.stdout.locked && !process.stderr.locked, `${name}: leaked stream lock`);
  const attach = async (mode, options = {}) => {
    process = await container.spawn('ui', [mode]); binding = attachTerminal(process, { render, maxRenderBytes: 1, ...options });
  };
  try {
    if (name === 'utf8') {
      await attach('utf8'); const result = await binding.completed;
      expect(result.code === 0 && text('stdout') === '\ufeff한\0��' && text('stderr') === '글�', 'UTF-8 decoder boundaries or EOF flush changed output');
    } else if (name === 'input-eof') {
      await attach('echo'); const bytes = new Uint8Array([0xed, 0x95, 0x9c, 0, 255, 10]);
      await binding.write(bytes); await binding.closeInput(); await binding.closeInput();
      expect((await binding.completed).code === 0 && text('stdout') === '한\0�\n', 'stdin EOF or UI decoding failed');
      const saved = container.fs.readFile('/workspace/input.bin');
      expect(saved.length === bytes.length && saved.every((byte, i) => byte === bytes[i]), 'UI decoder changed workspace bytes');
    } else if (name === 'blocked-input' || name === 'terminate') {
      await attach(name === 'terminate' ? 'loop' : 'input'); await ready.promise;
      if (name === 'terminate') await binding.terminate(); else await binding.dispose();
      expect((await binding.completed).reason === 'terminated', `${name}: command did not stop`);
    } else if (name === 'blocked-output') {
      const entered = deferred(); let signal, calls = 0;
      await attach('flood', { render(frame) { signal = frame.signal; calls++; entered.resolve(); return new Promise(() => {}); } });
      await entered.promise; await new Promise(resolve => setTimeout(resolve, 20)); await binding.dispose();
      expect(signal.aborted && calls === 1 && (await binding.completed).reason === 'terminated', 'output cancellation waited for renderer');
    } else if (name === 'render-error') {
      const error = new Error('render fixture failure');
      await attach('flood', { render() { throw error; } });
      let caught; try { await binding.completed; } catch (failure) { caught = failure; }
      expect(caught === error && (await process.exited).reason === 'terminated', 'renderer failure lost its cause or guest');
    } else if (name === 'exit-results') {
      for (const mode of ['exit', 'trap']) {
        await attach(mode); const result = await binding.completed;
        expect(mode === 'exit' ? result.code === 23 && result.reason === 'exited' : result.code === null && result.reason === 'runtime-error', `${mode}: result was changed`);
        unlocked();
      }
    } else throw new Error(`Unknown terminal case ${name}`);
    unlocked(); await binding.dispose();
    expect((await container.inspect()).processes.length === 0, `${name}: process leaked`);
    // Every failure/cancellation path must allow a new real guest in the owner.
    expect((await container.run('ui', ['exit'])).code === 23, `${name}: restart failed`);
    return { name, frames: frames.length, processes: (await container.inspect()).processes.length };
  } finally { await binding?.dispose(); await container.dispose(); }
}
