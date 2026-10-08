// BP-38 -- conductor minimo de Chrome headless por CDP (Node 22: WebSocket y fetch nativos),
// mismo enfoque que la prueba de la caja v1.1 (drive.mjs). Sin Puppeteer.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  const profile = join(tmpdir(), `bp38-chrome-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--ignore-certificate-errors', '--no-first-run', '--no-default-browser-check', '--window-size=1280,1100', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return proc;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('Chrome no arranco');
}

export class Page {
  static async open(url, { width = 1280, height = 1100, mobile = false } = {}) {
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
    const p = new Page(t.webSocketDebuggerUrl);
    await p.ready;
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    if (url) await p.goto(url);
    return p;
  }

  constructor(wsUrl) {
    this.id = 0;
    this.pending = new Map();
    this.logs = [];
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((res) => this.ws.addEventListener('open', res));
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        this.logs.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await sleep(2500);
  }

  /** Evalua una expresion (puede ser async) en la pagina y devuelve el valor. */
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }

  async waitFor(expr, timeoutMs = 15000) {
    const t0 = Date.now();
    for (;;) {
      try {
        if (await this.eval(expr)) return;
      } catch { /* todavia no */ }
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout esperando: ${expr}`);
      await sleep(250);
    }
  }

  async shot(path, { fullPage = true } = {}) {
    await sleep(400);
    let clip;
    if (fullPage) {
      const m = await this.send('Page.getLayoutMetrics');
      const h = Math.min(Math.ceil(m.cssContentSize?.height ?? m.contentSize.height), 4000);
      const w = Math.ceil(m.cssLayoutViewport?.clientWidth ?? 1280);
      clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
    }
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage, ...(clip ? { clip } : {}) });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
  }

  close() {
    this.ws.close();
  }
}

export { sleep };
